"""
Area-weighted centroids of StatBel statistical sectors per gemeente (``cd_munty_refnis``).

GeoJSON is EPSG:3812; output WGS84 ``(lat, lon)`` for tie-breaking OSM settlements.
Weights use ``ms_area_ha`` (no population column in this layer).
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def load_nis5_area_weighted_centroids(geojson_path: Path) -> dict[str, tuple[float, float]]:
    """
    Returns ``nis5 (5-digit) -> (lat, lon)`` in WGS84.
    """
    from pyproj import Transformer
    from shapely.geometry import shape

    path = Path(geojson_path)
    if not path.is_file():
        raise FileNotFoundError(f"Sectors GeoJSON not found: {path}")

    to_wgs = Transformer.from_crs("EPSG:3812", "EPSG:4326", always_xy=True)

    raw = json.loads(path.read_text(encoding="utf-8"))
    feats: list[dict[str, Any]] = raw.get("features") or []

    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # sum_x*w, sum_y*w, sum_w

    for f in feats:
        props = f.get("properties") or {}
        ref = props.get("cd_munty_refnis")
        if ref is None:
            continue
        digits = "".join(ch for ch in str(ref) if ch.isdigit())
        if len(digits) < 5:
            s = digits.zfill(5) if digits else ""
        else:
            s = digits[-5:]
        if len(s) != 5 or not s.isdigit():
            continue
        geom = f.get("geometry")
        if not geom:
            continue
        try:
            g = shape(geom)
        except Exception:
            continue
        if g.is_empty:
            continue
        try:
            c = g.centroid
        except Exception:
            continue
        w = float(props.get("ms_area_ha") or 0.0)
        if w <= 0:
            w = 1.0
        a = acc[s]
        a[0] += float(c.x) * w
        a[1] += float(c.y) * w
        a[2] += w

    out: dict[str, tuple[float, float]] = {}
    for nis5, (sx, sy, sw) in acc.items():
        if sw <= 0:
            continue
        x, y = sx / sw, sy / sw
        try:
            lon, lat = to_wgs.transform(x, y)
        except Exception:
            continue
        out[nis5] = (float(lat), float(lon))
    return out
