# Belgian municipality codes (`be-locode.json`)

How we assign the 3-letter segment in `city_code` (e.g. `beove` → repeater prefix `BE-OVE-`) for the [Repeater Configurator](../configurator.html) and [region map](../region-map.html).

**Machine-readable overrides:** [`be_locode_nis5_un_overrides.py`](be_locode_nis5_un_overrides.py)  
**Audit script:** [`verify_locode_overrides.py`](verify_locode_overrides.py)  
**Generator:** [`generate-be-locode.py`](generate-be-locode.py)

Official UN reference: [UNECE UN/LOCODE — Belgium](https://service.unece.org/trade/locode/be.htm) and [code-list.csv](https://github.com/datasets/un-locode/blob/master/data/code-list.csv).

---

## What each field does

| Field | Role |
|--------|------|
| `plaats` / `gemeente` | Official StatBel municipality name (2025, 565 parents). |
| `city_code` | `be` + UN 3-letter Location → name prefix in configurator. |
| `search_aliases` | Deelgemeenten / old names from NIS6 — **search only**, not the prefix. |
| `lat` / `lon` | Map pin (OSM settlement inside polygon when generator run with `--osm-pbf`, else UN or polygon fallback). |

Searching **“Overpelt”** still finds **Pelt** via `search_aliases`; the prefix follows `city_code` only.

---

## Assignment policy (2026)

1. **Prefer a real Belgian UN/LOCODE row** — do not invent 3-letter codes if a UN row exists for a fusion partner.
2. **Merged municipalities** — if UN still lists the pre-fusion towns separately (e.g. Neerpelt + Overpelt → Pelt), pick the code of the town that hosts the **administrative seat** (zetel / gemeentehuis / maison communale), verified from municipality websites and geocoding. That avoids favouring one deelgemeente arbitrarily.
3. **Homonyms** — when several UN rows share a name in different provinces (e.g. Herent VBR vs Herent Limburg), pick the row whose UN `Subdivision` matches our `province_code` and whose coordinates match the gemeente pin (see disambig table in overrides).
4. **Synthetic codes** — only when no UN Belgium row fits any partner; target is **zero** synthetics in `be-locode.json`.

After applying this policy, all **565** gemeenten use a code that exists in UN/LOCODE Belgium.

---

## Override tables

### `NIS5_TO_UN_LOCATION` (31 rows)

Used when:

- The new fused name is **not** in UN (e.g. Kruisem, Pajottegem).
- Automatic name matching would pick the **wrong** UN row (Brussel vs Anderlecht `ANL`).
- Several UN legacy names exist and we choose by **zetel** (e.g. Pelt → Overpelt `OVE`, not Neerpelt `NRP`).

### `NIS5_UN_DISAMBIG` (16 rows)

Used when automatic token matching returns **multiple** UN Location codes for the same name; we pin the correct province/coordinates.

Examples fixed for wrong homonym (UN subdiv ≠ gemeente province):

| NIS5 | Gemeente | Was | Now | UN name |
|------|----------|-----|-----|---------|
| 23027 | Halle (VBR) | HLL | **HFB** | Halle VBR (HLL = Halle Antwerpen) |
| 24038 | Herent (VBR) | HET | **HEB** | Herent VBR (HET = Herent Limburg) |
| 25084 | Perwez (WBR) | PRW | **PWE** | Perwez WBR (PRW = Perwez Namen) |
| 46030 | Beveren-Kruibeke-Zwijndrecht | BEV | **BWS** | Beveren-Waas VOV (BEV = Beveren West-Vl.) |
| 57018 | Celles (Hainaut) | CEL | **CLE** | Celles WHT (CEL = Celles Namen) |

---

## Seat-based fusion changes (2026)

| NIS5 | Gemeente | Old code | New code | Seat / reasoning |
|------|----------|----------|----------|------------------|
| 72043 | Pelt | NRP | **OVE** | Gemeentehuis Oude Markt 2, **Overpelt** |
| 44086 | Nazareth-De Pinte | NZH | **DPE** | Gemeentehuis **De Pinte** (Gemeenteplein) |
| 45068 | Kruisem | KRS (invented) | **KHM** | Gemeentehuis Markt, **Kruishoutem** |
| 23106 | Pajottegem | PJT (invented) | **GMA** | Zetel **Galmaarden** (Marktplein; fusion 2025) |
| 72038 | Hechtel-Eksel | EKL | **HCL** | Gemeentehuis **Hechtel** |
| 72042 | Oudsbergen | ODG (invented) | **MGU** | Hoofdzetel **Meeuwen** (Dorpsstraat) |
| 71002 | As | ASM (invented) | **ASS** | UN **As** (`ANE` = Assenede, different gemeente) |
| 56029 | Froidchapelle | FRD (invented) | **FDA** | UN Froid-Chapelle |
| 52048 | Montigny-le-Tilleul | MZL (invented) | **MON** | UN Montignies-le-Tilleul |

Already aligned with zetel (unchanged): Puurs-Sint-Amands `PUU`, Tessenderlo-Ham `TES`, Tongeren-Borgloon `TON`, Merelbeke-Melle `MRL`, Bilzen-Hoeselt `BLZ`, etc.

---

## Illustrative cases (from user questions)

### Pelt — `BE-OVE-` not `BE-NRP-`

UN has **no** row named “Pelt”. It still has **NRP** (Neerpelt) and **OVE** (Overpelt). Zetel is in **Overpelt**, so we use **OVE**. Both names remain in `search_aliases`.

### Nazareth-De Pinte — `BE-DPE-` not `BE-NZH-`

Same pattern: UN rows **NZH** + **DPE**; zetel in **De Pinte**.

### Kruisem — `BE-KHM-` not `BE-KRS-`

**KRS** was invented. UN has **KHM** (Kruishoutem) and **ZGM** (Zingem); zetel is **Kruishoutem**.

### Herent — one gemeente, one code

Only **one** gemeente Herent (NIS 24038) → **`beheb` (HEB)**. UN also has **HET** (Herent, Limburg) for a parish inside **Pelt**; that code is **not** assigned to any of our 565 rows. Searching “Herent” matches the VBR gemeente by primary name; Limburg residents in Pelt should search “Pelt” / “Overpelt” / “Neerpelt”.

---

## `search_aliases` vs `city_code`

- Built from **NIS6** sector names in `generate-be-locode.py` (`build_aliases`).
- **Not** updated when we only patch `city_code` in git — a full regen refreshes aliases.
- ~29 normalized alias strings appear on more than one gemeente (e.g. `beveren` on Alveringem, BKZ, Roeselare); search can return multiple hits — user picks the row.
- Known gap: **Herent** (Limburg, in Pelt) is not an alias on Pelt; optional future addition.

---

## Regenerating `be-locode.json`

**Full rebuild** (recommended after override changes):

```bash
cd RRY-Map-Bot
.venv/bin/python3 scripts/generate-be-locode.py \
  --nis6 data/inputs/NIS6withnamefrom01012025.xlsx \
  --refnis data/inputs/REFNIS_2025_CITIES.xlsx \
  --osm-pbf /path/to/belgium-latest.osm.pbf \
  -o data/be-locode.json
.venv/bin/python3 scripts/generate-be-municipalities-geojson.py
```

StatBel xlsx / large sector GeoJSON are usually **local** under `data/inputs/` or `data/statbel/` (not always in git).

**Verify without regenerating:**

```bash
python3 scripts/verify_locode_overrides.py
```

Expect: 565 rows, 0 override mismatches, 0 invented codes, provinces OK vs UN subdiv on overridden rows.

**Partial patch (2026 session):** `city_code` was updated in committed `be-locode.json` and `be-municipalities.geojson` for the gemeenten in the tables above; `search_aliases` and coordinates were left from the previous generator run until someone runs a full rebuild.

---

## Prefix changes for existing node names

Users who already advertised with old segments may need to rename, e.g.:

| Gemeente | Old prefix | New prefix |
|----------|------------|------------|
| Pelt | `BE-NRP-` | `BE-OVE-` |
| Nazareth-De Pinte | `BE-NZH-` | `BE-DPE-` |
| Kruisem | `BE-KRS-` | `BE-KHM-` |
| Halle (VBR) | `BE-HLL-` | `BE-HFB-` |
| Herent (VBR) | `BE-HET-` | `BE-HEB-` |

This is intentional so the code reflects the administrative seat and correct UN homonym, not an arbitrary fusion half.
