# Scripts

## Phase 1 — `generate-be-locode.py`

Builds [`data/be-locode.json`](../data/be-locode.json): **exactly 565** Belgian municipalities (StatBel NIS2025 / NIS6 parents), one map point per gemeente, plus `search_aliases` from NIS6 section names (deelgemeenten).

**Source-of-truth order**

1. **Set of gemeenten:** NIS6 xlsx column `CNIS5_2025` (565 unique parents).
2. **`province_code`:** derived by walking `REFNIS_2025_CITIES.xlsx` (province headers → following gemeente rows); default file is under [`data/inputs/`](../data/inputs/) if present, else [`data/statbel/`](../data/statbel/).
3. **`city_code` / default coordinates:** [UN/LOCODE `code-list.csv`](https://github.com/datasets/un-locode/blob/master/data/code-list.csv) (Belgium rows), with [`be_locode_nis5_un_overrides.py`](be_locode_nis5_un_overrides.py) for fusions, disambiguation, and seat-based picks (see **[LOCODE_POLICY.md](LOCODE_POLICY.md)**). With `--osm-pbf`, pins come from OSM **settlement** nodes (`place=*`) inside each gemeente polygon, then polygon **representative_point**, then UN coords.

   After changing overrides, run [`verify_locode_overrides.py`](verify_locode_overrides.py) and regenerate `be-locode.json` when StatBel inputs are available.
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

Consumers: [Repeater Configurator](../configurator.html), [region map](../region-map.html).

**StatBel geometry (reference only):** how to obtain municipality / sector GeoJSON for your own checks is documented in [`data/statbel/STATBEL_MUNICIPALITIES.md`](../data/statbel/STATBEL_MUNICIPALITIES.md). The in-repo Python audit scripts were removed; regenerate `be-locode.json` with `generate-be-locode.py` when source data or overrides change.

## Phase 2 — `generate-be-municipalities-geojson.py`

Builds [`data/be-municipalities.geojson`](../data/be-municipalities.geojson): **565** Belgian gemeente polygons in WGS84 (EPSG:4326), dissolved from the StatBel statistical-sectors GeoJSON and joined with the canonical labels from [`be-locode.json`](../data/be-locode.json).

Consumed at runtime by [`backend/belgian_geocoder.py`](../backend/belgian_geocoder.py) to do fast point-in-polygon checks during [`backend/sync_belgian_nodes.py`](../backend/sync_belgian_nodes.py), replacing the per-node Nominatim call.

**Source-of-truth order**

1. **Polygons:** StatBel statistical sectors GeoJSON (EPSG:3812), grouped and merged by property `cd_munty_refnis` (= NIS5). Expected under [`data/inputs/`](../data/inputs/), then [`data/statbel/`](../data/statbel/).
2. **Labels (`plaats`, `gemeente`, `province_code`, `city_code`):** joined from [`data/be-locode.json`](../data/be-locode.json) on NIS5.

The script simplifies geometries in EPSG:3812 (metric) at `5 m` tolerance by default, reprojects to EPSG:4326, and rounds output coordinates to 6 decimals.

**Dependencies:** `shapely`, `pyproj` (already in [`requirements.txt`](../requirements.txt)).

```bash
cd RRY-Map-Bot
.venv/bin/python3 scripts/generate-be-municipalities-geojson.py
```

Run it again only when StatBel releases new boundaries (typically yearly) or when `be-locode.json` changes. The generated GeoJSON is small (~5 MB) and is committed to the repo so deploys don't need the full 226 MB sectors file.

Optional flags:

```bash
.venv/bin/python3 scripts/generate-be-municipalities-geojson.py \
  --sectors path/to/sh_statbel_statistical_sectors_3812_20250101.geojson \
  --locode  path/to/be-locode.json \
  --simplify-meters 5 \
  --coord-precision 6 \
  -o data/be-municipalities.geojson
```

**Output schema (per feature):** `properties.nis5`, `properties.plaats`, `properties.gemeente`, `properties.province_code`, `properties.city_code`; `geometry` is a `Polygon` or `MultiPolygon` in EPSG:4326.

## One-shot DB backfills

### `backfill_cities.py`

Rewrites every row's `city` using the local StatBel-based geocoder. See the script's own docstring for the full behaviour (backup, dry-run, logs, `node_changes` audit with `change_type='city_backfill'`).

```bash
cd RRY-Map-Bot
.venv/bin/python3 scripts/backfill_cities.py --dry-run
.venv/bin/python3 scripts/backfill_cities.py
```

### `backfill_inserted_date.py`

Fills `inserted_date` on any `belgian_nodes` row where it is `NULL` or empty, using `created_at` first and the current time as a last resort. The stats chart and timeline playback treat `inserted_date` as "first seen on the official MeshCore map" (see `get_synthetic_sync_rows` in [`backend/api/app.py`](../backend/api/app.py)); an empty value would fall through `COALESCE` to `created_at`, distorting cumulative totals.

The sync importer already stamps `inserted_date = get_current_timestamp()` when the official feed omits it (see [`backend/sync_belgian_nodes.integrate_added_node`](../backend/sync_belgian_nodes.py)), so this script is a one-shot safety net for historical rows and a re-runnable future-proof guard. On a clean DB it touches zero rows.

```bash
cd RRY-Map-Bot
.venv/bin/python3 scripts/backfill_inserted_date.py --dry-run
.venv/bin/python3 scripts/backfill_inserted_date.py
```

Each write is mirrored into `node_changes` with `change_type='inserted_date_backfill'` (old value = `null`, new value = chosen timestamp + `fallback_source`).
