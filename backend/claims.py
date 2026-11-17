"""Who looks after a node, and what may be said about them.

A person is their Discord id. Each node has at most one **owner** (the person who claimed it,
``belgian_nodes.discord_owner_id``) and any number of **managers**: people the owner invited with a
one-time link. Managers see the node under "My nodes" and may leave; they can't remove the owner,
hand the node on or invite others. Unclaiming a node ends its managers and open invitations.

Each person's choices on the account page: without a row in ``person_settings`` both are on, so
the map shows their name with their nodes (as it always did) and partner tools may learn which
nodes they own or manage (opt-out).
"""

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from backend.database import get_connection, get_current_timestamp
from backend.datetime_utils import format_utc_iso

DEFAULT_SETTINGS = {'show_name': True, 'share_partners': True}


def get_settings(discord_id: str) -> Dict[str, bool]:
    """The person's two choices, both on when they never changed them."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT show_name, share_partners FROM person_settings WHERE discord_id = ?",
            (str(discord_id),),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return dict(DEFAULT_SETTINGS)
    return {'show_name': bool(row['show_name']), 'share_partners': bool(row['share_partners'])}


def save_settings(discord_id: str, show_name: Optional[bool] = None,
                  share_partners: Optional[bool] = None) -> Dict[str, bool]:
    """Changes the choices that are given (the others stay); returns all of them as stored."""
    current = get_settings(discord_id)
    if show_name is not None:
        current['show_name'] = bool(show_name)
    if share_partners is not None:
        current['share_partners'] = bool(share_partners)
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO person_settings (discord_id, show_name, share_partners, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                show_name = excluded.show_name,
                share_partners = excluded.share_partners,
                updated_at = excluded.updated_at
            """,
            (str(discord_id), int(current['show_name']), int(current['share_partners']),
             get_current_timestamp()),
        )
        conn.commit()
    finally:
        conn.close()
    return current


# Managers and invitations

INVITE_TTL = timedelta(days=7)
# Open invitations per node at once: enough to invite a few people, not a store anyone can fill.
MAX_OPEN_INVITES = 10
_TOKEN = re.compile(r'^[A-Za-z0-9_-]{32,128}$')
_KEY = re.compile(r'^[0-9a-f]{64}$')


def normalize_key(public_key) -> Optional[str]:
    """A node's public key as stored (64 lower-case hex), or None when it isn't one."""
    if not isinstance(public_key, str):
        return None
    key = public_key.replace(' ', '').replace('-', '').lower()
    return key if _KEY.fullmatch(key) else None


def is_invite_token(token) -> bool:
    return isinstance(token, str) and bool(_TOKEN.fullmatch(token))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return format_utc_iso(dt)


def _owner_row(conn, public_key):
    return conn.execute(
        "SELECT public_key, adv_name, type, discord_owner_id, discord_owner_name, is_active "
        "FROM belgian_nodes WHERE public_key = ?",
        (public_key,),
    ).fetchone()


def _log(conn, public_key, discord_id, name, action, source='web'):
    conn.execute(
        """
        INSERT INTO node_claims
            (public_key, discord_owner_id, discord_owner_name, action, timestamp, source)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        """,
        (public_key, str(discord_id), name, action, source),
    )


def role_of(public_key: str, discord_id: str) -> Optional[str]:
    """'owner' or 'manager' of this active node, else None."""
    conn = get_connection()
    try:
        row = _owner_row(conn, public_key)
        if not row or not row['is_active']:
            return None
        if row['discord_owner_id'] and str(row['discord_owner_id']) == str(discord_id):
            return 'owner'
        managed = conn.execute(
            "SELECT 1 FROM node_managers WHERE public_key = ? AND discord_id = ?",
            (public_key, str(discord_id)),
        ).fetchone()
        return 'manager' if managed else None
    finally:
        conn.close()


def nodes_of(discord_id: str) -> List[Dict]:
    """The active nodes this person owns, then those they manage, each with its role."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT b.public_key, b.adv_name, b.type, b.adv_lat, b.adv_lon, 'owner' AS role, 0 AS o
            FROM belgian_nodes b
            WHERE b.discord_owner_id = ? AND b.is_active = 1
            UNION ALL
            SELECT b.public_key, b.adv_name, b.type, b.adv_lat, b.adv_lon, 'manager' AS role, 1 AS o
            FROM node_managers m JOIN belgian_nodes b ON b.public_key = m.public_key
            WHERE m.discord_id = ? AND b.is_active = 1
            ORDER BY o, adv_name
            """,
            (str(discord_id), str(discord_id)),
        ).fetchall()
    finally:
        conn.close()
    return [{'public_key': r['public_key'], 'name': r['adv_name'], 'type': r['type'],
             'lat': r['adv_lat'], 'lon': r['adv_lon'], 'role': r['role']} for r in rows]


def managers_of(public_key: str) -> List[Dict]:
    """The node's managers, oldest first: their row number and name (never their Discord id)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, display_name, added_at FROM node_managers WHERE public_key = ? ORDER BY id",
            (public_key,),
        ).fetchall()
    finally:
        conn.close()
    return [{'id': r['id'], 'name': r['display_name'], 'added_at': r['added_at']} for r in rows]


def create_invite(public_key: str, owner_id: str):
    """A new one-time invitation to manage the node, made by its owner: {'token', 'expires_at'}.
    None when `owner_id` doesn't own this active node; 'too_many' when it has MAX_OPEN_INVITES
    open ones. Expired and used invitations of the node are cleared first."""
    conn = get_connection()
    try:
        row = _owner_row(conn, public_key)
        if not row or not row['is_active'] or str(row['discord_owner_id'] or '') != str(owner_id):
            return None
        now = _iso(_now())
        conn.execute(
            "DELETE FROM manager_invites WHERE public_key = ? AND (used_at IS NOT NULL OR expires_at <= ?)",
            (public_key, now),
        )
        open_count = conn.execute(
            "SELECT COUNT(*) FROM manager_invites WHERE public_key = ?", (public_key,)
        ).fetchone()[0]
        if open_count >= MAX_OPEN_INVITES:
            conn.commit()
            return 'too_many'
        token = secrets.token_urlsafe(32)
        expires = _iso(_now() + INVITE_TTL)
        conn.execute(
            "INSERT INTO manager_invites (token_hash, public_key, created_by, expires_at) VALUES (?, ?, ?, ?)",
            (_token_hash(token), public_key, str(owner_id), expires),
        )
        conn.commit()
        return {'token': token, 'expires_at': expires}
    finally:
        conn.close()


def _open_invite(conn, token):
    """The invitation's row and its node's row when it still works, else (None, None): known, not
    used, not expired, its node active and still owned by the person who made it."""
    if not is_invite_token(token):
        return None, None
    invite = conn.execute(
        "SELECT * FROM manager_invites WHERE token_hash = ?", (_token_hash(token),)
    ).fetchone()
    if not invite or invite['used_at'] or invite['expires_at'] <= _iso(_now()):
        return None, None
    node = _owner_row(conn, invite['public_key'])
    if not node or not node['is_active'] or str(node['discord_owner_id'] or '') != str(invite['created_by']):
        return None, None
    return invite, node


def invite_info(token: str, discord_id: Optional[str] = None) -> Dict:
    """What an invitation link leads to, for the person opening it: {'state', 'public_key',
    'node_name'}. state is 'gone' (unknown, used, expired, or the node changed owner), 'own' (the
    owner opened their own link), 'already' (they manage it already) or 'ok'."""
    conn = get_connection()
    try:
        invite, node = _open_invite(conn, token)
        if not invite:
            return {'state': 'gone'}
        info = {'public_key': node['public_key'], 'node_name': node['adv_name']}
        if discord_id is not None and str(node['discord_owner_id']) == str(discord_id):
            return {**info, 'state': 'own'}
        if discord_id is not None and conn.execute(
                "SELECT 1 FROM node_managers WHERE public_key = ? AND discord_id = ?",
                (node['public_key'], str(discord_id))).fetchone():
            return {**info, 'state': 'already'}
        return {**info, 'state': 'ok'}
    finally:
        conn.close()


def accept_invite(token: str, discord_id: str, display_name: Optional[str]) -> Dict:
    """The person becomes a manager of the invitation's node and the invitation is used up.
    Returns invite_info's answer as it was ('ok' when they became manager); for 'own' and
    'already' the invitation stays open for the person it was meant for."""
    conn = get_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        invite, node = _open_invite(conn, token)
        if not invite:
            conn.rollback()
            return {'state': 'gone'}
        info = {'public_key': node['public_key'], 'node_name': node['adv_name']}
        if str(node['discord_owner_id']) == str(discord_id):
            conn.rollback()
            return {**info, 'state': 'own'}
        if conn.execute("SELECT 1 FROM node_managers WHERE public_key = ? AND discord_id = ?",
                        (node['public_key'], str(discord_id))).fetchone():
            conn.rollback()
            return {**info, 'state': 'already'}
        used = conn.execute(
            "UPDATE manager_invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
            (_iso(_now()), invite['token_hash']),
        )
        if used.rowcount != 1:
            conn.rollback()
            return {'state': 'gone'}
        conn.execute(
            "INSERT INTO node_managers (public_key, discord_id, display_name, added_at, added_by) "
            "VALUES (?, ?, ?, ?, ?)",
            (node['public_key'], str(discord_id), display_name, get_current_timestamp(), invite['created_by']),
        )
        _log(conn, node['public_key'], discord_id, display_name, 'manager_add')
        conn.commit()
        return {**info, 'state': 'ok'}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _remove(conn, public_key, where, args):
    rows = conn.execute(
        f"SELECT id, discord_id, display_name FROM node_managers WHERE public_key = ? AND {where}",
        (public_key, *args),
    ).fetchall()
    for r in rows:
        conn.execute("DELETE FROM node_managers WHERE id = ?", (r['id'],))
        _log(conn, public_key, r['discord_id'], r['display_name'], 'manager_remove')
    return len(rows)


def remove_manager(public_key: str, owner_id: str, manager_id) -> bool:
    """The owner removes one manager (by the row number the account page shows)."""
    if not isinstance(manager_id, int) or isinstance(manager_id, bool):
        return False
    conn = get_connection()
    try:
        row = _owner_row(conn, public_key)
        if not row or str(row['discord_owner_id'] or '') != str(owner_id):
            return False
        removed = _remove(conn, public_key, 'id = ?', (manager_id,))
        conn.commit()
        return removed == 1
    finally:
        conn.close()


def leave(public_key: str, discord_id: str) -> bool:
    """A manager stops managing the node."""
    conn = get_connection()
    try:
        removed = _remove(conn, public_key, 'discord_id = ?', (str(discord_id),))
        conn.commit()
        return removed == 1
    finally:
        conn.close()


def drop_managers(conn, public_key: str) -> None:
    """In the caller's transaction (an unclaim): the node's managers go, each logged as
    'manager_remove', and its open invitations are deleted."""
    _remove(conn, public_key, '1 = 1', ())
    conn.execute("DELETE FROM manager_invites WHERE public_key = ?", (public_key,))


# What partner tools may learn

def shared_claims() -> List[Dict]:
    """Every owner and manager of an active node who shares their nodes with partner tools:
    {'public_key', 'role', 'discord_id', 'display_name' (None when they hide their name), 'since'
    (ISO UTC; None for a claim older than the claim history)}, in a stable order."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT b.public_key, 'owner' AS role, b.discord_owner_id AS discord_id,
                   CASE WHEN COALESCE(ps.show_name, 1) = 1 THEN b.discord_owner_name END AS display_name,
                   (SELECT MAX(c.timestamp) FROM node_claims c
                    WHERE c.public_key = b.public_key AND c.action = 'claim'
                      AND c.discord_owner_id = b.discord_owner_id) AS since
            FROM belgian_nodes b
            LEFT JOIN person_settings ps ON ps.discord_id = b.discord_owner_id
            WHERE b.is_active = 1 AND b.discord_owner_id IS NOT NULL AND b.discord_owner_id != ''
              AND COALESCE(ps.share_partners, 1) = 1
            UNION ALL
            SELECT m.public_key, 'manager' AS role, m.discord_id,
                   CASE WHEN COALESCE(ps.show_name, 1) = 1 THEN m.display_name END AS display_name,
                   m.added_at AS since
            FROM node_managers m
            JOIN belgian_nodes b ON b.public_key = m.public_key AND b.is_active = 1
            LEFT JOIN person_settings ps ON ps.discord_id = m.discord_id
            WHERE COALESCE(ps.share_partners, 1) = 1
            ORDER BY 1, 2 DESC, 3
            """
        ).fetchall()
    finally:
        conn.close()
    return [{'public_key': r['public_key'], 'role': r['role'], 'discord_id': str(r['discord_id']),
             'display_name': r['display_name'], 'since': format_utc_iso(r['since']) if r['since'] else None}
            for r in rows]


def node_status(public_key: str, discord_id: str) -> Dict:
    """A node as one of our own tools may see it for the signed-in person: {'status'} with
    'not_on_map' (unknown or inactive), 'unclaimed', 'yours' (they own it), 'managed' (they manage
    it) or 'claimed' (someone else owns it; then 'owner_name' when that owner shows their name)."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT b.is_active, b.discord_owner_id, b.discord_owner_name, ps.show_name "
            "FROM belgian_nodes b LEFT JOIN person_settings ps ON ps.discord_id = b.discord_owner_id "
            "WHERE b.public_key = ?",
            (public_key,),
        ).fetchone()
        if not row or not row['is_active']:
            return {'status': 'not_on_map'}
        owner = str(row['discord_owner_id'] or '')
        if owner and owner == str(discord_id):
            return {'status': 'yours'}
        if conn.execute("SELECT 1 FROM node_managers WHERE public_key = ? AND discord_id = ?",
                        (public_key, str(discord_id))).fetchone():
            return {'status': 'managed'}
        if not owner:
            return {'status': 'unclaimed'}
        answer = {'status': 'claimed'}
        if row['show_name'] != 0 and row['discord_owner_name']:
            answer['owner_name'] = row['discord_owner_name']
        return answer
    finally:
        conn.close()


def shown_owner_id(public_key: str) -> Optional[str]:
    """The Discord id of the active node's owner when they show their name (for the popup's message
    link, to signed-in members only), else None."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT b.discord_owner_id, ps.show_name FROM belgian_nodes b "
            "LEFT JOIN person_settings ps ON ps.discord_id = b.discord_owner_id "
            "WHERE b.public_key = ? AND b.is_active = 1",
            (public_key,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not row['discord_owner_id'] or row['show_name'] == 0:
        return None
    return str(row['discord_owner_id'])
