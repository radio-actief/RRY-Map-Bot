// The stats page's numbers from the server's history (GET /api/v1/stats-history, read by
// src/shared/stats-history.js) are the numbers the page computed itself from the change list
// before: the cumulative lines by type, the repeater growth per day and the playback frames.
// tests/fixtures/stats-history/history.json is the server's answer for changes.json
// (tests/test_stats_history.py keeps the two in step).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => JSON.parse(readFileSync(join(root, "tests/fixtures/stats-history", name), "utf8"));

/** src/shared/stats-history.js as the page runs it. */
function pageHistory() {
  const window = {};
  vm.runInNewContext(readFileSync(join(root, "src/shared/stats-history.js"), "utf8"), { window, Map, Array });
  return window.BEmeshStatsHistory;
}

// The page's own computation before, as src/stats.js had it.
function oldTypeFrames(nodeChanges) {
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
      } else if (c.change_type === "updated" && visibleCh[c.public_key]) {
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
  return framesByType;
}

function cumulativeByTypeForDate(framesByType, dateStr) {
  if (framesByType.length === 0) return { 1: 0, 2: 0, 3: 0, 4: 0 };
  if (dateStr < framesByType[0].date) return { 1: 0, 2: 0, 3: 0, 4: 0 };
  var best = framesByType[0];
  for (var i = 0; i < framesByType.length; i++) {
    if (framesByType[i].date <= dateStr) best = framesByType[i];
    else break;
  }
  return best.counts;
}

function oldGrowth(dayList, changes) {
  function syncDayKey(syncDate) {
    return String(syncDate == null ? "" : syncDate).slice(0, 10);
  }
  function applyNodeChangeForPlayback(visibleCh, c) {
    var t = c.type || 1;
    if (c.change_type === "added" || c.change_type === "restored") {
      visibleCh[c.public_key] = t;
    } else if (c.change_type === "updated" && visibleCh[c.public_key] !== undefined) {
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
  if (!dayList.length) return [];
  var sorted = changes.slice().sort(function (a, b) {
    return (a.sync_date || "").localeCompare(b.sync_date || "");
  });
  var visibleCh = {};
  var chIx = 0;
  var n = sorted.length;
  while (chIx < n && syncDayKey(sorted[chIx].sync_date) < dayList[0]) {
    applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
    chIx++;
  }
  var rows = [];
  for (var i = 0; i < dayList.length; i++) {
    var day = dayList[i];
    var repStart = repeaterCountFromVisible(visibleCh);
    while (chIx < n && syncDayKey(sorted[chIx].sync_date) === day) {
      applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
      chIx++;
    }
    var repEnd = repeaterCountFromVisible(visibleCh);
    rows.push({ date: day, growth: repEnd - repStart });
    var nextDay = dayList[i + 1];
    if (nextDay) {
      while (chIx < n && syncDayKey(sorted[chIx].sync_date) < nextDay) {
        applyNodeChangeForPlayback(visibleCh, sorted[chIx]);
        chIx++;
      }
    }
  }
  return rows;
}

function oldPlaybackFrames(changes) {
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
        visible[c.public_key] = { lat: c.lat, lon: c.lon, adv_name: c.adv_name, type: c.type || 1 };
      } else if (c.change_type === "updated" && visible[c.public_key]) {
        visible[c.public_key] = { lat: c.lat, lon: c.lon, adv_name: c.adv_name, type: c.type || 1 };
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
  return frames;
}

/** Every calendar day from the day before the first change to the day after the last. */
function everyDay(changes) {
  const dated = changes.map((c) => (c.sync_date || "").slice(0, 10)).filter(Boolean).sort();
  const out = [];
  for (let t = Date.parse(dated[0] + "T12:00:00Z") - 864e5; t <= Date.parse(dated.at(-1) + "T12:00:00Z") + 864e5; t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test("the server's history gives the page the numbers it computed from the change list", () => {
  const changes = fixture("changes.json");
  const history = fixture("history.json");
  const page = pageHistory();
  const days = everyDay(changes);

  const before = oldTypeFrames(changes);
  const after = plain(page.typeFrames(history));
  for (const day of days) {
    const want = cumulativeByTypeForDate(before, day);
    const got = cumulativeByTypeForDate(after, day);
    assert.deepEqual([got[1], got[2], got[3], got[4]], [want[1], want[2], want[3], want[4]], `by type on ${day}`);
  }

  const growth = page.growthByDay(history);
  // The page's day list (the sync history's days), and every day around the changes.
  for (const dayList of [days, days.filter((_, i) => i % 3 === 1)]) {
    const want = oldGrowth(dayList, changes);
    const got = dayList.map((day) => ({ date: day, growth: growth[day] || 0 }));
    assert.deepEqual(got, want);
  }

  assert.deepEqual(plain(page.playbackFrames(history)), plain(oldPlaybackFrames(changes)));
});

test("no history gives empty frames and no growth", () => {
  const page = pageHistory();
  for (const h of [null, { days: [], types: [], growth: [], looks: [], steps: [] }]) {
    assert.deepEqual(plain(page.typeFrames(h)), []);
    assert.deepEqual(plain(page.growthByDay(h)), {});
    assert.deepEqual(plain(page.playbackFrames(h)), []);
  }
});
