# Scripts

## generate-be-locode.py

Genereert `data/be-locode.json` uit UN/LOCODE België.

```bash
python3 scripts/generate-be-locode.py
```

- **Bron:** [UN/LOCODE code-list.csv](https://github.com/datasets/un-locode/blob/master/data/code-list.csv)
- **Output:** `data/be-locode.json` – alle Belgische locaties voor de [Regioncodes Configurator](../region-configurator.html)

Draai dit script periodiek om de data te vernieuwen wanneer UN/LOCODE wordt bijgewerkt.
