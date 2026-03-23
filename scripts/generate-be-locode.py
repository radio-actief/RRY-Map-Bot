#!/usr/bin/env python3
"""
Generate be-locode.json from UN/LOCODE Belgium data.
Based on https://service.unece.org/trade/locode/be.htm
Uses https://github.com/datasets/un-locode data.
"""
import csv
import json
import urllib.request
from pathlib import Path

UN_LOCODE_CSV = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "be-locode.json"

# UN/LOCODE Subdivision -> MeshCore province_code
# ISO 3166-2:BE: be-vlg = Vlaanderen (region), be-vli = Limburg (province)
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
    "WAL": "be-wal",   # Wallonië (generic)
}

# Province -> Gewest (region)
PROVINCE_TO_REGION = {
    "be-van": "be-vlg", "be-vov": "be-vlg", "be-vwv": "be-vlg",
    "be-vbr": "be-vlg", "be-vli": "be-vlg",  # Flanders (Limburg = be-vli)
    "be-bru": "be-bru",  # Brussels
    "be-wbr": "be-wal", "be-wht": "be-wal", "be-wlg": "be-wal",
    "be-wna": "be-wal", "be-wlx": "be-wal", "be-wal": "be-wal",
}


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

        province_code = SUBDIV_TO_PROVINCE.get(subdiv)
        if not province_code and subdiv:
            skipped += 1
            continue
        if not province_code:
            province_code = "be-wal"  # default Wallonia for unknown

        region = PROVINCE_TO_REGION.get(province_code, "be-wal")
        city_code = "be" + loc.lower()
        coords = row.get("Coordinates", "").strip()
        lat, lon = parse_unlocode_coords(coords)

        # Dedupe by city_code (some places appear multiple times)
        if city_code in seen:
            continue
        seen.add(city_code)

        loc_dict = {
            "plaats": name,
            "gemeente": name,
            "province_code": province_code,
            "region": region,
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
