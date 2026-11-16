"""Sign-in through the map for the site's other tools (NodeBook): one-time codes and handles.

A code is made when the map sends a signed-in person back to a tool. It is good for one swap,
within CODE_TTL_S, by that tool only. The swap gives the tool a handle: a pointer to the map
session that made the code, so the tool can later ask whether that session is still signed in.
Both are kept server-side under the SHA-256 of their value, never in clear. Each map session also
keeps the list of its handles, so ending that session everywhere ends its handles too.
"""

import hashlib
import os
import secrets
import threading
import time

from cachelib import FileSystemCache

CODE_TTL_S = 60
# Set by the app to a folder in its data directory.
GRANTS_DIR = None
# Codes and handles in separate stores: a flood of codes (anyone signed in can ask for them) only
# pushes out codes, never the handles other people's tool sessions depend on.
_THRESHOLDS = {'codes': 2000, 'handles': 20000, 'sessions': 20000}

_store = None
_lock = threading.Lock()


def _cache(kind):
    global _store
    if _store is None:
        _store = {name: FileSystemCache(os.path.join(GRANTS_DIR, name), threshold=limit, mode=0o600)
                  for name, limit in _THRESHOLDS.items()}
    return _store[kind]


def _key(kind, value):
    return f'{kind}:' + hashlib.sha256(value.encode('utf-8')).hexdigest()


def _new_value():
    return secrets.token_urlsafe(32)


def issue_code(tool, store_id, user_id):
    """A one-time code for `tool`, for the map session `store_id` of `user_id`."""
    code = _new_value()
    record = {'tool': tool, 'store_id': store_id, 'user_id': user_id, 'exp': time.time() + CODE_TTL_S}
    _cache('codes').set(_key('code', code), record, timeout=CODE_TTL_S + 5)
    return code


def redeem_code(tool, code):
    """The code's record when it is current and for `tool`, else None. A code is gone after its
    first try, whether that try was right or not."""
    if not isinstance(code, str) or not code:
        return None
    key = _key('code', code)
    with _lock:
        record = _cache('codes').get(key)
        if record is not None:
            _cache('codes').delete(key)
    if not isinstance(record, dict) or record.get('tool') != tool or record.get('exp', 0) < time.time():
        return None
    return record


def issue_handle(tool, store_id, user_id, lifetime_s):
    """A handle for `tool` that points to the map session `store_id`."""
    handle = _new_value()
    key = _key('handle', handle)
    _cache('handles').set(key, {'tool': tool, 'store_id': store_id, 'user_id': user_id},
                 timeout=int(lifetime_s))
    session_key = _key('session', store_id)
    with _lock:
        known = _cache('sessions').get(session_key)
        _cache('sessions').set(session_key, (known if isinstance(known, list) else []) + [key],
                               timeout=int(lifetime_s))
    return handle


def end_session(store_id):
    """Forget every handle that points to the map session `store_id`; nothing when it has none."""
    if not isinstance(store_id, str) or not store_id:
        return
    session_key = _key('session', store_id)
    with _lock:
        keys = _cache('sessions').get(session_key)
        _cache('sessions').delete(session_key)
    for key in keys if isinstance(keys, list) else []:
        _cache('handles').delete(key)


def find_handle(tool, handle):
    """The handle's record when it is known and for `tool`, else None."""
    if not isinstance(handle, str) or not handle:
        return None
    record = _cache('handles').get(_key('handle', handle))
    if not isinstance(record, dict) or record.get('tool') != tool:
        return None
    return record
