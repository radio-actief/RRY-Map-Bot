"""
NIS5 (gemeente) -> UN/LOCODE 3-letter Location when automatic matching fails
or when multiple UN rows share the same name and we must pick one.

Keys: zero-padded 5-digit CNIS5_2025. Values: uppercase UN Location (3 letters).
"""

# No automatic UN row (fusion / new name not in UN dataset) or explicit choice
NIS5_TO_UN_LOCATION = {
    "12014": "HPG",  # Heist-op-den-Berg (not HEI / Knokke-Heist)
    "31043": "KHI",  # Knokke-Heist (not HEI)
    "85024": "MDV",  # Meix-devant-Virton (not VIR Virton)
    "85045": "VIR",  # Virton
    "57095": "MDL",  # Mont-de-l'Enclus (not MSU Mont-Saint-Guibert)
    "25068": "MSU",  # Mont-Saint-Guibert
    "21004": "BRU",  # Brussel (gemeente) — avoid ANL Anderlecht token clash
    "12041": "PUU",  # Puurs-Sint-Amands — UN has Puurs
    "23106": "PJT",  # Pajottegem — synthetic (not in UN)
    "34043": "SPI",  # Spiere-Helkijn — UN Spiere (Espierres)
    "44086": "NZH",  # Nazareth-De Pinte
    "44088": "MRL",  # Merelbeke-Melle
    "45063": "SMI",  # Lierde — Sint-Martens-Lierde
    "45068": "KRS",  # Kruisem — synthetic
    "46030": "BEV",  # Beveren-Kruibeke-Zwijndrecht
    "52048": "MZL",  # Montigny-le-Tilleul — synthetic
    "56029": "FRD",  # Froidchapelle — synthetic
    "57097": "COM",  # Komen-Waasten / Comines-Warneton
    "58004": "MLW",  # Morlanwelz — Morlanwelz-Mariemont
    "62011": "BTS",  # Bitsingen — Bassenge
    "62063": "LGG",  # Luik / Liège
    "71002": "ASM",  # As — synthetic (short name; avoid ASS Assenede)
    "71071": "TES",  # Tessenderlo-Ham
    "72042": "ODG",  # Oudsbergen — synthetic (avoid OBG Oudenburg)
    "72043": "NRP",  # Pelt
    "73110": "BLZ",  # Bilzen-Hoeselt
    "73111": "TON",  # Tongeren-Borgloon — Tongeren centre proxy
    "85046": "HLN",  # Habay — Habay-la-Neuve proxy
    "91142": "HPD",  # Hastière — Hastière-par-delà proxy
    "52055": "PCL",  # Pont-à-Celles — avoid CEL Celles (Hainaut)
    "24135": "TWI",  # Tielt-Winge — avoid TLT Tielt
}

# When multiple UN Location codes match the same gemeente name
NIS5_UN_DISAMBIG = {
    "13031": "OTH",  # Oud-Turnhout (not TUR Turnhout)
    "12035": "SSL",  # Sint-Katelijne-Waver — SSL has coords (SKA has empty coords in UN)
    "13053": "LDA",  # Laakdal (not YZO)
    "23027": "HLL",  # Halle (Vlaams-Brabant; not HFB HAQ)
    "23047": "MAC",  # Machelen (VBR; not MCN)
    "23077": "VGW",  # Sint-Pieters-Leeuw
    "24038": "HET",  # Herent (VBR; not HEB)
    "25084": "PRW",  # Perwez (Perwijs)
    "25112": "WVR",  # Waver (Waals-Brabant Wavre; not WAV)
    "37022": "TLT",  # Tielt (not TTL)
    "41063": "SLH",  # Sint-Lievens-Houtem (not SHM)
    "42008": "HME",  # Hamme (Oost-Vlaanderen; not HAE/HMM)
    "46020": "SGW",  # Sint-Gillis-Waas (not GIL)
    "46021": "SNK",  # Sint-Niklaas (not SNO)
    "53053": "MQS",  # Bergen / Mons
    "57018": "CEL",  # Celles (Hainaut)
}
