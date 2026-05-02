# StatBel / NIS reference files

Place the official spreadsheets under **`data/inputs/`** (preferred; see [`../inputs/README.md`](../inputs/README.md)) or here in `data/statbel/`, or pass explicit paths to `scripts/generate-be-locode.py`:

- **`NIS6withnamefrom01012025.xlsx`** — NIS6 sections per gemeente; defines the **565** `CNIS5_2025` parents and `search_aliases` (from `T_NIS6_NL` / `T_NIS6_FR`).
- **`REFNIS_2025_CITIES.xlsx`** — administrative hierarchy; used only to assign **`province_code`** per `Code NIS`.

Update these when StatBel publishes a new reference date; then regenerate `be-locode.json` with `scripts/generate-be-locode.py`.

**Municipality boundaries (reference):** see [STATBEL_MUNICIPALITIES.md](STATBEL_MUNICIPALITIES.md) for downloading / reprojecting GeoJSON if you run your own geometry checks.
