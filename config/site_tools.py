"""The site's optional tool list (SITE_TOOLS_JSON): more tools served on the same site as the map,
shown in every page's tool switcher. Unset on a site that only runs the map."""

import json
import re

_KEY = re.compile(r'^[A-Za-z][A-Za-z0-9]{0,30}$')
# A path on this site: starts with one "/", then plain URL path characters only.
_URL = re.compile(r'^/(?![/\\])[A-Za-z0-9._~\-/]*$')


def parse_site_tools(raw):
    """[{key, label, url}] from the setting's JSON; entries that are not a plain path on this site are left out."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(data, list):
        return []
    tools = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        key, label, url = entry.get('key'), entry.get('label'), entry.get('url')
        if not (isinstance(key, str) and _KEY.fullmatch(key)):
            continue
        if not (isinstance(label, str) and 0 < len(label.strip()) <= 40):
            continue
        if not (isinstance(url, str) and _URL.fullmatch(url)):
            continue
        tools.append({'key': key, 'label': label.strip(), 'url': url})
    return tools
