#!/usr/bin/env python3
"""Build data/countries.geojson: Belgium, its neighbours and the European Union from Natural Earth.

Source: Natural Earth 1:10m admin-0 countries (public domain), downloaded to a
temporary directory. Keeps Belgium, the Netherlands, Luxembourg, France,
Germany and the United Kingdom, clipped to a box around them and simplified
so the file stays small. The European Union (region code eu) is the merged
outline of its 27 member states in Europe, from the Azores and the Canary
Islands to Cyprus, simplified more coarsely.

Output: data/countries.geojson, features with {code, name} properties
(lowercase code, English name), the same shape as be-provinces.geojson.
"""
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "data" / "countries.geojson"

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
MAX_BYTES = 300 * 1024
CLIP = box(-11, 41, 16, 61)  # lon -11..16, lat 41..61
TOLERANCE = 0.01

COUNTRIES = {
    "BEL": ("be", "Belgium"),
    "NLD": ("nl", "Netherlands"),
    "LUX": ("lu", "Luxembourg"),
    "FRA": ("fr", "France"),
    "DEU": ("de", "Germany"),
    "GBR": ("gb", "United Kingdom"),
}

EU_MEMBERS = {
    "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DEU", "DNK", "ESP", "EST", "FIN", "FRA", "GRC", "HUN",
    "IRL", "ITA", "LTU", "LUX", "LVA", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "SWE",
}
EU_CLIP = box(-32, 27, 35, 72)  # Europe, without the overseas regions
EU_TOLERANCE = 0.05


def round_coords(obj, ndigits=4):
    if isinstance(obj, (list, tuple)):
        return [round_coords(o, ndigits) for o in obj]
    return round(obj, ndigits)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "ne_10m_admin_0_countries.geojson"
        urllib.request.urlretrieve(URL, src)
        data = json.loads(src.read_text())

    found = {}
    members = {}
    for feat in data["features"]:
        a3 = feat["properties"].get("ADM0_A3")
        if a3 in EU_MEMBERS:
            members[a3] = shape(feat["geometry"]).intersection(EU_CLIP)
        if a3 not in COUNTRIES:
            continue
        code, name = COUNTRIES[a3]
        geom = shape(feat["geometry"]).intersection(CLIP).simplify(TOLERANCE, preserve_topology=True)
        geometry = mapping(geom)
        geometry["coordinates"] = round_coords(geometry["coordinates"])
        found[a3] = {
            "type": "Feature",
            "properties": {"code": code, "name": name},
            "geometry": geometry,
        }

    missing = (set(COUNTRIES) - set(found)) | (EU_MEMBERS - set(members))
    if missing:
        sys.exit(f"Missing countries in the source: {sorted(missing)}")

    eu = mapping(unary_union(list(members.values())).simplify(EU_TOLERANCE, preserve_topology=True))
    eu["coordinates"] = round_coords(eu["coordinates"], 3)
    union = {"type": "Feature", "properties": {"code": "eu", "name": "European Union"}, "geometry": eu}

    out = {"type": "FeatureCollection", "features": [found[a3] for a3 in COUNTRIES] + [union]}
    text = json.dumps(out, separators=(",", ":"))
    if len(text.encode()) >= MAX_BYTES:
        sys.exit(f"Output is {len(text.encode())} bytes, limit is {MAX_BYTES}; raise TOLERANCE")
    DST.write_text(text)
    print(f"Wrote {DST} ({DST.stat().st_size} bytes, {len(out['features'])} features)")


if __name__ == "__main__":
    main()
