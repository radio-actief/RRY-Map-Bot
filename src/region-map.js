// The region map: region codes (eu, be, be-* and the neighbouring countries) on the map engine of the
// map page (src/map-engine/: MapLibre, or Leaflet without WebGL). When the province outlines can't be
// loaded, the provinces are drawn as the areas around their places (data/be-province-hulls.geojson,
// scripts/generate-be-province-hulls.mjs).
import { createMapEngine, preloadEngine } from "./map-engine/index.js";
import { boundsOf, boundsOfGeoJSON } from "./map-engine/geo.js";

// The data and MapLibre's files start loading now, side by side.
preloadEngine();
const dataLoaded = loadData();

function loadData() {
  const json = (name, fallback) =>
    fetch(window.RRYRegions.rryDataUrl(name))
      .then((r) => (r.ok ? r.json().catch(() => fallback) : fallback))
      .catch(() => fallback);
  return Promise.all([json("be-locode.json", []), json("be-provinces.geojson", null), json("be-gewesten.geojson", null), json("countries.geojson", null)]);
}

      // Runs once src/shared/i18n.js has the page language's messages and has translated the static page.
      window.BEmeshI18n.ready.then(function (I18N) {
        var tr = I18N.t;
        // Shared Belgian region data + data-path helper (src/shared/be-regions.js,
        // loaded before this file). Deduplicated from the former inline copies.
        var Regions = window.RRYRegions;
        var rryDataUrl = Regions.rryDataUrl;
        /** Province and gewest names in the page language (codes never change). */
        var PROVINCE_NAMES = {};
        Object.keys(Regions.PROVINCE_NAMES).forEach(function (c) {
          PROVINCE_NAMES[c] = I18N.regionName(c);
        });
        /** Names a search also matches: the page language's and the default (English page) names. */
        var PROVINCE_SEARCH_NAMES = {};
        Object.keys(Regions.PROVINCE_NAMES).forEach(function (c) {
          PROVINCE_SEARCH_NAMES[c] = [PROVINCE_NAMES[c], Regions.PROVINCE_NAMES[c]];
        });
        var PROVINCE_CODES = Regions.PROVINCE_CODES;
        var PROVINCE_CAPITAL_LATLNG = Regions.PROVINCE_CAPITAL_LATLNG;
        var GEWEST_NAMES = {};
        Object.keys(Regions.GEWEST_NAMES).forEach(function (c) {
          GEWEST_NAMES[c] = I18N.regionName(c);
        });
        var GEWEST_OF_PROVINCE = Regions.GEWEST_OF_PROVINCE;

        let locations = [];
        let provinceBoundariesFC = null;
        let gewestBoundariesFC = null;
        let countryBoundariesFC = null;
        let map = null;
        let markerCluster = null;
        let provincesLayer = null;
        /** The region the search or the tree picked (its outline is drawn thicker). */
        let selectedCode = "";
        let overlayMode = "provinces";
        let showPlaces = true;
        let currentSearch = "";
        let lastMatches = [];
        let autocompleteIndex = -1;
        const belgiumCenter = { lat: 50.5, lon: 4.35 };
        const belgiumZoom = 8;

        function normalize(s) {
          return (s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        }

        function escapeHtml(s) {
          if (s == null) return "";
          var d = document.createElement("div");
          d.textContent = String(s);
          return d.innerHTML;
        }

        /** Country features by code (be, nl, lu, fr, de, gb and eu), from countries.geojson. */
        function countryFeature(code) {
          if (!countryBoundariesFC || !countryBoundariesFC.features) return null;
          for (var i = 0; i < countryBoundariesFC.features.length; i++) {
            var f = countryBoundariesFC.features[i];
            if (f.properties && f.properties.code === code) return f;
          }
          return null;
        }

        /** Country (or eu) name in the page language; the geojson name for a code without a translation. */
        function countryName(code) {
          if (I18N.has("region.name." + code)) return I18N.regionName(code);
          var f = countryFeature(code);
          return f ? f.properties.name : code;
        }

        /** A municipality's name in the page language (Brussels' official French names on a French page). */
        function placeName(loc) {
          return I18N.municipalityName((loc.plaats || loc.gemeente || "").trim());
        }

        /** The countries under eu, Belgium first (the order of the region tree). */
        function countryCodes() {
          var codes = [];
          if (!countryBoundariesFC || !countryBoundariesFC.features) return codes;
          countryBoundariesFC.features.forEach(function (f) {
            var c = f.properties && f.properties.code;
            if (c && c !== "eu") codes.push(c);
          });
          return codes;
        }

        /** A country or eu other than be: no Belgian location points belong to it. */
        function isForeignRegion(code) {
          return code !== "be" && !!countryFeature(code);
        }

        /** City code + country + province name (no be-* province code). */
        function placeParentCodesLine(loc) {
          var city = (loc.city_code || "").trim();
          var provName = (PROVINCE_NAMES[loc.province_code] || "").trim();
          var parts = [];
          if (city) parts.push(city);
          parts.push("be");
          if (provName) parts.push(provName);
          return parts.join(" · ");
        }

        function placeAutocompleteLabel(loc) {
          var name = I18N.municipalityName((loc.plaats || "").trim());
          return name + " — " + placeParentCodesLine(loc);
        }

        /** One row: display name (col 1) + region code (col 2). */
        function locodePopupPair(nameHtml, codeHtml) {
          return (
            '<div class="region-map-locode-popup__pair">' +
            '<span class="region-map-locode-popup__name">' +
            nameHtml +
            "</span>" +
            '<span class="region-map-locode-popup__code">' +
            codeHtml +
            "</span></div>"
          );
        }

        /** Click popup: 3 rows — place | city_code, province | be-*, Belgium | be. No title. */
        function locodePopupHtml(loc) {
          var cityName = escapeHtml(placeName(loc));
          var cityCodeRaw = (loc.city_code || "").trim();
          var cityCodeCell = cityCodeRaw
            ? "<code>" + escapeHtml(cityCodeRaw) + "</code>"
            : '<span class="node-popup__muted">—</span>';
          var provName = escapeHtml(
            (PROVINCE_NAMES[loc.province_code] || "").trim(),
          );
          var provCodeRaw = (loc.province_code || "").trim();
          var provCodeCell = provCodeRaw
            ? "<code>" + escapeHtml(provCodeRaw) + "</code>"
            : '<span class="node-popup__muted">—</span>';
          var landName = escapeHtml(countryName("be"));
          var landCodeCell = "<code>be</code>";
          var rows = [
            locodePopupPair(
              cityName || '<span class="node-popup__muted">—</span>',
              cityCodeCell,
            ),
            locodePopupPair(
              provName || '<span class="node-popup__muted">—</span>',
              provCodeCell,
            ),
            locodePopupPair(landName, landCodeCell),
          ];
          return (
            '<div class="node-popup region-map-locode-popup--compact" data-status="none">' +
            '<div class="node-popup__body">' +
            '<div class="region-map-locode-popup__grid">' +
            rows.join("") +
            "</div></div></div>"
          );
        }

        /** Same popup chrome as a city point, but province + country only (no city row). */
        function provinceLocodePopupHtml(provinceCode) {
          var pc = (provinceCode || "").trim();
          var provName = escapeHtml((PROVINCE_NAMES[pc] || "").trim());
          var provCodeCell = pc
            ? "<code>" + escapeHtml(pc) + "</code>"
            : '<span class="node-popup__muted">—</span>';
          var landName = escapeHtml(countryName("be"));
          var landCodeCell = "<code>be</code>";
          var rows = [
            locodePopupPair(
              provName || '<span class="node-popup__muted">—</span>',
              provCodeCell,
            ),
            locodePopupPair(landName, landCodeCell),
          ];
          return (
            '<div class="node-popup region-map-locode-popup--compact" data-status="none">' +
            '<div class="node-popup__body">' +
            '<div class="region-map-locode-popup__grid">' +
            rows.join("") +
            "</div></div></div>"
          );
        }

        /** Optional tier: gewest name/code + the provinces nested under it. */
        function gewestPopupHtml(gewestCode) {
          var gc = (gewestCode || "").trim();
          var gewestName = escapeHtml((GEWEST_NAMES[gc] || "").trim());
          var gewestCodeCell = gc
            ? "<code>" + escapeHtml(gc) + "</code>"
            : '<span class="node-popup__muted">—</span>';
          var provinceCodes = PROVINCE_CODES.filter(function (pc) {
            return GEWEST_OF_PROVINCE[pc] === gc;
          });
          var rows = [
            locodePopupPair(
              gewestName || '<span class="node-popup__muted">—</span>',
              gewestCodeCell,
            ),
            locodePopupPair(escapeHtml(countryName("be")), "<code>be</code>"),
          ];
          if (provinceCodes.length) {
            rows.push('<div class="region-map-locode-popup__label node-popup__muted">' + escapeHtml(tr("regionMap.popup.provinces")) + "</div>");
            provinceCodes.forEach(function (pc) {
              rows.push(
                locodePopupPair(
                  escapeHtml(PROVINCE_NAMES[pc] || pc),
                  "<code>" + escapeHtml(pc) + "</code>",
                ),
              );
            });
          }
          return (
            '<div class="node-popup region-map-locode-popup--compact" data-status="none">' +
            '<div class="node-popup__body">' +
            '<div class="region-map-locode-popup__grid">' +
            rows.join("") +
            "</div></div></div>"
          );
        }

        /** Country or eu: name/code, then eu as the parent region (or the countries under eu). */
        function countryPopupHtml(code) {
          var rows = [
            locodePopupPair(
              escapeHtml(countryName(code)),
              "<code>" + escapeHtml(code) + "</code>",
            ),
          ];
          if (code === "eu") {
            rows.push(
              locodePopupPair(
                escapeHtml(tr("regionMap.popup.countriesUnder")),
                escapeHtml(countryCodes().join(", ")),
              ),
            );
          } else if (countryFeature("eu")) {
            rows.push(
              locodePopupPair(
                escapeHtml(tr("regionMap.popup.parent", { name: countryName("eu") })),
                "<code>eu</code>",
              ),
            );
          }
          return (
            '<div class="node-popup region-map-locode-popup--compact" data-status="none">' +
            '<div class="node-popup__body">' +
            '<div class="region-map-locode-popup__grid">' +
            rows.join("") +
            "</div></div></div>"
          );
        }

        /** A region popup (place, province, gewest or country) at a spot. */
        function openRegionPopup(spot, html, offset) {
          map.openPopup(spot, {
            html: html,
            className: "region-locode-popup",
            minWidth: 280,
            maxWidth: 400,
            offset: offset || 0,
          });
        }

        /**
         * Where an area's name shows on hover: above the provincial capital (not under the cursor),
         * so it stays readable while moving over the polygon; else the middle of the area.
         */
        function labelSpot(feature) {
          var cap = PROVINCE_CAPITAL_LATLNG[feature.properties && feature.properties.code];
          if (cap && cap.length >= 2) return { lat: cap[0], lon: cap[1] };
          var b = boundsOfGeoJSON(feature);
          return b ? { lat: (b[0][0] + b[1][0]) / 2, lon: (b[0][1] + b[1][1]) / 2 } : null;
        }

        function locationMatchesQuery(loc, q) {
          if (
            normalize(loc.plaats).includes(q) ||
            normalize(loc.gemeente).includes(q)
          )
            return true;
          var al = loc.search_aliases;
          if (!al || !al.length) return false;
          for (var i = 0; i < al.length; i++) {
            if (normalize(al[i]).includes(q)) return true;
          }
          return false;
        }

        function getLocationsWithCoords() {
          return locations.filter(function (loc) {
            return loc.lat && loc.lon;
          });
        }

        /** The areas around each province's places, fetched once when the outlines didn't load. */
        let provinceHullsFC = null;
        let provinceHullsLoading = null;
        function loadProvinceHulls() {
          if (!provinceHullsLoading) {
            provinceHullsLoading = fetch(rryDataUrl("be-province-hulls.geojson"))
              .then(function (r) {
                return r.ok ? r.json() : null;
              })
              .catch(function () {
                return null;
              })
              .then(function (fc) {
                provinceHullsFC = fc && fc.features && fc.features.length ? fc : null;
                if (provinceHullsFC && overlayMode === "provinces" && !provincesLayer) updateOverlays();
              });
          }
          return provinceHullsLoading;
        }

        /** One distinct fill + outline per province, or per gewest in gewesten mode. */
        function getOverlayStyle(code) {
          var palette = {
            "be-van": { fill: "#e63946", line: "rgba(157, 34, 53, 0.45)" },
            "be-vbr": { fill: "#4361ee", line: "rgba(42, 63, 158, 0.45)" },
            "be-vov": { fill: "#2a9d8f", line: "rgba(23, 107, 98, 0.45)" },
            "be-vwv": { fill: "#219ebc", line: "rgba(20, 90, 110, 0.45)" },
            "be-vli": { fill: "#8ac926", line: "rgba(74, 110, 20, 0.45)" },
            "be-bru": { fill: "#9b5de5", line: "rgba(90, 45, 158, 0.45)" },
            "be-wbr": { fill: "#f4a261", line: "rgba(166, 95, 24, 0.45)" },
            "be-wht": { fill: "#e76f51", line: "rgba(154, 69, 46, 0.45)" },
            "be-wlg": { fill: "#bc6c25", line: "rgba(107, 61, 21, 0.45)" },
            "be-wna": { fill: "#7b2cbf", line: "rgba(74, 20, 140, 0.45)" },
            "be-wlx": { fill: "#06d6a0", line: "rgba(4, 122, 92, 0.45)" },
            "be-vlg": { fill: "#2a9d8f", line: "rgba(23, 107, 98, 0.5)" },
            "be-wal": { fill: "#bc6c25", line: "rgba(107, 61, 21, 0.5)" },
            be: { fill: "#d4a017", line: "rgba(120, 90, 13, 0.6)" },
            nl: { fill: "#f77f00", line: "rgba(140, 72, 0, 0.5)" },
            lu: { fill: "#e63946", line: "rgba(157, 34, 53, 0.5)" },
            fr: { fill: "#4361ee", line: "rgba(42, 63, 158, 0.5)" },
            de: { fill: "#6c757d", line: "rgba(52, 58, 64, 0.5)" },
            gb: { fill: "#9b5de5", line: "rgba(90, 45, 158, 0.5)" },
          };
          if (code === "eu") {
            return {
              fillColor: "#1d3fbb",
              fillOpacity: 0.06,
              color: "rgba(29, 63, 187, 0.7)",
              weight: 1.5,
              dashArray: "6 4",
            };
          }
          var p = palette[code];
          if (!p) {
            return {
              fillColor: "#b0b0b0",
              fillOpacity: 0.16,
              color: "rgba(0, 0, 0, 0.32)",
              weight: 1,
            };
          }
          return {
            fillColor: p.fill,
            fillOpacity: 0.22,
            color: p.line,
            weight: 1.25,
          };
        }

        var pad = function (px) {
          return { top: px, bottom: px, left: px, right: px };
        };

        function boundsFromProvinceGeoCode(pc) {
          if (!provinceBoundariesFC || !provinceBoundariesFC.features)
            return null;
          var f = provinceBoundariesFC.features.find(function (x) {
            return x.properties && x.properties.code === pc;
          });
          return f ? boundsOfGeoJSON(f) : null;
        }

        function fitAllProvincesBounds() {
          if (!map) return;
          var bb = provinceBoundariesFC && provinceBoundariesFC.features && provinceBoundariesFC.features.length ? boundsOfGeoJSON(provinceBoundariesFC) : null;
          if (bb) map.fitBounds(bb, pad(24));
          else map.setView(belgiumCenter, belgiumZoom);
        }

        function fitProvincePolygonBounds(pc) {
          var b = boundsFromProvinceGeoCode(pc);
          if (b && map) map.fitBounds(b, pad(20));
        }

        function fitCountryBounds(code) {
          var f = countryFeature(code);
          var b = f ? boundsOfGeoJSON(f) : null;
          if (b && map) map.fitBounds(b, pad(20));
        }

        /** The picked province, gewest or country gets a thicker outline. */
        function selectArea(code) {
          selectedCode = (code || "").trim().toLowerCase();
          if (provincesLayer) {
            provincesLayer.select(selectedCode ? function (f) {
              return f.properties && f.properties.code === selectedCode;
            } : null);
          }
        }

        /** Press the borders button that matches overlayMode. */
        function syncOverlayButtons() {
          document
            .querySelectorAll("#overlay-seg button")
            .forEach(function (b) {
              b.setAttribute(
                "aria-pressed",
                b.dataset.value === overlayMode ? "true" : "false",
              );
            });
        }

        /** Switch the borders control (and the map) to one mode. */
        function setOverlayMode(mode) {
          if (overlayMode === mode) return;
          overlayMode = mode;
          syncOverlayButtons();
          updateOverlays();
        }

        /** Borders follow the search: a foreign country shows Countries; anything Belgian leaves Countries for Provinces. */
        function followSearchBorders(code) {
          if (!code) return;
          if (isForeignRegion(code)) setOverlayMode("countries");
          else if (overlayMode === "countries") setOverlayMode("provinces");
        }

        /** The location points: blue dots, clustered above 50, a name on hover and the codes on a click. */
        function showPoints(matched) {
          if (markerCluster) {
            markerCluster.remove();
            markerCluster = null;
          }
          if (!showPlaces || !matched.length) return;
          markerCluster = map.addPoints(matched, {
            style: { radius: 6, fillColor: "#2563eb", color: "#1d4ed8", weight: 1, fillOpacity: 0.9 },
            cluster: matched.length > 50 ? { radius: 55 } : null,
            label: function (loc) {
              return placeName(loc) || "—";
            },
            onClick: function (loc, spot) {
              openRegionPopup(spot, locodePopupHtml(loc), 6);
            },
          });
        }

        /** An area layer: the borders of the current mode, with their name on hover and codes on a click. */
        function addAreas(fc, popupHtml, nameOf) {
          return map.addGeoJSON(fc, {
            style: function (feat) {
              return getOverlayStyle(feat.properties.code);
            },
            label: function (feat) {
              var c = feat.properties.code;
              return nameOf ? nameOf(c) : PROVINCE_NAMES[c] || GEWEST_NAMES[c] || c;
            },
            labelAt: labelSpot,
            onClick: function (feat, spot) {
              openRegionPopup(spot, popupHtml(feat.properties.code));
            },
          });
        }

        function updateOverlays() {
          if (!map) return;
          if (provincesLayer) {
            provincesLayer.remove();
            provincesLayer = null;
          }
          if (overlayMode === "provinces") {
            if (
              provinceBoundariesFC &&
              provinceBoundariesFC.features &&
              provinceBoundariesFC.features.length
            ) {
              provincesLayer = addAreas(provinceBoundariesFC, provinceLocodePopupHtml);
            } else if (provinceHullsFC) {
              provincesLayer = addAreas(provinceHullsFC, provinceLocodePopupHtml);
            } else {
              loadProvinceHulls();
            }
          } else if (overlayMode === "countries") {
            if (
              countryBoundariesFC &&
              countryBoundariesFC.features &&
              countryBoundariesFC.features.length
            ) {
              // eu first, so each country lies on top of it.
              var countryFeatures = countryBoundariesFC.features
                .slice()
                .sort(function (a, b) {
                  return (
                    (b.properties.code === "eu") - (a.properties.code === "eu")
                  );
                });
              provincesLayer = addAreas({ type: "FeatureCollection", features: countryFeatures }, countryPopupHtml, function (c) {
                return countryName(c) + " (" + c + ")";
              });
            }
          } else if (overlayMode === "gewesten") {
            if (
              gewestBoundariesFC &&
              gewestBoundariesFC.features &&
              gewestBoundariesFC.features.length
            ) {
              provincesLayer = addAreas(gewestBoundariesFC, gewestPopupHtml);
            }
          }
          selectArea(selectedCode);
          showPoints(lastMatches);
        }

        function matchLocations(query) {
          if (!query || !query.trim()) return getLocationsWithCoords();
          var q = normalize(query.trim());
          /* Country code be = all municipality points with coordinates */
          if (q === "be") return getLocationsWithCoords();
          if (isForeignRegion(q)) return [];
          return locations.filter(function (loc) {
            if (!loc.lat || !loc.lon) return false;
            if (loc.city_code === q || normalize(loc.city_code).includes(q))
              return true;
            if (
              loc.province_code === q ||
              normalize(loc.province_code).includes(q)
            )
              return true;
            if (locationMatchesQuery(loc, q)) return true;
            return false;
          });
        }

        function buildAutocompleteItems(query) {
          if (!query || query.length < 2) return [];
          var q = normalize(query);
          var items = [];
          var seen = new Set();
          var belMatch =
            q === "be" ||
            normalize("belgium").includes(q) ||
            normalize("belgie").includes(q) ||
            normalize("belgië").includes(q) ||
            normalize("belgique").includes(q);
          if (belMatch) {
            items.push({
              type: "country",
              code: "be",
              label: tr("regionMap.ac.country", { name: countryName("be"), code: "be" }),
            });
            seen.add("__be__");
          }
          ["eu"].concat(countryCodes()).forEach(function (c) {
            if (c === "be" || !countryFeature(c)) return;
            var f = countryFeature(c);
            if (
              normalize(c) === q ||
              normalize(countryName(c)).includes(q) ||
              normalize(f.properties.name || "").includes(q)
            ) {
              seen.add(c);
              items.push({
                type: "country",
                code: c,
                label: tr(c === "eu" ? "regionMap.ac.wider" : "regionMap.ac.country", {
                  name: countryName(c),
                  code: c,
                }),
              });
            }
          });
          PROVINCE_CODES.forEach(function (c) {
            if (
              normalize(c).includes(q) ||
              PROVINCE_SEARCH_NAMES[c].some(function (n) {
                return normalize(n || "").includes(q);
              })
            ) {
              if (!seen.has(c)) {
                seen.add(c);
                items.push({
                  type: "province",
                  code: c,
                  label: (PROVINCE_NAMES[c] || c) + " (" + c + ")",
                });
              }
            }
          });
          locations.forEach(function (loc) {
            if (items.length >= 15) return;
            if (!loc.lat || !loc.lon) return;
            if (
              normalize(loc.city_code).includes(q) ||
              locationMatchesQuery(loc, q)
            ) {
              var key = loc.city_code;
              if (!seen.has(key)) {
                seen.add(key);
                items.push({
                  type: "place",
                  code: loc.city_code,
                  label: placeAutocompleteLabel(loc),
                });
              }
            }
          });
          return items.slice(0, 12);
        }

        function showAutocomplete(items) {
          var ac = document.getElementById("autocomplete");
          ac.innerHTML = "";
          ac.style.display = "none";
          if (!items.length) return;
          items.forEach(function (item, i) {
            var el = document.createElement("div");
            el.className =
              "autocomplete-item" + (i === autocompleteIndex ? " active" : "");
            el.textContent = item.label;
            el.dataset.index = i;
            el.dataset.code = item.code;
            el.dataset.type = item.type || "place";
            el.addEventListener("click", function () {
              runCodeSearch(item.code, item.type);
              ac.innerHTML = "";
              ac.style.display = "none";
            });
            ac.appendChild(el);
          });
          ac.style.display = "block";
          autocompleteIndex = 0;
          var firstAc = ac.querySelector(".autocomplete-item");
          if (firstAc) firstAc.classList.add("active");
        }

        function runCodeSearch(code, type, keepInput) {
          var input = document.getElementById("code-input");
          if (input && !keepInput) input.value = code;
          markActiveRow(code);
          currentSearch = code;
          var matched = matchLocations(code);
          lastMatches = matched;
          var normCode = (code || "").trim().toLowerCase();
          var t = type || "";
          followSearchBorders(normCode);
          selectArea(normCode);
          if (t === "province" || PROVINCE_CODES.indexOf(normCode) >= 0) {
            fitProvincePolygonBounds(normCode);
          } else if (isForeignRegion(normCode)) {
            fitCountryBounds(normCode);
          } else if (t === "country" || normCode === "be") {
            fitAllProvincesBounds();
          }
          updateMap(matched);
          updateCounter(matched.length);
        }

        function markActiveRow(code) {
          var c = (code || "").trim().toLowerCase();
          document.querySelectorAll(".hierarchy-node").forEach(function (n) {
            n.classList.toggle("active", !!c && n.dataset.code === c);
          });
        }

        function updateCounter(count) {
          var txt = document.getElementById("counter-text");
          var normQ = normalize((currentSearch || "").trim());
          if (count === undefined) {
            if (!currentSearch) {
              txt.textContent = "";
            } else if (isForeignRegion(normQ)) {
              txt.textContent = countryName(normQ) + " (" + normQ + ")";
            } else if (normQ === "be") {
              var bn = lastMatches ? lastMatches.length : 0;
              txt.textContent =
                bn === 0
                  ? tr("regionMap.count.beNone", { name: countryName("be") })
                  : tr("regionMap.count.inBe", { count: bn, n: I18N.number(bn), name: countryName("be") });
            } else {
              txt.textContent = tr("regionMap.count.inResult", {
                count: lastMatches.length,
                n: I18N.number(lastMatches.length),
              });
            }
          } else {
            if (isForeignRegion(normQ)) {
              txt.textContent = countryName(normQ) + " (" + normQ + ")";
            } else if (normQ === "be" && count === 0) {
              txt.textContent = tr("regionMap.count.beNone", { name: countryName("be") });
            } else if (normQ === "be") {
              txt.textContent = tr("regionMap.count.shownInBe", { count: count, n: I18N.number(count), name: countryName("be") });
            } else {
              txt.textContent = tr("regionMap.count.shown", { count: count, n: I18N.number(count) });
            }
          }
        }

        function updateMap(matched) {
          if (!map) return;
          showPoints(matched || []);
          updateCounter(matched ? matched.length : 0);
          if (matched && matched.length === 1) {
            map.setView({ lat: matched[0].lat, lon: matched[0].lon }, 12);
          } else if (matched && matched.length > 1 && matched.length < 30) {
            map.fitBounds(
              boundsOf(matched.map(function (l) {
                return { lat: l.lat, lon: l.lon };
              })),
              pad(30),
            );
          }
        }

        function buildHierarchy() {
          var withCoords = getLocationsWithCoords();
          var hasEu = !!countryFeature("eu");
          var node = function (indent, code, type, name, count, label) {
            return (
              '<button type="button" class="hierarchy-node region-row indent-' +
              indent +
              '" data-code="' +
              code +
              '" data-type="' +
              type +
              '"><span class="region-name"><span class="region-title">' +
              escapeHtml(name) +
              '</span><span class="region-meta muted">' +
              escapeHtml(code + " · " + (label || tr("regionMap.kind." + type))) +
              "</span></span>" +
              (count != null
                ? '<span class="region-count">' + I18N.number(count) + "</span>"
                : "") +
              "</button>"
            );
          };
          var html = hasEu ? node(0, "eu", "country", countryName("eu"), null, tr("regionMap.kind.wider")) : "";
          var top = hasEu ? 1 : 0;
          html += node(top, "be", "country", countryName("be"), withCoords.length);
          PROVINCE_CODES.forEach(function (p) {
            var locs = withCoords.filter(function (l) {
              return l.province_code === p;
            });
            if (!locs.length) return;
            html += node(
              top + 1,
              p,
              "province",
              PROVINCE_NAMES[p] || p,
              locs.length,
            );
          });
          countryCodes().forEach(function (c) {
            if (c !== "be") html += node(top, c, "country", countryName(c));
          });
          var el = document.getElementById("hierarchy");
          if (el) {
            el.innerHTML = html;
            el.querySelectorAll(".hierarchy-node").forEach(function (n) {
              n.addEventListener("click", function () {
                runCodeSearch(n.dataset.code, n.dataset.type);
              });
            });
          }
          markActiveRow(currentSearch);
        }

        function init() {
          // The map: MapLibre (or Leaflet without WebGL), with the map page's base maps and controls.
          var mapReady = createMapEngine(document.getElementById("region-map-container"), {
            center: belgiumCenter,
            zoom: belgiumZoom,
            t: tr,
            attribution: "",
          }).then(function (engine) {
            map = window.bemeshMap = engine;
            document.getElementById("region-map-container").dataset.engine = engine.kind;
            return engine;
          });

          document
            .getElementById("toggle-controls")
            .addEventListener("click", function () {
              var panel = document.getElementById("controls");
              panel.classList.toggle("collapsed");
              panel.inert = panel.classList.contains("collapsed");
              var expanded = !panel.classList.contains("collapsed");
              this.setAttribute("aria-expanded", expanded ? "true" : "false");
              window.setTimeout(function () {
                if (map) map.resize();
              }, 280);
            });

          window.addEventListener("resize", function () {
            if (map) map.resize();
          });
          var rmVV = window.visualViewport;
          if (rmVV) {
            rmVV.addEventListener("resize", function () {
              if (map) map.resize();
            });
          }
          window.addEventListener("orientationchange", function () {
            window.setTimeout(function () {
              if (map) map.resize();
            }, 400);
          });

          document
            .querySelectorAll("#overlay-seg button")
            .forEach(function (b) {
              b.addEventListener("click", function () {
                overlayMode = this.dataset.value;
                syncOverlayButtons();
                updateOverlays();
              });
            });

          document
            .getElementById("show-places")
            .addEventListener("change", function () {
              showPlaces = this.checked;
              updateMap(
                lastMatches.length
                  ? lastMatches
                  : matchLocations(currentSearch),
              );
            });

          var input = document.getElementById("code-input");
          input.addEventListener("input", function () {
            markActiveRow(this.value);
            var items = buildAutocompleteItems(this.value);
            showAutocomplete(items);
            if (!items.length && this.value.trim()) {
              var raw = this.value.trim();
              var m = matchLocations(raw);
              lastMatches = m;
              currentSearch = raw;
              var nc = normalize(raw);
              followSearchBorders(nc);
              if (PROVINCE_CODES.indexOf(nc) >= 0) {
                fitProvincePolygonBounds(nc);
              } else if (isForeignRegion(nc)) {
                fitCountryBounds(nc);
              } else if (nc === "be") {
                fitAllProvincesBounds();
              }
              updateMap(m);
              updateCounter(m.length);
            }
          });

          input.addEventListener("keydown", function (e) {
            var ac = document.getElementById("autocomplete");
            var items = ac.querySelectorAll(".autocomplete-item");
            if (e.key === "ArrowDown") {
              e.preventDefault();
              autocompleteIndex = Math.min(
                autocompleteIndex + 1,
                items.length - 1,
              );
              items.forEach(function (el, i) {
                el.classList.toggle("active", i === autocompleteIndex);
              });
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
              items.forEach(function (el, i) {
                el.classList.toggle("active", i === autocompleteIndex);
              });
            } else if (e.key === "Enter" && items[autocompleteIndex]) {
              e.preventDefault();
              var it = items[autocompleteIndex];
              runCodeSearch(it.dataset.code, it.dataset.type || "place");
              ac.innerHTML = "";
              ac.style.display = "none";
            } else if (e.key === "Escape") {
              ac.innerHTML = "";
              ac.style.display = "none";
            }
          });

          input.addEventListener("focus", function () {
            var items = buildAutocompleteItems(this.value);
            if (items.length) showAutocomplete(items);
          });

          document.addEventListener("click", function (e) {
            if (!e.target.closest(".region-map-search-wrap")) {
              document.getElementById("autocomplete").innerHTML = "";
              document.getElementById("autocomplete").style.display = "none";
            }
          });

          Promise.all([dataLoaded, mapReady])
            .then(function (both) {
              var results = both[0];
              locations = results[0] || [];
              provinceBoundariesFC = results[1];
              gewestBoundariesFC = results[2];
              countryBoundariesFC = results[3];
              overlayMode = "provinces";
              syncOverlayButtons();
              buildHierarchy();
              updateOverlays();
              /* Same as clicking hierarchy indent-0 Belgium (be) */
              runCodeSearch("be", "country", true);
              if (map) map.resize();
            })
            .catch(function (e) {
              console.error(e);
              locations = [];
              provinceBoundariesFC = null;
              gewestBoundariesFC = null;
              countryBoundariesFC = null;
              document.getElementById("counter-text").textContent =
                tr("regionMap.loadFailed");
            });
        }

        init();
      });
