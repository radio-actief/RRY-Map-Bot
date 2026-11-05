"""
Local Belgian geocoder for RRY-Map-Bot.

Strict point-in-polygon over the 565 Belgian municipalities (canonical
``be-locode.json`` labels), with an **optional** buffered nearest-gemeente
fallback (off by default) for GPS/coastal edge cases.

Drop-in replacement for the Nominatim (Geopy) call inside
``backend/sync_belgian_nodes.py``. Loading and index-build happen once per
process (~100 ms for 5 MB); each ``geocode(lat, lon)`` is effectively free
(sub-millisecond).

The polygons file is built by ``scripts/generate-be-municipalities-geojson.py``
from the StatBel statistical sectors GeoJSON and the canonical labels from
``data/be-locode.json``.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Any, Optional

try:
    from shapely.geometry import Point, shape
    from shapely.ops import transform as shapely_transform, unary_union
    from shapely.strtree import STRtree
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "shapely is required for the local Belgian geocoder. "
        "Install with: pip install -r requirements.txt"
    ) from e

try:
    from pyproj import Transformer
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "pyproj is required for the local Belgian geocoder. "
        "Install with: pip install -r requirements.txt"
    ) from e


# Module-level singleton state, guarded by a lock so concurrent sync threads
# don't build the index twice.
_SINGLETON_LOCK = threading.Lock()
_SINGLETON: Optional["BelgianGeocoder"] = None


def _default_geojson_path() -> Path:
    """Resolve the default path to data/be-municipalities.geojson."""
    env = os.getenv("BE_MUNICIPALITIES_GEOJSON")
    if env:
        return Path(env)
    # config.BE_MUNICIPALITIES_GEOJSON if importable (fall back for tests).
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from config.config import BE_MUNICIPALITIES_GEOJSON  # type: ignore
        return Path(BE_MUNICIPALITIES_GEOJSON)
    except Exception:
        return Path(__file__).resolve().parent.parent / "data" / "be-municipalities.geojson"


def _default_buffer_meters() -> float:
    """Resolve the default tolerance for the nearest-gemeente fallback (0 = off)."""
    env = os.getenv("GEOCODE_BUFFER_METERS")
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from config.config import GEOCODE_BUFFER_METERS  # type: ignore
        return float(GEOCODE_BUFFER_METERS)
    except Exception:
        return 0.0


class BelgianGeocoder:
    """Point-in-polygon geocoder over 565 Belgian gemeente polygons.

    Two-stage lookup:

    1. Fast path in EPSG:4326 (WGS84) — STRtree bounding-box query, then
       ``contains()`` check against candidate polygons. Handles essentially
       every "clean" GPS fix inside Belgium.
    2. Optional buffer fallback (``buffer_m`` > 0 only): nearest gemeente within
       ``buffer_m`` metres in EPSG:3812. **Not recommended for sync:** foreign
       coordinates just across the border are often within 500 m of a Belgian
       polygon and would be misclassified as Belgian.

    With ``buffer_m`` 0 or when the fallback misses: returns ``None`` (not Belgian).
    """

    def __init__(
        self,
        geojson_path: Optional[Path] = None,
        buffer_m: Optional[float] = None,
    ):
        self.geojson_path = Path(geojson_path) if geojson_path else _default_geojson_path()
        self.buffer_m = float(buffer_m) if buffer_m is not None else _default_buffer_meters()

        if not self.geojson_path.is_file():
            raise FileNotFoundError(
                f"be-municipalities GeoJSON not found at {self.geojson_path}. "
                "Build it with: python3 scripts/generate-be-municipalities-geojson.py"
            )

        with open(self.geojson_path, "r", encoding="utf-8") as f:
            fc = json.load(f)
        features = fc.get("features") or []
        if not features:
            raise ValueError(f"{self.geojson_path}: no features")

        # Parallel arrays keyed by polygon index.
        self._geoms_4326: list[Any] = []
        self._properties: list[dict] = []
        for feat in features:
            geom = shape(feat["geometry"])
            if geom.is_empty:
                continue
            props = feat.get("properties") or {}
            self._geoms_4326.append(geom)
            self._properties.append(
                {
                    "nis5": props.get("nis5"),
                    "plaats": props.get("plaats"),
                    "gemeente": props.get("gemeente"),
                    "province_code": props.get("province_code"),
                    "city_code": props.get("city_code"),
                }
            )
        if not self._geoms_4326:
            raise ValueError(f"{self.geojson_path}: no usable geometries")

        # Fast path: STRtree over WGS84 polygons.
        self._tree_4326 = STRtree(self._geoms_4326)

        # Buffer fallback: EPSG:3812 geometries + transformer (built lazily
        # on first miss to keep cold-start fast, but cheap if we prebuild now).
        self._to_3812 = Transformer.from_crs(4326, 3812, always_xy=True)
        self._geoms_3812: Optional[list[Any]] = None
        self._tree_3812: Optional[STRtree] = None

    def _ensure_3812_index(self) -> None:
        if self._tree_3812 is not None:
            return

        def _fwd(x, y, z=None):
            lon_t, lat_t = self._to_3812.transform(x, y)
            return (lon_t, lat_t)

        self._geoms_3812 = [shapely_transform(_fwd, g) for g in self._geoms_4326]
        self._tree_3812 = STRtree(self._geoms_3812)

    def geocode(self, lat: float, lon: float) -> Optional[dict]:
        """Return ``{'nis5','plaats','gemeente','province_code','city_code'}`` or ``None``.

        ``None`` means the point is outside every gemeente polygon (strict
        ``contains``), or outside the optional ``buffer_m`` snap distance when
        the buffer fallback is enabled.

        The returned ``plaats`` is the canonical native-language label from
        ``be-locode.json`` (NL in Flanders and Brussels, FR in Wallonia).
        """
        if lat is None or lon is None:
            return None
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            return None

        point = Point(lon_f, lat_f)

        # 1) Fast path — point inside a gemeente polygon (WGS84 STRtree).
        candidate_idxs = self._tree_4326.query(point)
        # Shapely 2.x returns a numpy array of integer indices for a single
        # geometry query; be permissive across shapely versions.
        for idx in candidate_idxs:
            i = int(idx)
            if self._geoms_4326[i].contains(point):
                return dict(self._properties[i])

        # 2) Buffer fallback — nearest gemeente within buffer_m metres.
        if self.buffer_m <= 0:
            return None

        self._ensure_3812_index()
        assert self._tree_3812 is not None and self._geoms_3812 is not None

        x_m, y_m = self._to_3812.transform(lon_f, lat_f)
        point_m = Point(x_m, y_m)

        # STRtree.nearest returns the index of the single closest geometry.
        # Fall back to a bbox query if `nearest` isn't available.
        try:
            nearest_idx = self._tree_3812.nearest(point_m)
            i = int(nearest_idx)
            if self._geoms_3812[i].distance(point_m) <= self.buffer_m:
                return dict(self._properties[i])
            return None
        except AttributeError:  # pragma: no cover — very old shapely
            # Slow path: scan candidates in the buffered bbox.
            buf = point_m.buffer(self.buffer_m)
            cand = self._tree_3812.query(buf)
            best_i, best_d = None, float("inf")
            for idx in cand:
                i = int(idx)
                d = self._geoms_3812[i].distance(point_m)
                if d < best_d:
                    best_d = d
                    best_i = i
            if best_i is not None and best_d <= self.buffer_m:
                return dict(self._properties[best_i])
            return None

    def is_belgian(self, lat: float, lon: float) -> bool:
        """Convenience wrapper around :meth:`geocode`."""
        return self.geocode(lat, lon) is not None

    # Introspection helpers (useful for tests / backfill summaries).
    def __len__(self) -> int:
        return len(self._geoms_4326)

    def __repr__(self) -> str:
        return (
            f"BelgianGeocoder(path={self.geojson_path.name}, "
            f"n={len(self._geoms_4326)}, buffer_m={self.buffer_m})"
        )


def get_geocoder(
    geojson_path: Optional[Path] = None,
    buffer_m: Optional[float] = None,
    *,
    force_reload: bool = False,
) -> BelgianGeocoder:
    """Return a cached :class:`BelgianGeocoder` singleton.

    Subsequent calls reuse the same instance. Pass ``force_reload=True`` to
    rebuild (useful after regenerating the GeoJSON).
    """
    global _SINGLETON
    with _SINGLETON_LOCK:
        if _SINGLETON is None or force_reload:
            _SINGLETON = BelgianGeocoder(geojson_path=geojson_path, buffer_m=buffer_m)
        return _SINGLETON


def reset_geocoder() -> None:
    """Clear the cached singleton. Used by tests."""
    global _SINGLETON
    with _SINGLETON_LOCK:
        _SINGLETON = None


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="Smoke-check the local Belgian geocoder on a lat/lon."
    )
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("--buffer", type=float, default=None)
    ap.add_argument("--geojson", type=Path, default=None)
    args = ap.parse_args()

    g = BelgianGeocoder(geojson_path=args.geojson, buffer_m=args.buffer)
    print(repr(g))
    result = g.geocode(args.lat, args.lon)
    print(json.dumps(result, ensure_ascii=False, indent=2))
