"""Every map session a person signed in with, so "Log out everywhere" can end them all.

Each sign-in records the new session's store id under the person (by the SHA-256 of their Discord
id, never in clear). "Log out everywhere" takes the whole list at once. A session that already
ended or expired is simply gone from the session store by then; the caller skips it.
"""

import hashlib
import os
import threading

from cachelib import FileSystemCache

# Set by the app to a folder in its data directory.
INDEX_DIR = None
# People with a sign-in on record; the oldest file goes first past this.
THRESHOLD = 20000
# Sign-ins kept per person: the newest ones (a person has a handful of browsers, not hundreds).
MAX_PER_PERSON = 50

_store = None
_lock = threading.Lock()


def _cache():
    global _store
    if _store is None:
        _store = FileSystemCache(INDEX_DIR, threshold=THRESHOLD, mode=0o600)
    return _store


def _key(user_id):
    return 'person:' + hashlib.sha256(str(user_id).encode('utf-8')).hexdigest()


def remember(user_id, store_id, lifetime_s):
    """Record that `user_id` signed in with the session `store_id`; kept as long as a session lives."""
    if not user_id or not store_id:
        return
    key = _key(user_id)
    with _lock:
        known = _cache().get(key)
        ids = [s for s in known if s != store_id] if isinstance(known, list) else []
        ids.append(store_id)
        _cache().set(key, ids[-MAX_PER_PERSON:], timeout=int(lifetime_s))


def take_all(user_id):
    """The session store ids recorded for `user_id`, oldest first, and forget them."""
    key = _key(user_id)
    with _lock:
        known = _cache().get(key)
        _cache().delete(key)
    return [s for s in known if isinstance(s, str)] if isinstance(known, list) else []
