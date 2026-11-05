#!/usr/bin/env python3
"""Dissolve data/be-provinces.geojson into the 3 Belgian gewesten (regions).

Vlaams Gewest = union of the 5 Flemish provinces.
Waals Gewest  = union of the 5 Walloon provinces.
Brussels Hoofdstedelijk Gewest has no separate polygon: be-bru's own
province boundary already IS the region boundary, so it is not part of
this output (the configurator/region-map already have it as a province).

Output: data/be-gewesten.geojson, same {code, name} property shape as
be-provinces.geojson so it can be loaded and styled the same way.
"""
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "be-provinces.geojson"
DST = ROOT / "data" / "be-gewesten.geojson"

GEWEST_OF_PROVINCE = {
    "be-van": "be-vlg",
    "be-vbr": "be-vlg",
    "be-vov": "be-vlg",
    "be-vwv": "be-vlg",
    "be-vli": "be-vlg",
    "be-wbr": "be-wal",
    "be-wht": "be-wal",
    "be-wlg": "be-wal",
    "be-wna": "be-wal",
    "be-wlx": "be-wal",
}

GEWEST_NAMES = {
    "be-vlg": "Vlaams Gewest",
    "be-wal": "Waals Gewest",
}


def main():
    data = json.loads(SRC.read_text())
    groups = {"be-vlg": [], "be-wal": []}
    for feat in data["features"]:
        code = feat["properties"]["code"]
        gewest = GEWEST_OF_PROVINCE.get(code)
        if not gewest:
            continue
        groups[gewest].append(shape(feat["geometry"]))

    out_features = []
    for gewest_code, geoms in groups.items():
        merged = unary_union(geoms)
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "code": gewest_code,
                    "name": GEWEST_NAMES[gewest_code],
                },
                "geometry": mapping(merged),
            }
        )

    out = {"type": "FeatureCollection", "features": out_features}
    DST.write_text(json.dumps(out))
    print(f"Wrote {DST} ({DST.stat().st_size} bytes, {len(out_features)} features)")


if __name__ == "__main__":
    main()
