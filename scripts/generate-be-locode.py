#!/usr/bin/env python3
"""
Generate be-locode.json from UN/LOCODE Belgium data.
Based on https://service.unece.org/trade/locode/be.htm
Uses https://github.com/datasets/un-locode data.
"""
import csv
import json
import math
import urllib.request
from pathlib import Path

UN_LOCODE_CSV = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "be-locode.json"

# UN/LOCODE Subdivision -> MeshCore province_code
# ISO 3166-2:BE. "WAL" / "VLG" are regions, not provinces — infer province from coords.
SUBDIV_TO_PROVINCE = {
    "VAN": "be-van",   # Antwerpen
    "VOV": "be-vov",   # Oost-Vlaanderen
    "VWV": "be-vwv",   # West-Vlaanderen
    "VBR": "be-vbr",   # Vlaams-Brabant
    "VLI": "be-vli",   # Limburg (ISO BE-VLI)
    "BRU": "be-bru",   # Brussels
    "WBR": "be-wbr",   # Waals-Brabant
    "WHT": "be-wht",   # Henegouwen
    "WLG": "be-wlg",   # Luik
    "WNA": "be-wna",   # Namen
    "WLX": "be-wlx",   # Luxemburg
}

# Approximate province seats for nearest-province assignment (WAL / VLG / empty subdiv)
_PROVINCE_CENTROIDS = {
    "be-van": (51.22, 4.40),
    "be-vbr": (50.88, 4.70),
    "be-vov": (51.05, 3.72),
    "be-vwv": (51.21, 3.22),
    "be-vli": (50.93, 5.34),
    "be-bru": (50.85, 4.35),
    "be-wbr": (50.72, 4.61),
    "be-wht": (50.45, 3.95),
    "be-wlg": (50.63, 5.57),
    "be-wna": (50.46, 4.86),
    "be-wlx": (49.68, 5.82),
}

# UN Location (3 letters) -> province when CSV has no coordinates
LOCODE_PROVINCE_FALLBACK = {
    "AVG": "be-wht",  # Anvaing (Hainaut)
    "WAH": "be-wht",  # Hoves (Hainaut)
    "SKA": "be-vbr",  # Sint-Katelijne-Waver
}

# UN has empty Subdivision for some places; nearest-centroid can pick wrong province
# (e.g. Bierghes is Soignies/Hainaut, not Brussels-Capital).
LOCODE_PROVINCE_BY_LOCATION = {
    "BIH": "be-wht",  # Bierghes — Soignies, Hainaut (empty subdiv)
    "EST": "be-wht",  # Estaimbourg — Mouscron, Hainaut (UN WAL; centroid → East Flanders)
    "VGW": "be-vbr",  # Sint-Pieters-Leeuw (UN VLG; centroid → Brussels)
    "VIT": "be-wlx",  # Sankt Vith — prov. Luxembourg (empty subdiv; centroid → Liège)
}

# Fix bad/ambiguous UN/LOCODE coordinates (source typos or DDDMM ambiguity)
LOCODE_COORD_OVERRIDES = {
    "TNO": (49.717, 5.417),  # Tournay — 05240E mis-longitude
    "VIT": (50.280, 6.127),  # Sankt Vith — UN 5040N too far north vs centre
    "KZN": (50.944, 5.189),  # Kozen (Halen) — UN 00414E west of real Limburg site
    "PUR": (50.321, 5.262),  # Purnode (Yvoir) — UN 00494E parses to odd easting
    "SDE": (50.472, 4.797),  # Saint-Denis (Namur) — tighten vs UN 5031N 0446E
}


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def nearest_province_code(lat, lon):
    best, best_d = None, float("inf")
    for code, (clat, clon) in _PROVINCE_CENTROIDS.items():
        d = _haversine_km(lat, lon, clat, clon)
        if d < best_d:
            best_d, best = d, code
    return best


def parse_unlocode_coords(s):
    """Parse UN/LOCODE coords like '5046N 00313E' -> (lat, lon). DDMM N/S, DDDMM E/W."""
    if not s or not s.strip():
        return None, None
    s = s.strip()
    parts = s.split()
    if len(parts) != 2:
        return None, None
    try:
        lat_s, lon_s = parts[0], parts[1]
        lat_val = int(lat_s[:4])  # DDMM
        lat_dir = lat_s[-1]
        lon_val = int(lon_s[:5])  # DDDMM
        lon_dir = lon_s[-1]
        lat = (lat_val // 100) + (lat_val % 100) / 60
        lon = (lon_val // 100) + (lon_val % 100) / 60
        if lat_dir == "S":
            lat = -lat
        if lon_dir == "W":
            lon = -lon
        return lat, lon
    except (ValueError, IndexError):
        return None, None


def coords_for_location(loc_code, coords_str):
    """Parsed UN coords, with manual overrides for known upstream errors."""
    if loc_code in LOCODE_COORD_OVERRIDES:
        lat, lon = LOCODE_COORD_OVERRIDES[loc_code]
        return round(lat, 5), round(lon, 5)
    return parse_unlocode_coords(coords_str)


def main():
    print("Fetching UN/LOCODE...")
    with urllib.request.urlopen(UN_LOCODE_CSV, timeout=30) as resp:
        reader = csv.DictReader(
            line.decode("utf-8") for line in resp
        )
        rows = list(reader)

    locations = []
    seen = set()
    skipped = 0

    for row in rows:
        if row.get("Country") != "BE":
            continue
        loc = row.get("Location", "").strip()
        name = row.get("Name", "").strip()
        subdiv = row.get("Subdivision", "").strip()
        func = row.get("Function", "")

        if not loc or not name or len(loc) != 3:
            skipped += 1
            continue

        # Skip port/airport-only entries (no rail/road function)
        if func and func.startswith("1") and "3" not in func and "2" not in func:
            skipped += 1
            continue

        coords = row.get("Coordinates", "").strip()

        province_code = SUBDIV_TO_PROVINCE.get(subdiv)
        if province_code:
            pass
        elif subdiv in ("WAL", "VLG") or subdiv == "":
            province_code = LOCODE_PROVINCE_BY_LOCATION.get(loc)
            if not province_code:
                lat_guess, lon_guess = coords_for_location(loc, coords)
                if lat_guess is not None and lon_guess is not None:
                    province_code = nearest_province_code(lat_guess, lon_guess)
                else:
                    province_code = LOCODE_PROVINCE_FALLBACK.get(loc)
            if not province_code:
                skipped += 1
                continue
        else:
            skipped += 1
            continue

        city_code = "be" + loc.lower()
        lat, lon = coords_for_location(loc, coords)

        # Dedupe by city_code (some places appear multiple times)
        if city_code in seen:
            continue
        seen.add(city_code)

        loc_dict = {
            "plaats": name,
            "gemeente": name,
            "province_code": province_code,
            "city_code": city_code,
        }
        if lat is not None and lon is not None:
            loc_dict["lat"] = round(lat, 5)
            loc_dict["lon"] = round(lon, 5)
        locations.append(loc_dict)

    locations.sort(key=lambda x: (x["plaats"].lower(), x["city_code"]))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(locations, f, ensure_ascii=False, indent=0)

    print(f"Wrote {len(locations)} locations to {OUTPUT}")
    print(f"Skipped {skipped} entries")


if __name__ == "__main__":
    main()
