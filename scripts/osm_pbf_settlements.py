"""
Resolve per-gemeente (nis5) coordinates from OSM ``place=*`` nodes inside admin polygons.

Requires ``osmium`` (PyPI) + ``shapely`` + ``pyproj`` (see ``requirements-dev.txt``).

If the ``osmium`` **command** (``brew install osmium-tool`` / distro package) is on ``PATH``,
``tags-filter`` is used to shrink the node pass to objects carrying a ``place`` tag; otherwise
the full PBF is scanned (much slower on Geofabrik ``belgium.osm.pbf``).
"""

from __future__ import annotations

import os
import osmium
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def _filtered_place_nodes_pbf(src: Path) -> tuple[Path, bool]:
    """
    When ``osmium tags-filter`` is available, write a small temp PBF with only ``n/place`` nodes.

    Returns ``(path, is_temp)``. Caller must ``unlink`` when ``is_temp``.
    """
    exe = shutil.which("osmium")
    if not exe:
        return src, False
    fd, tmp = tempfile.mkstemp(suffix=".osm.pbf")
    os.close(fd)
    tmp_path = Path(tmp)
    cmd = [exe, "tags-filter", str(src), "n/place", "-o", str(tmp_path), "--overwrite"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=7200)
    except (OSError, subprocess.SubprocessError):
        tmp_path.unlink(missing_ok=True)
        return src, False
    if r.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        return src, False
    return tmp_path, True

# Most important settlement first; hamlet only when nothing stronger exists (handled in pick).
_PLACE_RANK: dict[str, int] = {
    "city": 0,
    "town": 1,
    "village": 2,
    "suburb": 3,
    "hamlet": 4,
    "neighbourhood": 5,
    "quarter": 6,
    "locality": 7,
}


def _place_rank(place: str) -> int:
    return _PLACE_RANK.get(place, 99)


def _parse_population(raw: str | None) -> int:
    if not raw:
        return 0
    s = str(raw).strip().replace(",", "")
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _project_belgium(g: Any, transformer: Any) -> Any:
    from functools import partial

    from shapely.ops import transform

    return transform(partial(_xy_transform, transformer), g)


def _xy_transform(transformer: Any, x: float, y: float) -> tuple[float, float]:
    return transformer.transform(x, y)


def load_nis5_settlement_coords(
    pbf_path: Path,
    geoms_by_nis5: dict[str, Any],
    *,
    weighted_centroids_4326: dict[str, tuple[float, float]] | None = None,
) -> tuple[dict[str, tuple[float, float]], dict[str, dict[str, Any]], list[str]]:
    """
    Stream ``pbf_path`` for nodes with ``place`` in ``_PLACE_RANK``; assign each node
    to exactly one ``nis5`` whose (projected) admin polygon covers the node.

    Returns ``(coords_by_nis5, meta_by_nis5, notes)`` where each meta has at least
    ``source`` (``settlement``), ``place``, ``name``, ``osm_id``, ``population``.
    """
    from pyproj import Transformer
    from shapely.geometry import Point
    from shapely.strtree import STRtree

    pbf_path = Path(pbf_path)
    if not pbf_path.is_file():
        raise FileNotFoundError(f"OSM PBF not found: {pbf_path}")

    to_bel = Transformer.from_crs("EPSG:4326", "EPSG:3812", always_xy=True)

    nis5_list: list[str] = []
    polys_p: list[Any] = []
    rep_p: dict[str, Any] = {}
    for nis in sorted(geoms_by_nis5.keys()):
        g = geoms_by_nis5.get(nis)
        if g is None or g.is_empty:
            continue
        try:
            gp = _project_belgium(g, to_bel)
            nis5_list.append(nis)
            polys_p.append(gp)
            rep_p[nis] = gp.representative_point()
        except Exception:
            continue

    if not polys_p:
        return {}, {}, ["no projected admin polygons for STRtree"]

    tree = STRtree(polys_p)
    notes: list[str] = []

    read_pbf, tmp_filtered = _filtered_place_nodes_pbf(pbf_path)
    if tmp_filtered:
        notes.append("settlement pass: osmium tags-filter n/place (temp PBF)")
    else:
        notes.append(
            "settlement pass: full PBF node scan (install osmium-tool for a much faster tags-filter pass)"
        )

    raw_nodes: list[dict[str, Any]] = []

    class CollectNodes(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()

        def node(self, n: Any) -> None:
            tags = dict(n.tags)
            pl = tags.get("place")
            if pl not in _PLACE_RANK:
                return
            if not n.location.valid():
                return
            lat_f = float(n.location.lat)
            lon_f = float(n.location.lon)
            pt = Point(lon_f, lat_f)
            try:
                ptp = _project_belgium(pt, to_bel)
            except Exception:
                return
            idxs = tree.query(ptp, predicate="covered_by")
            if idxs is None or len(idxs) == 0:
                return
            hit_nis: list[str] = []
            for i in idxs:
                try:
                    if polys_p[int(i)].covers(ptp):
                        hit_nis.append(nis5_list[int(i)])
                except Exception:
                    continue
            if not hit_nis:
                return
            nis5 = min(hit_nis)
            raw_nodes.append(
                {
                    "nis5": nis5,
                    "lat": lat_f,
                    "lon": lon_f,
                    "place": pl,
                    "name": (tags.get("name:fr") or tags.get("name:nl") or tags.get("name") or "").strip(),
                    "population": _parse_population(tags.get("population")),
                    "osm_id": int(n.id),
                }
            )

    try:
        CollectNodes().apply_file(str(read_pbf), locations=True, idx="flex_mem")
    finally:
        if tmp_filtered:
            try:
                read_pbf.unlink(missing_ok=True)
            except OSError:
                pass

    by_nis: dict[str, list[dict[str, Any]]] = {}
    for row in raw_nodes:
        by_nis.setdefault(row["nis5"], []).append(row)

    coords: dict[str, tuple[float, float]] = {}
    meta: dict[str, dict[str, Any]] = {}
    wcent = weighted_centroids_4326 or {}

    for nis5, candidates in by_nis.items():
        g = geoms_by_nis5.get(nis5)
        seed = rep_p.get(nis5)
        wc = wcent.get(nis5)
        if wc is not None:
            try:
                seed_w = _project_belgium(Point(wc[1], wc[0]), to_bel)
            except Exception:
                seed_w = seed
        else:
            seed_w = seed

        def sort_key(c: dict[str, Any]) -> tuple:
            pr = _place_rank(c["place"])
            pop = -c.get("population", 0)
            dist = 0.0
            if seed_w is not None:
                try:
                    ptp = _project_belgium(Point(c["lon"], c["lat"]), to_bel)
                    dist = float(ptp.distance(seed_w))
                except Exception:
                    dist = 1e12
            return (pr, pop, dist, c["osm_id"])

        best = min(candidates, key=sort_key)
        lat, lon = round(float(best["lat"]), 5), round(float(best["lon"]), 5)
        coords[nis5] = (lat, lon)
        meta[nis5] = {
            "source": "settlement",
            "place": best["place"],
            "name": best.get("name") or "",
            "osm_id": best["osm_id"],
            "population": best.get("population", 0),
            "candidates": len(candidates),
        }

    return coords, meta, notes
