"""One application, four addresses: the map's stats, region map and configurator may each have a
host name of their own in SITE_TOOLS_JSON, with their page at "/" there. With a list that names
none of them (as now), every page stays on its path of the map's address, exactly as before."""

import html
import json
import os
import re
import sys
from unittest import mock
from urllib.parse import urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
from config.site_tools import (  # noqa: E402
    host_page, old_path_target, own_hosts, own_page_origins, page_links, parse_site_tools,
)

MAP = 'https://map.example'
STATS = 'https://stats.example'
REGIONS = 'https://regions.example'
CONF = 'https://conf.example'
NODEBOOK = 'https://nodebook.example'

# The list as it is now: the map, NodeBook and MeshMate.
TODAY = [
    {'key': 'map', 'label': 'Map', 'url': f'{MAP}/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': f'{NODEBOOK}/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
]


def entries(hidden=(), redirect=()):
    """The six entries, with these keys hidden and these redirecting their old path."""
    raw = [
        {'key': 'map', 'label': 'Map', 'url': f'{MAP}/'},
        {'key': 'stats', 'label': 'Stats', 'url': f'{STATS}/'},
        {'key': 'regionMap', 'label': 'Region map', 'url': f'{REGIONS}/'},
        {'key': 'configurator', 'label': 'Configurator', 'url': f'{CONF}/'},
        {'key': 'nodebook', 'label': 'NodeBook', 'url': f'{NODEBOOK}/'},
        {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example/'},
    ]
    for e in raw:
        if e['key'] in hidden:
            e['hidden'] = True
        if e['key'] in redirect:
            e['redirectOldPath'] = True
    return parse_site_tools(json.dumps(raw))


HIDDEN = entries(hidden=('stats', 'regionMap', 'configurator'))
VISIBLE = entries()
REDIRECTS = entries(redirect=('stats', 'regionMap', 'configurator'))


@pytest.fixture
def conf_dist(tmp_path, monkeypatch):
    dist = tmp_path / 'configurator'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text('<!doctype html><html lang="en"><head><title>configurator-index</title></head><body></body></html>')
    (dist / 'assets' / 'app.js').write_text('console.log(1)')
    monkeypatch.setattr(app_module, 'CONFIGURATOR_DIST', str(dist))
    return dist


@pytest.fixture
def tools(monkeypatch, conf_dist):
    def use(list_):
        monkeypatch.setattr(app_module, 'SITE_TOOLS', list_)
    use(TODAY)
    return use


def get(path, host, **kw):
    return app_module.app.test_client().get(path, base_url=f'https://{host}', **kw)


def links_of(r):
    m = re.search(r'<meta name="bemesh-site" content="([^"]*)">', r.get_data(as_text=True))
    return json.loads(html.unescape(m.group(1))) if m else None


def title_of(r):
    m = re.search(r'<title[^>]*>(.*?)</title>', r.get_data(as_text=True), re.S)
    return m.group(1).strip() if m else ''


# The setting


def test_redirect_old_path_is_kept_only_when_true_on_the_three_pages():
    raw = [
        {'key': 'stats', 'label': 'S', 'url': '/s/', 'redirectOldPath': True},
        {'key': 'regionMap', 'label': 'R', 'url': '/r/', 'redirectOldPath': 'yes'},
        {'key': 'map', 'label': 'M', 'url': '/', 'redirectOldPath': True},
        {'key': 'nodebook', 'label': 'N', 'url': '/n/', 'redirectOldPath': True},
        {'key': 'configurator', 'label': 'C', 'url': '/c/', 'redirectOldPath': True, 'partner': True},
    ]
    tools = parse_site_tools(json.dumps(raw))
    assert [t.get('redirectOldPath') for t in tools] == [True, None, None, None, None]


def test_no_page_has_its_own_address_without_the_map_on_its_own():
    assert own_hosts(TODAY) == {}
    without_map = [t for t in VISIBLE if t['key'] != 'map']
    assert own_hosts(without_map) == {}
    on_a_path = parse_site_tools(json.dumps([{'key': 'map', 'label': 'M', 'url': '/'}, {'key': 'stats', 'label': 'S', 'url': f'{STATS}/'}]))
    assert own_hosts(on_a_path) == {}


def test_a_page_needs_an_address_at_its_root_and_another_host_than_the_map():
    raw = [
        {'key': 'map', 'label': 'M', 'url': f'{MAP}/'},
        {'key': 'stats', 'label': 'S', 'url': f'{STATS}/stats/'},
        {'key': 'regionMap', 'label': 'R', 'url': f'{MAP}/'},
        {'key': 'configurator', 'label': 'C', 'url': 'https://conf.example:8443/'},
    ]
    assert own_hosts(parse_site_tools(json.dumps(raw))) == {'map.example': 'map', 'conf.example:8443': 'configurator'}


def test_a_partner_never_gets_a_page():
    raw = [
        {'key': 'map', 'label': 'M', 'url': f'{MAP}/'},
        {'key': 'stats', 'label': 'S', 'url': f'{STATS}/', 'partner': True},
    ]
    assert own_hosts(parse_site_tools(json.dumps(raw))) == {}


def test_the_hosts_and_their_pages():
    assert own_hosts(HIDDEN) == {'map.example': 'map', 'stats.example': 'stats', 'regions.example': 'regionMap', 'conf.example': 'configurator'}
    assert host_page(HIDDEN, 'STATS.example') == 'stats'
    assert host_page(HIDDEN, 'map.example') is None
    assert host_page(HIDDEN, 'elsewhere.example') is None
    assert own_page_origins(HIDDEN) == [STATS, REGIONS, CONF]


def test_old_paths_redirect_only_when_shown_and_switched_on():
    assert old_path_target(VISIBLE, 'stats') is None
    assert old_path_target(REDIRECTS, 'stats') == STATS
    assert old_path_target(entries(hidden=('stats',), redirect=('stats',)), 'stats') is None
    assert old_path_target(REDIRECTS, 'map') is None


# Today's list: nothing changes


@pytest.mark.parametrize('path, title', [('/', 'map'), ('/stats', 'stats'), ('/region-map', 'region'), ('/configurator', 'configurator-index')])
def test_with_todays_list_every_page_is_on_its_path_and_unchanged(tools, path, title):
    r = get(path, 'map.example')
    assert r.status_code == 200
    assert title in title_of(r).lower()
    assert links_of(r) is None
    assert r.headers['Content-Security-Policy'] == app_module.page_policy()


@pytest.mark.parametrize('host', ['stats.example', 'conf.example'])
def test_with_todays_list_any_host_gets_the_map(tools, host):
    r = get('/', host)
    assert 'map' in title_of(r).lower() and links_of(r) is None


def test_with_todays_list_who_is_signed_in_has_no_cors(tools):
    r = get('/auth/me', 'map.example', headers={'Origin': STATS})
    assert 'Access-Control-Allow-Origin' not in r.headers
    assert 'Origin' not in r.headers.get('Vary', '')


def test_with_todays_list_the_short_links_stay(tools):
    assert get('/join?lang=nl', 'map.example').headers['Location'].endswith('/configurator?lang=nl#companion')
    assert get('/region-configurator', 'map.example').headers['Location'].endswith('/configurator')


# One application, four addresses


@pytest.mark.parametrize('host, title', [
    ('map.example', 'map'), ('stats.example', 'stats'), ('regions.example', 'region'), ('conf.example', 'configurator-index'),
    ('unknown.example', 'map'),
])
def test_each_host_serves_its_page_at_the_root(tools, host, title):
    tools(HIDDEN)
    r = get('/', host)
    assert r.status_code == 200
    assert title in title_of(r).lower()
    assert r.headers['Cache-Control'] == 'no-cache'


def test_a_port_is_part_of_the_host(tools):
    tools(parse_site_tools(json.dumps([
        {'key': 'map', 'label': 'M', 'url': 'http://127.0.0.1:4801/'},
        {'key': 'stats', 'label': 'S', 'url': 'http://127.0.0.1:4802/'},
    ])))
    assert 'stats' in title_of(get('/', '127.0.0.1:4802')).lower()
    assert 'map' in title_of(get('/', '127.0.0.1:4801')).lower()


@pytest.mark.parametrize('path', ['/api/v1/site-tools', '/api/v1/health', '/data/be-provinces.geojson', '/src/shared/topbar.js',
                                  '/lib/vue.runtime.esm-browser.prod.js', '/auth/me', '/configurator/assets/app.js', '/device-hub.html'])
@pytest.mark.parametrize('host', ['map.example', 'stats.example', 'regions.example', 'conf.example'])
def test_the_shared_files_answer_on_every_host(tools, path, host):
    tools(HIDDEN)
    assert get(path, host).status_code == 200


def test_the_old_paths_keep_their_pages_without_the_switch(tools):
    tools(VISIBLE)
    assert 'stats' in title_of(get('/stats', 'map.example')).lower()
    assert 'region' in title_of(get('/region-map', 'map.example')).lower()
    assert 'configurator-index' in title_of(get('/configurator', 'map.example')).lower()


def test_hidden_pages_are_reachable_but_named_nowhere_on_the_map(tools):
    tools(HIDDEN)
    shown = get('/api/v1/site-tools', 'map.example').get_json()
    assert [t['key'] for t in shown] == ['map', 'nodebook', 'meshmate']
    page = get('/', 'map.example')
    assert links_of(page)['pages'] == {'map': '/', 'stats': '/stats', 'regionMap': '/region-map', 'configurator': '/configurator'}
    for name in ('stats.example', 'regions.example', 'conf.example'):
        assert name not in page.headers['Content-Security-Policy']
        assert name not in get('/device-hub.html', 'map.example').headers['Content-Security-Policy']


def test_the_links_of_a_hidden_page_on_its_own_host(tools):
    tools(HIDDEN)
    assert links_of(get('/', 'stats.example')) == {
        'pages': {'map': f'{MAP}/', 'stats': '/', 'regionMap': f'{MAP}/region-map', 'configurator': f'{MAP}/configurator'},
        'map': MAP,
    }


def test_the_links_once_shown(tools):
    tools(VISIBLE)
    shown = {'map': '/', 'stats': f'{STATS}/', 'regionMap': f'{REGIONS}/', 'configurator': f'{CONF}/'}
    assert links_of(get('/', 'map.example')) == {'pages': shown}
    assert links_of(get('/', 'conf.example')) == {
        'pages': {**shown, 'map': f'{MAP}/', 'configurator': '/'}, 'map': MAP, 'hub': f'{MAP}/device-hub.html',
    }


def test_the_links_meta_is_escaped_and_right_after_head(tools):
    tools(VISIBLE)
    body = get('/', 'regions.example').get_data(as_text=True)
    assert re.search(r'<head[^>]*><meta name="bemesh-site" content="\{&quot;pages&quot;', body)
    assert body.count('name="bemesh-site"') == 1


# Old paths: 301 to the new address, keeping what follows and the query


@pytest.mark.parametrize('path, location', [
    ('/stats', f'{STATS}/'),
    ('/stats/', f'{STATS}/'),
    ('/stats?lang=nl', f'{STATS}/?lang=nl'),
    ('/stats/x/y?a=1&b=%2F', f'{STATS}/x/y?a=1&b=%2F'),
    ('/region-map?lang=fr', f'{REGIONS}/?lang=fr'),
    ('/configurator', f'{CONF}/'),
    ('/configurator?handoff=1&preset=eu', f'{CONF}/?handoff=1&preset=eu'),
    ('/configurator/?lang=nl', f'{CONF}/?lang=nl'),
    ('/configurator/some%20page', f'{CONF}/some%20page'),
])
def test_old_paths_answer_301_with_suffix_and_query(tools, path, location):
    tools(REDIRECTS)
    r = get(path, 'map.example')
    assert r.status_code == 301
    assert r.headers['Location'] == location


def test_head_redirects_too_and_a_post_does_not(tools):
    tools(REDIRECTS)
    assert app_module.app.test_client().head('/stats', base_url=f'{MAP}').status_code == 301
    assert app_module.app.test_client().post('/stats', base_url=f'{MAP}', headers={'Origin': MAP}).status_code != 301


def test_the_configurators_files_keep_answering_on_the_old_path(tools):
    tools(REDIRECTS)
    for host in ('map.example', 'conf.example'):
        r = get('/configurator/assets/app.js', host)
        assert r.status_code == 200 and 'javascript' in r.mimetype


def test_a_hidden_page_never_redirects(tools):
    tools(entries(hidden=('stats',), redirect=('stats',)))
    assert get('/stats', 'map.example').status_code == 200


def test_the_short_links_go_to_the_configurators_address_once_it_redirects(tools):
    tools(REDIRECTS)
    assert get('/join?lang=nl', 'map.example').headers['Location'] == f'{CONF}/?lang=nl#companion'
    assert get('/region-configurator', 'map.example').headers['Location'] == f'{CONF}/'


# Who is signed in: CORS for the map's own pages only


@pytest.mark.parametrize('origin', [STATS, REGIONS, CONF])
def test_own_pages_may_ask_who_is_signed_in(tools, origin):
    tools(HIDDEN)
    r = get('/auth/me', 'map.example', headers={'Origin': origin})
    assert r.headers['Access-Control-Allow-Origin'] == origin
    assert r.headers['Access-Control-Allow-Credentials'] == 'true'
    assert 'Origin' in r.headers['Vary']


@pytest.mark.parametrize('origin', [NODEBOOK, 'https://evil.example', MAP, 'null', 'https://stats.example.evil.example'])
def test_no_other_origin_gets_cors(tools, origin):
    tools(VISIBLE)
    r = get('/auth/me', 'map.example', headers={'Origin': origin})
    assert 'Access-Control-Allow-Origin' not in r.headers
    assert 'Access-Control-Allow-Credentials' not in r.headers
    assert 'Origin' in r.headers['Vary']


# Sign in and out on the map's address, back to the page's own


def sign_in_with_next(next_url):
    client = app_module.app.test_client()
    client.get('/auth/login', query_string={'next': next_url}, base_url=MAP)
    cookie = client.get_cookie(app_module.OAUTH_COOKIE, domain='map.example', path='/auth/')
    state = app_module.read_oauth_pending(cookie.value)['state']
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': '42', 'username': 'ann', 'global_name': 'Ann', 'avatar': 'a1'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=True):
        r = client.get('/auth/callback', query_string={'code': 'c', 'state': state}, base_url=MAP)
    return client, r


@pytest.fixture
def discord(monkeypatch):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')


@pytest.mark.parametrize('next_url', [f'{STATS}/', f'{CONF}/'])
def test_sign_in_returns_to_a_listed_page(tools, discord, next_url):
    tools(HIDDEN)
    _client, r = sign_in_with_next(next_url)
    assert r.status_code == 302 and r.headers['Location'] == next_url


@pytest.mark.parametrize('next_url', ['https://evil.example/', f'{STATS}/x', f'{STATS}', f'{STATS}/?a=1', 'https://stats.example.evil.example/'])
def test_sign_in_refuses_any_other_next(tools, discord, next_url):
    tools(HIDDEN)
    _client, r = sign_in_with_next(next_url)
    assert r.status_code == 302 and not r.headers['Location'].startswith(next_url)
    assert urlsplit(r.headers['Location']).netloc in ('', 'map.example')


def test_the_sign_out_page_goes_back_to_the_page_with_its_notice(tools, discord):
    tools(VISIBLE)
    client, _ = sign_in_with_next(f'{STATS}/')
    page = client.get('/auth/signout', query_string={'next': f'{STATS}/'}, base_url=MAP)
    assert page.status_code == 200
    assert f'action="/auth/logout?next={STATS.replace(":", "%3A").replace("/", "%2F")}%2F"' in page.get_data(as_text=True)
    assert STATS in page.headers['Content-Security-Policy'].split('form-action')[1]
    out = client.post('/auth/logout', query_string={'next': f'{STATS}/'}, base_url=MAP, headers={'Origin': MAP})
    assert out.status_code == 302 and out.headers['Location'] == f'{STATS}/?logout=success'
    assert client.get('/auth/me', base_url=MAP).get_json() == {'authenticated': False}


def test_another_tool_still_gets_its_address_as_it_is_after_log_out(tools, discord):
    tools(VISIBLE)
    client, _ = sign_in_with_next(f'{STATS}/')
    out = client.post('/auth/logout', query_string={'next': f'{NODEBOOK}/'}, base_url=MAP, headers={'Origin': NODEBOOK})
    assert out.headers['Location'] == f'{NODEBOOK}/'


def test_a_signed_in_person_is_seen_from_the_page_on_its_own_address(tools, discord):
    tools(VISIBLE)
    client, _ = sign_in_with_next(f'{STATS}/')
    r = client.get('/auth/me', base_url=MAP, headers={'Origin': STATS})
    assert r.get_json()['authenticated'] is True
    assert r.headers['Access-Control-Allow-Origin'] == STATS
    # The session cookie is the map's own: it has no Domain, so no other host ever gets it.
    assert client.get_cookie('bemesh_map_session', domain='map.example').domain in ('map.example', '')
    assert client.get_cookie('bemesh_map_session', domain='stats.example') is None


# Page security policy


def directive(policy, name):
    for part in policy.split('; '):
        if part.startswith(name + ' '):
            return part.split(' ')[1:]
    return None


def test_a_page_on_its_own_address_may_ask_the_map_and_frame_its_hub(tools):
    tools(VISIBLE)
    policy = get('/', 'conf.example').headers['Content-Security-Policy']
    assert MAP in directive(policy, 'connect-src')
    assert MAP in directive(policy, 'form-action')
    assert directive(policy, 'frame-src') == ["'self'", MAP]


def test_a_hidden_page_asks_the_map_but_frames_no_hub(tools):
    tools(HIDDEN)
    policy = get('/', 'conf.example').headers['Content-Security-Policy']
    assert MAP in directive(policy, 'connect-src')
    assert directive(policy, 'frame-src') is None


def test_the_maps_own_pages_keep_their_policy(tools):
    tools(VISIBLE)
    policy = get('/', 'map.example').headers['Content-Security-Policy']
    assert policy == app_module.page_policy()
    assert directive(policy, 'frame-src') is None


# The device hub


def test_the_hub_may_be_framed_by_the_shown_pages_on_their_own_address(tools):
    tools(VISIBLE)
    r = get('/device-hub.html', 'map.example')
    assert directive(r.headers['Content-Security-Policy'], 'frame-ancestors') == [
        "'self'", MAP, STATS, REGIONS, CONF, NODEBOOK, 'https://app.example',
    ]
    assert 'X-Frame-Options' not in r.headers


def test_hidden_pages_may_not_frame_the_hub(tools):
    tools(HIDDEN)
    ancestors = directive(get('/device-hub.html', 'map.example').headers['Content-Security-Policy'], 'frame-ancestors')
    assert ancestors == ["'self'", MAP, NODEBOOK, 'https://app.example']


@pytest.mark.parametrize('path', ['/', '/stats', '/configurator', '/account'])
def test_no_other_page_may_be_framed_by_a_tool(tools, path):
    tools(VISIBLE)
    r = get(path, 'map.example')
    assert 'frame-ancestors' not in (r.headers.get('Content-Security-Policy') or '')


def test_the_same_page_on_two_hosts_is_cached_apart(tools):
    tools(VISIBLE)
    a, b = get('/', 'map.example'), get('/', 'stats.example')
    assert a.headers['ETag'] != b.headers['ETag']


def test_page_links_for_no_hosts_is_none():
    assert page_links(TODAY, 'map.example') is None


def test_the_sign_out_and_account_pages_carry_the_links_too(tools, discord):
    tools(VISIBLE)
    signout = get('/auth/signout', 'map.example')
    assert links_of(signout)['pages']['stats'] == f'{STATS}/'
    client, _ = sign_in_with_next(f'{STATS}/')
    account = client.get('/account', base_url=MAP)
    assert account.status_code == 200 and links_of(account)['pages']['configurator'] == f'{CONF}/'
    tools(TODAY)
    assert links_of(get('/auth/signout', 'map.example')) is None
