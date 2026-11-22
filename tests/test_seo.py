"""Search engines: robots.txt and sitemap.xml per address, and each public page's head (title,
description, <html lang>, canonical, languages, share card, JSON-LD) per address and language."""

import json
import os
import re
import sys
from html import unescape

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.seo as seo  # noqa: E402
from config.site_tools import parse_site_tools  # noqa: E402

MAP = 'https://meshmap.example'
STATS = 'https://meshstats.example'
REGIONS = 'https://meshregions.example'
CONF = 'https://meshconfigurator.example'
ALIAS = 'map.alias.example'
HOSTS = {'map': MAP, 'stats': STATS, 'regionMap': REGIONS, 'configurator': CONF}


def tool_list(**flags):
    raw = [
        {'key': 'map', 'label': 'Map', 'url': f'{MAP}/'},
        {'key': 'stats', 'label': 'Stats', 'url': f'{STATS}/', **flags},
        {'key': 'regionMap', 'label': 'Region map', 'url': f'{REGIONS}/', **flags},
        {'key': 'configurator', 'label': 'Configurator', 'url': f'{CONF}/', **flags},
        {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    ]
    return parse_site_tools(json.dumps(raw))


@pytest.fixture
def site(tmp_path, monkeypatch):
    dist = tmp_path / 'configurator'
    dist.mkdir()
    (dist / 'index.html').write_text(
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>old</title>\n'
        '<meta name="description" content="old" />\n</head><body><div id="app"></div></body></html>\n'
    )
    monkeypatch.setattr(app_module, 'CONFIGURATOR_DIST', str(dist))
    monkeypatch.setattr(app_module, 'SITE_TOOLS', tool_list(redirectOldPath=True))

    def use(tools):
        monkeypatch.setattr(app_module, 'SITE_TOOLS', tools)
    return use


def get(url, **kw):
    scheme, rest = url.split('://', 1)
    host, _, path = rest.partition('/')
    return app_module.app.test_client().get('/' + path, base_url=f'{scheme}://{host}', **kw)


def head(resp):
    """The tags of a page's <head> as (tag, attrs) pairs, and the JSON-LD."""
    html = resp.get_data(as_text=True)
    head_html = html.split('</head>', 1)[0]
    tags = [(m.group(1).lower(), dict((k.lower(), unescape(v)) for k, v in re.findall(r'([\w:-]+)="([^"]*)"', m.group(2))))
            for m in re.finditer(r'<(meta|link|html)\b([^>]*)>', head_html)]
    ld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', head_html, re.S)
    title = re.findall(r'<title[^>]*>(.*?)</title>', head_html, re.S)
    return html, tags, [json.loads(x) for x in ld], title


def meta(tags, **match):
    return [a for t, a in tags if t == 'meta' and all(a.get(k) == v for k, v in match.items())]


def links(tags, rel):
    return [a for t, a in tags if t == 'link' and a.get('rel') == rel]


# robots.txt

def robots_groups(text):
    """{user agent: [rules]} of a robots.txt."""
    groups, agents, rules = {}, [], []
    for line in text.splitlines():
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        field, _, value = line.partition(':')
        field, value = field.strip().lower(), value.strip()
        if field == 'user-agent':
            if rules:
                for a in agents:
                    groups[a] = rules
                agents, rules = [], []
            agents.append(value)
        elif field in ('allow', 'disallow'):
            rules.append(f'{field}: {value}')
    for a in agents:
        groups[a] = rules
    return groups


@pytest.mark.parametrize('key', list(HOSTS))
def test_robots_per_address(site, key):
    resp = get(f'{HOSTS[key]}/robots.txt')
    assert resp.status_code == 200 and resp.mimetype == 'text/plain'
    text = resp.get_data(as_text=True)
    groups = robots_groups(text)
    for bot in seo.AI_BOTS:
        assert groups[bot] == ['disallow: /'], bot
    star = groups['*']
    for path in ('/api/', '/auth/', '/account', '/join', '/visit', '/device-hub.html', '/invite/'):
        assert f'disallow: {path}' in star
    assert 'disallow: /' not in star
    for engine in ('Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Qwantbot', 'Ecosia'):
        assert engine not in groups
    assert re.findall(r'^Sitemap: (.*)$', text, re.M) == [f'{HOSTS[key]}/sitemap.xml']


def test_the_ai_list_is_the_owners(site):
    assert len(seo.AI_BOTS) == 35 and len(set(seo.AI_BOTS)) == 35
    for bot in ('GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'TikTokSpider'):
        assert bot in seo.AI_BOTS


def test_robots_on_another_name_for_the_map(site):
    text = get(f'https://{ALIAS}/robots.txt').get_data(as_text=True)
    assert re.findall(r'^Sitemap: (.*)$', text, re.M) == [f'{MAP}/sitemap.xml']
    resp = get(f'https://{ALIAS}/sitemap.xml')
    assert resp.status_code == 301 and resp.headers['Location'] == f'{MAP}/sitemap.xml'


# sitemap.xml

def sitemap(url):
    resp = get(url)
    assert resp.status_code == 200 and resp.mimetype == 'application/xml'
    text = resp.get_data(as_text=True)
    entries = re.findall(r'<url><loc>([^<]*)</loc>(.*?)</url>', text)
    return [(unescape(loc), dict((h, unescape(u)) for h, u in re.findall(r'hreflang="([^"]+)" href="([^"]+)"', rest)))
            for loc, rest in entries]


@pytest.mark.parametrize('key', list(HOSTS))
def test_sitemap_per_address(site, key):
    base = f'{HOSTS[key]}/'
    entries = sitemap(f'{base}sitemap.xml')
    assert [loc for loc, _ in entries] == [base, f'{base}?lang=nl', f'{base}?lang=fr']
    for _, alt in entries:
        assert alt == {'en': base, 'nl': f'{base}?lang=nl', 'fr': f'{base}?lang=fr', 'x-default': base}


def test_sitemap_without_addresses_of_their_own(site):
    site([{'key': 'map', 'label': 'Map', 'url': f'{MAP}/'}])
    locs = [loc for loc, _ in sitemap('https://meshmap.example/sitemap.xml')]
    for path in ('', 'stats', 'region-map', 'configurator'):
        assert f'{MAP}/{path}' in locs and f'{MAP}/{path}?lang=nl' in locs and f'{MAP}/{path}?lang=fr' in locs
    assert len(locs) == 12


def test_hidden_pages_stay_out_of_the_sitemap(site):
    site(tool_list(hidden=True))
    assert sitemap(f'{STATS}/sitemap.xml') == []
    # ... and their page names the path on the map as its address
    _, tags, _, _ = head(get(f'{STATS}/'))
    assert links(tags, 'canonical')[0]['href'] == f'{MAP}/stats'


# The pages' heads

KEYS = list(HOSTS)
TEXTS = {(k, lang): seo.page_texts(k, lang) for k in KEYS for lang in seo.LANGS}


@pytest.mark.parametrize('key', KEYS)
@pytest.mark.parametrize('lang', seo.LANGS)
def test_texts_fit_the_rules(key, lang):
    t = TEXTS[(key, lang)]
    assert 0 < len(t['title']) <= 60, t['title']
    assert 140 <= len(t['description']) <= 160, (len(t['description']), t['description'])
    assert t['heading'] and t['text']
    assert '#BEmesh' in t['title'] and 'MeshCore' in t['title']


def test_titles_are_unique():
    titles = [t['title'] for t in TEXTS.values()]
    assert len(set(titles)) == len(titles)


@pytest.mark.parametrize('key', KEYS)
@pytest.mark.parametrize('lang', seo.LANGS)
def test_head_per_address_and_language(site, key, lang):
    base = f'{HOSTS[key]}/'
    url = base if lang == 'en' else f'{base}?lang={lang}'
    resp = get(url)
    assert resp.status_code == 200
    html, tags, ld, title = head(resp)
    t = TEXTS[(key, lang)]
    assert re.search(rf'<html lang="{lang}"', html)
    assert title == [t['title']]
    assert [m['content'] for m in meta(tags, name='description')] == [t['description']]
    keywords = meta(tags, name='keywords')[0]['content'].split(', ')
    for word in ('MeshCore Belgium', 'MeshCore België', 'MeshCore Belgique', '#BEmesh', "regio's", 'Radio-Actief'):
        assert word in keywords
    assert len(keywords) == len(seo.KEYWORDS) + len(seo.PAGE_KEYWORDS[key])
    assert [x['href'] for x in links(tags, 'canonical')] == [url]
    alternates = {x['hreflang']: x['href'] for x in links(tags, 'alternate')}
    assert alternates == {'en': base, 'nl': f'{base}?lang=nl', 'fr': f'{base}?lang=fr', 'x-default': base}
    og = {a['property']: a['content'] for _, a in tags if a.get('property', '').startswith('og:') and a['property'] != 'og:locale:alternate'}
    assert og['og:title'] == t['title'] and og['og:description'] == t['description']
    assert og['og:url'] == url and og['og:type'] == 'website' and og['og:site_name'] == '#BEmesh – MeshCore Belgium'
    assert og['og:locale'] == {'en': 'en_GB', 'nl': 'nl_BE', 'fr': 'fr_BE'}[lang]
    assert og['og:image'] == f'{HOSTS[key]}/img/share/bemesh-card.png'
    assert (og['og:image:width'], og['og:image:height']) == ('1200', '630')
    assert sorted(a['content'] for a in meta(tags, property='og:locale:alternate')) == sorted(
        v for k, v in seo.OG_LOCALES.items() if k != lang)
    assert meta(tags, name='twitter:card')[0]['content'] == 'summary_large_image'
    assert meta(tags, name='twitter:image')[0]['content'] == og['og:image']
    assert not meta(tags, name='robots')
    # JSON-LD: the organisation, this address as a website, and what the page is
    graph = ld[0]['@graph']
    types = [n['@type'] for n in graph]
    want = {'map': 'Map', 'regionMap': 'Map', 'stats': 'Dataset', 'configurator': 'WebApplication'}[key]
    assert types == ['Organization', 'WebSite', want]
    org, website, page = graph
    assert org['name'] == 'Radio-Actief' and org['logo'].endswith('/img/radio-actief-logo-256.png')
    assert any('discord' in u for u in org['sameAs']) and 'https://github.com/radio-actief' in org['sameAs']
    assert website['url'] == base and page['url'] == url and page['description'] == t['description']
    if key == 'configurator':
        assert page['operatingSystem'] == 'Web browser' and page['offers']['price'] == '0'
        assert page['inLanguage'] == ['en', 'nl', 'fr'] and page['areaServed']['name'] == 'Belgium'
        assert page['applicationCategory']
    # The charset stays first in <head>
    assert re.search(r'<head[^>]*>\s*(<meta name="bemesh-site"[^>]*>)?\s*<meta charset', html, re.I)


@pytest.mark.parametrize('key', ['map', 'stats', 'regionMap'])
@pytest.mark.parametrize('lang', seo.LANGS)
def test_what_this_is_is_in_the_page_in_its_language(site, key, lang):
    html = get(f'{HOSTS[key]}/?lang={lang}').get_data(as_text=True)
    body = html.split('<body', 1)[1]
    t = TEXTS[(key, lang)]
    from html import escape
    assert re.search(r'<h1 id="page-intro-title" data-i18n="[\w.]+intro.heading">' + re.escape(escape(t['heading'], quote=False)) + '</h1>', body)
    assert re.search(r'<p data-i18n="[\w.]+intro.text">' + re.escape(escape(t['text'], quote=False)) + '</p>', body)


def test_language_from_the_shared_choice_and_the_browser(site):
    client = app_module.app.test_client()
    client.set_cookie('bemesh_lang', 'fr', domain='meshmap.example')
    resp = client.get('/', base_url=MAP)
    html, tags, _, title = head(resp)
    assert '<html lang="fr"' in html and title == [TEXTS[('map', 'fr')]['title']]
    # Its address stays the clean one: the language came from the cookie, not the address
    assert links(tags, 'canonical')[0]['href'] == f'{MAP}/'
    assert {'Cookie', 'Accept-Language'} <= set(resp.vary)
    html, _, _, title = head(get(f'{STATS}/', headers={'Accept-Language': 'nl-BE,nl;q=0.9'}))
    assert '<html lang="nl"' in html and title == [TEXTS[('stats', 'nl')]['title']]
    # ?lang=en is the clean address
    _, tags, _, _ = head(get(f'{MAP}/?lang=en'))
    assert links(tags, 'canonical')[0]['href'] == f'{MAP}/'


def test_another_name_for_the_map_points_at_the_map(site):
    for url in (f'https://{ALIAS}/', f'https://{ALIAS}/?lang=nl&utm_source=x'):
        _, tags, ld, _ = head(get(url))
        lang = 'nl' if 'lang=nl' in url else None
        want = f'{MAP}/' + (f'?lang={lang}' if lang else '')
        assert links(tags, 'canonical')[0]['href'] == want
        assert meta(tags, property='og:url')[0]['content'] == want
        assert ld[0]['@graph'][1]['url'] == f'{MAP}/'


def test_old_paths_point_at_their_address(site):
    site(tool_list())  # shown, the old paths still answer
    _, tags, _, _ = head(get(f'{MAP}/stats?lang=fr'))
    assert links(tags, 'canonical')[0]['href'] == f'{STATS}/?lang=fr'
    _, tags, _, _ = head(get(f'{MAP}/region-map'))
    assert links(tags, 'canonical')[0]['href'] == f'{REGIONS}/'


def test_without_a_tool_list_the_pages_name_their_own_paths(site):
    site([])
    _, tags, _, _ = head(get('https://meshmap.example/stats?lang=nl'))
    assert links(tags, 'canonical')[0]['href'] == 'https://meshmap.example/stats?lang=nl'
    _, tags, _, _ = head(get('https://meshmap.example/'))
    assert links(tags, 'canonical')[0]['href'] == 'https://meshmap.example/'


def test_the_page_policy_still_holds(site):
    """JSON-LD is data, not a script: the policy stays as it was, without inline scripts."""
    for key in KEYS:
        resp = get(f'{HOSTS[key]}/')
        policy = resp.headers['Content-Security-Policy']
        script_src = re.search(r'script-src ([^;]*)', policy).group(1)
        assert "'unsafe-inline'" not in script_src
        html = resp.get_data(as_text=True)
        inline = re.findall(r'<script(?![^>]*\bsrc=)([^>]*)>', html)
        assert inline and all('type="application/ld+json"' in attrs for attrs in inline), inline
        ld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)[0]
        assert '</' not in ld


def test_private_pages_are_noindex(site):
    for path in ('/api/v1/health', '/auth/me', '/device-hub.html', '/auth/failed'):
        assert get(f'{MAP}{path}').headers.get('X-Robots-Tag') == 'noindex', path
    assert 'X-Robots-Tag' not in get(f'{MAP}/').headers
    # The account page itself (signed in) and the small sign-in pages say so in their head too
    with open(os.path.join(app_module.PROJECT_ROOT, 'account.html'), encoding='utf-8') as f:
        assert '<meta name="robots" content="noindex" />' in f.read()
    assert '<meta name="robots" content="noindex">' in get(f'{MAP}/auth/failed').get_data(as_text=True)


def test_the_share_card_is_served(site):
    resp = get(f'{MAP}/img/share/bemesh-card.png')
    assert resp.status_code == 200 and resp.mimetype == 'image/png'
    data = resp.get_data()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert int.from_bytes(data[16:20], 'big') == 1200 and int.from_bytes(data[20:24], 'big') == 630
