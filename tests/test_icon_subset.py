"""The map's icons come from a subset of Bootstrap Icons (scripts/subset-icons.py): every icon a page
or script uses is in it, and nothing much else, so the page doesn't load 220 KB for 21 icons."""

import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..')
CSS = os.path.join(ROOT, 'lib', 'css', 'bootstrap-icons.css')


def used_icons():
    import sys
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    from importlib import import_module
    return import_module('subset-icons').used_icons(ROOT)


def test_every_icon_in_use_is_in_the_subset():
    css = open(CSS, encoding='utf-8').read()
    have = set(re.findall(r'\.(bi-[a-z0-9-]+)::before', css))
    used = used_icons()
    assert used, 'the pages use icons'
    assert used <= have, sorted(used - have)


def test_the_subset_holds_only_icons_in_use():
    css = open(CSS, encoding='utf-8').read()
    have = set(re.findall(r'\.(bi-[a-z0-9-]+)::before', css))
    assert have == used_icons()
    assert len(css) < 6000


def test_the_subset_font_is_small_and_named_by_its_content():
    css = open(CSS, encoding='utf-8').read()
    m = re.search(r'url\("fonts/(bootstrap-icons-[0-9a-f]{10}\.woff2)"\)', css)
    assert m, 'the font file name carries a content hash'
    font = os.path.join(ROOT, 'lib', 'css', 'fonts', m.group(1))
    assert os.path.getsize(font) < 12000
    import hashlib
    assert hashlib.sha256(open(font, 'rb').read()).hexdigest()[:10] in m.group(1)
