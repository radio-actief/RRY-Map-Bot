# StatBel geometry (reference for downloading / reprojecting GeoJSON)

`scripts/generate-be-locode.py` can use **statistical sector** GeoJSON (Lambert) as an optional tie-break when resolving OSM settlement coordinates (`--sectors-geojson` or the default file under `data/inputs/` / `data/statbel/`). Municipality polygons are **not** required for generation.

You can still use municipality or sector GeoJSON in your **own** tooling (point-in-polygon, distance checks) with the notes below.

## Option A — Statistical sectors (Lambert 2008, large file)

Example file: `sh_statbel_statistical_sectors_3812_20250101.geojson` (EPSG:3812), from [StatBel — Statistical sectors](https://statbel.fgov.be/en/open-data/statistical-sectors-2025) / [data.gov.be](https://data.gov.be/).

- **CRS:** filenames containing `3812` or `31370` imply Lambert; use the CRS that matches your extract when projecting `be-locode.json` WGS84 points for distance / point-in-polygon checks.

## Option B — Municipality boundaries (WGS84 / EPSG:4326)

1. Open **Statistics Belgium — Open Data** → *Geographic files* / *Code REFNIS* ([Open Data](https://statbel.fgov.be/en/open-data)).
2. Download **municipality** GeoJSON in **EPSG:4326**, or reproject, for example:

```bash
ogr2ogr -t_srs EPSG:4326 gemeenten_4326.geojson sh_statbel_municipalities_31370.geojson
```

## NIS5 join (sector extracts)

Sector features often expose gemeente NIS5 as **`cd_munty_refnis`**. Municipality extracts may use `CNIS5_2025`, `CNIS5`, `NIS5`, etc.

## Licence

StatBel open data are typically **CC BY 4.0** — retain attribution when publishing derivative maps or reports.
