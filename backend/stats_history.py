"""The stats page's history numbers, computed on the server from the node change list.

The input is the list GET /api/v1/node-changes answers (``get_node_changes_since``): rows with
public_key, change_type, sync_date, lat, lon, adv_name and type, sorted by sync_date. The page
replays it day by day: "added" and "restored" show a node, "updated" changes a node that is shown,
"removed" hides it. This module does that replay once and keeps what the page draws:

- ``days``: every day (the first 10 characters of sync_date) that has changes, oldest first;
- ``types``: per day, the nodes shown after it by type: [companions, repeaters, room servers,
  sensors] (the chart's cumulative lines);
- ``growth``: per day, the repeaters shown after it minus before it (the top growth days);
- ``looks``: each distinct [lat, lon, name, type] a node is shown with;
- ``steps``: per day, what changed on the playback map, in order: a key number k followed by a
  look number for a node shown with that look, or -(k + 1) for node k hidden. Key numbers are
  given in order of first appearance; a change that leaves a node as it was is left out.

The page builds its playback frames from ``steps`` (src/shared/stats-history.js) exactly as it
built them from the rows, in the same order.
"""

from typing import Iterable, Optional

TYPES = (1, 2, 3, 4)


def _node_type(value) -> int:
    """The page's `c.type || 1`: a missing or zero type is a companion."""
    return value or 1


def build_stats_history(changes: Iterable[dict]) -> dict:
    """The page's history numbers and playback steps for `changes` (see the module docstring)."""
    by_day: dict = {}
    for c in changes:
        by_day.setdefault((c.get('sync_date') or '')[:10], []).append(c)

    keys: dict = {}
    looks: list = []
    look_numbers: dict = {}
    shown: dict = {}  # public key -> look tuple, in the page's order (insertion order)
    counts = {t: 0 for t in TYPES}

    def look_number(look: tuple) -> int:
        n = look_numbers.get(look)
        if n is None:
            n = look_numbers[look] = len(looks)
            looks.append(list(look))
        return n

    def key_number(public_key) -> int:
        n = keys.get(public_key)
        if n is None:
            n = keys[public_key] = len(keys)
        return n

    def count(look: Optional[tuple], by: int) -> None:
        if look is not None and look[3] in counts:
            counts[look[3]] += by

    days, types, growth, steps = [], [], [], []
    for day in sorted(by_day):
        repeaters_before = counts[2]
        step: list = []
        for c in by_day[day]:
            pk = c.get('public_key')
            kind = c.get('change_type')
            if kind in ('added', 'restored') or (kind == 'updated' and pk in shown):
                look = (c.get('lat'), c.get('lon'), c.get('adv_name'), _node_type(c.get('type')))
                before = shown.get(pk)
                if before == look:
                    continue
                count(before, -1)
                count(look, 1)
                shown[pk] = look
                step += [key_number(pk), look_number(look)]
            elif kind == 'removed' and pk in shown:
                count(shown.pop(pk), -1)
                step.append(-(key_number(pk) + 1))
        days.append(day)
        types.append([counts[t] for t in TYPES])
        growth.append(counts[2] - repeaters_before)
        steps.append(step)
    return {'days': days, 'types': types, 'growth': growth, 'looks': looks, 'steps': steps}
