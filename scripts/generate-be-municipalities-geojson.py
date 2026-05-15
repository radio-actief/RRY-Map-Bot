#!/usr/bin/env python3
"""
Generate RRY-Map-Bot/data/be-municipalities.geojson: 565 Belgian municipality polygons.

Reads the StatBel statistical-sectors GeoJSON (EPSG:3812), dissolves sectors by
``cd_munty_refnis`` (= NIS5), simplifies in the metric CRS, reprojects to WGS84
(EPSG:4326) and joins with the canonical labels from ``data/be-locode.json``
(``plaats``, ``gemeente``, ``province_code``, ``city_code``).

Output is a plain GeoJSON FeatureCollection (EPSG:4326) used by
``backend/belgian_geocoder.py`` for point-in-polygon checks.

Expected runtime: ~30-60 s on a modern laptop. The input GeoJSON ships as
line-delimited features (one feature per line between the header and footer),
so we stream-parse it to keep memory sensible.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

try:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union, transform as shapely_transform
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "shapely is required. Install with: pip install -r requirements.txt"
    ) from e

try:
    from pyproj import Transformer
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "pyproj is required. Install with: pip install -r requirements.txt"
    ) from e


SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
INPUTS_DIR = DATA_DIR / "inputs"

DEFAULT_SECTORS = (
    (INPUTS_DIR / "sh_statbel_statistical_sectors_3812_20250101.geojson")
    if (INPUTS_DIR / "sh_statbel_statistical_sectors_3812_20250101.geojson").is_file()
    else DATA_DIR / "statbel" / "sh_statbel_statistical_sectors_3812_20250101.geojson"
)
DEFAULT_LOCODE = DATA_DIR / "be-locode.json"
DEFAULT_OUTPUT = DATA_DIR / "be-municipalities.geojson"


def _norm_nis5(v) -> str | None:
    """Normalize a NIS code cell to a 5-digit string, or None."""
    if v is None:
        return None
    if isinstance(v, float) and v == int(v):
        v = int(v)
    s = str(v).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if len(s) == 5 and s.isdigit():
        return s
    return None


def load_locode_index(path: Path) -> dict[str, dict]:
    """Load be-locode.json and index by nis5 for joining."""
    with open(path, "r", encoding="utf-8") as f:
        rows = json.load(f)
    out: dict[str, dict] = {}
    for row in rows:
        nis5 = _norm_nis5(row.get("nis5"))
        if not nis5:
            continue
        out[nis5] = row
    if len(out) != 565:
        raise SystemExit(
            f"Expected 565 rows in {path}, got {len(out)} (is be-locode.json up to date?)"
        )
    return out


def stream_features(path: Path):
    """Yield parsed GeoJSON features from a line-delimited sectors file.

    The StatBel sectors export has one feature per line between a 5-line
    header and a 2-line footer. We don't rely on that being stable; we
    simply try to json.loads each line after stripping trailing commas.
    """
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip().rstrip(",")
            if not s or not s.startswith('{ "type": "Feature"'):
                continue
            try:
                yield json.loads(s)
            except json.JSONDecodeError:
                # Be permissive: skip malformed line with a warning on stderr.
                print(f"WARN: skipped unparseable feature line", file=sys.stderr)
                continue


def dissolve_by_nis5(
    sectors_path: Path, simplify_tolerance_m: float
) -> dict[str, "object"]:
    """Stream-read sectors and dissolve polygons per NIS5.

    We accumulate the union *incrementally* (via unary_union over a running
    list) to avoid holding all ~20k sector geometries in RAM at once.
    Returns a dict ``{nis5: shapely_geometry}`` in EPSG:3812.
    """
    # Collect all sector geometries per NIS5 first (compact shapely objects,
    # ~200 MB at peak). Then do one unary_union per NIS5, which is much
    # faster and more accurate than incremental unions.
    buckets: dict[str, list] = defaultdict(list)
    total = 0
    t0 = time.time()

    for feat in stream_features(sectors_path):
        props = feat.get("properties") or {}
        geom = feat.get("geometry")
        if not geom:
            continue
        nis5 = _norm_nis5(props.get("cd_munty_refnis"))
        if not nis5:
            continue
        try:
            g = shape(geom)
        except Exception as e:
            print(f"WARN: bad geometry for sector {props.get('cd_sector')}: {e}", file=sys.stderr)
            continue
        if g.is_empty:
            continue
        buckets[nis5].append(g)
        total += 1
        if total % 2000 == 0:
            print(f"  parsed {total} sectors ({len(buckets)} NIS5 so far)...", flush=True)

    print(f"Parsed {total} sectors across {len(buckets)} NIS5 in {time.time() - t0:.1f}s")

    out: dict[str, object] = {}
    t1 = time.time()
    for i, (nis5, geoms) in enumerate(sorted(buckets.items()), 1):
        merged = unary_union(geoms)
        if simplify_tolerance_m > 0:
            # preserve_topology=True keeps polygons valid but is slower. For a
            # ~5 m tolerance on admin polygons topology preservation matters
            # (avoids self-intersections on concave coastlines).
            merged = merged.simplify(simplify_tolerance_m, preserve_topology=True)
        out[nis5] = merged
        if i % 50 == 0:
            print(f"  dissolved {i}/{len(buckets)} gemeenten...", flush=True)
    print(f"Dissolved {len(out)} gemeenten in {time.time() - t1:.1f}s")
    return out


def reproject_3812_to_4326(geoms_3812: dict[str, object]) -> dict[str, object]:
    """Reproject every geometry from EPSG:3812 to EPSG:4326 (WGS84, lon/lat)."""
    transformer = Transformer.from_crs(3812, 4326, always_xy=True)

    def _fn(x, y, z=None):
        lon, lat = transformer.transform(x, y)
        return (lon, lat)

    out: dict[str, object] = {}
    for nis5, g in geoms_3812.items():
        out[nis5] = shapely_transform(_fn, g)
    return out


def build_feature_collection(
    geoms_4326: dict[str, object],
    locode_by_nis5: dict[str, dict],
) -> dict:
    """Build a GeoJSON FeatureCollection joining geoms with labels."""
    features: list[dict] = []
    missing: list[str] = []
    for nis5 in sorted(geoms_4326.keys()):
        loc = locode_by_nis5.get(nis5)
        if loc is None:
            missing.append(nis5)
            continue
        geom = geoms_4326[nis5]
        if geom.is_empty:
            missing.append(nis5)
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "nis5": nis5,
                    "plaats": loc.get("plaats"),
                    "gemeente": loc.get("gemeente"),
                    "province_code": loc.get("province_code"),
                    "city_code": loc.get("city_code"),
                },
                "geometry": mapping(geom),
            }
        )
    if missing:
        raise SystemExit(
            f"Missing or empty geometry/label join for {len(missing)} NIS5: "
            f"{missing[:10]}{'...' if len(missing) > 10 else ''}"
        )
    return {
        "type": "FeatureCollection",
        "name": "be-municipalities",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}},
        "features": features,
    }


def _round_coords(obj, ndigits: int = 6):
    """Recursively round float coordinates in a GeoJSON object.

    Six decimals of lon/lat ~ 11 cm of resolution, plenty for admin boundaries
    and dramatically smaller on disk than the default ~15-digit floats.
    """
    if isinstance(obj, float):
        return round(obj, ndigits)
    if isinstance(obj, list):
        return [_round_coords(v, ndigits) for v in obj]
    if isinstance(obj, tuple):
        return tuple(_round_coords(v, ndigits) for v in obj)
    if isinstance(obj, dict):
        return {k: _round_coords(v, ndigits) for k, v in obj.items()}
    return obj


def main():
    ap = argparse.ArgumentParser(
        description="Generate data/be-municipalities.geojson (565 Belgian gemeenten)."
    )
    ap.add_argument(
        "--sectors",
        type=Path,
        default=DEFAULT_SECTORS,
        help="StatBel statistical-sectors GeoJSON (EPSG:3812). "
        "Default: data/inputs/ then data/statbel/.",
    )
    ap.add_argument(
        "--locode",
        type=Path,
        default=DEFAULT_LOCODE,
        help="Canonical be-locode.json with 565 gemeenten labels.",
    )
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output GeoJSON path (default: data/be-municipalities.geojson).",
    )
    ap.add_argument(
        "--simplify-meters",
        type=float,
        default=5.0,
        help="Douglas-Peucker simplify tolerance in metres (EPSG:3812). "
        "0 disables. Default: 5.0",
    )
    ap.add_argument(
        "--coord-precision",
        type=int,
        default=6,
        help="Decimal places for output lon/lat (default 6 ~ 0.11 m).",
    )
    args = ap.parse_args()

    if not args.sectors.is_file():
        raise SystemExit(f"--sectors not found: {args.sectors}")
    if not args.locode.is_file():
        raise SystemExit(f"--locode not found: {args.locode}")

    print(f"Sectors:  {args.sectors}")
    print(f"Locode:   {args.locode}")
    print(f"Output:   {args.output}")
    print(f"Simplify: {args.simplify_meters} m (EPSG:3812)")
    print()

    locode_by_nis5 = load_locode_index(args.locode)
    print(f"Loaded {len(locode_by_nis5)} gemeenten labels from be-locode.json")

    geoms_3812 = dissolve_by_nis5(args.sectors, args.simplify_meters)
    if len(geoms_3812) != 565:
        raise SystemExit(
            f"Expected 565 NIS5 groups in sectors file, got {len(geoms_3812)}. "
            "Is the input file up to date?"
        )

    print("Reprojecting EPSG:3812 -> EPSG:4326...")
    t0 = time.time()
    geoms_4326 = reproject_3812_to_4326(geoms_3812)
    print(f"Reprojected in {time.time() - t0:.1f}s")

    fc = build_feature_collection(geoms_4326, locode_by_nis5)
    if args.coord_precision is not None and args.coord_precision >= 0:
        fc = _round_coords(fc, args.coord_precision)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(
        f"\nWrote {len(fc['features'])} gemeente polygons to {args.output} "
        f"({size_mb:.1f} MB)"
    )


if __name__ == "__main__":
    main()
