"""The map, stats and region map pages are built (web/site, `npm run build`) into dist/site: their
scripts, styles, fonts and images under /assets/ with a content hash in the name, kept by browsers
for a year, while the page itself is asked for again on every visit. Without a build the pages are
served as they are in the repository."""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import backend.api.app as app_module  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
GZ = {'Accept-Encoding': 'gzip'}
PAGES = {'/': 'index.html', '/stats': 'stats.html', '/region-map': 'region-map.html'}
YEAR = 'public, max-age=31536000, immutable'


@pytest.fixture
def built(tmp_path, monkeypatch):
    """A client whose site has a build: one page per name and two files."""
    dist = tmp_path / 'site'
    (dist / 'assets').mkdir(parents=True)
    for name in PAGES.values():
        (dist / name).write_text(f'<html>built {name} ' + 'x' * 2000 + '</html>')
    (dist / 'assets' / 'index-abc123.js').write_text('console.log(1);' * 200)
    (dist / 'assets' / 'worker-abc123.mjs').write_text('console.log(2)')
    (dist / 'assets' / 'index-abc123.css').write_text('body{margin:0}')
    monkeypatch.setattr(app_module, 'SITE_DIST', str(dist))
    app_module._gzip_cache.clear()
    return app_module.app.test_client()


@pytest.fixture
def unbuilt(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_DIST', str(tmp_path / 'nothing-here'))
    app_module._gzip_cache.clear()
    return app_module.app.test_client()


@pytest.mark.parametrize('path, name', list(PAGES.items()) + [('/' + n, n) for n in PAGES.values()])
def test_a_built_page_is_served_and_asked_for_again_on_every_visit(built, path, name):
    r = built.get(path, headers=GZ)
    assert r.status_code == 200 and r.mimetype == 'text/html'
    assert r.headers['Content-Encoding'] == 'gzip'
    assert r.headers['Cache-Control'] == 'no-cache'
    assert 'Content-Security-Policy' in r.headers
    assert built.get(path).data.startswith(f'<html>built {name}'.encode())
    assert built.get(path, headers={**GZ, 'If-None-Match': r.headers['ETag']}).status_code == 304


@pytest.mark.parametrize('path, name', PAGES.items())
def test_without_a_build_the_page_of_the_repository_is_served(unbuilt, path, name):
    r = unbuilt.get(path)
    assert r.status_code == 200
    assert r.data == open(os.path.join(ROOT, name), 'rb').read()
    assert r.headers['Cache-Control'] == 'no-cache'


def test_an_address_of_the_map_app_gets_the_built_map_page(built):
    r = built.get('/some/place')
    assert r.status_code == 200 and r.data.startswith(b'<html>built index.html')
    assert r.headers['Cache-Control'] == 'no-cache'


@pytest.mark.parametrize('name, mimetype', [
    ('index-abc123.js', 'application/javascript'),
    ('worker-abc123.mjs', 'application/javascript'),
    ('index-abc123.css', 'text/css'),
])
def test_built_files_are_kept_for_a_year(built, name, mimetype):
    r = built.get(f'/assets/{name}', headers=GZ)
    assert r.status_code == 200 and r.mimetype == mimetype
    assert r.headers['Cache-Control'] == YEAR


def test_a_large_built_file_goes_out_compressed(built):
    assert built.get('/assets/index-abc123.js', headers=GZ).headers['Content-Encoding'] == 'gzip'


@pytest.mark.parametrize('path', ['/assets/nope-123.js', '/assets/', '/assets/../index.html', '/assets/..%2F..%2Fpackage.json'])
def test_a_missing_built_file_is_a_404_not_the_map_page(built, path):
    assert built.get(path).status_code == 404


def test_without_a_build_there_are_no_built_files(unbuilt):
    assert unbuilt.get('/assets/index-abc123.js').status_code == 404


def test_the_files_the_pages_load_one_by_one_stay_where_they_were(built):
    """Other pages (the account page, the device hub, the configurator) and old copies of a page
    still ask for them."""
    for path in ('/src/map.js', '/src/shared/i18n.js', '/src/shared/i18n/shared.en.json', '/css/map.css',
                 '/lib/leaflet.js', '/lib/maplibre-gl.mjs', '/img/node_types/1.svg', '/favicon.ico', '/device-hub.html'):
        assert built.get(path).status_code == 200, path


# --- the build itself (CI builds before it runs these; skipped where there is no build) ---

DIST = os.path.join(ROOT, 'dist', 'site')
needs_build = pytest.mark.skipif(not os.path.isfile(os.path.join(DIST, 'index.html')), reason='no dist/site: run `npm run build`')
LOCAL = re.compile(r'''(?:src|href)="(\.{0,2}/[^"]*)"''')


def built_page(name):
    return open(os.path.join(DIST, name), encoding='utf-8').read()


@needs_build
@pytest.mark.parametrize('name', PAGES.values())
def test_a_built_page_loads_only_hashed_files_that_exist(name):
    html = built_page(name)
    refs = [r for r in LOCAL.findall(html) if not r.startswith(('/api/', '/auth/'))]
    scripts_and_styles = re.findall(r'<(?:script|link rel="(?:stylesheet|modulepreload|preload|icon|apple-touch-icon)")[^>]*(?:src|href)="([^"]+)"', html)
    assert scripts_and_styles
    for ref in scripts_and_styles:
        if ref.startswith('https://'):
            continue  # the CDN scripts the page policy names, and the tile host it preconnects to
        assert re.fullmatch(r'/assets/[\w.-]+-[\w-]{8,}\.\w+', ref), ref
        assert os.path.isfile(os.path.join(DIST, ref.lstrip('/'))), ref
    assert not [r for r in refs if r.startswith(('./src/', './lib/', './css/', '/src/', '/lib/', '/css/'))]


@needs_build
@pytest.mark.parametrize('name', PAGES.values())
def test_a_built_page_keeps_its_classic_scripts_and_has_no_inline_script(name):
    html = built_page(name)
    source = open(os.path.join(ROOT, name), encoding='utf-8').read()
    assert not re.search(r'<script(?![^>]*\bsrc=)[^>]*>', html)
    assert not re.search(r'<[a-z][^>]*\son[a-z]+="', html)
    # the language and theme script stays an ordinary script in <head>, before the page draws
    head = html[:html.index('</head>')]
    first = re.search(r'<script src="(/assets/head-[0-9a-f]{10}\.js)"([^>]*)>', head)
    assert first and 'type="module"' not in first.group(2) and 'defer' not in first.group(2) and 'async' not in first.group(2)
    page = re.search(r'data-i18n-page="([\w-]+)"', source).group(1)
    assert f'data-i18n-page="{page}"' in first.group(2)
    assert re.search(r'data-i18n-files="\{[^"]*&quot;nl&quot;:&quot;/assets/' + re.escape(page) + r'\.nl-[0-9a-f]{10}\.json', first.group(2))
    # and the scripts at the end of <body> are still there, as one file
    assert re.search(r'<script src="/assets/page-[0-9a-f]{10}\.js"\s*></script>\s*</body>', html)
    # one stylesheet, marked for the map engines
    assert len(re.findall(r'<link rel="stylesheet"', html)) == 1
    assert re.search(r'<link rel="stylesheet" data-bemesh-styles[^>]*href="/assets/[\w.-]+\.css"', html)


@needs_build
def test_the_built_map_pages_name_the_engine_files_to_preload():
    import html as html_module
    import json
    for name, wanted in (('index.html', True), ('region-map.html', True), ('stats.html', False)):
        m = re.search(r'<meta name="bemesh-engine-files" content="([^"]*)">', built_page(name))
        assert bool(m) == wanted, name
        if not m:
            continue
        files = json.loads(html_module.unescape(m.group(1)))
        assert [f[0] for f in files] == ['modulepreload', 'preload'] and files[1][2] == 'style'
        assert re.fullmatch(r'/assets/maplibre-engine-[\w-]+\.js', files[0][1])
        assert re.fullmatch(r'/assets/maplibre-gl-[\w-]+\.css', files[1][1])
        for f in files:
            assert os.path.isfile(os.path.join(DIST, f[1].lstrip('/'))), f


@needs_build
def test_the_built_styles_keep_the_pages_order():
    """Fonts and icons first, then the site's tokens and shell, the page's own styles last."""
    css_name = re.search(r'href="/assets/([\w.-]+\.css)"', built_page('index.html')).group(1)
    css = open(os.path.join(DIST, 'assets', css_name), encoding='utf-8').read()
    marks = [r'@font-face', r'\.bi::?before', r'--gold:', r'\nbody\s*\{', r'\.map-ctrl\s*\{', r'body\.map-page\s*\{']
    found = [m.start() if m else -1 for m in (re.search(mark, css) for mark in marks)]
    assert all(i >= 0 for i in found), dict(zip(marks, found))
    assert found == sorted(found), dict(zip(marks, found))
    assert 'data:font' not in css and 'data:application/font' not in css
    # as written, not rewritten by a minifier: the tokens keep their own spelling
    tokens = open(os.path.join(ROOT, 'src', 'shared', 'bemesh-tokens.css'), encoding='utf-8').read()
    for line in [l.strip() for l in tokens.splitlines() if l.strip().startswith('--') and 'url(' not in l][:40]:
        assert line in css, line


@needs_build
def test_the_built_files_are_served(monkeypatch):
    monkeypatch.setattr(app_module, 'SITE_DIST', DIST)
    client = app_module.app.test_client()
    for name in os.listdir(os.path.join(DIST, 'assets')):
        r = client.get(f'/assets/{name}')
        assert r.status_code == 200 and r.headers['Cache-Control'] == YEAR, name
        if name.endswith(('.js', '.mjs')):
            assert r.mimetype == 'application/javascript', name


@needs_build
def test_the_built_map_page_has_the_globes_styles_and_projection():
    """Zoomed out, the map page shows the earth as a globe: its background rule is in the page's
    one stylesheet (after the map's own area rule), and the engine chunk carries the projection."""
    css_name = re.search(r'href="/assets/([\w.-]+\.css)"', built_page('index.html')).group(1)
    css = open(os.path.join(DIST, 'assets', css_name), encoding='utf-8').read()
    area, space = css.find('.bemesh-map {'), css.find('.bemesh-map.bemesh-map--space {')
    assert 0 <= area < space
    assert 'background: var(--code-bg);' in css[space:space + 120]
    engine = next(f for f in os.listdir(os.path.join(DIST, 'assets')) if re.fullmatch(r'maplibre-engine-[\w-]+\.js', f))
    code = open(os.path.join(DIST, 'assets', engine), encoding='utf-8').read()
    assert 'vertical-perspective' in code and 'bemesh-map--space' in code and 'transformStyle' in code
