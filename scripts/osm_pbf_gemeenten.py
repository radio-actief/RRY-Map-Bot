"""
Belgian gemeente (admin_level=8) geometries from a local Geofabrik-style OSM PBF.

Join key: OSM ``ref:INS`` ↔ ``nis5`` in ``be-locode.json`` (5-digit NIS2025).

Used by ``generate-be-locode.py`` (``--osm-pbf``) for gemeente polygons.

Requires: ``osmium`` (PyPI) + ``shapely`` (already in project ``requirements.txt``).
Optional: ``ogr2ogr`` (GDAL) for an alternate extraction path when available.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

def normalize_nis5_from_ref_ins(raw: str | None) -> str | None:
    """Map OSM ``ref:INS`` (digits, possibly zero-padded or in a URI) to 5-digit ``nis5``."""
    if not raw:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return None
    if len(digits) >= 5:
        return digits[-5:]
    return digits.zfill(5)


def _geometry_from_wkt(wkt: str):
    from shapely import from_wkt
    from shapely.geometry import MultiPolygon, Polygon

    g = from_wkt(wkt)
    if g.is_empty:
        return None
    if isinstance(g, Polygon):
        return g
    if isinstance(g, MultiPolygon):
        return g
    # GeometryCollection etc. — try unary_union downstream
    return g


def load_nis5_geometries_osmium(pbf_path: Path) -> tuple[dict[str, Any], list[str]]:
    """
    Stream PBF with osmium Area assembly; return (nis5 -> Shapely geometry, warnings).
    """
    import osmium
    import osmium.geom
    from shapely.ops import unary_union

    wktf = osmium.geom.WKTFactory()
    wkts_by_nis: dict[str, list[str]] = defaultdict(list)

    class Collect(osmium.SimpleHandler):
        def area(self, a: Any) -> None:
            tags = dict(a.tags)
            if tags.get("boundary") != "administrative":
                return
            if str(tags.get("admin_level", "")) != "8":
                return
            ref = tags.get("ref:INS") or tags.get("ref_ins")
            nis = normalize_nis5_from_ref_ins(ref)
            if not nis:
                return
            try:
                wk = wktf.create_multipolygon(a)
            except Exception:
                return
            if wk:
                wkts_by_nis[nis].append(wk)

    h = Collect()
    h.apply_file(str(pbf_path), locations=True, idx="flex_mem")

    out: dict[str, Any] = {}
    notes: list[str] = []
    for nis, wlist in wkts_by_nis.items():
        geoms = []
        for w in wlist:
            g = _geometry_from_wkt(w)
            if g is not None and not g.is_empty:
                geoms.append(g)
        if not geoms:
            continue
        if len(geoms) > 1:
            notes.append(f"duplicate ref:INS merge nis5={nis} ({len(geoms)} areas)")
            merged = unary_union(geoms)
        else:
            merged = geoms[0]
        out[nis] = merged
    return out, notes


def load_nis5_geometries_ogr(pbf_path: Path) -> tuple[dict[str, Any] | None, str | None]:
    """
    If ``ogr2ogr`` is on PATH, export admin_level=8 administrative multipolygons to GeoJSON
    and build the same nis5 → geometry map. Returns (None, reason) on skip/failure.
    """
    ogr = shutil.which("ogr2ogr")
    if not ogr:
        return None, "ogr2ogr not on PATH"

    fd, tmp_path = tempfile.mkstemp(suffix=".geojson")
    import os

    os.close(fd)
    tmp = Path(tmp_path)
    try:
        # OSM driver: tags often as columns when GDAL exposes them; WHERE on admin_level/boundary.
        cmd = [
            ogr,
            "-f",
            "GeoJSON",
            str(tmp),
            str(pbf_path),
            "multipolygons",
            "-where",
            "admin_level = '8' AND boundary = 'administrative'",
            "-t_srs",
            "EPSG:4326",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=7200)
        if r.returncode != 0:
            return None, (r.stderr or r.stdout or "ogr2ogr failed")[:500]

        from shapely.geometry import shape

        raw = json.loads(tmp.read_text(encoding="utf-8"))
        feats = raw.get("features") or []
        by_nis: dict[str, list[Any]] = defaultdict(list)
        for f in feats:
            props = f.get("properties") or {}
            ref = props.get("ref:INS") or props.get("ref_INS")
            nis = normalize_nis5_from_ref_ins(str(ref) if ref is not None else None)
            if not nis:
                continue
            geom = f.get("geometry")
            if not geom:
                continue
            try:
                by_nis[nis].append(shape(geom))
            except Exception:
                continue

        from shapely.ops import unary_union

        out: dict[str, Any] = {}
        for nis, geoms in by_nis.items():
            if not geoms:
                continue
            out[nis] = unary_union(geoms) if len(geoms) > 1 else geoms[0]
        return out, None
    except Exception as e:
        return None, str(e)[:500]
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def load_nis5_geometries(pbf_path: Path, prefer: str = "auto") -> dict[str, Any]:
    """``prefer``: ``auto`` (try ogr2ogr first, else osmium), ``ogr``, ``osmium``."""
    geoms, _meta = load_nis5_geometries_with_meta(pbf_path, prefer=prefer)
    return geoms


def load_nis5_geometries_with_meta(
    pbf_path: Path, prefer: str = "auto"
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Returns ``(geoms_by_nis5, meta)`` where ``meta`` has ``backend``, ``notes``, and optional ``ogr_error``.
    """
    pbf_path = Path(pbf_path)
    if not pbf_path.is_file():
        raise FileNotFoundError(f"OSM PBF not found: {pbf_path}")

    meta: dict[str, Any] = {"backend": None, "notes": [], "ogr_error": None}

    if prefer in ("auto", "ogr"):
        g, err = load_nis5_geometries_ogr(pbf_path)
        if g is not None:
            meta["backend"] = "ogr2ogr"
            return g, meta
        meta["ogr_error"] = err
        if prefer == "ogr":
            raise RuntimeError(f"OGR extraction failed: {err}")

    geoms, notes = load_nis5_geometries_osmium(pbf_path)
    meta["backend"] = "osmium"
    meta["notes"] = notes
    return geoms, meta


def _project_belgium(g: Any, transformer: Any) -> Any:
    from functools import partial

    from shapely.ops import transform

    return transform(partial(_xy_transform, transformer), g)


def _xy_transform(transformer: Any, x: float, y: float) -> tuple[float, float]:
    return transformer.transform(x, y)


def compare_be_locode_to_osm(
    rows: list[dict[str, Any]],
    geoms_by_nis5: dict[str, Any],
    *,
    error_snap_m: float = 3000.0,
    warn_snap_m: float = 150.0,
    inside_buffer_m: float = 200.0,
) -> dict[str, Any]:
    """
    Compare each catalogue point to OSM admin_level=8 polygons.

    Metric distances use EPSG:3812 (Lambert 2008), consistent with StatBel checks.
    ``inside_osm_polygon`` uses ``inside_buffer_m`` metres (default 200, like StatBel sectors).
    """
    from pyproj import Transformer
    from shapely.geometry import Point

    to_bel = Transformer.from_crs("EPSG:4326", "EPSG:3812", always_xy=True)
    to_wgs = Transformer.from_crs("EPSG:3812", "EPSG:4326", always_xy=True)

    per_row: list[dict[str, Any]] = []
    unmatched_json: list[str] = []
    errors = 0
    warnings = 0

    json_nis = {str(r.get("nis5")) for r in rows if r.get("nis5")}

    for row in rows:
        nis5 = row.get("nis5")
        if not isinstance(nis5, str) or len(nis5) != 5:
            continue
        lat, lon = row.get("lat"), row.get("lon")
        if lat is None or lon is None:
            continue
        latf, lonf = float(lat), float(lon)
        pt = Point(lonf, latf)
        g = geoms_by_nis5.get(nis5)
        if g is None or g.is_empty:
            unmatched_json.append(nis5)
            per_row.append(
                {
                    "nis5": nis5,
                    "plaats": row.get("plaats"),
                    "matched_osm": False,
                    "severity": "WARN",
                    "note": "no admin_level=8 polygon with ref:INS in PBF",
                }
            )
            warnings += 1
            continue

        try:
            gp = _project_belgium(g, to_bel)
            ptp = _project_belgium(pt, to_bel)
            rep = gp.representative_point()
            boundary_m = float(gp.distance(ptp))
            rep_m = float(rep.distance(ptp))
            inside = gp.buffer(inside_buffer_m).contains(ptp)
        except Exception as e:
            per_row.append(
                {
                    "nis5": nis5,
                    "plaats": row.get("plaats"),
                    "matched_osm": True,
                    "severity": "WARN",
                    "note": f"geometry error: {e}",
                }
            )
            warnings += 1
            continue

        try:
            rlon, rlat = to_wgs.transform(rep.x, rep.y)
        except Exception:
            rlat, rlon = latf, lonf

        if boundary_m > error_snap_m:
            sev = "ERROR"
            errors += 1
        elif boundary_m > warn_snap_m or not inside:
            sev = "WARN"
            warnings += 1
        elif rep_m > 8000:
            sev = "WARN"
            warnings += 1
        elif rep_m > 3000:
            sev = "INFO"
        else:
            sev = "INFO"

        per_row.append(
            {
                "nis5": nis5,
                "plaats": row.get("plaats"),
                "matched_osm": True,
                "distance_to_representative_point_m": round(rep_m, 1),
                "distance_to_polygon_m": round(boundary_m, 1),
                "inside_osm_polygon": inside,
                "osm_rep_lat": round(rlat, 6),
                "osm_rep_lon": round(rlon, 6),
                "severity": sev,
            }
        )

    unmatched_osm = sorted(set(geoms_by_nis5.keys()) - json_nis)

    return {
        "per_row": per_row,
        "unmatched_json_nis5": sorted(set(unmatched_json)),
        "unmatched_osm_nis5_sample": unmatched_osm[:40],
        "unmatched_osm_nis5_count": len(unmatched_osm),
        "severity_errors": errors,
        "severity_warnings": warnings,
        "extraction_notes": [],
    }


def merge_osm_report_notes(base: dict[str, Any], notes: list[str]) -> None:
    lst = base.setdefault("extraction_notes", [])
    lst.extend(notes)
