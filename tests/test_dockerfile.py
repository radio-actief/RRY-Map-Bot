"""The image's web stage builds the configurator from only some folders of the repo: every file the
configurator's code reaches outside web/ must be in a folder that stage copies, or the build fails
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
