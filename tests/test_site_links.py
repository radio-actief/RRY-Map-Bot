"""GET /api/v1/site-links: the ☰ menu's outside links (Radio-Actief, #BEmesh, MeshWiki, Discord, GitHub)
in menu order with their labels in every site language, readable by the other tools' pages."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')


def test_the_menu_links_come_in_order_with_labels_in_every_language():
    r = app_module.app.test_client().get('/api/v1/site-links', headers={'Origin': 'https://meshmate.radio-actief.be'})
    assert r.status_code == 200
    assert r.headers['Access-Control-Allow-Origin'] == '*'
    links = r.get_json()
    source = json.load(open(os.path.join(ROOT, 'src', 'shared', 'bemesh-links.json'), encoding='utf-8'))
    assert [l['href'] for l in links] == [s['href'] for s in source]
    assert [l['key'] for l in links] == [s['key'] for s in source]
    docs = next(l for l in links if l['key'] == 'link.docs')
    assert docs['label'] == {'en': 'Documentation', 'nl': 'Documentatie', 'fr': 'Documentation'}
    assert set(docs['title']) == {'en', 'nl', 'fr'}
    for l in links:
        assert l['href'].startswith('https://')
        assert all(l['label'][lang] for lang in ('en', 'nl', 'fr'))
