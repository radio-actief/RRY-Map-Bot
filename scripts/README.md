# Scripts

## Phase 1 — `generate-be-locode.py`

Builds [`data/be-locode.json`](../data/be-locode.json): **exactly 565** Belgian municipalities (StatBel NIS2025 / NIS6 parents), one map point per gemeente, plus `search_aliases` from NIS6 section names (deelgemeenten).

**Source-of-truth order**

1. **Set of gemeenten:** NIS6 xlsx column `CNIS5_2025` (565 unique parents).
2. **`province_code`:** derived by walking `REFNIS_2025_CITIES.xlsx` (province headers → following gemeente rows); default file is under [`data/inputs/`](../data/inputs/) if present, else [`data/statbel/`](../data/statbel/).
3. **`city_code` / default coordinates:** [UN/LOCODE `code-list.csv`](https://github.com/datasets/un-locode/blob/master/data/code-list.csv) (Belgium rows), with [`be_locode_nis5_un_overrides.py`](be_locode_nis5_un_overrides.py) for fusions, disambiguation, and synthetic 3-letter codes. With `--osm-pbf`, pins come from OSM **settlement** nodes (`place=*`) inside each gemeente polygon, then polygon **representative_point**, then UN coords.
4. **Legacy UN coordinate fixes:** `LOCODE_COORD_OVERRIDES` in `generate-be-locode.py` (still keyed by UN Location).
5. **`plaats` / `gemeente`:** Dutch in Flanders and Brussels, French in Wallonia (with the other language and sectors in `search_aliases`).

**Inputs (defaults):** prefer [`data/inputs/`](../data/inputs/) (see [`data/inputs/README.md`](../data/inputs/README.md)), then fall back to `data/statbel/`:

- `NIS6withnamefrom01012025.xlsx`
- `REFNIS_2025_CITIES.xlsx`
- Optional sectors GeoJSON: `sh_statbel_statistical_sectors_3812_20250101.geojson` (same resolution order)

**Dependencies:** `openpyxl` (see [`requirements.txt`](../requirements.txt)). For `--osm-pbf` / sectors, `shapely` / `pyproj` and dev deps: [`requirements-dev.txt`](../requirements-dev.txt).

```bash
cd RRY-Map-Bot
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python3 scripts/generate-be-locode.py
```

**Production map pins (recommended):** Geofabrik `belgium*.osm.pbf` + dev deps (`pip install -r requirements-dev.txt`). Pass `--osm-pbf` for **settlement** coordinates (`place=city|town|village|…` inside the admin polygon), falling back to polygon **representative_point**, then UN. Optional sector GeoJSON (same basename as above under `data/inputs/` or `data/statbel/`, auto-used when present unless `--no-sectors`) supplies an **area-weighted centroid** per gemeente to break ties between multiple settlements. For a **much faster** second pass over the PBF, install the **`osmium`** CLI (`brew install osmium-tool` / `osmium-tool` package); otherwise the script scans all nodes once.

```bash
.venv/bin/python3 scripts/generate-be-locode.py \
  --osm-pbf ~/Downloads/belgium-latest.osm.pbf \
  -o data/be-locode.json
```

Skip StatBel tie-break (faster, less RAM) while still using OSM settlements:

```bash
.venv/bin/python3 scripts/generate-be-locode.py \
  --osm-pbf ~/Downloads/belgium-latest.osm.pbf \
  --no-sectors \
  -o data/be-locode.json
```

Optional paths:

```bash
.venv/bin/python3 scripts/generate-be-locode.py \
  --nis6 path/to/NIS6withnamefrom01012025.xlsx \
  --refnis path/to/REFNIS_2025_CITIES.xlsx \
  -o data/be-locode.json
```

**Output schema (per row):** `nis5`, `plaats`, `gemeente`, `province_code`, `city_code`, `lat`, `lon`, `search_aliases` (array of strings).

Consumers: [Regioncodes Configurator](../region-configurator.html), [region map](../region-map.html).

**StatBel geometry (reference only):** how to obtain municipality / sector GeoJSON for your own checks is documented in [`data/statbel/STATBEL_MUNICIPALITIES.md`](../data/statbel/STATBEL_MUNICIPALITIES.md). The in-repo Python audit scripts were removed; regenerate `be-locode.json` with `generate-be-locode.py` when source data or overrides change.
