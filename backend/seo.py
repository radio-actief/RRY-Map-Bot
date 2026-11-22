"""Search engines: robots.txt, sitemap.xml and the head tags of the four public pages (map, stats,
region map, configurator), each for the address it is served on.

Search engines may read the public pages; AI crawlers and agents may read nothing; nobody is asked
to read the API, sign-in, account or device pages. Each page tells a search engine its own clean
address (canonical), its three languages (?lang=nl, ?lang=fr; English and x-default at the clean
address), a title and description in the language served, and what it is (JSON-LD).

The titles, descriptions and the pages' visible "what this is" texts are the pages' own messages
(src/shared/i18n/<page>.<lang>.json, web/configurator/src/i18n/<lang>.json), so the server and the
page's script always show the same words."""

import functools
import json
import os
import re
from html import escape
from typing import Optional

from config.site_tools import OWN_PAGES, own_hosts, own_tool, tool_origins

LANGS = ('en', 'nl', 'fr')

# AI crawlers and agents: none of them may read any page (one group, Disallow: /). Search engines
# (Googlebot, Bingbot, Applebot, DuckDuckBot, YandexBot, Qwantbot, Ecosia) fall under "*".
AI_BOTS = (
    'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
    'Claude-Web', 'anthropic-ai', 'CCBot', 'Google-Extended', 'GoogleOther', 'Applebot-Extended',
    'PerplexityBot', 'Perplexity-User', 'Bytespider', 'Amazonbot', 'meta-externalagent',
    'meta-externalfetcher', 'FacebookBot', 'cohere-ai', 'cohere-training-data-crawler', 'Diffbot',
    'Omgilibot', 'Omgili', 'ImagesiftBot', 'YouBot', 'DuckAssistBot', 'MistralAI-User', 'AI2Bot',
    'Ai2Bot-Dolma', 'Timpibot', 'Kangaroo Bot', 'PanguBot', 'Webzio-Extended', 'TikTokSpider',
)

# Everything that is not a page for search engines, on every address: the API, signing in, the
# account and its invitations, the short links and old addresses that only redirect, the device hub
# (a frame for the site's tools) and the raw data files. The pages' scripts, styles, fonts and images
# stay open: a search engine needs them to see the page as people do.
PRIVATE_PATHS = (
    '/api/', '/auth/', '/account', '/invite/', '/join', '/visit', '/device-hub.html', '/data/',
    '/region-configurator', '/configurator.html',
)

# Search-engine "noindex" for whatever these paths answer, in case one is linked from elsewhere.
NOINDEX_PREFIXES = ('/api/', '/auth/', '/account', '/invite/', '/device-hub.html')

KEYWORDS = (
    'MeshCore', 'MeshCore Belgium', 'MeshCore België', 'MeshCore Belgique', 'BEmesh', '#BEmesh',
    'LoRa', 'mesh', 'meshnetwerk', 'réseau maillé', 'network', 'netwerk', 'réseau', 'Belgium',
    'België', 'Belgique', 'Brussels', 'Brussel', 'Bruxelles', 'Flanders', 'Vlaanderen', 'Flandre',
    'Wallonia', 'Wallonië', 'Wallonie', 'Vlaams', 'Waals', 'flamand', 'wallon', 'regions',
    "regio's", 'régions', 'repeater', 'répéteur', 'Radio-Actief',
)
PAGE_KEYWORDS = {
    'map': ('map', 'kaart', 'carte', 'repeater map', 'node map'),
    'stats': ('stats', 'statistieken', 'statistiques', 'network statistics'),
    'regionMap': ('region codes', 'regiocodes', 'codes de région', 'region map', 'regiokaart'),
    'configurator': ('configurator', 'configuratie', 'configuration', 'repeater setup', 'companion'),
}

SITE_NAME = '#BEmesh – MeshCore Belgium'
OG_LOCALES = {'en': 'en_GB', 'nl': 'nl_BE', 'fr': 'fr_BE'}
SHARE_IMAGE = '/img/share/bemesh-card.png'
SHARE_IMAGE_SIZE = (1200, 630)
ORG_LOGO = '/img/radio-actief-logo-256.png'
ORG_URL = 'https://radio-actief.be/'
ORG_GITHUB = 'https://github.com/radio-actief'

# The built page file of each page key, and back.
PAGE_FILES = {'index.html': 'map', 'stats.html': 'stats', 'region-map.html': 'regionMap'}

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
_SITE_MESSAGES = {'map': 'map', 'stats': 'stats', 'regionMap': 'region-map'}


@functools.lru_cache(maxsize=32)
def _messages(key: str, lang: str) -> dict:
    if key == 'configurator':
        path = os.path.join(PROJECT_ROOT, 'web', 'configurator', 'src', 'i18n', f'{lang}.json')
    else:
        path = os.path.join(PROJECT_ROOT, 'src', 'shared', 'i18n', f'{_SITE_MESSAGES[key]}.{lang}.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _prefix(key: str) -> str:
    return 'app' if key == 'configurator' else key


def page_texts(key: str, lang: str) -> dict:
    """{title, description, heading, text} of a page in a language, English where it lacks one."""
    prefix = _prefix(key)
    names = {'title': 'title', 'description': 'description', 'heading': 'intro.heading', 'text': 'intro.text'}
    own, english = _messages(key, lang), _messages(key, 'en')
    return {name: own.get(f'{prefix}.{m}') or english.get(f'{prefix}.{m}', '') for name, m in names.items()}


def page_urls(tools, url_root: str) -> dict:
    """{page key: its public address}: a shown page on an address of its own there ("https://x/"),
    any other page on its path of the map's address. Without addresses of their own (no tool list),
    the paths of the address asked (url_root, ending in "/")."""
    if not own_hosts(tools):
        return {key: url_root + path.lstrip('/') for key, path in OWN_PAGES.items()}
    map_url = own_tool(tools, 'map')['url']
    urls = {}
    for key, path in OWN_PAGES.items():
        tool = own_tool(tools, key)
        urls[key] = tool['url'] if tool and not tool.get('hidden') else map_url + path.lstrip('/')
    return urls


def origin_of(url: str) -> str:
    """The origin ("https://host[:port]") of an address."""
    m = re.match(r'^(https?://[^/]+)', url)
    return m.group(1) if m else url.rstrip('/')


def host_origin(tools, host: str, url_root: str) -> Optional[str]:
    """The public origin of the address asked: a listed page's own address, or url_root's origin
    without a list; None for an address the list doesn't name (another name for the map)."""
    hosts = own_hosts(tools)
    if not hosts:
        return origin_of(url_root)
    key = hosts.get((host or '').lower())
    if key is None:
        return None
    return tool_origins([own_tool(tools, key)])[0]


def lang_url(base: str, lang: Optional[str]) -> str:
    """The address of a page in a language: English is the clean address (also x-default)."""
    return base if lang in (None, 'en') else f'{base}?lang={lang}'


def robots_txt(sitemap: str) -> str:
    lines = ['# #BEmesh – MeshCore Belgium. Search engines welcome; AI crawlers and agents are not.', '']
    lines += [f'User-agent: {bot}' for bot in AI_BOTS]
    lines += ['Disallow: /', '', 'User-agent: *']
    lines += [f'Disallow: {path}' for path in PRIVATE_PATHS]
    lines += ['Allow: /', '', f'Sitemap: {sitemap}', '']
    return '\n'.join(lines)


def sitemap_xml(bases) -> str:
    """The public pages at these addresses, each in its three languages with their alternates."""
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]
    for base in bases:
        alternates = ''.join(
            f'<xhtml:link rel="alternate" hreflang="{lang}" href="{escape(lang_url(base, lang))}"/>' for lang in LANGS
        ) + f'<xhtml:link rel="alternate" hreflang="x-default" href="{escape(base)}"/>'
        for lang in LANGS:
            out.append(f'<url><loc>{escape(lang_url(base, lang))}</loc>{alternates}</url>')
    out.append('</urlset>')
    return '\n'.join(out) + '\n'


def _json_ld(key: str, texts: dict, lang: str, base: str, canonical: str, discord_url: str) -> str:
    origin = origin_of(base)
    org = {
        '@type': 'Organization',
        '@id': ORG_URL + '#organization',
        'name': 'Radio-Actief',
        'url': ORG_URL,
        'logo': origin + ORG_LOGO,
        'sameAs': [u for u in (discord_url, ORG_GITHUB) if u],
    }
    name = texts['title'].split(' – ')[0]
    site = {
        '@type': 'WebSite',
        '@id': base + '#website',
        'url': base,
        'name': name,
        'alternateName': SITE_NAME,
        'inLanguage': list(LANGS),
        'publisher': {'@id': org['@id']},
    }
    belgium = {'@type': 'Country', 'name': 'Belgium'}
    page = {
        'name': name,
        'description': texts['description'],
        'url': canonical,
        'inLanguage': lang,
        'isPartOf': {'@id': site['@id']},
        'publisher': {'@id': org['@id']},
        'image': origin + SHARE_IMAGE,
    }
    if key == 'configurator':
        page.update({
            '@type': 'WebApplication',
            'applicationCategory': 'UtilitiesApplication',
            'operatingSystem': 'Web browser',
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'},
            'inLanguage': list(LANGS),
            'areaServed': belgium,
        })
    elif key == 'stats':
        page.update({
            '@type': 'Dataset',
            'creator': {'@id': org['@id']},
            'spatialCoverage': belgium,
            'isAccessibleForFree': True,
        })
    else:
        page.update({'@type': 'Map', 'spatialCoverage': belgium})
    data = {'@context': 'https://schema.org', '@graph': [org, site, page]}
    # Data, not a script: "</" can't end the element early.
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def head_tags(key: str, lang: str, base: str, asked_lang: Optional[str], discord_url: str = '') -> str:
    """The head tags of a page served in `lang`, at `base` (its public address); `asked_lang` is the
    ?lang= of the request (a known one or None), which its canonical address keeps."""
    texts = page_texts(key, lang)
    canonical = lang_url(base, asked_lang)
    origin = origin_of(base)
    image = origin + SHARE_IMAGE
    prefix = _prefix(key)
    a = escape
    keywords = ', '.join(KEYWORDS + PAGE_KEYWORDS.get(key, ()))
    tags = [
        f'<title data-i18n="{prefix}.title">{a(texts["title"])}</title>',
        f'<meta name="description" content="{a(texts["description"])}" data-i18n-attr="content:{prefix}.description">',
        f'<meta name="keywords" content="{a(keywords)}">',
        f'<link rel="canonical" href="{a(canonical)}">',
        *[f'<link rel="alternate" hreflang="{code}" href="{a(lang_url(base, code))}">' for code in LANGS],
        f'<link rel="alternate" hreflang="x-default" href="{a(base)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{a(SITE_NAME)}">',
        f'<meta property="og:title" content="{a(texts["title"])}">',
        f'<meta property="og:description" content="{a(texts["description"])}">',
        f'<meta property="og:url" content="{a(canonical)}">',
        f'<meta property="og:locale" content="{OG_LOCALES[lang]}">',
        *[f'<meta property="og:locale:alternate" content="{OG_LOCALES[code]}">' for code in LANGS if code != lang],
        f'<meta property="og:image" content="{a(image)}">',
        f'<meta property="og:image:width" content="{SHARE_IMAGE_SIZE[0]}">',
        f'<meta property="og:image:height" content="{SHARE_IMAGE_SIZE[1]}">',
        f'<meta property="og:image:alt" content="{a(SITE_NAME)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{a(texts["title"])}">',
        f'<meta name="twitter:description" content="{a(texts["description"])}">',
        f'<meta name="twitter:image" content="{a(image)}">',
        f'<script type="application/ld+json">{_json_ld(key, texts, lang, base, canonical, discord_url)}</script>',
    ]
    return '\n'.join(tags) + '\n'


_TITLE = re.compile(r'\s*<title\b[^>]*>.*?</title>', re.S | re.I)
_DESCRIPTION = re.compile(r'\s*<meta\s+name="description"[^>]*>', re.S | re.I)
_HTML_LANG = re.compile(r'(<html\b[^>]*?\blang=")[^"]*(")', re.I)
_HEAD = re.compile(r'<head(\s[^>]*)?>', re.I)
_CHARSET = re.compile(r'<meta\s+charset=[^>]*>', re.I)


def render_page(html: str, key: str, lang: str, base: str, asked_lang: Optional[str], after_head: str = '',
                discord_url: str = '') -> str:
    """The page with <html lang>, its own title and description replaced by head_tags() (right after
    its <meta charset>, which stays first; `after_head` goes right after <head>), and its visible
    "what this is" in the language served."""
    html = _TITLE.sub('', html, count=1)
    html = _DESCRIPTION.sub('', html, count=1)
    html = _HTML_LANG.sub(lambda m: m.group(1) + lang + m.group(2), html, count=1)
    html = _HEAD.sub(lambda m: m.group(0) + after_head, html, count=1)
    tags = head_tags(key, lang, base, asked_lang, discord_url)
    if _CHARSET.search(html):
        html = _CHARSET.sub(lambda m: m.group(0) + '\n' + tags, html, count=1)
    else:
        html = _HEAD.sub(lambda m: m.group(0) + '\n' + tags, html, count=1)
    texts = page_texts(key, lang)
    prefix = _prefix(key)
    for name, msg in (('heading', 'intro.heading'), ('text', 'intro.text')):
        marked = re.compile(r'(<(h1|p)\b[^>]*\bdata-i18n="' + re.escape(f'{prefix}.{msg}') + r'"[^>]*>).*?(</\2>)', re.S)
        html = marked.sub(lambda m: m.group(1) + escape(texts[name], quote=False) + m.group(3), html, count=1)
    return html
