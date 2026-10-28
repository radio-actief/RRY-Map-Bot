# Translation glossary

The terms the site's Dutch (nl_BE) and French (fr_FR) texts use, for the whole site: the map, stats,
region map, the shared top bar and the configurator. Message files: `src/shared/i18n/*.{en,nl,fr}.json`
(top bar, menu, place names and the three tool pages) and `web/configurator/src/i18n/{en,nl,fr}.json`.

Dutch uses "je"; French uses "vous". Both stay short and plain, in the tone of the English.

## Community terms

| English | Nederlands | Français | Note |
| --- | --- | --- | --- |
| repeater | repeater | répéteur | |
| companion | companion | companion | |
| room server | room server | room server | |
| sensor | sensor | capteur | |
| client (node type on the map) | client | client | |
| node | node | nœud | |
| mesh | mesh | mesh | |
| advert | advert | advert | French has no settled word; "annonce" would be the plain one |
| flood (noun and verb) | flood, flooden | flood, relayer en flood | |
| zero-hop advert | zero-hop advert | advert zero-hop | |
| flood advert | flood advert | advert en flood | |
| hop | hop | saut | |
| region (MeshCore scope) | regio, regio's | région, régions | the Belgian community wiki says "regio", "regio's" and "regio-scope" |
| region code | regiocode | code de région | |
| home region | thuisregio | région d'attache | |
| untagged (traffic without a region) | zonder regio | sans région | |
| default region (a companion's) | standaardregio | région par défaut | the app's own label stays "Default Region Scope" |
| channel (hashtag channel) | kanaal | canal | channel names (#bemesh) never change |
| Open in app | Openen in app | Ouvrir dans l'app | |
| uploader | uploader | uploader | |
| claim / unclaim (a node) | claimen / vrijgeven | revendiquer / libérer | |
| observer | observer | observateur | |

## Radio and device terms

| English | Nederlands | Français |
| --- | --- | --- |
| frequency | frequentie | fréquence |
| bandwidth | bandbreedte | bande passante |
| spreading factor | spreading factor | facteur d'étalement |
| coding rate | coding rate | taux de codage |
| duty cycle | duty cycle | rapport cyclique |
| TX power | zendvermogen | puissance d'émission |
| RX gain boost | extra RX-versterking | gain RX renforcé |
| preset | preset | préréglage |
| timing preset | timing-preset | préréglage de timing |
| hop preset | hop-preset | préréglage de sauts |
| firmware | firmware | firmware |
| board | bord | carte |
| flasher | flasher | flasher |
| public key / private key | publieke sleutel / privésleutel | clé publique / clé privée |
| vanity key | vanity key | clé personnalisée |
| identity | identiteit | identité |
| admin password / guest password | beheerderswachtwoord / gastwachtwoord | mot de passe admin / mot de passe invité |
| owner info | eigenaarsinfo | infos propriétaire |
| access list | toegangslijst | liste d'accès |
| read (settings from the repeater) | lezen | lire |
| apply | toepassen | appliquer |
| reboot | herstarten | redémarrer |
| factory reset | fabrieksinstellingen | réinitialisation d'usine |
| backup | back-up | sauvegarde |
| check-up | controle | bilan |
| device tools | toesteltools | outils de l'appareil |

## Configurator steps and site profiles

| English | Nederlands | Français |
| --- | --- | --- |
| Connect | Verbinden | Connexion |
| Place | Plaats | Lieu |
| Name | Naam | Nom |
| Regions | Regio's | Régions |
| Settings | Instellingen | Réglages |
| Send | Versturen | Envoi |
| Hilltop / Foothills / Suburban / Local / Custom | Heuveltop / Heuvelflank / Woonwijk / Lokaal / Eigen | Sommet / Coteau / Quartier / Local / Personnalisé |
| Tight / Minimal / Average / Extended / Full (hop presets) | Krap / Minimaal / Gemiddeld / Ruim / Volledig | Serré / Minimal / Moyen / Étendu / Complet |
| Allow / Deny / Not set | Toestaan / Weigeren / Niet ingesteld | Autoriser / Refuser / Non défini |
| Repeater / Companion (the two tasks) | Repeater / Companion | Répéteur / Companion |

## Pages and top bar

| English | Nederlands | Français |
| --- | --- | --- |
| Map | Kaart | Carte |
| Stats | Statistieken | Statistiques |
| Region map | Regiokaart | Carte des régions |
| Configurator | Configurator | Configurateur |
| Sign in with Discord | Aanmelden met Discord | Se connecter avec Discord |
| Log out | Afmelden | Se déconnecter |
| My nodes | Mijn nodes | Mes nœuds |
| Theme: light / dark / follows the system | Thema: licht / donker / volgt het systeem | Thème : clair / sombre / suit le système |

## Place names

Region codes (`be-vlg`, `be-wlg`, …) never change. English keeps the names the site showed before.

| Code | English | Nederlands | Français |
| --- | --- | --- | --- |
| be | Belgium | België | Belgique |
| be-vlg | Vlaams Gewest | Vlaanderen | Flandre |
| be-wal | Waals Gewest | Wallonië | Wallonie |
| be-bru | Brussel | Brussel | Bruxelles |
| be-van | Antwerpen | Antwerpen | Anvers |
| be-vbr | Vlaams-Brabant | Vlaams-Brabant | Brabant flamand |
| be-vov | Oost-Vlaanderen | Oost-Vlaanderen | Flandre-Orientale |
| be-vwv | West-Vlaanderen | West-Vlaanderen | Flandre-Occidentale |
| be-vli | Limburg | Limburg | Limbourg |
| be-wbr | Waals-Brabant | Waals-Brabant | Brabant wallon |
| be-wht | Henegouwen | Henegouwen | Hainaut |
| be-wlg | Luik | Luik | Liège |
| be-wna | Namen | Namen | Namur |
| be-wlx | Luxemburg | Luxemburg | Luxembourg |
| gewest (the tier) | Region (gewest) | Gewest | Région (Flandre ou Wallonie) |

Municipalities: `data/be-locode.json` holds one name per municipality. The 19 Brussels municipalities
are the only ones with official names in both languages; their French names (Ixelles, Uccle,
Schaerbeek, …) are in `src/shared/i18n.js` and show on French pages. Every other municipality,
facility municipalities included, keeps its one official name.

## Not translated

MeshCore CLI commands (`region allowf *`, `set prv.key`, `get name`), node names and owner info,
preset names from the API (EU/UK (Narrow), …), the MeshCore app's own labels on the Companion page
(Discover Regions, Default Region Scope, Experimental Settings), the Discord bot, the daily digest
and backend logs.
