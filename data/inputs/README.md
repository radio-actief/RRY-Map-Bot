# Local build inputs (not committed)

Place reference files here so `scripts/generate-be-locode.py` picks them up automatically (it prefers `data/inputs/` over `data/statbel/`).

Suggested copies or symlinks from `~/Downloads/` (reference snapshot **2025-05-01** / StatBel situation **2025-01-01**):

| File | Role |
|------|------|
| `belgium-260501.osm.pbf` | Geofabrik Belgium extract — pass as `--osm-pbf` (any matching `belgium*.osm.pbf` is fine if you pass the path explicitly). |
| `NIS6withnamefrom01012025.xlsx` | StatBel NIS6 — gemeente set and aliases. |
| `REFNIS_2025_CITIES.xlsx` | StatBel REFNIS — province per gemeente. |
| `sh_statbel_statistical_sectors_3812_20250101.geojson` | StatBel statistical sectors (EPSG:3812) — optional tie-break for OSM settlement coords. |

Example:

```bash
cd RRY-Map-Bot/data/inputs
ln -sf ~/Downloads/NIS6withnamefrom01012025.xlsx .
ln -sf ~/Downloads/REFNIS_2025_CITIES.xlsx .
ln -sf ~/Downloads/sh_statbel_statistical_sectors_3812_20250101.geojson .
ln -sf ~/Downloads/belgium-260501.osm.pbf .
```

Verify / compare scripts write under `data/.cache/verify/` by default (gitignored).
