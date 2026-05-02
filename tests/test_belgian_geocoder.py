"""
Smoke tests for the local Belgian geocoder (:mod:`backend.belgian_geocoder`).

The tests assert strict point-in-polygon results at well-known landmarks (one
per province + Brussels), verify that an off-coast point is **not** snapped
when ``buffer_m=0`` (default sync behaviour), optionally assert the legacy
``buffer_m=500`` snap for that same point, and cover clearly non-Belgian
coordinates (Paris, Amsterdam).

Run directly (no pytest dependency)::

    cd RRY-Map-Bot
    .venv/bin/python3 tests/test_belgian_geocoder.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.belgian_geocoder import BelgianGeocoder, reset_geocoder  # noqa: E402


# (lat, lon, expected plaats, expected province_code, note)
POSITIVE_CASES = [
    # Brussels — Grote Markt / Grand Place
    (50.8467, 4.3525, "Brussel", "be-bru", "Brussels - Grote Markt"),
    # Antwerpen (Antwerp) — MAS
    (51.2294, 4.4055, "Antwerpen", "be-van", "Antwerp - MAS"),
    # Gent (East Flanders) — Korenmarkt
    (51.0536, 3.7224, "Gent", "be-vov", "Gent - Korenmarkt"),
    # Brugge (West Flanders) — Markt
    (51.2085, 3.2249, "Brugge", "be-vwv", "Bruges - Markt"),
    # Leuven (Flemish Brabant) — Grote Markt
    (50.8794, 4.7009, "Leuven", "be-vbr", "Leuven - Grote Markt"),
    # Hasselt (Limburg) — Grote Markt
    (50.9307, 5.3378, "Hasselt", "be-vli", "Hasselt - Grote Markt"),
    # Liège (Liège) — Place Saint-Lambert
    (50.6450, 5.5736, "Liège", "be-wlg", "Liege - Place Saint-Lambert"),
    # Namur (Namur) — Place d'Armes
    (50.4673, 4.8719, "Namur", "be-wna", "Namur - Place d'Armes"),
    # Mons (Hainaut) — Grand-Place
    (50.4542, 3.9521, "Mons", "be-wht", "Mons - Grand-Place"),
    # Arlon (Luxembourg) — centre
    (49.6836, 5.8167, "Arlon", "be-wlx", "Arlon - centre"),
    # Wavre (Walloon Brabant) — centre
    (50.7162, 4.6018, "Wavre", "be-wbr", "Wavre - centre"),
]


# NL side of the Meuse near Lanaken: outside Belgian polygons but within 500 m
# of Lanaken (BE) — strict ``buffer_m=0`` must return None; legacy buffer snaps.
OFFSHORE_CASE = (50.87, 5.65, "Lanaken", "NL-side near Lanaken (buffer snap only)")


# Clearly-not-Belgian coordinates (should return None).
NEGATIVE_CASES = [
    (48.8566, 2.3522, "Paris"),
    (52.3676, 4.9041, "Amsterdam"),
    (51.5074, -0.1278, "London"),
    # ~100 km off shore in the North Sea — must NOT buffer-snap
    (51.5, 2.5, "mid-North-Sea"),
]


class MiniTestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors: list[str] = []

    def ok(self, name: str):
        self.passed += 1
        print(f"  PASS  {name}")

    def fail(self, name: str, detail: str):
        self.failed += 1
        self.errors.append(f"{name}: {detail}")
        print(f"  FAIL  {name} -- {detail}")


def run(result: MiniTestResult) -> None:
    reset_geocoder()
    geojson = REPO_ROOT / "data" / "be-municipalities.geojson"
    if not geojson.is_file():
        result.fail(
            "setup",
            f"missing {geojson}; build it with "
            "'python3 scripts/generate-be-municipalities-geojson.py'",
        )
        return

    g_strict = BelgianGeocoder(geojson_path=geojson, buffer_m=0.0)
    if len(g_strict) != 565:
        result.fail("setup/feature_count", f"expected 565 polygons, got {len(g_strict)}")
        return
    result.ok(f"setup/feature_count ({len(g_strict)} polygons, buffer_m=0)")

    for lat, lon, exp_plaats, exp_prov, note in POSITIVE_CASES:
        got = g_strict.geocode(lat, lon)
        name = f"positive: {note}"
        if got is None:
            result.fail(name, f"expected {exp_plaats!r}, got None")
            continue
        if got.get("plaats") != exp_plaats:
            result.fail(
                name, f"plaats: expected {exp_plaats!r}, got {got.get('plaats')!r}"
            )
            continue
        if got.get("province_code") != exp_prov:
            result.fail(
                name,
                f"province: expected {exp_prov!r}, got {got.get('province_code')!r}",
            )
            continue
        result.ok(f"{name} -> {got['plaats']} [{got['province_code']}]")

    lat, lon, exp_plaats, note = OFFSHORE_CASE
    got_off = g_strict.geocode(lat, lon)
    name = f"strict_border: {note}"
    if got_off is not None:
        result.fail(name, f"expected None with buffer_m=0, got {got_off}")
    else:
        result.ok(f"{name} -> None (strict PIP, no buffer snap)")

    g_buf = BelgianGeocoder(geojson_path=geojson, buffer_m=500.0)
    got_buf = g_buf.geocode(lat, lon)
    name2 = f"legacy_buffer_500m: {note}"
    if got_buf is None or got_buf.get("plaats") != exp_plaats:
        result.fail(
            name2,
            f"expected {exp_plaats!r} with buffer_m=500, got {got_buf!r}",
        )
    else:
        result.ok(f"{name2} -> {got_buf['plaats']}")

    for lat, lon, note in NEGATIVE_CASES:
        got = g_strict.geocode(lat, lon)
        name = f"negative: {note}"
        if got is None:
            result.ok(name)
        else:
            result.fail(name, f"expected None, got {got}")

    # Invalid inputs
    for lat, lon, note in [
        (None, 4.35, "lat=None"),
        (50.85, None, "lon=None"),
        ("nope", "nope", "strings"),
    ]:
        got = g_strict.geocode(lat, lon)  # type: ignore[arg-type]
        if got is None:
            result.ok(f"bad_input: {note}")
        else:
            result.fail(f"bad_input: {note}", f"expected None, got {got}")

    # is_belgian convenience
    if g_strict.is_belgian(50.8467, 4.3525) and not g_strict.is_belgian(48.8566, 2.3522):
        result.ok("is_belgian helper")
    else:
        result.fail("is_belgian helper", "unexpected result")


def main() -> int:
    print("=" * 60)
    print("Belgian geocoder smoke tests")
    print("=" * 60)
    result = MiniTestResult()
    run(result)
    print("=" * 60)
    print(f"  passed: {result.passed}")
    print(f"  failed: {result.failed}")
    if result.errors:
        print("\nFailures:")
        for e in result.errors:
            print(f"  - {e}")
    return 0 if result.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
