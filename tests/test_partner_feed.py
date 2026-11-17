"""Partner tools (SITE_TOOLS_JSON "partner": true) and the claims feed of contract v1: server to
server with the partner's Bearer secret, no Discord ids, a pairwise subject per person and partner,
each person's choices honoured, and ETag / 304."""

import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402
import backend.claims as claims  # noqa: E402
import backend.partners as partners  # noqa: E402
from config.site_tools import parse_site_tools, shown_tools  # noqa: E402

ANN, BOB, CAT = '111111111111111111', '222222222222222222', '333333333333333333'
A, B, C, D = 'a1' * 32, 'b2' * 32, 'c3' * 32, 'd4' * 32
PARTNER_SECRET = 'p' * 40
OTHER_PARTNER_SECRET = 'q' * 40
OWN_SECRET = 'n' * 40
SUBJECT_KEY = 's' * 48
TOOLS = parse_site_tools(json.dumps([
    {'key': 'nodebook', 'label': 'NodeBook', 'url': 'https://nodebook.example/'},
    {'key': 'analyzer', 'label': 'Analyzer', 'url': 'https://analyzer.example/', 'partner': True, 'hidden': True},
    {'key': 'other', 'label': 'Other partner', 'url': 'https://other.example/', 'partner': True},
]))
SECRETS = {'nodebook': OWN_SECRET, 'analyzer': PARTNER_SECRET, 'other': OTHER_PARTNER_SECRET}


@pytest.fixture(autouse=True)
def site(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_TOOLS', TOOLS)
    monkeypatch.setattr(app_module, 'SITE_TOOL_SECRETS', SECRETS)
    monkeypatch.setattr(partners, 'SUBJECT_KEY', SUBJECT_KEY)


@pytest.fixture
def db(temp_db):
    conn = sqlite3.connect(temp_db)
    conn.executemany(
        "INSERT INTO belgian_nodes (public_key, type, adv_name, adv_lat, adv_lon, discord_owner_id, "
        "discord_owner_name, params, source, is_active) VALUES (?, 2, ?, 50.8, 4.3, ?, ?, '{}', 'app', ?)",
        [(A, 'Ann relay', ANN, 'Ann', 1), (B, 'Bob relay', BOB, 'Bob', 1),
         (C, 'Free relay', None, None, 1), (D, 'Gone relay', ANN, 'Ann', 0)],
    )
    conn.execute("INSERT INTO node_claims (public_key, discord_owner_id, discord_owner_name, action, timestamp, source) "
                 "VALUES (?, ?, 'Ann', 'claim', '2026-10-01 08:00:00', 'web')", (A, ANN))
    conn.execute("INSERT INTO node_managers (public_key, discord_id, display_name, added_at, added_by) "
                 "VALUES (?, ?, 'Cat', '2026-11-02T09:30:00Z', ?)", (A, CAT, ANN))
    conn.commit()
    conn.close()
    return temp_db


def feed(secret=PARTNER_SECRET, **headers):
    hdrs = {'Authorization': f'Bearer {secret}', **headers} if secret else headers
    return app_module.app.test_client().get('/api/v1/partner/claims', headers=hdrs)


def expected_subject(partner, person):
    mac = hmac.new(SUBJECT_KEY.encode(), f'partner:{partner}:{person}'.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b'=').decode()[:22]


# The setting


def test_partner_is_kept_only_when_true_and_makes_the_tool_hidden():
    tools = parse_site_tools(json.dumps([
        {'key': 'a', 'label': 'A', 'url': 'https://a.example/', 'partner': True},
        {'key': 'b', 'label': 'B', 'url': 'https://b.example/', 'partner': 'yes'},
        {'key': 'c', 'label': 'C', 'url': 'https://c.example/', 'partner': 1},
    ]))
    assert tools == [
        {'key': 'a', 'label': 'A', 'url': 'https://a.example/', 'hidden': True, 'partner': True},
        {'key': 'b', 'label': 'B', 'url': 'https://b.example/'},
        {'key': 'c', 'label': 'C', 'url': 'https://c.example/'},
    ]
    # Even a partner entry without "hidden" is never shown.
    assert shown_tools([{'key': 'p', 'label': 'P', 'url': '/p/', 'partner': True}]) == []


def test_partners_are_never_shown_named_or_allowed_to_frame_the_device_hub():
    c = app_module.app.test_client()
    assert [t['key'] for t in c.get('/api/v1/site-tools').get_json()] == ['nodebook']
    hub = c.get('/device-hub.html')
    assert 'analyzer.example' not in hub.headers['Content-Security-Policy']
    assert 'other.example' not in hub.headers['Content-Security-Policy']
    page = c.get('/')
    for host in ('analyzer.example', 'other.example', 'Analyzer'):
        assert host not in page.headers.get('Content-Security-Policy', '')


# Who may read it


@pytest.mark.parametrize('secret', [None, 'wrong' * 10, OWN_SECRET])
def test_only_a_partners_secret_opens_the_feed(db, secret):
    r = feed(secret)
    assert r.status_code == 401
    assert r.get_json() == {'error': 'invalid_client'}
    assert r.headers['WWW-Authenticate'] == 'Bearer'


def test_a_call_from_a_browser_is_refused(db):
    assert feed(Origin='https://analyzer.example').status_code == 400
    c = app_module.app.test_client()
    c.set_cookie('bemesh_map_session', 'x')
    r = c.get('/api/v1/partner/claims', headers={'Authorization': f'Bearer {PARTNER_SECRET}'})
    assert r.status_code == 400 and r.get_json() == {'error': 'invalid_request'}


# What it says


def test_the_feed_is_the_contracts_json(db):
    r = feed()
    assert r.status_code == 200
    body = r.get_json()
    assert set(body) == {'version', 'generatedAt', 'claims'}
    assert body['version'] == 1
    assert re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', body['generatedAt'])
    assert body['claims'] == [
        {'publicKey': A, 'role': 'owner', 'subject': expected_subject('analyzer', ANN), 'displayName': 'Ann', 'since': '2026-10-01T08:00:00Z'},
        {'publicKey': A, 'role': 'manager', 'subject': expected_subject('analyzer', CAT), 'displayName': 'Cat', 'since': '2026-11-02T09:30:00Z'},
        {'publicKey': B, 'role': 'owner', 'subject': expected_subject('analyzer', BOB), 'displayName': 'Bob', 'since': None},
    ]


def test_subjects_are_pairwise_and_say_nothing_about_discord(db):
    mine = {c['displayName']: c['subject'] for c in feed().get_json()['claims']}
    theirs = {c['displayName']: c['subject'] for c in feed(OTHER_PARTNER_SECRET).get_json()['claims']}
    assert set(mine) == set(theirs) == {'Ann', 'Bob', 'Cat'}
    for name in mine:
        assert re.fullmatch(r'[A-Za-z0-9_-]{22}', mine[name])
        assert mine[name] != theirs[name]
    # Stable from one call to the next.
    assert mine == {c['displayName']: c['subject'] for c in feed().get_json()['claims']}


def test_no_discord_id_anywhere_in_the_feed(db):
    text = feed().get_data(as_text=True)
    for person in (ANN, BOB, CAT):
        assert person not in text


def test_a_hidden_name_is_null_and_switching_sharing_off_leaves_the_person_out(db):
    claims.save_settings(ANN, show_name=False)
    rows = feed().get_json()['claims']
    assert [(c['role'], c['displayName']) for c in rows if c['publicKey'] == A] == [('owner', None), ('manager', 'Cat')]
    claims.save_settings(CAT, share_partners=False)
    claims.save_settings(BOB, share_partners=False)
    rows = feed().get_json()['claims']
    assert [(c['publicKey'], c['role']) for c in rows] == [(A, 'owner')]


def test_inactive_nodes_and_unclaimed_ones_are_left_out(db):
    keys = {c['publicKey'] for c in feed().get_json()['claims']}
    assert C not in keys and D not in keys


# Caching


def test_an_unchanged_feed_answers_304_and_a_change_gives_a_new_etag(db):
    first = feed()
    etag = first.headers['ETag']
    assert etag
    again = feed(**{'If-None-Match': etag})
    assert again.status_code == 304 and again.get_data() == b''
    # A partner that took the gzipped body sends the weak form back.
    weak = feed(**{'If-None-Match': 'W/' + etag})
    assert weak.status_code == 304
    claims.save_settings(BOB, show_name=False)
    changed = feed(**{'If-None-Match': etag})
    assert changed.status_code == 200 and changed.headers['ETag'] != etag
    assert 'no-store' not in changed.headers['Cache-Control']
    assert 'Authorization' in changed.headers['Vary']


def test_each_partner_has_its_own_etag(db):
    assert feed().headers['ETag'] != feed(OTHER_PARTNER_SECRET).headers['ETag']
