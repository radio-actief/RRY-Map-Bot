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


# The map's own pages: the key a tool list gives each, and its path on the map's address.
OWN_PAGES = {'map': '/', 'stats': '/stats', 'regionMap': '/region-map', 'configurator': '/configurator'}


def parse_site_tools(raw):
    """[{key, label, url[, hidden][, partner][, redirectOldPath]}] from the setting's JSON; entries
    that are not a plain path on this site or a plain https address are left out. "hidden": true and
    "partner": true (only those values) are kept as hidden: True and partner: True. A partner is
    another project's tool (docs/PARTNERS.md): it may sign people in through the map after their
    consent and read the claims feed, and it is always hidden. "redirectOldPath": true is kept only
    on the map's own pages stats, regionMap and configurator (see old_path_target)."""
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
        tool = {'key': key, 'label': label.strip(), 'url': url}
        # Hidden: people can sign in to it and come back to it, but no page shows or names it.
        if entry.get('hidden') is True:
            tool['hidden'] = True
        # Partner: never shown or named by the pages, no device-hub access, consent before sign-in.
        if entry.get('partner') is True:
            tool['hidden'] = True
            tool['partner'] = True
        # One of the map's own pages on an address of its own: its old path on the map answers 301
        # there (see old_path_target).
        if entry.get('redirectOldPath') is True and key in OWN_PAGES and key != 'map' and not tool.get('partner'):
            tool['redirectOldPath'] = True
        tools.append(tool)
    return tools


def shown_tools(tools):
    """The tools the pages may show: the list without the hidden ones and partners, as {key, label, url}."""
    return [{k: t[k] for k in ('key', 'label', 'url')} for t in tools
            if not t.get('hidden') and not t.get('partner')]


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


# A tool's shared secret for signing in through the map: long enough that it can't be guessed.
SECRET_MIN_LENGTH = 32


def parse_tool_secrets(raw):
    """{tool key: secret} from SITE_TOOL_SECRETS_JSON, the secrets the site's tools use when they swap
    a sign-in code or ask whether someone is still signed in. A key that isn't plain or a secret
    shorter than SECRET_MIN_LENGTH is left out, so that tool can't sign in through the map."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        key: secret for key, secret in data.items()
        if isinstance(key, str) and _KEY.fullmatch(key)
        and isinstance(secret, str) and len(secret) >= SECRET_MIN_LENGTH
    }


_DOMAIN = re.compile(r'^' + _LABEL + r'(?:\.' + _LABEL + r')+$')
_IPV4 = re.compile(r'^[0-9.]+$')


def parse_cookie_domain(raw):
    """The parent domain the site's tools share a language cookie on (LANG_COOKIE_DOMAIN, e.g.
    ".radio-actief.be"), lower case without the leading dot; None when unset or not a plain
    domain name of two or more labels."""
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    if value.startswith('.'):
        value = value[1:]
    if not _DOMAIN.fullmatch(value) or _IPV4.fullmatch(value):
        return None
    return value


# The map's own pages on addresses of their own: one application answers on several host names,
# each with its page at "/". See DEPLOYMENT.md, "One application, four addresses".


def _root_host(url):
    """The host as a browser sends it in Host ("host", or "host:port" for a port that is not the
    scheme's default) of a tool on its own address at the root ("https://host/"), else None."""
    parts = _full_address(url) if isinstance(url, str) else None
    if not parts or _FULL.fullmatch(url)['path'] != '/':
        return None
    scheme, host, port = parts
    return host if port in (None, _DEFAULT_PORTS[scheme]) else f'{host}:{port}'


def own_hosts(tools):
    """{host: key} of the map's own pages that have an address of their own at its root
    ("https://stats.example/"), hidden ones included, the map's own host as "map". Empty unless the
    map itself is listed that way and at least one other page is: until then every page stays on its
    path of the map's address, exactly as without a list. A partner never counts; a host named twice
    keeps its first page."""
    by_key = {}
    for tool in tools:
        key = tool.get('key')
        if key in OWN_PAGES and key not in by_key and not tool.get('partner'):
            by_key[key] = tool
    map_host = _root_host(by_key.get('map', {}).get('url'))
    if not map_host:
        return {}
    hosts = {map_host: 'map'}
    for key in ('stats', 'regionMap', 'configurator'):
        host = _root_host(by_key.get(key, {}).get('url'))
        if host and host not in hosts:
            hosts[host] = key
    return hosts if len(hosts) > 1 else {}


def own_tool(tools, key):
    """The tool list's entry for one of the map's own pages when it is on its own address (see
    own_hosts), else None."""
    for host, k in own_hosts(tools).items():
        if k == key:
            return next(t for t in tools if t.get('key') == key and _root_host(t.get('url')) == host)
    return None


def host_page(tools, host):
    """Which of the map's own pages answers at "/" on this Host: its key, or None for the map's own
    host and any host not listed (those keep the map, as today)."""
    key = own_hosts(tools).get((host or '').lower())
    return None if key in (None, 'map') else key


def own_page_tools(tools):
    """The entries of the map's own pages on their own address besides the map, hidden ones included."""
    return [own_tool(tools, k) for k in own_hosts(tools).values() if k != 'map']


def own_page_origins(tools):
    """The origins of the map's own pages on their own address besides the map, hidden ones included:
    the pages that may ask the map's /auth/me with the visitor's cookie."""
    return tool_origins(own_page_tools(tools))


def old_path_target(tools, key):
    """The origin a page's old path on the map ("/stats", "/region-map", "/configurator") answers
    301 to: only for a shown page on its own address with "redirectOldPath": true, else None."""
    tool = own_tool(tools, key)
    if not tool or key == 'map' or tool.get('hidden') or not tool.get('redirectOldPath'):
        return None
    return tool_origins([tool])[0]


def page_links(tools, host):
    """What a page on this Host links to for the four pages, and where the map is when that's
    another address, as {"pages": {key: href}, "map": origin, "hub": url}; None while no page has an
    address of its own (the pages then keep their fixed paths, as today).

    A page links to a shown page on its own address by that address, to itself by "/" (also when it
    is hidden), to the map's address by "/" from the map, and to any other page by its path on the
    map's address. "map" (the map's origin) and "hub" (its device hub, for a shown page) are there
    only on another address than the map's."""
    hosts = own_hosts(tools)
    if not hosts:
        return None
    host = (host or '').lower()
    here = hosts.get(host)
    map_origin = tool_origins([own_tool(tools, 'map')])[0]
    away = here not in (None, 'map')
    base = map_origin if away else ''
    pages = {}
    for key, path in OWN_PAGES.items():
        tool = own_tool(tools, key)
        if key == here or (key == 'map' and not away):
            pages[key] = '/'
        elif key == 'map':
            pages[key] = map_origin + '/'
        elif tool and not tool.get('hidden'):
            pages[key] = tool['url']
        else:
            pages[key] = base + path
    links = {'pages': pages}
    if away:
        links['map'] = map_origin
        if not own_tool(tools, here).get('hidden'):
            links['hub'] = map_origin + '/device-hub.html'
    return links
