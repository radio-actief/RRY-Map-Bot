"""Sign-in through the map for the site's other tools (NodeBook): one-time codes and handles.

A code is made when the map sends a signed-in person back to a tool. It is good for one swap,
within CODE_TTL_S, by that tool only. The swap gives the tool a handle: a pointer to the map
session that made the code, so the tool can later ask whether that session is still signed in.
Both are kept server-side under the SHA-256 of their value, never in clear.
"""

import hashlib
import secrets
import threading
import time

from cachelib import FileSystemCache

CODE_TTL_S = 60
# Set by the app to a folder in its data directory.
GRANTS_DIR = None
# Enough room for every open handle; expired entries go first when it fills up.
_THRESHOLD = 20000

_store = None
_lock = threading.Lock()


def _cache():
    global _store
    if _store is None:
        _store = FileSystemCache(GRANTS_DIR, threshold=_THRESHOLD, mode=0o600)
    return _store


def _key(kind, value):
    return f'{kind}:' + hashlib.sha256(value.encode('utf-8')).hexdigest()


def _new_value():
    return secrets.token_urlsafe(32)


def issue_code(tool, store_id, user_id):
    """A one-time code for `tool`, for the map session `store_id` of `user_id`."""
    code = _new_value()
    record = {'tool': tool, 'store_id': store_id, 'user_id': user_id, 'exp': time.time() + CODE_TTL_S}
    _cache().set(_key('code', code), record, timeout=CODE_TTL_S + 5)
    return code


def redeem_code(tool, code):
    """The code's record when it is current and for `tool`, else None. A code is gone after its
    first try, whether that try was right or not."""
    if not isinstance(code, str) or not code:
        return None
    key = _key('code', code)
    with _lock:
        record = _cache().get(key)
        if record is not None:
            _cache().delete(key)
    if not isinstance(record, dict) or record.get('tool') != tool or record.get('exp', 0) < time.time():
        return None
    return record


def issue_handle(tool, store_id, user_id, lifetime_s):
    """A handle for `tool` that points to the map session `store_id`."""
    handle = _new_value()
    _cache().set(_key('handle', handle), {'tool': tool, 'store_id': store_id, 'user_id': user_id},
                 timeout=int(lifetime_s))
    return handle


def find_handle(tool, handle):
    """The handle's record when it is known and for `tool`, else None."""
    if not isinstance(handle, str) or not handle:
        return None
    record = _cache().get(_key('handle', handle))
    if not isinstance(record, dict) or record.get('tool') != tool:
        return None
    return record
