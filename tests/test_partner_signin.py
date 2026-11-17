"""Sign in with #BEmesh for partner tools (contract v1, phase 2): a one-time consent page per person
and partner, withdrawable on the account page; the partner's token answer has a pairwise subject,
the shown name and membership only. Our own tools keep their answer as it was."""

import json
import os
import sys
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.auth as auth  # noqa: E402
import backend.claims as claims  # noqa: E402
import backend.partners as partners  # noqa: E402
import backend.tool_grants as grants  # noqa: E402
from config.site_tools import parse_site_tools  # noqa: E402

ANN = '111111111111111111'
OWN, PARTNER = 'n' * 40, 'p' * 40
ORIGIN = {'Origin': 'http://localhost'}
TOOLS = parse_site_tools(json.dumps([
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'analyzer', 'label': 'Analyzer', 'url': 'https://analyzer.example/', 'partner': True, 'hidden': True},
]))
CALLBACK = 'https://analyzer.example/auth/callback'


@pytest.fixture(autouse=True)
def site(monkeypatch, tmp_path, temp_db):
    monkeypatch.setattr(auth, 'DISCORD_OAUTH2_CLIENT_ID', 'test-client-id')
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', {'nodebook': OWN, 'analyzer': PARTNER})
    monkeypatch.setattr(grants, '_store', None)
    monkeypatch.setattr(grants, 'GRANTS_DIR', str(tmp_path / 'tool-grants'))
    monkeypatch.setattr(partners, 'SUBJECT_KEY', 's' * 48)


def client():
    return app_module.app.test_client()


def discord_callback(c, state, member=True):
    with mock.patch.object(app_module, 'exchange_code_for_token', return_value={'access_token': 't'}), \
         mock.patch.object(app_module, 'get_user_info',
                           return_value={'id': ANN, 'username': 'ann', 'global_name': 'Ann', 'avatar': 'a1'}), \
         mock.patch.object(auth, 'is_guild_member', return_value=member):
        return c.get('/auth/callback', query_string={'code': 'c', 'state': state})


def sign_in(member=True):
    c = client()
    c.get('/auth/login')
    discord_callback(c, app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)['state'], member)
    return c


def split(location):
    parts = urlsplit(location)
    return f'{parts.scheme}://{parts.netloc}{parts.path}', {k: v[0] for k, v in parse_qs(parts.query).items()}


def authorize(c, tool='analyzer', state='s1', **extra):
    return c.get('/auth/authorize', query_string={'tool': tool, 'state': state, **extra})


def allow(c, state='s1'):
    return c.post('/auth/consent', data={'tool': 'analyzer', 'state': state}, headers=ORIGIN)


def token(code, tool='analyzer', secret=PARTNER):
    return client().post('/auth/token', json={'tool': tool, 'code': code}, headers={'Authorization': f'Bearer {secret}'})


def alive(handle, tool='analyzer', secret=PARTNER):
    return client().post('/auth/alive', json={'tool': tool, 'handle': handle}, headers={'Authorization': f'Bearer {secret}'})


def partner_code(c, state='s1'):
    where, q = split(allow(c, state).headers['Location'])
    assert where == CALLBACK and q['state'] == state
    return q['code']


# The consent page


def test_a_partner_asks_for_consent_before_the_first_code():
    c = sign_in()
    r = authorize(c)
    assert r.status_code == 302
    assert r.headers['Location'] == '/auth/consent?tool=analyzer&state=s1'


def test_the_consent_page_says_what_the_partner_gets_with_cancel_and_allow():
    c = sign_in()
    r = c.get('/auth/consent?tool=analyzer&state=s1', headers={'Accept-Language': 'en'})
    assert r.status_code == 200 and r.headers['Cache-Control'] == 'no-store'
    html = r.get_data(as_text=True)
    assert '<header class="topbar">' in html
    assert '<h1>Sign in to Analyzer with #BEmesh?</h1>' in html
    assert '<p>Analyzer asks for: your display name, and the nodes you share with partner tools.</p>' in html
    assert 'It never gets your Discord account.' in html
    cancel = html.index(f'href="{CALLBACK}?error=access_denied&amp;state=s1"')
    allow_at = html.index('<button type="submit" class="btn primary">Allow</button>')
    assert cancel < allow_at  # Cancel on the left, the main action on the right
    assert '<input type="hidden" name="tool" value="analyzer">' in html
    form_action = r.headers['Content-Security-Policy'].split('form-action')[1].split(';')[0]
    assert 'https://analyzer.example' in form_action
    assert ANN not in html


@pytest.mark.parametrize('lang, title', [('nl', 'Aanmelden bij Analyzer met #BEmesh?'),
                                         ('fr', 'Se connecter à Analyzer avec #BEmesh ?')])
def test_the_consent_page_speaks_the_visitors_language(lang, title):
    html = sign_in().get(f'/auth/consent?tool=analyzer&state=s1&lang={lang}').get_data(as_text=True)
    assert f'<h1>{title}</h1>' in html


def test_allow_is_remembered_and_the_page_is_not_shown_again():
    c = sign_in()
    assert partner_code(c)
    assert partners.has_consent(ANN, 'analyzer')
    where, q = split(authorize(c, state='s2').headers['Location'])
    assert where == CALLBACK and q['state'] == 's2' and q['code']
    # Opening the consent page again goes straight on, too.
    assert c.get('/auth/consent?tool=analyzer&state=s3').headers['Location'].startswith(CALLBACK + '?code=')


def test_allow_only_from_the_consent_page_itself():
    c = sign_in()
    r = c.post('/auth/consent', data={'tool': 'analyzer', 'state': 's1'}, headers={'Origin': 'https://analyzer.example'})
    assert r.status_code == 403
    assert not partners.has_consent(ANN, 'analyzer')


def test_prompt_none_without_consent_tells_the_partner_at_once():
    c = sign_in()
    r = authorize(c, prompt='none')
    assert r.headers['Location'] == CALLBACK + '?error=consent_required&state=s1'
    allow(c)
    assert split(authorize(c, prompt='none').headers['Location'])[1]['code']


def test_signed_out_the_partner_sign_in_goes_through_discord_then_consent():
    c = client()
    assert authorize(c).headers['Location'].startswith('https://discord.com/')
    pending = app_module.read_oauth_pending(c.get_cookie(app_module.OAUTH_COOKIE, path='/auth/').value)
    r = discord_callback(c, pending['state'])
    assert r.headers['Location'] == '/auth/consent?tool=analyzer&state=s1'


def test_the_consent_page_signed_out_starts_the_sign_in():
    r = client().get('/auth/consent?tool=analyzer&state=s1')
    assert r.headers['Location'] == '/auth/authorize?tool=analyzer&state=s1'


@pytest.mark.parametrize('query', ['tool=nodebook&state=s1', 'tool=nope&state=s1', 'tool=analyzer&state=bad%20state', 'tool=analyzer'])
def test_consent_is_only_for_a_partner_with_a_good_state(query):
    c = sign_in()
    assert c.get('/auth/consent?' + query).status_code == 400
    assert c.post('/auth/consent?' + query, headers=ORIGIN).status_code == 400


def test_our_own_tools_never_see_a_consent_page():
    c = sign_in()
    assert authorize(c, tool='nodebook').headers['Location'].startswith('https://nodebook.example/auth/callback?code=')


# What the partner gets


def test_the_partners_token_answer_is_subject_name_and_membership_only():
    c = sign_in()
    r = token(partner_code(c))
    assert r.status_code == 200
    body = r.get_json()
    assert set(body) == {'handle', 'user'}
    assert body['user'] == {'subject': partners.subject('analyzer', ANN), 'displayName': 'Ann', 'isMember': True}
    text = r.get_data(as_text=True)
    for leak in (ANN, 'ann"', 'a1"', 'avatar', 'username', 'discriminator'):
        assert leak not in text


def test_the_subject_at_sign_in_is_the_subject_in_the_claims_feed():
    import sqlite3
    conn = sqlite3.connect(os.environ['DATABASE_PATH'])
    conn.execute("INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, "
                 "discord_owner_name, params, source, is_active) VALUES (?, 2, 'R', 50, 4, ?, 'Ann', '{}', 'app', 1)",
                 ('a1' * 32, ANN))
    conn.commit()
    conn.close()
    user = token(partner_code(sign_in())).get_json()['user']
    feed = client().get('/api/v1/partner/claims', headers={'Authorization': f'Bearer {PARTNER}'}).get_json()
    assert [c['subject'] for c in feed['claims']] == [user['subject']]


def test_a_hidden_name_is_null_for_the_partner_and_membership_is_told():
    claims.save_settings(ANN, show_name=False)
    c = sign_in(member=False)
    user = token(partner_code(c)).get_json()['user']
    assert user['displayName'] is None and user['isMember'] is False


def test_our_own_tools_keep_todays_token_answer():
    c = sign_in()
    code = split(authorize(c, tool='nodebook').headers['Location'])[1]['code']
    body = token(code, tool='nodebook', secret=OWN).get_json()
    assert body['user'] == {'id': ANN, 'username': 'ann', 'global_name': 'Ann', 'discriminator': '0000',
                            'avatar': 'a1', 'is_guild_member': True}
    handle = body['handle']
    assert alive(handle, tool='nodebook', secret=OWN).get_json() == {'alive': True, 'user': body['user']}


def test_alive_works_for_a_partner_with_the_same_user_shape():
    c = sign_in()
    body = token(partner_code(c)).get_json()
    assert alive(body['handle']).get_json() == {'alive': True, 'user': body['user']}


# Withdrawing


def test_the_account_page_lists_allowed_partners_and_withdraws_them():
    c = sign_in()
    assert c.get('/api/v1/account').get_json()['partners'] == []
    body = token(partner_code(c)).get_json()
    assert c.get('/api/v1/account').get_json()['partners'] == [{'key': 'analyzer', 'label': 'Analyzer'}]
    r = c.post('/api/v1/account/partners/analyzer/remove', headers=ORIGIN)
    assert r.status_code == 200
    assert c.get('/api/v1/account').get_json()['partners'] == []
    # The partner's sign-in ends, and the next sign-in asks again.
    assert alive(body['handle']).get_json() == {'alive': False}
    assert authorize(c).headers['Location'] == '/auth/consent?tool=analyzer&state=s1'
    assert c.post('/api/v1/account/partners/analyzer/remove', headers=ORIGIN).status_code == 404


def test_a_code_made_before_withdrawing_is_refused():
    c = sign_in()
    code = partner_code(c)
    c.post('/api/v1/account/partners/analyzer/remove', headers=ORIGIN)
    assert token(code).status_code == 400


def test_withdrawing_needs_a_sign_in_and_the_maps_own_page():
    c = sign_in()
    allow(c)
    assert client().post('/api/v1/account/partners/analyzer/remove', headers=ORIGIN).status_code == 401
    assert c.post('/api/v1/account/partners/analyzer/remove', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert partners.has_consent(ANN, 'analyzer')


def test_a_partner_no_longer_listed_is_not_shown_on_the_account_page(monkeypatch):
    c = sign_in()
    allow(c)
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS[:1])
    assert c.get('/api/v1/account').get_json()['partners'] == []
