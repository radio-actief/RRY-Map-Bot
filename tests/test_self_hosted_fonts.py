"""The pages' fonts (Figtree, JetBrains Mono, Orbitron) come from the site itself, not from Google:
no third-party connection, no visitor data to Google, and font files cached for a year by name."""

import hashlib
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
PAGES = ['index.html', 'stats.html', 'region-map.html', 'account.html', 'web/configurator/index.html']
FONTS_CSS = os.path.join(ROOT, 'src', 'shared', 'fonts.css')


@pytest.mark.parametrize('page', PAGES)
def test_no_page_asks_google_for_fonts(page):
    html = open(os.path.join(ROOT, page), encoding='utf-8').read()
    assert 'fonts.googleapis.com' not in html and 'fonts.gstatic.com' not in html
    assert '/src/shared/fonts.css' in html


def test_every_font_family_the_styles_name_is_defined():
    css = open(FONTS_CSS, encoding='utf-8').read()
    families = set(re.findall(r'font-family:\s*"([^"]+)"', css))
    assert {'Figtree', 'JetBrains Mono', 'Orbitron'} <= families


def test_every_font_file_exists_and_is_named_by_its_content():
    css = open(FONTS_CSS, encoding='utf-8').read()
    files = re.findall(r'url\("fonts/([^"]+\.woff2)"\)', css)
    assert len(files) >= 5
    for name in files:
        path = os.path.join(ROOT, 'src', 'shared', 'fonts', name)
        digest = hashlib.sha256(open(path, 'rb').read()).hexdigest()[:10]
        assert name.endswith(f'-{digest}.woff2'), name


def test_the_page_policy_no_longer_allows_google_fonts():
    policy = app_module.page_policy()
    assert 'googleapis' not in policy and 'gstatic' not in policy


def test_font_files_are_cached_for_a_year():
    client = app_module.app.test_client()
    name = re.findall(r'url\("fonts/([^"]+\.woff2)"\)', open(FONTS_CSS, encoding='utf-8').read())[0]
    r = client.get(f'/src/shared/fonts/{name}')
    assert r.status_code == 200
    assert r.headers['Cache-Control'] == 'public, max-age=31536000, immutable'
    icons = re.findall(r'fonts/(bootstrap-icons-[0-9a-f]+\.woff2)', open(os.path.join(ROOT, 'lib/css/bootstrap-icons.css')).read())[0]
    assert client.get(f'/lib/css/fonts/{icons}').headers['Cache-Control'] == 'public, max-age=31536000, immutable'
