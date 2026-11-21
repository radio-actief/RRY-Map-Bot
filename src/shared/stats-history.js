/* The stats page's history from GET /api/v1/stats-history (backend/stats_history.py): the server
 * replays the node changes once, and the page reads the result.
 * window.BEmeshStatsHistory.typeFrames(h) → [{ date, counts: { 1, 2, 3, 4 } }]: the nodes shown
 *   after each day by type (the chart's cumulative lines).
 * window.BEmeshStatsHistory.growthByDay(h) → { date: repeaters after the day minus before it }.
 * window.BEmeshStatsHistory.playbackFrames(h) → [{ date, nodes: [{ lat, lon, adv_name, type }] }]:
 *   the playback map's frames, the nodes in the order they were first shown. */
(function () {
  function days(h) {
    return h && Array.isArray(h.days) ? h.days : [];
  }

  function typeFrames(h) {
    var types = (h && h.types) || [];
    return days(h).map(function (date, i) {
      var c = types[i] || [];
      return { date: date, counts: { 1: c[0] || 0, 2: c[1] || 0, 3: c[2] || 0, 4: c[3] || 0 } };
    });
  }

  function growthByDay(h) {
    var growth = (h && h.growth) || [];
    var out = {};
    days(h).forEach(function (date, i) {
      out[date] = growth[i] || 0;
    });
    return out;
  }

  function playbackFrames(h) {
    var looks = (h && h.looks) || [];
    var steps = (h && h.steps) || [];
    // A Map keeps the order nodes were first shown in, also when one is shown again with a new look.
    var shown = new Map();
    return days(h).map(function (date, i) {
      var step = steps[i] || [];
      for (var j = 0; j < step.length; j++) {
        var k = step[j];
        if (k < 0) {
          shown.delete(-k - 1);
        } else {
          var look = looks[step[++j]] || [];
          shown.set(k, { lat: look[0], lon: look[1], adv_name: look[2], type: look[3] });
        }
      }
      return { date: date, nodes: Array.from(shown.values()) };
    });
  }

  window.BEmeshStatsHistory = { typeFrames: typeFrames, growthByDay: growthByDay, playbackFrames: playbackFrames };
})();
