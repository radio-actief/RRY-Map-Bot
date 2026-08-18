      (function () {
        // Shared Belgian region data + data-path helper (src/shared/be-regions.js,
        // loaded before this file). Deduplicated from the former inline copies.
        var Regions = window.RRYRegions;
        var rryDataUrl = Regions.rryDataUrl;
        var PROVINCE_NAMES = Regions.PROVINCE_NAMES;
        var PROVINCE_CODES = Regions.PROVINCE_CODES;
        var PROVINCE_CAPITAL_LATLNG = Regions.PROVINCE_CAPITAL_LATLNG;
        var GEWEST_NAMES = Regions.GEWEST_NAMES;
        var GEWEST_OF_PROVINCE = Regions.GEWEST_OF_PROVINCE;

        let locations = [];
        let provinceBoundariesFC = null;
        let gewestBoundariesFC = null;
        let map = null;
        let markerCluster = null;
        let provincesLayer = null;
        let overlayMode = "provinces";
        let showPlaces = true;
        let currentSearch = "";
        let lastMatches = [];
        let autocompleteIndex = -1;
        const belgiumCenter = [50.5, 4.35];
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
          var name = (loc.plaats || "").trim();
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
          var cityName = escapeHtml((loc.plaats || loc.gemeente || "").trim());
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
          var landName = escapeHtml("Belgium");
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
          var landName = escapeHtml("Belgium");
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
          var provinceNames = provinceCodes
            .map(function (pc) {
              return PROVINCE_NAMES[pc] || pc;
            })
            .join(", ");
          var rows = [
            locodePopupPair(
              gewestName || '<span class="node-popup__muted">—</span>',
              gewestCodeCell,
            ),
            locodePopupPair(escapeHtml("Belgium"), "<code>be</code>"),
            locodePopupPair(
              escapeHtml("Provinces (optional under gewest)"),
              escapeHtml(provinceNames),
            ),
          ];
          return (
            '<div class="node-popup region-map-locode-popup--compact" data-status="none">' +
            '<div class="node-popup__body">' +
            '<div class="region-map-locode-popup__grid">' +
            rows.join("") +
            "</div></div></div>"
          );
        }

        var REGION_LOCODE_POPUP_OPTS = {
          /* Leaflet measures content width with nowrap; minWidth avoids a 1-char-wide box */
          minWidth: 280,
          maxWidth: 400,
          className: "region-locode-popup",
        };

        var REGION_MAP_TOOLTIP_OPTS = {
          permanent: false,
          direction: "auto",
          className: "region-map-tooltip",
        };

        /**
         * Show province name tooltip fixed above the provincial capital (not under the cursor),
         * so it stays readable while moving over the polygon.
         */
        function attachProvinceHoverTooltip(layer, provinceCode) {
          var code = provinceCode;
          var label = PROVINCE_NAMES[code] || GEWEST_NAMES[code] || code;
          var cap = PROVINCE_CAPITAL_LATLNG[code];
          function clearTip() {
            if (layer._rmProvinceHoverTip && map) {
              try {
                map.removeLayer(layer._rmProvinceHoverTip);
              } catch (e) {
                /* ignore */
              }
              layer._rmProvinceHoverTip = null;
            }
          }
          layer.on("mouseover", function () {
            if (layer._rmProvinceHoverTip || !map) return;
            var latlng;
            try {
              if (cap && cap.length >= 2) {
                latlng = L.latLng(cap[0], cap[1]);
              } else if (layer.getBounds && layer.getBounds().isValid()) {
                latlng = layer.getBounds().getCenter();
              }
            } catch (e2) {
              latlng = null;
            }
            if (!latlng) return;
            var tip = L.tooltip(
              Object.assign({}, REGION_MAP_TOOLTIP_OPTS, {
                direction: "top",
                sticky: false,
                offset: L.point(0, -10),
              }),
            )
              .setContent(label)
              .setLatLng(latlng)
              .addTo(map);
            layer._rmProvinceHoverTip = tip;
          });
          layer.on("mouseout", clearTip);
          layer.on("remove", clearTip);
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

        function pointsToFeatureCollection(points) {
          return {
            type: "FeatureCollection",
            features: points.map(function (p) {
              return {
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                properties: {},
              };
            }),
          };
        }

        function buildHullFromPoints(points, maxEdgeKm) {
          if (!points.length || typeof turf === "undefined") return null;
          if (points.length < 3) return null;
          var fc = pointsToFeatureCollection(points);
          var hull = null;
          try {
            if (turf.concave) {
              hull = turf.concave(fc, {
                maxEdge: maxEdgeKm || 50,
                units: "kilometers",
              });
            }
          } catch (e) {}
          if (!hull && turf.convex) {
            try {
              hull = turf.convex(fc);
            } catch (e2) {}
          }
          return hull;
        }

        function buildProvinceAreas() {
          var layers = {};
          var withCoords = getLocationsWithCoords();
          PROVINCE_CODES.forEach(function (code) {
            var pts = withCoords.filter(function (l) {
              return l.province_code === code;
            });
            var hull = buildHullFromPoints(pts, 50);
            if (hull) layers[code] = hull;
          });
          return layers;
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
          };
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

        function boundsFromProvinceGeoCode(pc) {
          if (!provinceBoundariesFC || !provinceBoundariesFC.features)
            return null;
          var i;
          for (i = 0; i < provinceBoundariesFC.features.length; i++) {
            var f = provinceBoundariesFC.features[i];
            if (f.properties && f.properties.code === pc) {
              try {
                var tmp = L.geoJSON(f);
                var b = tmp.getBounds();
                tmp.remove();
                if (b && b.isValid()) return b;
              } catch (e) {}
            }
          }
          return null;
        }

        function fitAllProvincesBounds() {
          if (!map) return;
          if (
            provinceBoundariesFC &&
            provinceBoundariesFC.features &&
            provinceBoundariesFC.features.length
          ) {
            try {
              var ly = L.geoJSON(provinceBoundariesFC);
              var bb = ly.getBounds();
              ly.remove();
              if (bb && bb.isValid()) {
                map.fitBounds(bb, { padding: [24, 24] });
                return;
              }
            } catch (e2) {}
          }
          map.setView(belgiumCenter, belgiumZoom);
        }

        function fitProvincePolygonBounds(pc) {
          var b = boundsFromProvinceGeoCode(pc);
          if (b && map && b.isValid()) map.fitBounds(b, { padding: [20, 20] });
        }

        function addCircleMarkersToContainer(container, matched) {
          matched.forEach(function (loc) {
            var circle = L.circleMarker([loc.lat, loc.lon], {
              radius: 6,
              fillColor: "#2563eb",
              color: "#1d4ed8",
              weight: 1,
              fillOpacity: 0.9,
            });
            circle.bindPopup(locodePopupHtml(loc), REGION_LOCODE_POPUP_OPTS);
            circle.bindTooltip(
              (loc.plaats || loc.gemeente || "").trim() || "—",
              REGION_MAP_TOOLTIP_OPTS,
            );
            container.addLayer(circle);
          });
        }

        function updateOverlays() {
          if (markerCluster) {
            map.removeLayer(markerCluster);
            markerCluster = null;
          }
          if (provincesLayer) {
            map.removeLayer(provincesLayer);
            provincesLayer = null;
          }
          if (overlayMode === "provinces") {
            if (
              provinceBoundariesFC &&
              provinceBoundariesFC.features &&
              provinceBoundariesFC.features.length
            ) {
              provincesLayer = L.geoJSON(provinceBoundariesFC, {
                style: function (feat) {
                  return getOverlayStyle(feat.properties.code);
                },
                onEachFeature: function (feat, layer) {
                  var c = feat.properties.code;
                  attachProvinceHoverTooltip(layer, c);
                  layer.bindPopup(
                    provinceLocodePopupHtml(c),
                    REGION_LOCODE_POPUP_OPTS,
                  );
                },
              });
              map.addLayer(provincesLayer);
            } else if (typeof turf !== "undefined") {
              var areas = buildProvinceAreas();
              var features = [];
              for (var code in areas) {
                if (areas[code]) {
                  var feat = areas[code];
                  var geom = feat.geometry || feat;
                  var props = feat.properties
                    ? Object.assign({}, feat.properties, { code: code })
                    : { code: code };
                  var f =
                    turf && turf.feature
                      ? turf.feature(geom, props)
                      : {
                          type: "Feature",
                          geometry: geom,
                          properties: props,
                        };
                  features.push(f);
                }
              }
              if (features.length) {
                provincesLayer = L.geoJSON(
                  { type: "FeatureCollection", features: features },
                  {
                    style: function (f) {
                      return getOverlayStyle(f.properties.code);
                    },
                    onEachFeature: function (f, layer) {
                      var pc = f.properties.code;
                      attachProvinceHoverTooltip(layer, pc);
                      layer.bindPopup(
                        provinceLocodePopupHtml(pc),
                        REGION_LOCODE_POPUP_OPTS,
                      );
                    },
                  },
                );
                map.addLayer(provincesLayer);
              }
            }
          } else if (overlayMode === "gewesten") {
            if (
              gewestBoundariesFC &&
              gewestBoundariesFC.features &&
              gewestBoundariesFC.features.length
            ) {
              provincesLayer = L.geoJSON(gewestBoundariesFC, {
                style: function (feat) {
                  return getOverlayStyle(feat.properties.code);
                },
                onEachFeature: function (feat, layer) {
                  var c = feat.properties.code;
                  attachProvinceHoverTooltip(layer, c);
                  layer.bindPopup(
                    gewestPopupHtml(c),
                    REGION_LOCODE_POPUP_OPTS,
                  );
                },
              });
              map.addLayer(provincesLayer);
            }
          }
          if (showPlaces && lastMatches.length) {
            var useCluster =
              typeof L.markerClusterGroup === "function" &&
              lastMatches.length > 50;
            if (useCluster) {
              markerCluster = L.markerClusterGroup({
                maxClusterRadius: 55,
                chunkedLoading: lastMatches.length > 400,
              });
              addCircleMarkersToContainer(markerCluster, lastMatches);
            } else {
              markerCluster = L.featureGroup();
              addCircleMarkersToContainer(markerCluster, lastMatches);
            }
            map.addLayer(markerCluster);
          }
        }

        function matchLocations(query) {
          if (!query || !query.trim()) return getLocationsWithCoords();
          var q = normalize(query.trim());
          /* Country code be = all municipality points with coordinates */
          if (q === "be") return getLocationsWithCoords();
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
              label: "Belgium (be) — country",
            });
            seen.add("__be__");
          }
          PROVINCE_CODES.forEach(function (c) {
            if (
              normalize(c).includes(q) ||
              normalize(PROVINCE_NAMES[c] || "").includes(q)
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

        function runCodeSearch(code, type) {
          var input = document.getElementById("code-input");
          if (input) input.value = code;
          currentSearch = code;
          var matched = matchLocations(code);
          lastMatches = matched;
          var normCode = (code || "").trim().toLowerCase();
          var t = type || "";
          if (t === "province" || PROVINCE_CODES.indexOf(normCode) >= 0) {
            fitProvincePolygonBounds(normCode);
          } else if (t === "country" || normCode === "be") {
            fitAllProvincesBounds();
          }
          updateMap(matched);
          updateCounter(matched.length);
        }

        function updateCounter(count) {
          var txt = document.getElementById("counter-text");
          var sp = document.getElementById("spinner");
          if (sp) sp.style.display = "none";
          var normQ = normalize((currentSearch || "").trim());
          if (count === undefined) {
            if (!currentSearch) {
              txt.textContent =
                "Enter a province code (be-*), be, or a place name";
            } else if (normQ === "be") {
              var bn = lastMatches ? lastMatches.length : 0;
              txt.textContent =
                bn === 0
                  ? "Belgium — no location points on the map"
                  : bn + " location points in Belgium";
            } else {
              txt.textContent =
                lastMatches.length + " location points in search result";
            }
          } else {
            if (normQ === "be" && count === 0) {
              txt.textContent = "Belgium — no location points on the map";
            } else if (normQ === "be") {
              txt.textContent = count + " location points shown in Belgium";
            } else {
              txt.textContent = count + " location points shown";
            }
          }
        }

        function updateMap(matched) {
          if (!map) return;
          if (markerCluster) {
            map.removeLayer(markerCluster);
            markerCluster = null;
          }
          if (!showPlaces || !matched.length) {
            updateCounter(matched ? matched.length : 0);
            if (matched && matched.length === 1) {
              map.setView([matched[0].lat, matched[0].lon], 12);
            } else if (matched && matched.length > 1 && matched.length < 30) {
              var b = L.latLngBounds(
                matched.map(function (l) {
                  return [l.lat, l.lon];
                }),
              );
              map.fitBounds(b, { padding: [30, 30] });
            }
            return;
          }
          var useCluster =
            typeof L.markerClusterGroup === "function" && matched.length > 50;
          if (useCluster) {
            markerCluster = L.markerClusterGroup({
              maxClusterRadius: 55,
              chunkedLoading: matched.length > 400,
            });
            addCircleMarkersToContainer(markerCluster, matched);
          } else {
            markerCluster = L.featureGroup();
            addCircleMarkersToContainer(markerCluster, matched);
          }
          map.addLayer(markerCluster);
          updateCounter(matched.length);
          if (matched.length === 1) {
            map.setView([matched[0].lat, matched[0].lon], 12);
          } else if (matched.length < 30) {
            var bounds = L.latLngBounds(
              matched.map(function (l) {
                return [l.lat, l.lon];
              }),
            );
            map.fitBounds(bounds, { padding: [30, 30] });
          }
        }

        function buildHierarchy() {
          var withCoords = getLocationsWithCoords();
          var html =
            '<div class="hierarchy-node indent-0" data-code="be" data-type="country">Belgium (be)</div>';
          PROVINCE_CODES.forEach(function (p) {
            var locs = withCoords.filter(function (l) {
              return l.province_code === p;
            });
            if (!locs.length) return;
            html +=
              '<div class="hierarchy-node indent-1" data-code="' +
              p +
              '" data-type="province">' +
              (PROVINCE_NAMES[p] || p) +
              " (" +
              p +
              ") [" +
              locs.length +
              "]</div>";
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
        }

        function init() {
          map = L.map("region-map-container").setView(
            belgiumCenter,
            belgiumZoom,
          );
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          }).addTo(map);

          document
            .getElementById("toggle-controls")
            .addEventListener("click", function () {
              var panel = document.getElementById("controls");
              panel.classList.toggle("collapsed");
              var expanded = !panel.classList.contains("collapsed");
              this.setAttribute("aria-expanded", expanded ? "true" : "false");
              window.setTimeout(function () {
                if (map) map.invalidateSize({ animate: false });
              }, 280);
            });

          window.addEventListener("resize", function () {
            if (map) map.invalidateSize({ animate: false });
          });
          var rmVV = window.visualViewport;
          if (rmVV) {
            rmVV.addEventListener("resize", function () {
              if (map) map.invalidateSize({ animate: false });
            });
          }
          window.addEventListener("orientationchange", function () {
            window.setTimeout(function () {
              if (map) map.invalidateSize({ animate: false });
            }, 400);
          });

          document
            .querySelectorAll('input[name="overlay"]')
            .forEach(function (r) {
              r.addEventListener("change", function () {
                overlayMode = this.value;
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
            var items = buildAutocompleteItems(this.value);
            showAutocomplete(items);
            if (!items.length && this.value.trim()) {
              var raw = this.value.trim();
              var m = matchLocations(raw);
              lastMatches = m;
              currentSearch = raw;
              var nc = normalize(raw);
              if (PROVINCE_CODES.indexOf(nc) >= 0) {
                fitProvincePolygonBounds(nc);
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

          Promise.all([
            fetch(rryDataUrl("be-locode.json"))
              .then(function (r) {
                if (!r.ok) return [];
                return r.json().catch(function () {
                  return [];
                });
              })
              .then(function (data) {
                return Array.isArray(data) ? data : [];
              }),
            fetch(rryDataUrl("be-provinces.geojson")).then(function (r) {
              if (!r.ok) return null;
              return r.json().catch(function () {
                return null;
              });
            }),
            fetch(rryDataUrl("be-gewesten.geojson")).then(function (r) {
              if (!r.ok) return null;
              return r.json().catch(function () {
                return null;
              });
            }),
          ])
            .then(function (results) {
              locations = results[0] || [];
              provinceBoundariesFC = results[1];
              gewestBoundariesFC = results[2];
              var pr = document.querySelector(
                'input[name="overlay"][value="provinces"]',
              );
              if (pr) pr.checked = true;
              overlayMode = "provinces";
              buildHierarchy();
              updateOverlays();
              /* Same as clicking hierarchy indent-0 Belgium (be) */
              runCodeSearch("be", "country");
              if (map) map.invalidateSize({ animate: false });
            })
            .catch(function () {
              locations = [];
              provinceBoundariesFC = null;
              gewestBoundariesFC = null;
              document.getElementById("counter-text").textContent =
                "Could not load locations.";
            });
        }

        init();
      })();
