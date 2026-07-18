      (function () {
        const loadingEl = document.getElementById("stats-loading");
        const errorEl = document.getElementById("stats-error");
        const contentEl = document.getElementById("stats-content");

        // Populate header chips immediately
        function fillHeaderChips(s) {
          var byType =
            s.by_type_map &&
            typeof s.by_type_map === "object" &&
            Object.keys(s.by_type_map).length > 0
              ? s.by_type_map
              : s.by_type || {};
          var total = s.total_nodes != null ? Number(s.total_nodes) : 0;
          var companions = byType[1] != null ? Number(byType[1]) : 0;
          var repeaters = byType[2] != null ? Number(byType[2]) : 0;
          var roomServers = byType[3] != null ? Number(byType[3]) : 0;
          var sensors = byType[4] != null ? Number(byType[4]) : 0;
          var claimed = s.claimed_nodes != null ? Number(s.claimed_nodes) : 0;
          var users =
            s.registered_users != null ? Number(s.registered_users) : 0;
          var active24h = s.active_24h != null ? Number(s.active_24h) : 0;
          var active7d = s.active_7d != null ? Number(s.active_7d) : 0;
          var active30d = s.active_30d != null ? Number(s.active_30d) : 0;
          function set(id, val) {
            var el = document.getElementById(id);
            if (el)
              el.textContent = val != null ? Number(val).toLocaleString() : "—";
          }
          function setChip(id, val, hideWhenZero) {
            set(id, val);
            var wrap = document.getElementById(id + "-wrap");
            if (wrap && hideWhenZero && (val == null || val === 0))
              wrap.style.display = "none";
            else if (wrap) wrap.style.display = "";
          }
          set("stats-chip-total", total);
          setChip(
            "stats-chip-companions",
            companions > 0 ? companions : null,
            true,
          );
          setChip(
            "stats-chip-repeaters",
            repeaters > 0 ? repeaters : null,
            true,
          );
          setChip(
            "stats-chip-roomservers",
            roomServers > 0 ? roomServers : null,
            true,
          );
          setChip("stats-chip-sensors", sensors > 0 ? sensors : null, true);
          set("stats-chip-active24h", active24h);
          set("stats-chip-active7d", active7d);
          set("stats-chip-active30d", active30d);
          set("stats-chip-claimed", claimed);
          set("stats-chip-users", users);
        }

        // Download + filter flyouts: close on outside click; mutual close when opening the other
        const downloadChip = document.getElementById("stats-download-chip");
        const downloadDropdown = document.getElementById(
          "stats-download-dropdown",
        );
        const filterMenu = document.getElementById("stats-filter-menu");
        const filterTrigger = document.getElementById(
          "stats-filter-menu-trigger",
        );
        const filterDropdown = document.getElementById(
          "stats-filter-menu-dropdown",
        );
        var statsHeaderPopoverResizeTimer;
        function scheduleStatsHeaderChartResize() {
          clearTimeout(statsHeaderPopoverResizeTimer);
          statsHeaderPopoverResizeTimer = setTimeout(function () {
            try {
              if (window.__statsChartInstance) {
                window.__statsChartInstance.resize();
              }
            } catch (err) {}
          }, 120);
        }
        function closeStatsHeaderPopovers() {
          if (downloadChip) downloadChip.classList.remove("is-open");
          if (filterMenu) filterMenu.classList.remove("is-open");
          if (filterTrigger)
            filterTrigger.setAttribute("aria-expanded", "false");
        }
        document.addEventListener("click", function () {
          var filterWasOpen =
            filterMenu && filterMenu.classList.contains("is-open");
          var downloadWasOpen =
            downloadChip && downloadChip.classList.contains("is-open");
          closeStatsHeaderPopovers();
          if (filterWasOpen || downloadWasOpen)
            scheduleStatsHeaderChartResize();
        });
        if (downloadChip) {
          downloadChip.addEventListener("click", function (e) {
            e.stopPropagation();
            if (filterMenu) filterMenu.classList.remove("is-open");
            if (filterTrigger)
              filterTrigger.setAttribute("aria-expanded", "false");
            downloadChip.classList.toggle("is-open");
            scheduleStatsHeaderChartResize();
          });
          if (downloadDropdown) {
            downloadDropdown.addEventListener("click", function (e) {
              e.stopPropagation();
            });
          }
        }
        if (filterMenu && filterTrigger && filterDropdown) {
          filterTrigger.addEventListener("click", function (e) {
            e.stopPropagation();
            if (downloadChip) downloadChip.classList.remove("is-open");
            filterMenu.classList.toggle("is-open");
            filterTrigger.setAttribute(
              "aria-expanded",
              filterMenu.classList.contains("is-open") ? "true" : "false",
            );
            scheduleStatsHeaderChartResize();
          });
          filterDropdown.addEventListener("click", function (e) {
            e.stopPropagation();
          });
        }

        const topdayGrowth = document.getElementById("stats-topday-growth");

        function showError(msg) {
          loadingEl.style.display = "none";
          contentEl.style.display = "none";
          errorEl.textContent = msg;
          errorEl.style.display = "block";
        }
        function hideStatsError() {
          errorEl.style.display = "none";
          errorEl.textContent = "";
        }

        function formatDate(iso) {
          if (!iso) return "—";
          const d = new Date(iso);
          return d.toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          });
        }

        var chartPresetValue = "all";
        /** Shared across chart re-inits; must not live inside initStatsContent (that runs per refetch). */
        var statsDataCache = null;
        var currentPresetValue = "all";
        window.__statsRadioCustom = null;
        var citiesSelectEl = document.getElementById("stats-cities-type");
        var __statsPlaybackGen = 0;

        function formatDateOnly(dateStr) {
          var d = new Date(dateStr + "T12:00:00");
          return d.toLocaleDateString(undefined, { dateStyle: "medium" });
        }

        function ensureApexCharts() {
          return new Promise(function (resolve, reject) {
            if (typeof ApexCharts !== "undefined") {
              resolve();
              return;
            }
            var s = document.createElement("script");
            s.src =
              "https://cdn.jsdelivr.net/npm/apexcharts@3.45.1/dist/apexcharts.min.js";
            s.async = true;
            s.onload = function () {
              resolve();
            };
            s.onerror = function () {
              reject(new Error("Failed to load chart library"));
            };
            document.head.appendChild(s);
          });
        }

        function ensureStatsLeaflet() {
          return new Promise(function (resolve, reject) {
            if (typeof L !== "undefined" && L.map) {
              resolve();
              return;
            }
            var s = document.createElement("script");
            s.src = "./lib/leaflet.js";
            s.async = true;
            s.onload = function () {
              resolve();
            };
            s.onerror = function () {
              reject(new Error("Failed to load map library"));
            };
            document.head.appendChild(s);
          });
        }

        function getNetworkCountForPreset(presetKey) {
          if (!statsDataCache) return null;
          if (presetKey === "all")
            return statsDataCache.displayable_map_nodes != null
              ? Number(statsDataCache.displayable_map_nodes)
              : statsDataCache.total_nodes != null
                ? Number(statsDataCache.total_nodes)
                : null;
          if (presetKey === "Custom settings")
            return statsDataCache.custom_frequency != null
              ? Number(statsDataCache.custom_frequency)
              : null;
          if (presetKey === "Unknown")
            return statsDataCache.unknown_frequency != null
              ? Number(statsDataCache.unknown_frequency)
              : null;
          if (presetKey === "__custom__")
            return statsDataCache.total_nodes != null
              ? Number(statsDataCache.total_nodes)
              : null;
          var presets = statsDataCache.frequency_presets || {};
          return presets[presetKey] != null ? Number(presets[presetKey]) : null;
        }

        function syncStatsPresetPanelActive() {
          var listEl = document.getElementById("stats-preset-dropdown");
          if (listEl) {
            listEl.querySelectorAll("button[data-value]").forEach(function (b) {
              b.classList.toggle(
                "is-active",
                b.getAttribute("data-value") === currentPresetValue,
              );
            });
          }
          var customRoot = document.getElementById("stats-preset-custom-root");
          var customWrap =
            customRoot && customRoot.querySelector(".stats-preset-custom");
          if (customWrap) {
            customWrap.classList.toggle(
              "is-active",
              currentPresetValue === "__custom__",
            );
          }
        }

        function populatePresetDropdown(s) {
          var container = document.getElementById("stats-preset-dropdown");
          var customRoot = document.getElementById("stats-preset-custom-root");
          if (!container || !customRoot) return;
          var presets = s.frequency_presets || {};
          var presetOrder = [
            "EU/UK (Narrow)",
            "EU 433MHz (Long Range)",
            "EU/UK (Long Range)",
            "EU/UK (Medium Range)",
          ];
          container.innerHTML = "";
          customRoot.innerHTML = "";
          function addOption(value, label) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.setAttribute("data-value", value);
            btn.addEventListener("click", function () {
              window.__statsRadioCustom = null;
              [
                "stats-custom-freq",
                "stats-custom-sf",
                "stats-custom-bw",
                "stats-custom-cr",
              ].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = "";
              });
              chartPresetValue = value;
              currentPresetValue = value;
              syncStatsPresetPanelActive();
              var url =
                value === "all"
                  ? "/api/v1/stats"
                  : "/api/v1/stats?frequency_preset=" +
                    encodeURIComponent(value);
              fetch(url)
                .then(function (r) {
                  return r.ok ? r.json() : Promise.reject();
                })
                .then(function (data) {
                  statsDataCache = data;
                  fillHeaderChips(data);
                  renderTopCities(
                    (citiesSelectEl && citiesSelectEl.value) || "all",
                  );
                  if (typeof window.__statsRefetchChart === "function")
                    window.__statsRefetchChart(value);
                  closeStatsHeaderPopovers();
                  scheduleStatsHeaderChartResize();
                })
                .catch(function () {});
            });
            container.appendChild(btn);
          }
          addOption("all", "All frequencies");
          presetOrder.forEach(function (name) {
            if (presets[name] != null && presets[name] > 0)
              addOption(name, name);
          });
          Object.keys(presets).forEach(function (name) {
            if (
              presetOrder.indexOf(name) === -1 &&
              presets[name] != null &&
              presets[name] > 0
            )
              addOption(name, name);
          });
          var customWrap = document.createElement("div");
          customWrap.className = "stats-preset-custom";
          customWrap.innerHTML =
            '<div class="stats-preset-custom-grid">' +
            '<label>Freq (MHz)<input type="number" step="0.001" id="stats-custom-freq" placeholder="869.618" /></label>' +
            '<label>SF<input type="number" step="1" min="5" max="13" id="stats-custom-sf" placeholder="8" /></label>' +
            '<label>BW (kHz)<input type="number" step="0.1" id="stats-custom-bw" placeholder="62.5" /></label>' +
            '<label>CR<input type="number" step="1" min="4" max="9" id="stats-custom-cr" placeholder="8" /></label>' +
            "</div>" +
            '<button type="button" id="stats-preset-custom-apply">Apply</button>';
          customRoot.appendChild(customWrap);
          var applyBtn = document.getElementById("stats-preset-custom-apply");
          if (applyBtn) {
            applyBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              var freqEl = document.getElementById("stats-custom-freq");
              var sfEl = document.getElementById("stats-custom-sf");
              var bwEl = document.getElementById("stats-custom-bw");
              var crEl = document.getElementById("stats-custom-cr");
              function numOrEmpty(el, parseFn) {
                if (!el) return null;
                var s = String(el.value || "").trim();
                if (s === "") return null;
                var v = parseFn(s);
                return isNaN(v) ? false : v;
              }
              var freq = numOrEmpty(freqEl, parseFloat);
              var sf = numOrEmpty(sfEl, function (s) {
                return parseInt(s, 10);
              });
              var bw = numOrEmpty(bwEl, parseFloat);
              var cr = numOrEmpty(crEl, function (s) {
                return parseInt(s, 10);
              });
              if (
                freq === false ||
                sf === false ||
                bw === false ||
                cr === false
              ) {
                window.alert(
                  "Use numbers only. Freq 100–1000 MHz, SF 5–13, BW 30–1000 kHz, CR 4–9.",
                );
                return;
              }
              var custom = {};
              if (freq != null) {
                if (freq < 100 || freq > 1000) {
                  window.alert("Freq must be between 100 and 1000 MHz.");
                  return;
                }
                custom.freq = freq;
              }
              if (sf != null) {
                if (sf < 5 || sf > 13) {
                  window.alert("SF must be between 5 and 13.");
                  return;
                }
                custom.sf = sf;
              }
              if (bw != null) {
                if (bw < 30 || bw > 1000) {
                  window.alert("BW must be between 30 and 1000 kHz.");
                  return;
                }
                custom.bw = bw;
              }
              if (cr != null) {
                if (cr < 4 || cr > 9) {
                  window.alert("CR must be between 4 and 9.");
                  return;
                }
                custom.cr = cr;
              }
              if (Object.keys(custom).length === 0) {
                window.alert(
                  "Enter at least one of: Freq, SF, BW, or CR (others optional).",
                );
                return;
              }
              window.__statsRadioCustom = custom;
              chartPresetValue = "all";
              currentPresetValue = "__custom__";
              syncStatsPresetPanelActive();
              var qsParts = [];
              if (custom.freq != null)
                qsParts.push("freq=" + encodeURIComponent(custom.freq));
              if (custom.sf != null)
                qsParts.push("sf=" + encodeURIComponent(custom.sf));
              if (custom.bw != null)
                qsParts.push("bw=" + encodeURIComponent(custom.bw));
              if (custom.cr != null)
                qsParts.push("cr=" + encodeURIComponent(custom.cr));
              var qs = qsParts.join("&");
              fetch("/api/v1/stats?" + qs)
                .then(function (r) {
                  return r.ok ? r.json() : Promise.reject();
                })
                .then(function (data) {
                  statsDataCache = data;
                  fillHeaderChips(data);
                  renderTopCities(
                    (citiesSelectEl && citiesSelectEl.value) || "all",
                  );
                  if (typeof window.__statsRefetchChart === "function")
                    window.__statsRefetchChart(null);
                  updateNetworkChipFromPreset();
                  syncStatsPresetPanelActive();
                  closeStatsHeaderPopovers();
                  scheduleStatsHeaderChartResize();
                })
                .catch(function () {});
            });
          }
          syncStatsPresetPanelActive();
        }

        function updateNetworkChipFromPreset() {
          var valEl = document.getElementById("stats-chip-total");
          if (!valEl) return;
          var count = getNetworkCountForPreset(currentPresetValue);
          valEl.textContent =
            count != null ? Number(count).toLocaleString() : "—";
        }

        function getTopCitiesForType(typeKey) {
          var key =
            typeKey === "all"
              ? "top_cities"
              : typeKey === "1"
                ? "top_cities_companions"
                : typeKey === "2"
                  ? "top_cities_repeaters"
                  : typeKey === "3"
                    ? "top_cities_room_servers"
                    : typeKey === "4"
                      ? "top_cities_sensors"
                      : "top_cities";
          var arr = (statsDataCache && statsDataCache[key]) || [];
          return arr.slice(0, 5);
        }

        function renderTopCities(typeKey) {
          var tCities = document.getElementById("stats-summary-cities");
          var citiesSelect = document.getElementById("stats-cities-type");
          var titleEl = document.getElementById("stats-summary-cities-title");
          var inlineWrap = document.querySelector(".stats-top-cities-inline");
          if (!tCities) return;
          tCities.innerHTML = "";
          if (citiesSelect) citiesSelect.value = typeKey;
          if (titleEl) titleEl.textContent = "Top cities";
          if (inlineWrap) {
            inlineWrap.classList.toggle("is-filtered", typeKey !== "all");
          }
          var list = getTopCitiesForType(typeKey);
          function row(tbody, label, value) {
            var tr = document.createElement("tr");
            tr.innerHTML =
              "<td>" + label + '</td><td class="num">' + value + "</td>";
            tbody.appendChild(tr);
          }
          if (list.length > 0)
            list.forEach(function (c) {
              row(
                tCities,
                c.city,
                '<span class="value">' +
                  Number(c.count).toLocaleString() +
                  "</span>",
              );
            });
          else row(tCities, "—", "—");
        }

        function initStatsPlaybackMap(changes) {
          if (!changes || changes.length === 0) return;
          var byDate = {};
          changes.forEach(function (c) {
            var d = (c.sync_date || "").slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(c);
          });
          var sortedDates = Object.keys(byDate).sort();
          var frames = [];
          var visible = {};
          sortedDates.forEach(function (d) {
            byDate[d].forEach(function (c) {
              if (c.change_type === "added" || c.change_type === "restored") {
                visible[c.public_key] = {
                  lat: c.lat,
                  lon: c.lon,
                  adv_name: c.adv_name,
                  type: c.type || 1,
                };
              } else if (c.change_type === "updated" && visible[c.public_key]) {
                visible[c.public_key] = {
                  lat: c.lat,
                  lon: c.lon,
                  adv_name: c.adv_name,
                  type: c.type || 1,
                };
              } else if (c.change_type === "removed") {
                delete visible[c.public_key];
              }
            });
            frames.push({
              date: d,
              nodes: Object.keys(visible).map(function (k) {
                return visible[k];
              }),
            });
          });
          if (frames.length === 0) return;

          var nodeTypeColors = {
            1: { fill: "#2196f3", stroke: "#1565C0" },
            2: { fill: "#4CAF50", stroke: "#2E7D32" },
            3: { fill: "#9C27B0", stroke: "#6A1B9A" },
            4: { fill: "#0891b2", stroke: "#0e7490" },
          };
          function colorForType(t) {
            return nodeTypeColors[t] || nodeTypeColors[1];
          }

          var slider = document.getElementById("playback-slider");
          var dateEl = document.getElementById("playback-date");
          var playBtn = document.getElementById("playback-play");
          var speedSelect = document.getElementById("playback-speed");
          if (!slider || !dateEl || !playBtn || !speedSelect) return;

          var map = L.map("stats-map", {
            center: [50.8503, 4.3517],
            zoom: 7,
          });
          window.__statsPlaybackMap = map;
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          }).addTo(map);
          var markersLayer = L.layerGroup().addTo(map);

          slider.max = Math.max(0, frames.length - 1);

          function setFrame(i) {
            i = Math.max(0, Math.min(i, frames.length - 1));
            slider.value = i;
            var f = frames[i];
            dateEl.textContent = formatDateOnly(f.date);
            var countsByType = { 1: 0, 2: 0, 3: 0, 4: 0 };
            f.nodes.forEach(function (n) {
              var t = n.type || 1;
              countsByType[t] = (countsByType[t] || 0) + 1;
            });
            var legendEl = document.getElementById("playback-legend");
            for (var t = 1; t <= 4; t++) {
              var count = countsByType[t] || 0;
              var el = document.getElementById("playback-legend-count-" + t);
              if (el) el.textContent = count;
              var row = legendEl
                ? legendEl.querySelector('[data-type="' + t + '"]')
                : null;
              if (row) row.style.display = count > 0 ? "" : "none";
            }
            var totalEl = document.getElementById(
              "playback-legend-count-total",
            );
            if (totalEl) {
              var atEnd = i === frames.length - 1;
              var presetAllForMap =
                typeof currentPresetValue !== "undefined" &&
                currentPresetValue === "all" &&
                (!window.__statsRadioCustom ||
                  Object.keys(window.__statsRadioCustom).length === 0);
              var mapCount =
                atEnd &&
                presetAllForMap &&
                statsDataCache &&
                statsDataCache.displayable_map_nodes != null
                  ? Number(statsDataCache.displayable_map_nodes)
                  : null;
              totalEl.textContent =
                mapCount != null && !isNaN(mapCount)
                  ? mapCount
                  : f.nodes.length;
            }
            markersLayer.clearLayers();
            f.nodes.forEach(function (n) {
              var c = colorForType(n.type);
              var m = L.circleMarker([n.lat, n.lon], {
                radius: 6,
                fillColor: c.fill,
                color: c.stroke,
                weight: 1,
                fillOpacity: 0.9,
              });
              var tip = n.adv_name || "";
              if (n.type) {
                var typeNames = {
                  1: "Client",
                  2: "Repeater",
                  3: "Room Server",
                  4: "Sensor",
                };
                tip =
                  (tip ? tip + " \u2014 " : "") + (typeNames[n.type] || "Node");
              }
              if (tip) m.bindTooltip(tip, { permanent: false });
              markersLayer.addLayer(m);
            });
          }

          setFrame(frames.length - 1);

          var playInterval = null;
          function stopPlay() {
            if (playInterval) {
              clearInterval(playInterval);
              playInterval = null;
            }
            playBtn.textContent = "\u25B6";
            playBtn.title = "Play";
          }
          function startPlay() {
            var speed = parseFloat(speedSelect.value) || 1;
            var ms = Math.max(200, 800 / speed);
            playBtn.textContent = "\u23F8";
            playBtn.title = "Pause";
            playInterval = setInterval(function () {
              var next = parseInt(slider.value, 10) + 1;
              if (next >= frames.length) next = 0;
              setFrame(next);
            }, ms);
          }
          playBtn.addEventListener("click", function () {
            if (playInterval) stopPlay();
            else startPlay();
          });
          speedSelect.addEventListener("change", function () {
            if (playInterval) {
              stopPlay();
              startPlay();
            }
          });

          document
            .getElementById("playback-prev")
            .addEventListener("click", function () {
              stopPlay();
              setFrame(parseInt(slider.value, 10) - 1);
            });
          document
            .getElementById("playback-next")
            .addEventListener("click", function () {
              stopPlay();
              setFrame(parseInt(slider.value, 10) + 1);
            });
          slider.addEventListener("input", function () {
            stopPlay();
            setFrame(parseInt(slider.value, 10));
          });

          (function initMapFullscreen() {
            var mapWrapEl = document.getElementById("stats-map-container");
            var btn = document.getElementById("stats-map-fullscreen");
            var dockEl = document.querySelector(".stats-playback-dock");
            if (!mapWrapEl || !btn) return;
            if (btn.__pbWired) return;
            btn.__pbWired = true;

            var dockParent = dockEl ? dockEl.parentNode : null;
            var dockNext = dockEl ? dockEl.nextSibling : null;

            function fsEl() {
              return (
                document.fullscreenElement ||
                document.webkitFullscreenElement ||
                null
              );
            }
            function isFs() {
              return fsEl() === mapWrapEl;
            }

            function syncBtn() {
              var on = isFs();
              btn.setAttribute("aria-pressed", on ? "true" : "false");
              btn.setAttribute(
                "aria-label",
                on ? "Exit fullscreen map" : "Fullscreen map",
              );
              btn.title = on ? "Exit fullscreen (Esc)" : "Fullscreen map";
            }

            function invalidate() {
              try {
                if (window.__statsPlaybackMap) {
                  window.__statsPlaybackMap.invalidateSize();
                }
              } catch (e) {}
            }

            function moveDockIntoMap() {
              if (!dockEl || dockEl.parentNode === mapWrapEl) return;
              dockEl.classList.add("stats-playback-dock--map-overlay");
              mapWrapEl.appendChild(dockEl);
            }

            function restoreDock() {
              if (!dockEl || !dockParent) return;
              dockEl.classList.remove("stats-playback-dock--map-overlay");
              if (dockNext && dockNext.parentNode === dockParent) {
                dockParent.insertBefore(dockEl, dockNext);
              } else {
                dockParent.appendChild(dockEl);
              }
            }

            btn.addEventListener("click", function (e) {
              e.preventDefault();
              e.stopPropagation();
              if (isFs()) {
                if (document.exitFullscreen) {
                  document.exitFullscreen().catch(function () {});
                } else if (document.webkitExitFullscreen) {
                  document.webkitExitFullscreen();
                }
              } else if (mapWrapEl.requestFullscreen) {
                mapWrapEl.requestFullscreen().catch(function () {});
              } else if (mapWrapEl.webkitRequestFullscreen) {
                mapWrapEl.webkitRequestFullscreen();
              }
            });

            function onChange() {
              if (isFs()) moveDockIntoMap();
              else restoreDock();
              syncBtn();
              invalidate();
              setTimeout(invalidate, 60);
              setTimeout(invalidate, 250);
            }
            document.addEventListener("fullscreenchange", onChange);
            document.addEventListener("webkitfullscreenchange", onChange);

            syncBtn();
          })();
        }
        function statsFrequencyQuerySuffix() {
          if (
            window.__statsRadioCustom &&
            Object.keys(window.__statsRadioCustom).length > 0
          ) {
            var c = window.__statsRadioCustom;
            var parts = [];
            if (c.freq != null && c.freq !== "")
              parts.push("freq=" + encodeURIComponent(c.freq));
            if (c.sf != null && c.sf !== "")
              parts.push("sf=" + encodeURIComponent(c.sf));
            if (c.bw != null && c.bw !== "")
              parts.push("bw=" + encodeURIComponent(c.bw));
            if (c.cr != null && c.cr !== "")
              parts.push("cr=" + encodeURIComponent(c.cr));
            return parts.length ? "&" + parts.join("&") : "";
          }
          var p = chartPresetValue || "all";
          return p !== "all"
            ? "&frequency_preset=" + encodeURIComponent(p)
            : "";
        }
        function fetchChartData(preset, opts) {
          opts = opts || {};
          var includeNodeChanges = opts.includeNodeChanges !== false;
          if (!window.__statsRadioCustom) {
            chartPresetValue = preset != null ? preset : chartPresetValue;
          }
          var presetParam = statsFrequencyQuerySuffix();
          var syncP = fetch(
            "/api/v1/sync-history?limit=500" + presetParam,
          ).then(function (r) {
            if (!r.ok) throw new Error("Failed to load sync history");
            return r.json();
          });
          if (!includeNodeChanges) {
            return syncP.then(function (history) {
              return [history, []];
            });
          }
          return Promise.all([
            syncP,
            fetch("/api/v1/node-changes?limit=15000" + presetParam).then(
              function (r) {
                return r.ok ? r.json() : [];
              },
            ),
          ]);
        }
        /** Calendar YYYY-MM-DD from API sync_date (avoids UTC midnight shifting date-only strings). */
        function statsApiSyncDateKey(syncDate) {
          var s = String(syncDate == null ? "" : syncDate).trim();
          var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
          if (m) return m[1];
          var d = new Date(s);
          if (isNaN(d.getTime())) return null;
          return (
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0")
          );
        }
        function initStatsContent(history, nodeChanges) {
          __statsPlaybackGen++;
          var playbackGen = __statsPlaybackGen;
          if (window.__statsChartInstance) {
            window.__statsChartInstance.destroy();
            window.__statsChartInstance = null;
          }
          if (window.__statsPlaybackMap) {
            window.__statsPlaybackMap.remove();
            window.__statsPlaybackMap = null;
          }
          document
            .querySelectorAll(
              ".stats-header-chip.chip-filterable.is-chart-filtered",
            )
            .forEach(function (c) {
              c.classList.remove("is-chart-filtered");
            });
          loadingEl.style.display = "none";
          if (!history || history.length === 0) {
            showError(
              "No sync history yet. Syncs will appear here once the sync service has run.",
            );
            return;
          }

          // Aggregate by day (use literal YYYY-MM-DD from API when present)
          const byDay = {};
          history.forEach(function (row) {
            const key = statsApiSyncDateKey(row.sync_date);
            if (!key) return;
            if (!byDay[key]) {
              byDay[key] = {
                date: key,
                nodes_added: 0,
                nodes_removed: 0,
                nodes_restored: 0,
                nodes_updated: 0,
                hasSyncData: false,
              };
            }
            byDay[key].nodes_added += row.nodes_added || 0;
            byDay[key].nodes_removed += row.nodes_removed || 0;
            byDay[key].nodes_restored += row.nodes_restored || 0;
            byDay[key].nodes_updated += row.nodes_updated || 0;
            if (row.from_sync === true) byDay[key].hasSyncData = true;
          });
          const dailyRows = Object.keys(byDay)
            .sort()
            .map(function (k) {
              return byDay[k];
            });

          if (dailyRows.length === 0) {
            showError(
              "No sync history yet. Syncs will appear here once the sync service has run.",
            );
            return;
          }

          // Build a continuous timeline (every day from first to last) for the chart, so gaps are visible
          function dateKeyToMs(key) {
            return new Date(key + "T12:00:00").getTime();
          }
          function msToDateKey(ms) {
            var d = new Date(ms);
            return (
              d.getFullYear() +
              "-" +
              String(d.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(d.getDate()).padStart(2, "0")
            );
          }
          var chartStartDate = dailyRows[0].date;
          var firstMs = dateKeyToMs(dailyRows[0].date);
          var lastMs = dateKeyToMs(dailyRows[dailyRows.length - 1].date);
          var oneDayMs = 24 * 60 * 60 * 1000;
          var dailyRowsChart = [];
          for (var t = firstMs; t <= lastMs; t += oneDayMs) {
            var key = msToDateKey(t);
            var row = byDay[key]
              ? {
                  date: key,
                  nodes_added: byDay[key].nodes_added,
                  nodes_removed: byDay[key].nodes_removed,
                  nodes_restored: byDay[key].nodes_restored,
                  nodes_updated: byDay[key].nodes_updated,
                  hasSyncData: !!byDay[key].hasSyncData,
                }
              : {
                  date: key,
                  nodes_added: 0,
                  nodes_removed: 0,
                  nodes_restored: 0,
                  nodes_updated: 0,
                  hasSyncData: false,
                };
            row.hasData = !!byDay[key];
            dailyRowsChart.push(row);
          }

          // Table rows: from chart, date >= chartStartDate, restored merged into added
          var dailyRowsTable = dailyRows
            .filter(function (r) {
              return r.date >= chartStartDate;
            })
            .map(function (r) {
              var cr = dailyRowsChart.find(function (c) {
                return c.date === r.date;
              });
              if (!cr) return null;
              return {
                date: r.date,
                nodes_added: cr.nodes_added + cr.nodes_restored,
                nodes_removed: cr.nodes_removed,
              };
            })
            .filter(Boolean);

          hideStatsError();
          contentEl.style.display = "block";

          // Wire dropdown and node-type chips to filter Top cities
          window.__statsResetNodeFilter = function () {
            renderTopCities("all");
            chartFilterType = null;
            document
              .querySelectorAll(".stats-header-chip.chip-filterable")
              .forEach(function (c) {
                c.classList.remove("is-chart-filtered");
              });
            if (statsChartInstance) applyChartRange(currentChartRange);
          };
          if (citiesSelectEl && !window.__statsCitiesSelectWired) {
            window.__statsCitiesSelectWired = true;
            citiesSelectEl.addEventListener("change", function () {
              renderTopCities(this.value);
            });
          }
          window.__statsChartFilterClick = function (t) {
            chartFilterType = chartFilterType === t ? null : t;
            document
              .querySelectorAll(".stats-header-chip.chip-filterable")
              .forEach(function (c) {
                c.classList.toggle(
                  "is-chart-filtered",
                  c.getAttribute("data-type") === chartFilterType,
                );
              });
            if (statsChartInstance) applyChartRange(currentChartRange);
          };
          if (!window.__statsChipHandlersAttached) {
            document
              .querySelectorAll(".stats-header-chip.chip-filterable")
              .forEach(function (chip) {
                chip.addEventListener("click", function () {
                  var t = this.getAttribute("data-type");
                  if (!t) return;
                  var isTogglingOff = chartFilterType === t;
                  if (citiesSelectEl) {
                    citiesSelectEl.value = isTogglingOff ? "all" : t;
                    renderTopCities(isTogglingOff ? "all" : t);
                  }
                  if (window.__statsChartFilterClick)
                    window.__statsChartFilterClick(t);
                });
              });
            window.__statsChipHandlersAttached = true;
          }

          var topN = 3;
          function syncDayKey(syncDate) {
            return String(syncDate == null ? "" : syncDate).slice(0, 10);
          }
          function applyNodeChangeForPlayback(visibleCh, c) {
            var t = c.type || 1;
            if (c.change_type === "added" || c.change_type === "restored") {
              visibleCh[c.public_key] = t;
            } else if (
              c.change_type === "updated" &&
              visibleCh[c.public_key] !== undefined
            ) {
              visibleCh[c.public_key] = t;
            } else if (c.change_type === "removed") {
              delete visibleCh[c.public_key];
            }
          }
          function repeaterCountFromVisible(visibleCh) {
            var n = 0;
            for (var pk in visibleCh) {
              if (visibleCh[pk] === 2) n++;
            }
            return n;
          }
          function topRepeaterGrowthDays(dayList, changes) {
            if (!dayList.length) return [];
            var sorted = changes.slice().sort(function (a, b) {
              return (a.sync_date || "").localeCompare(b.sync_date || "");
            });
            var visibleCh = {};
            var chIx = 0;
            var n = sorted.length;

            function consumeBeforeDay(day) {
              while (chIx < n && syncDayKey(sorted[chIx].sync_date) < day) {
                applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
                chIx++;
              }
            }
            function consumeOnDay(day) {
              while (chIx < n && syncDayKey(sorted[chIx].sync_date) === day) {
                applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
                chIx++;
              }
            }

            consumeBeforeDay(dayList[0]);
            var rows = [];
            for (var i = 0; i < dayList.length; i++) {
              var day = dayList[i];
              var repStart = repeaterCountFromVisible(visibleCh);
              consumeOnDay(day);
              var repEnd = repeaterCountFromVisible(visibleCh);
              rows.push({ date: day, growth: repEnd - repStart });
              var nextDay = dayList[i + 1];
              if (nextDay) {
                while (
                  chIx < n &&
                  syncDayKey(sorted[chIx].sync_date) < nextDay
                ) {
                  applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
                  chIx++;
                }
              }
            }
            return rows;
          }

          var dayListForGrowth = dailyRowsTable.map(function (r) {
            return r.date;
          });
          var topGrowth = topRepeaterGrowthDays(dayListForGrowth, nodeChanges)
            .sort(function (a, b) {
              return b.growth - a.growth;
            })
            .slice(0, topN);

          function formatTopdayValue(val, valueKey) {
            if (valueKey === "growth") {
              return val >= 0 ? "+" + val : String(val);
            }
            return String(val);
          }
          function fillTopdayCard(container, rows, valueKey) {
            container.innerHTML = "";
            if (!rows || rows.length === 0) {
              var empty = document.createElement("div");
              empty.className = "stats-topday-empty";
              empty.textContent = "No data";
              container.appendChild(empty);
              return;
            }
            rows.forEach(function (row, i) {
              var val = row[valueKey];
              var isLead = i === 0;
              var item = document.createElement("div");
              item.className = "stats-topday-item" + (isLead ? " is-lead" : "");
              item.innerHTML =
                '<span class="stats-topday-rank">' +
                (isLead ? "#" : "") +
                (i + 1) +
                "</span>" +
                '<span class="stats-topday-date">' +
                formatDateOnly(row.date) +
                "</span>" +
                '<span class="stats-topday-value">' +
                formatTopdayValue(val, valueKey) +
                "</span>";
              container.appendChild(item);
            });
          }
          fillTopdayCard(topdayGrowth, topGrowth, "growth");

          // Cumulative = (added + restored) - removed, full timeline, no reset.
          // After the unified displayable predicate, the running ledger over the
          // first-seen seed and node_changes lands on displayable_map_nodes; no
          // floor / badge / snap reconciliation is needed.
          var cumulative = 0;
          var cumulativeData = dailyRowsChart.map(function (r) {
            cumulative += r.nodes_added + r.nodes_restored - r.nodes_removed;
            return cumulative;
          });

          // Cumulative by node type from node_changes (same logic as playback)
          var byDateCh = {};
          nodeChanges.forEach(function (c) {
            var d = (c.sync_date || "").slice(0, 10);
            if (!byDateCh[d]) byDateCh[d] = [];
            byDateCh[d].push(c);
          });
          var sortedDatesCh = Object.keys(byDateCh).sort();
          var visibleCh = {};
          var framesByType = [];
          sortedDatesCh.forEach(function (d) {
            byDateCh[d].forEach(function (c) {
              var t = c.type || 1;
              if (c.change_type === "added" || c.change_type === "restored") {
                visibleCh[c.public_key] = t;
              } else if (
                c.change_type === "updated" &&
                visibleCh[c.public_key]
              ) {
                visibleCh[c.public_key] = t;
              } else if (c.change_type === "removed") {
                delete visibleCh[c.public_key];
              }
            });
            var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            Object.values(visibleCh).forEach(function (t) {
              counts[t] = (counts[t] || 0) + 1;
            });
            framesByType.push({ date: d, counts: counts });
          });
          function cumulativeByTypeForDate(dateStr) {
            if (framesByType.length === 0) return { 1: 0, 2: 0, 3: 0, 4: 0 };
            if (dateStr < framesByType[0].date)
              return { 1: 0, 2: 0, 3: 0, 4: 0 };
            var best = framesByType[0];
            for (var i = 0; i < framesByType.length; i++) {
              if (framesByType[i].date <= dateStr) best = framesByType[i];
              else break;
            }
            return best.counts;
          }

          // Visible chart window starts at first day in history (chartStartDate = dailyRows[0].date).
          // Cumulative series is built over the full dailyRowsChart before slicing.
          var chartFromIdx = dailyRowsChart.findIndex(function (r) {
            return r.date >= chartStartDate;
          });
          if (chartFromIdx < 0) chartFromIdx = 0;
          var chartRows = dailyRowsChart.slice(chartFromIdx);
          function sparseLabels(rows, maxLabels) {
            var step = Math.max(1, Math.floor(rows.length / maxLabels));
            return rows.map(function (r, i) {
              return i % step === 0 ? formatDateOnly(r.date) : "";
            });
          }
          var labels = sparseLabels(chartRows, 10);
          var cumulativeDisplay = chartRows.map(function (_, i) {
            return cumulativeData[chartFromIdx + i];
          });
          var cumulativeByType = {
            1: chartRows.map(function (r) {
              return cumulativeByTypeForDate(r.date)[1];
            }),
            2: chartRows.map(function (r) {
              return cumulativeByTypeForDate(r.date)[2];
            }),
            3: chartRows.map(function (r) {
              return cumulativeByTypeForDate(r.date)[3];
            }),
            4: chartRows.map(function (r) {
              return cumulativeByTypeForDate(r.date)[4];
            }),
          };
          var chartTooltipDates = chartRows.map(function (r) {
            return r.date;
          });

          // Net change: split into positive (growth) and negative (decline) for bars
          var chartNetChange = chartRows.map(function (r) {
            return (
              (r.nodes_added || 0) +
              (r.nodes_restored || 0) -
              (r.nodes_removed || 0)
            );
          });
          var chartNetPositive = chartNetChange.map(function (v) {
            return v > 0 ? v : 0;
          });
          var chartNetNegative = chartNetChange.map(function (v) {
            return v < 0 ? Math.abs(v) : 0;
          });
          // Net change per day per type (daily delta from cumulative)
          var netChangeByType = {
            1: chartRows.map(function (_, i) {
              var prev = i === 0 ? 0 : cumulativeByType[1][i - 1];
              return cumulativeByType[1][i] - prev;
            }),
            2: chartRows.map(function (_, i) {
              var prev = i === 0 ? 0 : cumulativeByType[2][i - 1];
              return cumulativeByType[2][i] - prev;
            }),
            3: chartRows.map(function (_, i) {
              var prev = i === 0 ? 0 : cumulativeByType[3][i - 1];
              return cumulativeByType[3][i] - prev;
            }),
            4: chartRows.map(function (_, i) {
              var prev = i === 0 ? 0 : cumulativeByType[4][i - 1];
              return cumulativeByType[4][i] - prev;
            }),
          };
          var currentNetChangeByType = netChangeByType;
          var chartEl = document.getElementById("stats-chart");
          var style = chartEl && getComputedStyle(document.documentElement);
          var colorAdded =
            (style && style.getPropertyValue("--stats-chart-added").trim()) ||
            "#2ecc71";
          var colorRemoved =
            (style && style.getPropertyValue("--stats-chart-removed").trim()) ||
            "#e74c3c";
          var colorTotal =
            (style && style.getPropertyValue("--stats-chart-total").trim()) ||
            "#d4a017";
          var colorType1 =
            (style && style.getPropertyValue("--stats-chart-type-1").trim()) ||
            "#2196f3";
          var colorType2 =
            (style && style.getPropertyValue("--stats-chart-type-2").trim()) ||
            "#4caf50";
          var colorType3 =
            (style && style.getPropertyValue("--stats-chart-type-3").trim()) ||
            "#9c27b0";
          var colorType4 =
            (style && style.getPropertyValue("--stats-chart-type-4").trim()) ||
            "#0891b2";

          var chartFilterType = null;
          var currentChartRange = "month";

          function rangeStartDate(rangeValue, latestDateStr) {
            if (rangeValue === "all") return chartStartDate;
            var latestMs = dateKeyToMs(latestDateStr);
            var days = 0;
            if (rangeValue === "week") days = 7;
            else if (rangeValue === "month") days = 30;
            else if (rangeValue === "3m") days = 90;
            else if (rangeValue === "6m") days = 180;
            else if (rangeValue === "1y") days = 365;
            else if (rangeValue === "ytd") {
              var ytdStr = latestDateStr.slice(0, 4) + "-01-01";
              return ytdStr < chartStartDate ? chartStartDate : ytdStr;
            }
            var startMs = latestMs - days * oneDayMs;
            var startStr = msToDateKey(startMs);
            return startStr < chartStartDate ? chartStartDate : startStr;
          }

          function applyChartRange(rangeValue) {
            if (!statsChartInstance || !chartRows.length) return;
            var latestDateStr = chartRows[chartRows.length - 1].date;
            var startStr = rangeStartDate(rangeValue, latestDateStr);
            var startIdx = chartRows.findIndex(function (r) {
              return r.date >= startStr;
            });
            if (startIdx < 0) startIdx = 0;
            var filteredRows = chartRows.slice(startIdx);
            chartTooltipDates = filteredRows.map(function (r) {
              return r.date;
            });
            var filteredLabels = sparseLabels(filteredRows, 10);
            var filteredCumulative = filteredRows.map(function (_, i) {
              return cumulativeData[chartFromIdx + startIdx + i];
            });
            var firstDate = filteredRows[0].date;
            var prevDateStr = msToDateKey(dateKeyToMs(firstDate) - oneDayMs);
            var prevCumulativeByType = cumulativeByTypeForDate(prevDateStr);
            var filteredNetChangeByType = {
              1: filteredRows.map(function (_, i) {
                var c = filteredRows.map(function (r) {
                  return cumulativeByTypeForDate(r.date)[1];
                });
                return i === 0
                  ? c[0] - (prevCumulativeByType[1] || 0)
                  : c[i] - c[i - 1];
              }),
              2: filteredRows.map(function (_, i) {
                var c = filteredRows.map(function (r) {
                  return cumulativeByTypeForDate(r.date)[2];
                });
                return i === 0
                  ? c[0] - (prevCumulativeByType[2] || 0)
                  : c[i] - c[i - 1];
              }),
              3: filteredRows.map(function (_, i) {
                var c = filteredRows.map(function (r) {
                  return cumulativeByTypeForDate(r.date)[3];
                });
                return i === 0
                  ? c[0] - (prevCumulativeByType[3] || 0)
                  : c[i] - c[i - 1];
              }),
              4: filteredRows.map(function (_, i) {
                var c = filteredRows.map(function (r) {
                  return cumulativeByTypeForDate(r.date)[4];
                });
                return i === 0
                  ? c[0] - (prevCumulativeByType[4] || 0)
                  : c[i] - c[i - 1];
              }),
            };
            var filteredBarNetFromTypes = filteredRows.map(function (_, i) {
              var sum = 0;
              for (var t = 1; t <= 4; t++) {
                sum += filteredNetChangeByType[t][i] || 0;
              }
              return sum;
            });
            var baseIdx = chartFromIdx + startIdx;
            var filteredNetChange = filteredRows.map(function (_, i) {
              var cur = cumulativeData[baseIdx + i];
              var prev =
                i > 0
                  ? cumulativeData[baseIdx + i - 1]
                  : baseIdx > 0
                    ? cumulativeData[baseIdx - 1]
                    : 0;
              return cur - prev;
            });
            var filteredNetPositive = filteredNetChange.map(function (v) {
              return v > 0 ? v : 0;
            });
            var filteredNetNegative = filteredNetChange.map(function (v) {
              return v < 0 ? Math.abs(v) : 0;
            });
            var filteredCumulativeByType = {
              1: filteredRows.map(function (r) {
                return cumulativeByTypeForDate(r.date)[1];
              }),
              2: filteredRows.map(function (r) {
                return cumulativeByTypeForDate(r.date)[2];
              }),
              3: filteredRows.map(function (r) {
                return cumulativeByTypeForDate(r.date)[3];
              }),
              4: filteredRows.map(function (r) {
                return cumulativeByTypeForDate(r.date)[4];
              }),
            };
            if (filteredRows.length >= 1) {
              var _fn = filteredRows.length - 1;
              for (var _tr = 1; _tr <= 4; _tr++) {
                if (
                  !filteredCumulativeByType[_tr] ||
                  !filteredNetChangeByType[_tr]
                )
                  continue;
                if (filteredRows.length === 1) {
                  filteredNetChangeByType[_tr][0] =
                    filteredCumulativeByType[_tr][0] -
                    (prevCumulativeByType[_tr] || 0);
                } else {
                  filteredNetChangeByType[_tr][_fn] =
                    filteredCumulativeByType[_tr][_fn] -
                    filteredCumulativeByType[_tr][_fn - 1];
                }
              }
            }
            var filteredBarMax = Math.max(
              Math.max.apply(null, filteredNetPositive) || 0,
              Math.max.apply(null, filteredNetNegative) || 0,
            );
            if (filteredBarMax === 0) filteredBarMax = 1;
            currentNetChangeByType = filteredNetChangeByType;

            var typeNames = {
              1: "Companions",
              2: "Repeaters",
              3: "Room servers",
              4: "Sensors",
            };
            var typeColors = {
              1: colorType1,
              2: colorType2,
              3: colorType3,
              4: colorType4,
            };

            var seriesConfig, colorsConfig, strokeConfig, barMaxVal, lineMaxVal;
            if (chartFilterType) {
              var t = chartFilterType;
              var typeNet = filteredNetChangeByType[t] || [];
              var typeNetPos = typeNet.map(function (v) {
                return v > 0 ? v : 0;
              });
              var typeNetNeg = typeNet.map(function (v) {
                return v < 0 ? Math.abs(v) : 0;
              });
              barMaxVal = Math.max(
                Math.max.apply(null, typeNetPos) || 0,
                Math.max.apply(null, typeNetNeg) || 0,
              );
              if (barMaxVal === 0) barMaxVal = 1;
              lineMaxVal =
                Math.max.apply(null, filteredCumulativeByType[t] || [0]) || 1;
              seriesConfig = [
                {
                  name: "Growth",
                  type: "column",
                  data: typeNetPos,
                },
                {
                  name: "Decline",
                  type: "column",
                  data: typeNetNeg,
                },
                {
                  name: typeNames[t] || "Type",
                  type: "line",
                  data: filteredCumulativeByType[t] || [],
                  fill: { opacity: 0 },
                },
              ];
              colorsConfig = [
                colorAdded,
                colorRemoved,
                typeColors[t] || colorTotal,
              ];
              strokeConfig = [0, 0, 5];
            } else {
              barMaxVal = filteredBarMax;
              lineMaxVal = Math.max.apply(null, filteredCumulative) || 1;
              seriesConfig = [
                {
                  name: "Growth",
                  type: "column",
                  data: filteredNetPositive,
                },
                {
                  name: "Decline",
                  type: "column",
                  data: filteredNetNegative,
                },
                {
                  name: "Companions",
                  type: "line",
                  data: filteredCumulativeByType[1],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Repeaters",
                  type: "line",
                  data: filteredCumulativeByType[2],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Room servers",
                  type: "line",
                  data: filteredCumulativeByType[3],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Sensors",
                  type: "line",
                  data: filteredCumulativeByType[4],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Total",
                  type: "line",
                  data: filteredCumulative,
                  fill: { opacity: 0 },
                },
              ];
              colorsConfig = [
                colorAdded,
                colorRemoved,
                colorType1,
                colorType2,
                colorType3,
                colorType4,
                colorTotal,
              ];
              strokeConfig = [0, 0, 3, 3, 3, 3, 5];
            }

            var yaxisConfig;
            if (chartFilterType) {
              yaxisConfig = [
                {
                  seriesName: "Growth",
                  title: {
                    text: "Change",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  axisBorder: { show: true, color: "#e7e5e4" },
                  min: 0,
                  max: barMaxVal,
                  tickAmount: 6,
                  show: true,
                },
                {
                  seriesName: "Decline",
                  min: 0,
                  max: barMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: typeNames[chartFilterType] || "Type",
                  opposite: true,
                  title: {
                    text: "Cumulative",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: true,
                },
              ];
            } else {
              yaxisConfig = [
                {
                  seriesName: "Growth",
                  title: {
                    text: "Change",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  axisBorder: { show: true, color: "#e7e5e4" },
                  min: 0,
                  max: barMaxVal,
                  tickAmount: 6,
                  show: true,
                },
                {
                  seriesName: "Decline",
                  min: 0,
                  max: barMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Companions",
                  opposite: true,
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Repeaters",
                  opposite: true,
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Room servers",
                  opposite: true,
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Sensors",
                  opposite: true,
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Total",
                  opposite: true,
                  title: {
                    text: "Cumulative",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  min: 0,
                  max: lineMaxVal,
                  tickAmount: 6,
                  show: true,
                },
              ];
            }

            statsChartInstance.updateOptions({
              series: seriesConfig,
              colors: colorsConfig,
              stroke: {
                width: strokeConfig,
                curve:
                  chartFilterType && strokeConfig.length === 3
                    ? ["straight", "straight", "straight"]
                    : [
                        "straight",
                        "straight",
                        "smooth",
                        "smooth",
                        "smooth",
                        "smooth",
                        "straight",
                      ],
                lineCap: "round",
              },
              xaxis: { categories: filteredLabels },
              yaxis: yaxisConfig,
            });
          }

          var statsChartInstance = null;
          if (typeof ApexCharts !== "undefined" && chartEl) {
            var barMax = Math.max(
              Math.max.apply(null, chartNetPositive) || 0,
              Math.max.apply(null, chartNetNegative) || 0,
            );
            if (barMax === 0) barMax = 1;
            statsChartInstance = new ApexCharts(chartEl, {
              chart: {
                type: "line",
                fontFamily: "DM Sans, system-ui, sans-serif",
                toolbar: { show: false },
                zoom: { enabled: false },
                animations: {
                  enabled: true,
                  speed: 600,
                  easing: "easeinout",
                  dynamicAnimation: { enabled: true },
                },
              },
              series: [
                {
                  name: "Growth",
                  type: "column",
                  data: chartNetPositive,
                },
                {
                  name: "Decline",
                  type: "column",
                  data: chartNetNegative,
                },
                {
                  name: "Companions",
                  type: "line",
                  data: cumulativeByType[1],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Repeaters",
                  type: "line",
                  data: cumulativeByType[2],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Room servers",
                  type: "line",
                  data: cumulativeByType[3],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Sensors",
                  type: "line",
                  data: cumulativeByType[4],
                  fill: {
                    type: "gradient",
                    gradient: {
                      shadeIntensity: 0,
                      opacityFrom: 0.5,
                      opacityTo: 0.15,
                      stops: [0, 100],
                    },
                  },
                },
                {
                  name: "Total",
                  type: "line",
                  data: cumulativeDisplay,
                  fill: { opacity: 0 },
                },
              ],
              stroke: {
                width: [0, 0, 3, 3, 3, 3, 5],
                curve: [
                  "straight",
                  "straight",
                  "smooth",
                  "smooth",
                  "smooth",
                  "smooth",
                  "straight",
                ],
                lineCap: "round",
              },
              plotOptions: {
                bar: {
                  columnWidth: "65%",
                  borderRadius: 6,
                  distributed: false,
                  stacked: false,
                  fill: {
                    opacity: 1,
                  },
                },
              },
              colors: [
                colorAdded,
                colorRemoved,
                colorType1,
                colorType2,
                colorType3,
                colorType4,
                colorTotal,
              ],
              xaxis: {
                categories: labels,
                tickAmount: 8,
                labels: {
                  style: { colors: "#57534e", fontSize: "11px" },
                  hideOverlappingLabels: true,
                  maxHeight: 80,
                },
                axisBorder: { show: true, color: "#e7e5e4" },
                axisTicks: { show: true, color: "#e7e5e4" },
              },
              yaxis: [
                {
                  seriesName: "Growth",
                  title: {
                    text: "Change",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  axisBorder: { show: true, color: "#e7e5e4" },
                  min: 0,
                  max: barMax,
                  tickAmount: 6,
                  show: true,
                },
                {
                  seriesName: "Growth",
                  min: 0,
                  max: barMax,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Decline",
                  min: 0,
                  max: barMax,
                  tickAmount: 6,
                  show: false,
                  title: { text: "" },
                  labels: { show: false },
                  axisBorder: { show: false },
                  axisTicks: { show: false },
                },
                {
                  seriesName: "Total",
                  opposite: true,
                  title: {
                    text: "Total",
                    style: { color: "#57534e", fontSize: "12px" },
                  },
                  labels: { style: { colors: "#57534e" } },
                  min: 0,
                  max: Math.max.apply(null, cumulativeDisplay) || 1,
                  tickAmount: 6,
                  show: true,
                },
                {
                  seriesName: "Companions",
                  opposite: true,
                  min: 0,
                  max: Math.max.apply(null, cumulativeDisplay) || 1,
                  show: false,
                },
                {
                  seriesName: "Repeaters",
                  opposite: true,
                  min: 0,
                  max: Math.max.apply(null, cumulativeDisplay) || 1,
                  show: false,
                },
                {
                  seriesName: "Room servers",
                  opposite: true,
                  min: 0,
                  max: Math.max.apply(null, cumulativeDisplay) || 1,
                  show: false,
                },
                {
                  seriesName: "Sensors",
                  opposite: true,
                  min: 0,
                  max: Math.max.apply(null, cumulativeDisplay) || 1,
                  show: false,
                },
              ],
              grid: {
                borderColor: "#e7e5e4",
                strokeDashArray: 3,
                xaxis: { lines: { show: false } },
                yaxis: { lines: { show: true } },
              },
              legend: {
                position: "top",
                horizontalAlign: "center",
                fontSize: "12px",
                fontWeight: 500,
                labels: { colors: "#57534e", style: { opacity: 0.85 } },
                itemMargin: { horizontal: 16, vertical: 6 },
                markers: { radius: 5, shape: "circle" },
              },
              tooltip: {
                shared: true,
                intersect: false,
                theme: "light",
                style: { fontSize: "12px" },
                hideEmptySeries: false,
                x: {
                  formatter: function (val, opts) {
                    var i =
                      opts && opts.dataPointIndex != null
                        ? opts.dataPointIndex
                        : 0;
                    return chartTooltipDates[i] != null
                      ? formatDateOnly(chartTooltipDates[i])
                      : val || "";
                  },
                },
                custom: function (opts) {
                  var w = opts.w;
                  var i = opts.dataPointIndex;
                  var series = (w && w.globals && w.globals.series) || [];
                  var growth =
                    series[0] && series[0][i] != null ? series[0][i] : 0;
                  var decline =
                    series[1] && series[1][i] != null ? series[1][i] : 0;
                  var net = growth - decline;
                  var typeNames = {
                    1: "Companions",
                    2: "Repeaters",
                    3: "Room servers",
                    4: "Sensors",
                  };
                  var parts = [];
                  if (growth > 0 || decline > 0) {
                    parts.push(
                      "<div style='font-size:11px;color:#78716c;margin-bottom:4px'>Added+restored: +" +
                        growth +
                        " · Removed: -" +
                        decline +
                        "</div>",
                    );
                  }
                  parts.push(
                    "<div>Net: " + (net > 0 ? "+" : "") + net + "</div>",
                  );
                  if (
                    chartFilterType &&
                    currentNetChangeByType &&
                    (currentNetChangeByType[1] ||
                      currentNetChangeByType[2] ||
                      currentNetChangeByType[3] ||
                      currentNetChangeByType[4])
                  ) {
                    for (var t = 1; t <= 4; t++) {
                      var v =
                        currentNetChangeByType[t] &&
                        currentNetChangeByType[t][i] != null
                          ? currentNetChangeByType[t][i]
                          : 0;
                      if (v !== 0) {
                        parts.push(
                          "<div style='padding-left:8px;font-size:11px'>" +
                            typeNames[t] +
                            " (day): " +
                            (v > 0 ? "+" : "") +
                            v +
                            "</div>",
                        );
                      }
                    }
                  }
                  var tipLastIdx =
                    chartTooltipDates && chartTooltipDates.length
                      ? chartTooltipDates.length - 1
                      : -1;
                  var tipUseMapCounts =
                    i === tipLastIdx &&
                    statsDataCache &&
                    statsDataCache.by_type_map &&
                    !chartFilterType;
                  for (var s = 2; s < series.length; s++) {
                    var val = series[s] && series[s][i];
                    if (
                      tipUseMapCounts &&
                      s >= 2 &&
                      s <= 5 &&
                      s < series.length - 1
                    ) {
                      var ty = s - 1;
                      var bm = statsDataCache.by_type_map;
                      var bmp =
                        bm[ty] != null
                          ? bm[ty]
                          : bm[String(ty)] != null
                            ? bm[String(ty)]
                            : null;
                      if (bmp != null) val = Number(bmp);
                    }
                    if (val != null) {
                      var name =
                        (w.globals.seriesNames && w.globals.seriesNames[s]) ||
                        "Series " + s;
                      parts.push(
                        "<div>" +
                          name +
                          ": " +
                          Number(val).toLocaleString() +
                          "</div>",
                      );
                    }
                  }
                  return (
                    "<div style='padding:8px 10px;min-width:140px'>" +
                    parts.join("") +
                    "</div>"
                  );
                },
              },
              responsive: [
                {
                  breakpoint: 641,
                  options: {
                    chart: { offsetX: 0, offsetY: -4 },
                    grid: {
                      padding: {
                        top: 2,
                        right: 0,
                        bottom: 2,
                        left: 0,
                      },
                    },
                    legend: {
                      position: "bottom",
                      horizontalAlign: "center",
                      fontSize: "10px",
                      itemMargin: { horizontal: 5, vertical: 2 },
                      markers: { width: 9, height: 9, radius: 4 },
                    },
                    xaxis: {
                      tickAmount: 5,
                      labels: {
                        style: { colors: "#57534e", fontSize: "9px" },
                        maxHeight: 56,
                      },
                    },
                  },
                },
              ],
              dataLabels: { enabled: false },
            });
            statsChartInstance.render();
            window.__statsChartInstance = statsChartInstance;
            if (!window.__statsViewportResizeHooked) {
              window.__statsViewportResizeHooked = true;
              var statsResizeTimer;
              function statsReflowCharts() {
                clearTimeout(statsResizeTimer);
                statsResizeTimer = setTimeout(function () {
                  try {
                    if (window.__statsChartInstance) {
                      window.__statsChartInstance.resize();
                    }
                    if (window.__statsPlaybackMap) {
                      window.__statsPlaybackMap.invalidateSize();
                    }
                  } catch (e) {}
                }, 200);
              }
              window.addEventListener("resize", statsReflowCharts);
              var statsVV = window.visualViewport;
              if (statsVV) {
                statsVV.addEventListener("resize", statsReflowCharts);
                statsVV.addEventListener("scroll", statsReflowCharts);
              }
              window.addEventListener("orientationchange", function () {
                setTimeout(statsReflowCharts, 350);
              });
            }
            applyChartRange("month");
            var rangeSelect = document.getElementById("stats-chart-range");
            if (rangeSelect) {
              rangeSelect.addEventListener("change", function () {
                currentChartRange = this.value;
                applyChartRange(this.value);
              });
            }
          }

          // Playback map: defer heavy node_changes + Leaflet until idle (or run immediately when refetch passes data).
          function runPlaybackWithChanges(ch) {
            if (playbackGen !== __statsPlaybackGen) return;
            ensureStatsLeaflet()
              .then(function () {
                if (playbackGen !== __statsPlaybackGen) return;
                initStatsPlaybackMap(ch || []);
              })
              .catch(function () {});
          }
          if (nodeChanges && nodeChanges.length) {
            runPlaybackWithChanges(nodeChanges);
          } else {
            var ric =
              window.requestIdleCallback ||
              function (fn) {
                setTimeout(fn, 250);
              };
            ric(function () {
              if (playbackGen !== __statsPlaybackGen) return;
              var pp = statsFrequencyQuerySuffix();
              fetch("/api/v1/node-changes?limit=15000" + pp).then(function (r) {
                if (playbackGen !== __statsPlaybackGen) return;
                if (!r.ok) {
                  runPlaybackWithChanges([]);
                  return;
                }
                return r.json().then(function (ch) {
                  if (playbackGen !== __statsPlaybackGen) return;
                  runPlaybackWithChanges(ch || []);
                });
              });
            });
          }
        }
        window.__statsRefetchChart = function (preset) {
          if (preset != null && preset !== "" && !window.__statsRadioCustom) {
            chartPresetValue = preset;
          }
          fetchChartData(null)
            .then(function (results) {
              initStatsContent(results[0], results[1] || []);
            })
            .catch(function (err) {
              showError(err.message || "Could not load sync history.");
            });
        };
        var presetParamBoot = statsFrequencyQuerySuffix();
        Promise.all([
          fetch("/api/v1/stats").then(function (r) {
            if (!r.ok) throw new Error("Failed to load stats");
            return r.json();
          }),
          fetch("/api/v1/sync-history?limit=500" + presetParamBoot).then(
            function (r) {
              if (!r.ok) throw new Error("Failed to load sync history");
              return r.json();
            },
          ),
          fetch("/api/v1/node-changes?limit=15000" + presetParamBoot).then(
            function (r) {
              return r.ok ? r.json() : [];
            },
          ),
          ensureApexCharts(),
        ])
          .then(function (tuple) {
            var s = tuple[0];
            var history = tuple[1];
            var nodeChangesBoot = tuple[2] || [];
            statsDataCache = s;
            fillHeaderChips(s);
            var main = document.querySelector(".stats-header-main");
            if (main) main.classList.remove("is-loading");
            var tCitiesBoot = document.getElementById("stats-summary-cities");
            if (tCitiesBoot) {
              var cs = document.getElementById("stats-cities-type");
              var citiesTypeKey = (cs && cs.value) || "all";
              populatePresetDropdown(s);
              updateNetworkChipFromPreset();
              renderTopCities(citiesTypeKey);
            } else {
              populatePresetDropdown(s);
              updateNetworkChipFromPreset();
            }
            initStatsContent(history, nodeChangesBoot);
          })
          .catch(function (err) {
            loadingEl.style.display = "none";
            showError(err.message || "Could not load stats page data.");
            var main = document.querySelector(".stats-header-main");
            if (main) main.classList.remove("is-loading");
          });
      })();
