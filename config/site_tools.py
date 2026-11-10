"""The site's optional tool list (SITE_TOOLS_JSON): the tools shown in every page's tool switcher,
each on a path of this site ("/nodebook/") or on its own address ("https://nodebook.example/").
Unset on a site that only runs the map."""

import json
import re

_KEY = re.compile(r'^[A-Za-z][A-Za-z0-9]{0,30}$')
# A path on this site: starts with one "/", then plain URL path characters only, no "." or ".." segment.
_URL = re.compile(r'^/(?![/\\])[A-Za-z0-9._~\-/]*$')
_DOT_SEGMENT = re.compile(r'(^|/)\.{1,2}(/|$)')
# A tool on its own address: https, a lower-case host name, an optional port and a plain path that
# ends in "/". No user name, query or fragment. Plain http only on this machine, for tests.
_LABEL = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
_FULL = re.compile(
    r'^(?P<scheme>https|http)://(?P<host>' + _LABEL + r'(?:\.' + _LABEL + r')*)'
    r'(?::(?P<port>[1-9][0-9]{0,4}))?(?P<path>/(?:[A-Za-z0-9._~\-]+/)*)$'
)
_LOCAL_HOSTS = ('localhost', '127.0.0.1')
_DEFAULT_PORTS = {'https': 443, 'http': 80}


def _full_address(url):
    """The parts of a tool's own address (scheme, host, port), or None when it isn't one we accept."""
    m = _FULL.fullmatch(url)
    if not m or _DOT_SEGMENT.search(m['path']):
        return None
    port = int(m['port']) if m['port'] else None
    if port is not None and port > 65535:
        return None
    if m['scheme'] == 'http' and m['host'] not in _LOCAL_HOSTS:
        return None
    return m['scheme'], m['host'], port


def _is_tool_url(url):
    if not isinstance(url, str):
        return False
    if _URL.fullmatch(url):
        return not _DOT_SEGMENT.search(url)
    return _full_address(url) is not None


def parse_site_tools(raw):
    """[{key, label, url}] from the setting's JSON; entries that are not a plain path on this site or
    a plain https address are left out."""
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
        if not _is_tool_url(url):
            continue
        tools.append({'key': key, 'label': label.strip(), 'url': url})
    return tools


def tool_origins(tools):
    """The origins ("https://host[:port]", as a browser writes them) of the tools on their own
    address, each once, in list order; tools on a path of this site have none."""
    origins = []
    for tool in tools:
        parts = _full_address(tool.get('url', ''))
        if not parts:
            continue
        scheme, host, port = parts
        origin = f'{scheme}://{host}' if port in (None, _DEFAULT_PORTS[scheme]) else f'{scheme}://{host}:{port}'
        if origin not in origins:
            origins.append(origin)
    return origins
