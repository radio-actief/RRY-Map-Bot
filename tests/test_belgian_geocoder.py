"""
Tests for the local Belgian geocoder (:mod:`backend.belgian_geocoder`).

Strict point-in-polygon results at well-known landmarks (one per province +
Brussels), no snapping of an off-border point when ``buffer_m=0`` (default
sync behaviour), the legacy ``buffer_m=500`` snap for that same point, and
clearly non-Belgian coordinates.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.belgian_geocoder import BelgianGeocoder  # noqa: E402

GEOJSON = REPO_ROOT / "data" / "be-municipalities.geojson"


# (lat, lon, expected plaats, expected province_code, note)
POSITIVE_CASES = [
    (50.8467, 4.3525, "Brussel", "be-bru", "Brussels - Grote Markt"),
    (51.2294, 4.4055, "Antwerpen", "be-van", "Antwerp - MAS"),
    (51.0536, 3.7224, "Gent", "be-vov", "Gent - Korenmarkt"),
    (51.2085, 3.2249, "Brugge", "be-vwv", "Bruges - Markt"),
    (50.8794, 4.7009, "Leuven", "be-vbr", "Leuven - Grote Markt"),
    (50.9307, 5.3378, "Hasselt", "be-vli", "Hasselt - Grote Markt"),
    (50.6450, 5.5736, "Liège", "be-wlg", "Liege - Place Saint-Lambert"),
    (50.4673, 4.8719, "Namur", "be-wna", "Namur - Place d'Armes"),
    (50.4542, 3.9521, "Mons", "be-wht", "Mons - Grand-Place"),
    (49.6836, 5.8167, "Arlon", "be-wlx", "Arlon - centre"),
    (50.7162, 4.6018, "Wavre", "be-wbr", "Wavre - centre"),
]

# NL side of the Meuse near Lanaken: outside Belgian polygons but within 500 m
# of Lanaken (BE). Strict ``buffer_m=0`` returns None; the legacy buffer snaps.
BORDER_CASE = (50.87, 5.65, "Lanaken")

NEGATIVE_CASES = [
    (48.8566, 2.3522, "Paris"),
    (52.3676, 4.9041, "Amsterdam"),
    (51.5074, -0.1278, "London"),
    (51.5, 2.5, "mid-North-Sea"),
    (50.7753, 6.0839, "Aachen"),
]


@pytest.fixture(scope="module")
def strict():
    if not GEOJSON.is_file():
        pytest.skip(f"missing {GEOJSON}; build it with scripts/generate-be-municipalities-geojson.py")
    return BelgianGeocoder(geojson_path=GEOJSON, buffer_m=0.0)


def test_feature_count(strict):
    assert len(strict) == 565


@pytest.mark.parametrize(
    "lat,lon,plaats,province,note", POSITIVE_CASES, ids=[c[4] for c in POSITIVE_CASES]
)
def test_landmarks_resolve_to_their_municipality(strict, lat, lon, plaats, province, note):
    got = strict.geocode(lat, lon)
    assert got is not None
    assert got["plaats"] == plaats
    assert got["province_code"] == province


def test_border_point_is_not_snapped_without_buffer(strict):
    lat, lon, _ = BORDER_CASE
    assert strict.geocode(lat, lon) is None


def test_border_point_snaps_with_legacy_buffer(strict):
    lat, lon, plaats = BORDER_CASE
    buffered = BelgianGeocoder(geojson_path=GEOJSON, buffer_m=500.0)
    got = buffered.geocode(lat, lon)
    assert got is not None and got["plaats"] == plaats


@pytest.mark.parametrize("lat,lon,note", NEGATIVE_CASES, ids=[c[2] for c in NEGATIVE_CASES])
def test_foreign_points_return_none(strict, lat, lon, note):
    assert strict.geocode(lat, lon) is None


@pytest.mark.parametrize(
    "lat,lon",
    [(None, 4.35), (50.85, None), ("nope", "nope")],
    ids=["lat-none", "lon-none", "strings"],
)
def test_bad_input_returns_none(strict, lat, lon):
    assert strict.geocode(lat, lon) is None  # type: ignore[arg-type]


def test_is_belgian_helper(strict):
    assert strict.is_belgian(50.8467, 4.3525)
    assert not strict.is_belgian(48.8566, 2.3522)
