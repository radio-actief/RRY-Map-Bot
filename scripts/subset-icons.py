#!/usr/bin/env python3
"""Rebuild lib/css/bootstrap-icons.css and its font with only the icons the pages use.

The full Bootstrap Icons set (vendor/bootstrap-icons, not served) is 86 KB of CSS and a 130 KB font;
the tools use about twenty-five icons. Run this after using a new icon (`bi-...` in a page, a script
or the configurator's source):

    python3 scripts/subset-icons.py        # needs fonttools and brotli (pip install fonttools brotli)

tests/test_icon_subset.py fails when a page uses an icon the subset lacks.
"""
import hashlib
import os
import re
import sys

SOURCES = ('index.html', 'stats.html', 'region-map.html', 'account.html', 'src', 'src/shared')
# The configurator's own source, every folder below it (its components use icons in the top bar).
TREES = ('web/configurator/src',)
ICON = re.compile(r'\bbi-[a-z0-9]+(?:-[a-z0-9]+)*')


def used_icons(root):
    """The bi-* icon names written in the pages and their scripts."""
    found = set()
    files = []
    for source in SOURCES:
        path = os.path.join(root, source)
        files += [path] if os.path.isfile(path) else [
            os.path.join(path, f) for f in sorted(os.listdir(path)) if f.endswith(('.js', '.mjs', '.html'))]
    for tree in TREES:
        for folder, _dirs, names in sorted(os.walk(os.path.join(root, tree))):
            files += [os.path.join(folder, f) for f in sorted(names) if f.endswith(('.ts', '.tsx'))]
    for f in files:
        found.update(ICON.findall(open(f, encoding='utf-8').read()))
    return found


def main(root):
    from fontTools import subset

    vendor = os.path.join(root, 'vendor', 'bootstrap-icons')
    full_css = open(os.path.join(vendor, 'bootstrap-icons.css'), encoding='utf-8').read()
    codes = dict(re.findall(r'\.(bi-[a-z0-9-]+)::before\{content:"\\([0-9a-f]+)"\}', full_css))
    used = used_icons(root)
    missing = sorted(used - codes.keys())
    if missing:
        sys.exit(f'not in Bootstrap Icons: {missing}')

    out_dir = os.path.join(root, 'lib', 'css', 'fonts')
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, 'bootstrap-icons.subset.woff2')
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = []
    options.name_IDs = []
    font = subset.load_font(os.path.join(vendor, 'bootstrap-icons.woff2'), options)
    sub = subset.Subsetter(options)
    sub.populate(unicodes=[int(codes[name], 16) for name in sorted(used)])
    sub.subset(font)
    subset.save_font(font, tmp, options)
    digest = hashlib.sha256(open(tmp, 'rb').read()).hexdigest()[:10]
    name = f'bootstrap-icons-{digest}.woff2'
    for old in os.listdir(out_dir):
        if old.startswith('bootstrap-icons') and old != 'bootstrap-icons.subset.woff2':
            os.remove(os.path.join(out_dir, old))
    os.replace(tmp, os.path.join(out_dir, name))

    rules = ''.join(f'.{n}::before{{content:"\\{codes[n]}"}}' for n in sorted(used))
    css = (
        '/* Bootstrap Icons v1.11.3 (MIT, https://github.com/twbs/icons), only the icons the pages use:\n'
        ' * built by scripts/subset-icons.py from vendor/bootstrap-icons. */\n'
        f'@font-face{{font-display:block;font-family:bootstrap-icons;src:url("fonts/{name}") format("woff2")}}'
        '.bi::before,[class*=" bi-"]::before,[class^=bi-]::before{display:inline-block;'
        'font-family:bootstrap-icons!important;font-style:normal;font-weight:400!important;font-variant:normal;'
        'text-transform:none;line-height:1;vertical-align:-.125em;-webkit-font-smoothing:antialiased;'
        '-moz-osx-font-smoothing:grayscale}' + rules + '\n'
    )
    open(os.path.join(root, 'lib', 'css', 'bootstrap-icons.css'), 'w', encoding='utf-8').write(css)
    print(f'{len(used)} icons, font {name}')


if __name__ == '__main__':
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
