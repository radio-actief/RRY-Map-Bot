"""The language the site's tools share: cookie bemesh_lang, set by the map when a person picks a
language (POST /api/v1/lang) and read by the map's own server pages."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
from config.site_tools import parse_cookie_domain  # noqa: E402

ORIGIN = {'Origin': 'http://localhost'}


@pytest.fixture
def client():
    return app_module.app.test_client()


def pick(client, lang, **headers):
    return client.post('/api/v1/lang', json={'lang': lang}, headers={**ORIGIN, **headers})


def lang_cookie_header(response):
    found = [h for h in response.headers.getlist('Set-Cookie') if h.startswith('bemesh_lang=')]
    assert len(found) == 1
    return found[0]


# The setting


@pytest.mark.parametrize('raw, want', [
    (None, None), ('', None), ('  ', None),
    ('.radio-actief.be', 'radio-actief.be'), ('Radio-Actief.BE', 'radio-actief.be'),
    ('be', None), ('.be', None), ('radio-actief.be/', None), ('*.radio-actief.be', None),
    ('radio actief.be', None), ('-x.be', None), ('127.0.0.1', None),
])
def test_the_cookie_domain_setting(raw, want):
    assert parse_cookie_domain(raw) == want


# Saving a pick


def test_a_pick_is_saved_for_all_tools_in_a_plain_cookie(client):
    r = pick(client, 'nl')
    assert r.status_code == 204
    header = lang_cookie_header(r)
    assert header.startswith('bemesh_lang=nl;')
    assert 'Path=/' in header
    assert 'Max-Age=31536000' in header
    assert 'SameSite=Lax' in header
    assert 'HttpOnly' not in header
    assert 'Domain=' not in header   # no setting: this host only (dev)


def test_with_the_setting_the_cookie_goes_to_the_parent_domain(client, monkeypatch):
    monkeypatch.setattr(app_module, 'LANG_COOKIE_DOMAIN', 'radio-actief.be')
    r = pick(client, 'fr', Origin='https://meshmap.radio-actief.be', Host='meshmap.radio-actief.be')
    assert 'Domain=radio-actief.be' in lang_cookie_header(r)


def test_a_domain_this_host_is_not_in_is_never_used(client, monkeypatch):
    monkeypatch.setattr(app_module, 'LANG_COOKIE_DOMAIN', 'radio-actief.be')
    r = pick(client, 'fr', Origin='https://map.example', Host='map.example')
    assert 'Domain=' not in lang_cookie_header(r)
    r = pick(client, 'fr', Origin='https://xradio-actief.be', Host='xradio-actief.be')
    assert 'Domain=' not in lang_cookie_header(r)


def test_secure_follows_the_session_cookie_setting(client, monkeypatch):
    monkeypatch.setitem(app_module.app.config, 'SESSION_COOKIE_SECURE', True)
    assert 'Secure' in lang_cookie_header(pick(client, 'en'))


@pytest.mark.parametrize('body', [{'lang': 'de'}, {'lang': ''}, {'lang': 5}, {}, None, ['nl']])
def test_an_unknown_language_is_refused_and_nothing_is_saved(client, body):
    r = client.post('/api/v1/lang', json=body, headers=ORIGIN)
    assert r.status_code == 400
    assert not [h for h in r.headers.getlist('Set-Cookie') if h.startswith('bemesh_lang=')]


def test_another_site_cannot_set_the_language(client):
    r = pick(client, 'fr', Origin='https://evil.example')
    assert r.status_code == 403
    assert not r.headers.getlist('Set-Cookie')


def test_the_code_is_saved_in_lower_case(client):
    assert lang_cookie_header(pick(client, 'FR')).startswith('bemesh_lang=fr;')


# The map's own server pages


def test_the_server_pages_follow_the_shared_choice_before_the_browser(client):
    client.set_cookie('bemesh_lang', 'fr')
    page = client.get('/auth/signout', headers={'Accept-Language': 'nl-BE,nl;q=0.9'}).get_data(as_text=True)
    assert '<html lang="fr">' in page


def test_the_server_pages_take_the_first_language_the_site_has(client):
    page = client.get('/auth/signout', headers={'Accept-Language': 'de-DE,de;q=0.9,nl-BE;q=0.8,en;q=0.5'}).get_data(as_text=True)
    assert '<html lang="nl">' in page
    page = client.get('/auth/signout', headers={'Accept-Language': 'de-DE'}).get_data(as_text=True)
    assert '<html lang="en">' in page


def test_lang_in_the_address_wins_on_a_server_page(client):
    client.set_cookie('bemesh_lang', 'fr')
    page = client.get('/auth/failed?lang=nl').get_data(as_text=True)
    assert '<html lang="nl">' in page


def test_an_odd_cookie_value_is_ignored(client):
    client.set_cookie('bemesh_lang', 'de')
    page = client.get('/auth/signout', headers={'Accept-Language': 'fr-BE'}).get_data(as_text=True)
    assert '<html lang="fr">' in page
