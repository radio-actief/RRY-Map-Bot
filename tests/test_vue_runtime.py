"""The map page's template is compiled ahead (npm run build:map), so it loads Vue's runtime-only build
(105 KB instead of 166 KB) and the compiler builds are not shipped."""

import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..')
RUNTIME = '../lib/vue.runtime.esm-browser.prod.js'


def test_the_map_loads_vues_runtime_only_build():
    for f in ('src/map.js', 'src/map-app.render.js', 'scripts/build-map-template.mjs'):
        src = open(os.path.join(ROOT, f), encoding='utf-8').read()
        assert RUNTIME in src, f
        assert not re.search(r'lib/vue\.esm-browser', src), f
    assert os.path.exists(os.path.join(ROOT, 'lib', 'vue.runtime.esm-browser.prod.js'))


def test_the_compiler_builds_are_not_shipped():
    for name in ('vue.esm-browser.js', 'vue.esm-browser.min.js', 'vue.esm-browser.prod.js'):
        assert not os.path.exists(os.path.join(ROOT, 'lib', name)), name
