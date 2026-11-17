"""The image's web stage builds the configurator and the pages from only some folders of the repo:
every file their code reaches outside web/ must be in a folder that stage copies, or the build fails
in the image although it passes in a full checkout (as 1.4.0's first deploy did)."""

import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..')
SPEC = re.compile(r'''(?:from\s+|import\(\s*|new URL\(\s*)["']((?:\.\./)+[^"'`$]+)["']''')


def web_stage_folders():
    text = open(os.path.join(ROOT, 'Dockerfile'), encoding='utf-8').read()
    stage = text.split('FROM ', 2)[1]
    return [m.group(1).rstrip('/') + '/' for m in re.finditer(r'^COPY\s+(\S+)\s+\S+$', stage, re.M)]


def reached_files():
    """Files outside web/ named by a static import, a dynamic import or a literal new URL, following
    those files' own relative imports too."""
    todo, seen = [], set()
    for base, _, files in os.walk(os.path.join(ROOT, 'web', 'configurator', 'src')):
        todo += [os.path.join(base, f) for f in files if f.endswith(('.ts', '.tsx', '.js', '.css'))]
    found = set()
    while todo:
        path = todo.pop()
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        text = open(path, encoding='utf-8').read()
        for spec in SPEC.findall(text) + re.findall(r'''from\s+["'](\./[^"']+)["']''', text):
            if spec.endswith('/'):
                continue  # a folder joined with a name at run time: served by the site, not built
            target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
            rel = os.path.relpath(target, ROOT).replace(os.sep, '/')
            if not rel.startswith(('web/', '..')):
                found.add(rel)
            todo.append(target)
    return found


def test_the_web_stage_copies_everything_the_configurator_imports():
    folders = web_stage_folders()
    missing = sorted(f for f in reached_files() if not any(f.startswith(d) for d in folders))
    assert 'src/map-engine/index.js' in reached_files()
    assert not missing, missing


SITE_PAGES = ('index.html', 'stats.html', 'region-map.html')


def web_stage_copies():
    """Every file and folder the web stage copies, also from a COPY with several sources."""
    text = open(os.path.join(ROOT, 'Dockerfile'), encoding='utf-8').read()
    stage = text.split('FROM ', 2)[1]
    return [src for line in re.findall(r'^COPY\s+(.+)$', stage, re.M) for src in line.split()[:-1]]


def page_files():
    """The files of this site the built pages name: scripts, styles, icons and images, plus what
    their modules import and their stylesheets load."""
    found = set()
    for page in SITE_PAGES:
        html = open(os.path.join(ROOT, page), encoding='utf-8').read()
        found.add(page)
        found.update(re.findall(r'<(?:script|link|img)\b[^>]*\s(?:src|href)="\./([^"]+)"', html))
    todo = [f for f in found if f.endswith(('.js', '.mjs', '.css'))]
    seen = set()
    while todo:
        rel = todo.pop()
        path = os.path.join(ROOT, rel)
        if rel in seen or not os.path.isfile(path):
            continue
        seen.add(rel)
        text = open(path, encoding='utf-8').read()
        specs = SPEC.findall(text) + re.findall(r'''(?:from\s+|import\(\s*|new URL\(\s*)["'`](\./[^"'`$]+)''', text)
        if rel.endswith('.css'):
            specs += [u for u in re.findall(r'''url\(["']?([^"')]+)''', text) if not u.startswith(('#', 'data:', 'http'))]
        for spec in specs:
            if spec.endswith('/'):
                continue  # a folder joined with a name at run time: served by the site, not built
            target = os.path.relpath(os.path.normpath(os.path.join(os.path.dirname(path), spec)), ROOT).replace(os.sep, '/')
            found.add(target)
            if target.endswith(('.js', '.mjs', '.css')):
                todo.append(target)
    return found


def test_the_web_stage_copies_everything_the_pages_load():
    copies = web_stage_copies()
    files = page_files()
    assert {'src/map.js', 'src/stats.js', 'css/map.css', 'lib/maplibre-gl.mjs', 'img/loader.svg', 'favicon.ico'} <= files
    missing = sorted(f for f in files if not any(f == c or (c.endswith('/') and f.startswith(c)) for c in copies))
    assert not missing, missing
    # the pages' messages are read by the build itself (web/site/site-pages.mjs)
    assert any('src/shared/i18n/'.startswith(c) for c in copies if c.endswith('/'))


def test_the_image_gets_both_builds():
    text = open(os.path.join(ROOT, 'Dockerfile'), encoding='utf-8').read()
    runtime = text.split('FROM ', 2)[2]
    assert 'COPY --from=web /app/dist/configurator /app/dist/configurator' in runtime
    assert 'COPY --from=web /app/dist/site /app/dist/site' in runtime
    # the stage's own dist never comes from the build context
    assert 'dist/' in open(os.path.join(ROOT, '.dockerignore'), encoding='utf-8').read().split()
