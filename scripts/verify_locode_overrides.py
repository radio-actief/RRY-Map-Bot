#!/usr/bin/env python3
"""Verify NIS5 LOCODE overrides against be-locode.json and UN/LOCODE CSV.

Expects ``be_locode_nis5_un_overrides.py`` policy: real UN codes preferred;
fusions use the UN row for the town with the administrative seat (zetel).
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from be_locode_nis5_un_overrides import NIS5_TO_UN_LOCATION, NIS5_UN_DISAMBIG

BELOCODE = REPO / "data" / "be-locode.json"
UN_URL = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv"

UN_SUBDIV_TO_PROV = {
    "VAN": "be-van",
    "VBR": "be-vbr",
    "VLI": "be-vli",
    "VOV": "be-vov",
    "VWV": "be-vwv",
    "WBR": "be-wbr",
    "WHT": "be-wht",
    "WLG": "be-wlg",
    "WLX": "be-wlx",
    "WNA": "be-wna",
    "BRU": "be-bru",
}

LOCODE_COORD_OVERRIDES = {
    "TNO": (49.717, 5.417),
    "VIT": (50.280, 6.127),
    "KZN": (50.944, 5.189),
    "PUR": (50.321, 5.262),
    "SDE": (50.472, 4.797),
}


def norm_key(s: str) -> str:
    s = (s or "").lower().strip()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_unlocode_coords(s: str):
    if not s or not str(s).strip():
        return None, None
    s = str(s).strip()
    parts = s.split()
    if len(parts) != 2:
        return None, None
    try:
        lat_s, lon_s = parts[0], parts[1]
        lat_val = int(lat_s[:4])
        lat_dir = lat_s[-1]
        lon_val = int(lon_s[:5])
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


def coords_for_un_location(loc_code: str, coords_str: str):
    loc_u = (loc_code or "").upper()
    if loc_u in LOCODE_COORD_OVERRIDES:
        return LOCODE_COORD_OVERRIDES[loc_u]
    return parse_unlocode_coords(coords_str)


def fetch_un_be() -> dict[str, dict]:
    with urllib.request.urlopen(UN_URL, timeout=60) as resp:
        rows = list(csv.DictReader(line.decode("utf-8") for line in resp))
    return {
        r["Location"].strip().upper(): r
        for r in rows
        if r.get("Country") == "BE" and r.get("Location")
    }


def gemeente_match_keys(nl: str, fr: str) -> set[str]:
    keys = {norm_key(nl), norm_key(fr)} - {""}
    for s in (nl, fr):
        for part in re.split(r"[-–]", s or ""):
            k = norm_key(part.strip())
            if len(k) >= 3:
                keys.add(k)
    return keys


def auto_un_candidates(plaats: str, tokens_index: dict) -> list[str]:
    keys = gemeente_match_keys(plaats, plaats)
    out: list[str] = []
    seen: set[str] = set()
    for k in keys:
        for r in tokens_index.get(k, []):
            loc = r.get("Location", "").strip().upper()
            if len(loc) == 3 and loc not in seen:
                seen.add(loc)
                out.append(loc)
    return sorted(out)


def build_tokens_index(be_rows: list[dict]) -> dict:
    from collections import defaultdict

    idx: dict = defaultdict(list)
    for r in be_rows:
        loc = r.get("Location", "").strip()
        if len(loc) != 3:
            continue
        func = r.get("Function", "")
        if func and func.startswith("1") and "3" not in func and "2" not in func:
            continue
        name = r.get("Name", "") or ""
        toks = {norm_key(name)}
        for part in re.split(r"[/]", name):
            part = part.strip()
            if not part:
                continue
            sub = re.split(r"\(", part, maxsplit=1)[0].strip()
            if sub:
                toks.add(norm_key(sub))
        for tok in toks:
            if len(tok) >= 3:
                idx[tok].append(r)
    return idx


def main() -> int:
    with open(BELOCODE, encoding="utf-8") as f:
        locs = {r["nis5"]: r for r in json.load(f)}

    un = fetch_un_be()
    be_rows = list(un.values())
    tokens = build_tokens_index(be_rows)

    issues: list[str] = []
    warnings: list[str] = []
    rows_out: list[dict] = []

    overlap = set(NIS5_TO_UN_LOCATION) & set(NIS5_UN_DISAMBIG)
    if overlap:
        issues.append(f"NIS5 in BOTH tables: {overlap}")

    all_ov = {
        **{k: (v, "TO_UN") for k, v in NIS5_TO_UN_LOCATION.items()},
        **{k: (v, "DISAMBIG") for k, v in NIS5_UN_DISAMBIG.items()},
    }

    print(f"TO_UN={len(NIS5_TO_UN_LOCATION)} DISAMBIG={len(NIS5_UN_DISAMBIG)} total={len(all_ov)}")
    print(f"be-locode.json={len(locs)} municipalities\n")

    for nis5, (code, kind) in sorted(all_ov.items()):
        loc = locs.get(nis5)
        if not loc:
            issues.append(f"{nis5} {code}: not in be-locode.json")
            continue

        plaats = loc["plaats"]
        expected = "be" + code.lower()
        row = {
            "nis5": nis5,
            "plaats": plaats,
            "code": code,
            "kind": kind,
            "city_code_ok": loc["city_code"] == expected,
            "province": loc.get("province_code"),
            "lat": loc.get("lat"),
            "lon": loc.get("lon"),
        }

        if loc["city_code"] != expected:
            issues.append(f"{nis5} {plaats}: {loc['city_code']} != {expected}")

        un_row = un.get(code)
        if un_row:
            row["in_un"] = True
            row["un_name"] = un_row.get("Name", "")
            row["un_submotion"] = un_row.get("Subdivision", "")
            un_sub = (un_row.get("Subdivision") or "").strip().upper()
            un_prov = UN_SUBDIV_TO_PROV.get(un_sub)
            if un_prov and loc.get("province_code") and un_prov != loc["province_code"]:
                issues.append(
                    f"{nis5} {plaats} ({code}): prov {loc['province_code']} != UN {un_sub}->{un_prov}"
                )
            ulat, ulon = coords_for_un_location(code, un_row.get("Coordinates") or "")
            row["un_lat"] = ulat
            row["un_lon"] = ulon
            if ulat and "lat" in loc:
                d_km = ((loc["lat"] - ulat) ** 2 + (loc["lon"] - ulon) ** 2) ** 0.5 * 111
                row["pin_km_from_un"] = round(d_km, 1)
                if d_km > 12:
                    warnings.append(f"{nis5} {plaats}: pin {d_km:.0f}km from UN ({code})")
        else:
            row["in_un"] = False
            cands = auto_un_candidates(plaats, tokens)
            row["auto_if_no_override"] = ",".join(cands) if cands else "none"
            # also check aliases
            for alias in loc.get("search_aliases") or []:
                ac = auto_un_candidates(alias, tokens)
                if ac:
                    row.setdefault("alias_un_cands", {})[alias] = ac

        cands = auto_un_candidates(plaats, tokens)
        if len(cands) > 1 and code not in cands:
            row["auto_cands"] = cands
        elif len(cands) == 1 and cands[0] != code:
            row["auto_single"] = cands[0]

        rows_out.append(row)

    # duplicate city codes
    by_cc: dict[str, list] = {}
    for r in locs.values():
        by_cc.setdefault(r["city_code"], []).append((r["nis5"], r["plaats"]))
    for cc, items in by_cc.items():
        if len(items) > 1:
            issues.append(f"Duplicate {cc}: {items}")

    # coord overrides usage
    print("=== LOCODE_COORD_OVERRIDES ===")
    for code in sorted(LOCODE_COORD_OVERRIDES):
        users = [r["plaats"] for r in locs.values() if r["city_code"] == "be" + code.lower()]
        print(f"  {code} -> {users or '(no gemeente uses this code)'}")

    print("\n=== TABLE (verified against live UN CSV) ===")
    print(
        f"{'NIS5':<6} {'Plaats':<26} {'Code':<4} {'Kind':<8} {'Prov':<8} "
        f"{'UN?':<4} {'UN subdiv':<6} {'km UN':<6} Note"
    )
    for row in rows_out:
        note = []
        if not row["city_code_ok"]:
            note.append("CITY_MISMATCH")
        if not row.get("in_un"):
            note.append("SYNTHETIC")
            if row.get("auto_if_no_override") not in ("none", ""):
                note.append(f"auto={row['auto_if_no_override']}")
        if row.get("auto_single"):
            note.append(f"would_auto={row['auto_single']}")
        if row.get("auto_cands"):
            note.append(f"cands={row['auto_cands']}")
        km = row.get("pin_km_from_un", "")
        print(
            f"{row['nis5']:<6} {row['plaats'][:26]:<26} {row['code']:<4} {row['kind']:<8} "
            f"{row.get('province',''):<8} {'yes' if row.get('in_un') else 'no':<4} "
            f"{row.get('un_subdiv',''):<6} {str(km):<6} {';'.join(note)}"
        )

    print(f"\n=== ISSUES ({len(issues)}) ===")
    for i in issues:
        print(f"  {i}")
    if not issues:
        print("  None — overrides match be-locode.json; provinces OK vs UN subdiv.")

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
