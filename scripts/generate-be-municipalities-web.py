#!/usr/bin/env python3
"""
Generate data/be-municipalities.web.json: the browser copy of the 565 municipality borders.

Reads data/be-municipalities.geojson (the full borders the backend geocoder uses), simplifies
each polygon in a metric CRS (EPSG:3812, default 20 m, topology kept per polygon), and writes
every ring as an encoded polyline (Google's algorithm, 5 decimals, lat then lon) in a small
JSON file the configurator decodes on load (web/configurator/src/core/borders.ts).

Format: {"format": "be-municipalities-web/1", "precision": 5, "simplifyMeters": 20,
         "features": [{"p": {nis5, plaats, gemeente, province_code, city_code},
                       "g": [[ring, hole, ...], ...]}]}   one list of rings per polygon.

Run it again whenever data/be-municipalities.geojson changes.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    import shapely
    from shapely.geometry import shape
except ImportError as e:  # pragma: no cover
    raise SystemExit("shapely is required. Install with: pip install -r requirements.txt") from e
try:
    from pyproj import Transformer
except ImportError as e:  # pragma: no cover
    raise SystemExit("pyproj is required. Install with: pip install -r requirements.txt") from e

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_INPUT = DATA_DIR / "be-municipalities.geojson"
DEFAULT_OUTPUT = DATA_DIR / "be-municipalities.web.json"


def encode_value(v: int) -> str:
    v = ~(v << 1) if v < 0 else (v << 1)
    out = []
    while v >= 0x20:
        out.append(chr((0x20 | (v & 0x1F)) + 63))
        v >>= 5
    out.append(chr(v + 63))
    return "".join(out)


def encode_ring(coords, precision: int) -> str:
    """One ring of (lon, lat) points as an encoded polyline (lat first, as Google's algorithm)."""
    factor = 10**precision
    out, plat, plon = [], 0, 0
    for lon, lat in coords:
        ilat, ilon = round(lat * factor), round(lon * factor)
        out.append(encode_value(ilat - plat) + encode_value(ilon - plon))
        plat, plon = ilat, ilon
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument("--simplify-meters", type=float, default=20.0)
    ap.add_argument("--precision", type=int, default=5)
    args = ap.parse_args()

    to_m = Transformer.from_crs("EPSG:4326", "EPSG:3812", always_xy=True)
    to_deg = Transformer.from_crs("EPSG:3812", "EPSG:4326", always_xy=True)

    def project(geom, transformer):
        return shapely.transform(geom, lambda xy: list(zip(*transformer.transform(xy[:, 0], xy[:, 1]))))

    src = json.loads(args.input.read_text(encoding="utf-8"))
    features = []
    for f in src["features"]:
        geom = project(project(shape(f["geometry"]), to_m).simplify(args.simplify_meters, preserve_topology=True), to_deg)
        polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
        rings = [
            [encode_ring(p.exterior.coords, args.precision)] + [encode_ring(i.coords, args.precision) for i in p.interiors]
            for p in polys
        ]
        features.append({"p": f["properties"], "g": rings})
    out = {
        "format": "be-municipalities-web/1",
        "precision": args.precision,
        "simplifyMeters": args.simplify_meters,
        "features": features,
    }
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} municipalities to {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
