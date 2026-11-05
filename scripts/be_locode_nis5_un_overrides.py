"""
NIS5 (gemeente) -> UN/LOCODE 3-letter Location when automatic matching fails
or when multiple UN rows share the same name.

Policy (2026):
  1. Prefer a real UN/LOCODE row over inventing a 3-letter code.
  2. For merged municipalities with several UN legacy names, pick the code of
     the town that hosts the official administrative seat (zetel / maison
     communale), verified via municipality websites and geocoding — so no
     deelgemeente is favoured arbitrarily.
  3. Use synthetic codes only when no Belgian UN row fits any fusion partner.

Keys: zero-padded 5-digit CNIS5_2025. Values: uppercase UN Location (3 letters).

Full rationale, examples (Pelt, Kruisem, homonyms), and regen steps: LOCODE_POLICY.md
"""

# No automatic UN row (new name not in UN) or explicit seat / disambiguation choice
NIS5_TO_UN_LOCATION = {
    "12014": "HPG",  # Heist-op-den-Berg (not HEI / Knokke-Heist)
    "31043": "KHI",  # Knokke-Heist (not HEI)
    "85024": "MDV",  # Meix-devant-Virton (not VIR Virton)
    "85045": "VIR",  # Virton
    "57095": "MDL",  # Mont-de-l'Enclus (not MSU Mont-Saint-Guibert)
    "25068": "MSU",  # Mont-Saint-Guibert
    "21004": "BRU",  # Brussel (gemeente) — avoid ANL Anderlecht token clash
    "12041": "PUU",  # Puurs-Sint-Amands — zetel Puurs
    "23106": "GMA",  # Pajottegem — zetel Galmaarden (Marktplein)
    "34043": "SPI",  # Spiere-Helkijn — zetel Spiere
    "44086": "DPE",  # Nazareth-De Pinte — zetel De Pinte (not NZH Nazareth)
    "44088": "MRL",  # Merelbeke-Melle — zetel Merelbeke
    "45063": "SMI",  # Lierde — Sint-Martens-Lierde
    "45068": "KHM",  # Kruisem — zetel Kruishoutem (not synthetic KRS)
    "46030": "BWS",  # Beveren-Kruibeke-Zwijndrecht (BEV = Beveren West-Vl.)
    "52048": "MON",  # Montigny-le-Tilleul — UN Montignies-le-Tilleul
    "56029": "FDA",  # Froidchapelle — UN Froid-Chapelle
    "57097": "COM",  # Komen-Waasten / Comines-Warneton
    "58004": "MLW",  # Morlanwelz — Morlanwelz-Mariemont
    "62011": "BTS",  # Bassenge — Bitsingen (Bassenge)
    "62063": "LGG",  # Luik / Liège
    "71002": "ASS",  # As — UN As (ANE = Assenede, not ASM)
    "71071": "TES",  # Tessenderlo-Ham — zetel Tessenderlo
    "72038": "HCL",  # Hechtel-Eksel — zetel Hechtel (not EKL)
    "72042": "MGU",  # Oudsbergen — zetel Meeuwen (Meeuwen-Gruitrode)
    "72043": "OVE",  # Pelt — zetel Overpelt Oude Markt (not NRP Neerpelt)
    "73110": "BLZ",  # Bilzen-Hoeselt — zetel Bilzen
    "73111": "TON",  # Tongeren-Borgloon — zetel Tongeren
    "85046": "HLN",  # Habay — Habay-la-Neuve proxy
    "91142": "HPD",  # Hastière — Hastière-par-delà proxy
    "52055": "PCL",  # Pont-à-Celles — avoid CEL Celles (Hainaut)
    "24135": "TWI",  # Tielt-Winge — avoid TLT Tielt
}

# When multiple UN Location codes match the same gemeente name (homonyms)
NIS5_UN_DISAMBIG = {
    "13031": "OTH",  # Oud-Turnhout (not TUR Turnhout)
    "12035": "SSL",  # Sint-Katelijne-Waver — SSL has coords (SKA empty in UN)
    "13053": "LDA",  # Laakdal (not YZO)
    "23027": "HFB",  # Halle (VBR; HLL = Halle Antwerpen, HAQ = Hal Limburg)
    "23047": "MAC",  # Machelen (VBR; not MCN)
    "23077": "VGW",  # Sint-Pieters-Leeuw
    "24038": "HEB",  # Herent (VBR; HET = Herent Limburg)
    "25084": "PWE",  # Perwez (WBR; PRW = Perwez Namen)
    "25112": "WVR",  # Waver (Waals-Brabant Wavre; not WAV)
    "37022": "TLT",  # Tielt (not TTL)
    "41063": "SLH",  # Sint-Lievens-Houtem (not SHM)
    "42008": "HME",  # Hamme (Oost-Vlaanderen; not HAE/HMM)
    "46020": "SGW",  # Sint-Gillis-Waas (not GIL)
    "46021": "SNK",  # Sint-Niklaas (not SNO)
    "53053": "MQS",  # Bergen / Mons
    "57018": "CLE",  # Celles (Hainaut; CEL = Celles Namen)
}
