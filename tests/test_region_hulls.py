"""The region map's province areas for when the outlines can't be loaded: data/be-province-hulls.geojson,
built by scripts/generate-be-province-hulls.mjs from data/be-locode.json. The page loads no geometry
library: the areas are in the file."""

import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), '..')


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def province_codes():
    block = re.search(r'var PROVINCE_CODES = \[(.*?)\];', read('src/shared/be-regions.js'), re.S).group(1)
    return re.findall(r'"(be-[a-z]+)"', block)


def test_one_area_per_province_in_the_pages_order():
    hulls = json.loads(read('data/be-province-hulls.geojson'))
    assert hulls['type'] == 'FeatureCollection'
    assert [f['properties']['code'] for f in hulls['features']] == province_codes()
    for f in hulls['features']:
        ring = f['geometry']['coordinates'][0]
        assert f['geometry']['type'] == 'Polygon'
        assert len(ring) >= 4 and ring[0] == ring[-1]


def test_each_corner_is_one_of_the_provinces_places():
    """A hull's corners are places of its province: after be-locode.json changes, build the file again."""
    places = [p for p in json.loads(read('data/be-locode.json')) if p.get('lat') and p.get('lon')]
    for f in json.loads(read('data/be-province-hulls.geojson'))['features']:
        spots = {(p['lon'], p['lat']) for p in places if p['province_code'] == f['properties']['code']}
        corners = {tuple(c) for c in f['geometry']['coordinates'][0]}
        assert corners <= spots, f['properties']['code']


def test_the_region_map_loads_scripts_of_this_site_only():
    srcs = re.findall(r'<script[^>]*\bsrc="([^"]+)"', read('region-map.html'))
    assert srcs and all(not re.match(r'(https?:)?//', s) for s in srcs), srcs
