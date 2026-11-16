"""Signing in and out the way people do it: two sign-ins at once in one browser, a tool that logs
out without the map asking a second time, the landing page that says it worked, and the sign-out
and failed pages on the site's own top bar."""

import os
import sys
import time
from html.parser import HTMLParser
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.account_sessions as account_sessions  # noqa: E402
import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.tool_grants as grants  # noqa: E402

SECRET = 'n' * 40
TOOLS = [
    {'key': 'map', 'label': 'Map', 'url': 'https://map.example/'},
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'meshmate', 'label': 'MeshMate', 'url': 'https://app.example:8445/'},
    {'key': 'secret', 'label': 'Secret', 'url': 'https://hidden.example/', 'hidden': True},
    {'key': 'docs', 'label': 'Docs', 'url': '/docs/'},
]
SAME = {'Origin': 'http://localhost'}


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {'nodebook': SECRET})
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))
    monkeypatch.setattr(account_sessions, '_store', None)
    monkeypatch.setattr(account_sessions, 'INDEX_DIR', str(tmp_path / 'session-index'))


@pytest.fixture
def client():
    return app_module.app.test_client()


def oauth_cookie(client):
    cookie = client.get_cookie(app_module.OAUTH_COOKIE, path='/auth/')
    return cookie.value if cookie else None


def start(client, path, **args):
    r = client.get(path, query_string=args)
    assert r.headers['Location'].startswith('https://discord.com/')
    return parse_qs(urlsplit(r.headers['Location']).query)['state'][0]


def callback(client, state, user_id='42', member=True, **extra):
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info', return_value={'id': user_id, 'username': 'ann', 'global_name': 'Ann', 'avatar': None}), \
         mock.patch.object(auth, 'is_guild_member', return_value=member):
        return client.get('/auth/callback', query_string={'code': 'c', 'state': state, **extra})


def signed_in(client):
    return client.get('/auth/me').get_json()['authenticated']


def where(location):
    parts = urlsplit(location)
    return f'{parts.scheme}://{parts.netloc}{parts.path}', {k: v[0] for k, v in parse_qs(parts.query).items()}


# 1. Two sign-ins at once


@pytest.mark.parametrize('order', [(0, 1), (1, 0)])
def test_two_tabs_that_started_a_sign_in_both_finish_in_either_order(client, order):
    states = [
        start(client, '/auth/authorize', tool='nodebook', state='tab-a'),
        start(client, '/auth/authorize', tool='nodebook', state='tab-b'),
    ]
    tool_states = ['tab-a', 'tab-b']
    for i in order:
        r = callback(client, states[i])
        assert r.status_code == 302
        to, q = where(r.headers['Location'])
        assert to == 'https://nodebook.example/auth/callback'
        assert q['state'] == tool_states[i] and q['code']
    assert signed_in(client)


def test_a_tool_sign_in_and_a_map_sign_in_at_once_both_finish(client):
    map_state = start(client, '/auth/login', next='/stats')
    tool_state = start(client, '/auth/authorize', tool='nodebook', state='nb-1')
    assert where(callback(client, tool_state).headers['Location'])[0] == 'https://nodebook.example/auth/callback'
    assert callback(client, map_state).headers['Location'] == '/stats'


def test_each_pending_sign_in_keeps_its_own_return_and_only_the_finished_one_goes(client):
    first = start(client, '/auth/login', next='/stats')
    second = start(client, '/auth/login', next='/configurator')
    assert app_module.read_oauth_pending(oauth_cookie(client), first)['next'] == '/stats'
    assert app_module.read_oauth_pending(oauth_cookie(client), second)['next'] == '/configurator'
    assert app_module.read_oauth_pending(oauth_cookie(client))['state'] == second
    callback(client, second)
    assert app_module.read_oauth_pending(oauth_cookie(client), second) is None
    assert app_module.read_oauth_pending(oauth_cookie(client), first)['next'] == '/stats'
    assert callback(client, first).headers['Location'] == '/stats'
    # Nothing pending any more: the cookie is gone.
    assert oauth_cookie(client) is None


def test_at_most_three_sign_ins_wait_the_oldest_goes_first(client):
    states = [start(client, '/auth/login', next=n) for n in ('/stats', '/region-map', '/configurator', '/account')]
    value = oauth_cookie(client)
    assert app_module.read_oauth_pending(value, states[0]) is None
    assert [app_module.read_oauth_pending(value, s)['next'] for s in states[1:]] == ['/region-map', '/configurator', '/account']


def test_a_pending_sign_in_lives_ten_minutes_each(client):
    first = start(client, '/auth/login', next='/stats')
    later = time.time() + 400
    with mock.patch.object(app_module.time, 'time', return_value=later):
        second = start(client, '/auth/login', next='/configurator')
    with mock.patch.object(app_module.time, 'time', return_value=later + 300):
        value = oauth_cookie(client)
        assert app_module.read_oauth_pending(value, first) is None
        assert app_module.read_oauth_pending(value, second)['next'] == '/configurator'


def test_a_stale_sign_in_in_a_signed_in_browser_goes_on_instead_of_failing(client):
    first = start(client, '/auth/login', next='/stats')
    second = start(client, '/auth/login', next='/region-map')
    assert callback(client, second).headers['Location'] == '/region-map'
    # The first tab's Discord page is used again after its sign-in finished: no longer pending.
    assert callback(client, first).headers['Location'] == '/stats'
    again = callback(client, first)
    assert again.headers['Location'] == '/'
    assert signed_in(client)


def test_an_expired_sign_in_in_a_signed_in_browser_goes_on_to_where_it_was_going(client):
    now = time.time()
    old = start(client, '/auth/authorize', tool='nodebook', state='old-tab')
    with mock.patch.object(app_module.time, 'time', return_value=now + 400):
        fresh = start(client, '/auth/login', next='/stats')
    # Ten minutes after the first started, while the second still waits: the first is no longer pending.
    with mock.patch.object(app_module.time, 'time', return_value=now + 700):
        assert callback(client, fresh).headers['Location'] == '/stats'
        r = callback(client, old)
    to, q = where(r.headers['Location'])
    assert to == 'https://nodebook.example/auth/callback'
    assert q['state'] == 'old-tab' and q['code']


def test_a_stale_sign_in_never_signs_in_by_itself(client):
    """Signed out, a state that is no longer pending fails as before: no exchange with Discord."""
    first = start(client, '/auth/login', next='/stats')
    callback(client, first)
    client.post('/auth/logout', headers=SAME)
    with mock.patch.object(app_module, 'exchange_code_for_token') as exchange:
        r = client.get('/auth/callback', query_string={'code': 'c', 'state': first})
    exchange.assert_not_called()
    assert r.headers['Location'].startswith('/auth/failed?reason=expired')
    assert not signed_in(client)


@pytest.mark.parametrize('state', ['forged', '', 'x' * 300, 'é'])
def test_a_forged_state_without_a_session_still_fails(client, state):
    start(client, '/auth/login', next='/stats')
    with mock.patch.object(app_module, 'exchange_code_for_token') as exchange:
        r = client.get('/auth/callback', query_string={'code': 'c', 'state': state})
    exchange.assert_not_called()
    assert r.headers['Location'].startswith('/auth/failed?reason=expired')
    assert not signed_in(client)


def test_a_state_from_another_browser_fails_and_leaves_this_browsers_sign_in_waiting(client):
    other = app_module.app.test_client()
    foreign = start(other, '/auth/login', next='/stats')
    mine = start(client, '/auth/login', next='/configurator')
    r = callback(client, foreign)
    assert r.headers['Location'].startswith('/auth/failed?reason=expired')
    assert not signed_in(client)
    assert callback(client, mine).headers['Location'] == '/configurator'


def test_a_forged_cookie_holds_no_pending_sign_in(client):
    assert app_module.read_oauth_pending('not-a-cookie') is None
    assert app_module.read_oauth_pending(None) is None
    forged = app_module._oauth_serializer().dumps({'pending': 'nope'})
    assert app_module.read_oauth_pending(forged) is None


def test_a_sign_in_started_before_this_version_still_finishes(client):
    """The cookie of one pending sign-in as earlier versions wrote it."""
    old = app_module._oauth_serializer().dumps({'next': '/stats', 'state': 'old-state'})
    client.set_cookie(app_module.OAUTH_COOKIE, old, path='/auth/')
    assert callback(client, 'old-state').headers['Location'] == '/stats'


# 2. Log out from a listed tool without a second question


def test_a_shown_tool_logs_out_and_returns_to_itself(client):
    callback(client, start(client, '/auth/login'))
    r = client.post('/auth/logout', query_string={'next': 'https://nodebook.example/'},
                    headers={'Origin': 'https://nodebook.example'})
    assert r.status_code == 302
    assert r.headers['Location'] == 'https://nodebook.example/'
    assert not signed_in(client)


def test_a_tool_on_another_port_is_known_by_its_whole_origin(client):
    callback(client, start(client, '/auth/login'))
    r = client.post('/auth/logout', query_string={'next': 'https://app.example:8445/'},
                    headers={'Origin': 'https://app.example:8445'})
    assert r.headers['Location'] == 'https://app.example:8445/'
    assert not signed_in(client)


@pytest.mark.parametrize('origin, nxt', [
    ('https://evil.example', 'https://nodebook.example/'),        # a foreign site
    ('https://nodebook.example', 'https://app.example:8445/'),    # a tool sending people to another tool
    ('https://nodebook.example', '/stats'),                       # a tool sending people to a map page
    ('https://nodebook.example', None),                           # no way back named
    ('https://nodebook.example', 'https://nodebook.example/x/'),  # not the listed address
    ('https://app.example', 'https://app.example:8445/'),         # same host, other port
    ('http://nodebook.example', 'https://nodebook.example/'),     # other scheme
    ('https://hidden.example', 'https://hidden.example/'),        # a hidden tool
    ('null', 'https://nodebook.example/'),
])
def test_a_log_out_from_anywhere_else_is_refused(client, origin, nxt):
    callback(client, start(client, '/auth/login'))
    args = {'next': nxt} if nxt else {}
    r = client.post('/auth/logout', query_string=args, headers={'Origin': origin})
    assert r.status_code == 403
    assert signed_in(client)


def test_a_tool_cannot_use_its_referer_or_log_out_everywhere(client):
    callback(client, start(client, '/auth/login'))
    r = client.post('/auth/logout', query_string={'next': 'https://nodebook.example/'},
                    headers={'Referer': 'https://nodebook.example/#/account'})
    assert r.status_code == 403
    r = client.post('/auth/logout-everywhere', query_string={'next': 'https://nodebook.example/'},
                    headers={'Origin': 'https://nodebook.example'})
    assert r.status_code == 403
    assert signed_in(client)


class Page(HTMLParser):
    """The bits of a page these tests look at."""

    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def find(self, tag, **want):
        # '' asks only that the attribute is there (as in <span data-lang-switch>).
        return [a for t, a in self.tags if t == tag and all(
            (k in a) if v == '' else a.get(k) == v for k, v in want.items())]


def page(client, path, **args):
    r = client.get(path, query_string=args)
    assert r.status_code == 200 and r.mimetype == 'text/html'
    p = Page()
    p.feed(r.get_data(as_text=True))
    return r, p


@pytest.mark.parametrize('path', ['/auth/signout', '/auth/failed'])
def test_the_sign_out_and_failed_pages_have_the_sites_bar_and_fonts(client, path):
    r, p = page(client, path)
    body = r.get_data(as_text=True)
    assert p.find('header', **{'class': 'topbar'})
    assert p.find('link', rel='stylesheet', href='/src/shared/fonts.css')
    assert p.find('link', rel='stylesheet', href='/lib/css/bootstrap-icons.css')
    assert p.find('link', rel='preload', **{'as': 'font'})
    assert [a['href'] for a in p.find('a') if a.get('data-i18n', '').startswith('page.')] == [
        '/', '/stats', '/region-map', '/configurator']
    assert p.find('span', **{'data-page-menu': ''}) and p.find('span', **{'data-lang-switch': ''})
    assert p.find('button', **{'data-theme-toggle': ''})
    # No account part in the bar: these pages are about signing in and out.
    assert not p.find('span', **{'data-account-chip': ''})
    scripts = [a['src'] for a in p.find('script')]
    assert scripts == ['/src/shared/i18n.js', '/src/shared/theme.js', '/src/shared/about.js',
                       '/src/shared/menu-place.js', '/src/shared/topbar.js']
    # Scripts of this site only, none inline: the page policy holds.
    assert all(a.get('src') for a in p.find('script'))
    assert '<script>' not in body and 'onclick' not in body.lower()
    policy = r.headers['Content-Security-Policy']
    assert "script-src 'self'" in policy and 'unsafe-eval' not in policy


@pytest.mark.parametrize('lang, cancel, title', [
    ('en', 'Cancel', 'Map'), ('nl', 'Annuleren', 'Kaart'), ('fr', 'Annuler', 'Carte'),
])
def test_the_sign_out_page_has_a_cancel_back_and_speaks_the_language(client, lang, cancel, title):
    r, p = page(client, '/auth/signout', next='https://nodebook.example/', lang=lang)
    body = r.get_data(as_text=True)
    assert f'lang="{lang}"' in body
    assert f'>{cancel}</a>' in body and f'>{title}</a>' in body
    assert p.find('a', href='https://nodebook.example/', **{'class': 'btn'})


def test_the_sign_out_page_cancels_to_the_map_without_a_listed_way_back(client):
    _r, p = page(client, '/auth/signout', next='https://evil.example/')
    assert p.find('a', href='/', **{'class': 'btn'})
    assert not [a for a in p.find('a') if 'evil' in a.get('href', '')]


def test_the_bar_on_these_pages_names_no_hidden_tool(client):
    for path in ('/auth/signout', '/auth/failed'):
        assert 'hidden.example' not in client.get(path).get_data(as_text=True)


# 3. A message after logging out


@pytest.mark.parametrize('nxt, landing', [
    (None, '/?logout=success'),
    ('/', '/?logout=success'),
    ('/stats', '/stats?logout=success'),
    ('/region-map', '/region-map?logout=success'),
    ('/configurator', '/configurator?logout=success'),
    ('/account', '/?logout=success'),
    ('https://nodebook.example/', 'https://nodebook.example/'),
    ('/docs/', '/docs/'),
    ('https://evil.example/', '/?logout=success'),
])
def test_log_out_lands_with_the_message_on_map_pages_only(client, nxt, landing):
    args = {'next': nxt} if nxt else {}
    assert client.post('/auth/logout', query_string=args, headers=SAME).headers['Location'] == landing


def test_log_out_everywhere_lands_with_its_own_message(client):
    callback(client, start(client, '/auth/login'))
    r = client.post('/auth/logout-everywhere', headers=SAME)
    assert r.headers['Location'] == '/?logout=everywhere'
