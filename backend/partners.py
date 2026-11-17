"""Partner tools: other projects' tools that work with the map (docs/PARTNERS.md).

A partner never gets a Discord id. It knows each person by a pairwise pseudonym, the subject:
base64url(HMAC-SHA256(map secret, "partner:" + partner key + ":" + Discord id)), first 22
characters. It is stable per person and partner, two partners can't link their subjects, and it
says nothing about the Discord account.
"""

import base64
import hashlib
import hmac
from typing import Dict, List

from backend import claims
from backend.database import get_connection, get_current_timestamp

# The map's secret for subjects; set by the app (PARTNER_SUBJECT_SECRET, or one kept in the data
# directory). Changing it changes every subject.
SUBJECT_KEY = None


def subject(partner_key: str, discord_id: str) -> str:
    if not SUBJECT_KEY:
        raise RuntimeError('partner subject key not set')
    mac = hmac.new(SUBJECT_KEY.encode('utf-8'),
                   f'partner:{partner_key}:{discord_id}'.encode('utf-8'), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).rstrip(b'=').decode('ascii')[:22]


def feed_claims(partner_key: str) -> List[Dict]:
    """The claims feed's entries for this partner (contract v1): owners and managers who share
    their nodes with partner tools, each with the person's subject for this partner."""
    return [{
        'publicKey': c['public_key'],
        'role': c['role'],
        'subject': subject(partner_key, c['discord_id']),
        'displayName': c['display_name'],
        'since': c['since'],
    } for c in claims.shared_claims()]


# Consent: a partner signs a person in only after they allowed it once (withdrawn on /account).

def has_consent(discord_id: str, partner_key: str) -> bool:
    conn = get_connection()
    try:
        return conn.execute(
            "SELECT 1 FROM partner_consents WHERE discord_id = ? AND partner_key = ?",
            (str(discord_id), partner_key),
        ).fetchone() is not None
    finally:
        conn.close()


def grant_consent(discord_id: str, partner_key: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO partner_consents (discord_id, partner_key, granted_at) VALUES (?, ?, ?)",
            (str(discord_id), partner_key, get_current_timestamp()),
        )
        conn.commit()
    finally:
        conn.close()


def withdraw_consent(discord_id: str, partner_key: str) -> bool:
    conn = get_connection()
    try:
        gone = conn.execute(
            "DELETE FROM partner_consents WHERE discord_id = ? AND partner_key = ?",
            (str(discord_id), partner_key),
        ).rowcount
        conn.commit()
        return gone == 1
    finally:
        conn.close()


def consents_of(discord_id: str) -> List[Dict]:
    """The partners this person allowed, oldest first: {'key', 'granted_at'}."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT partner_key, granted_at FROM partner_consents WHERE discord_id = ? ORDER BY granted_at, partner_key",
            (str(discord_id),),
        ).fetchall()
    finally:
        conn.close()
    return [{'key': r['partner_key'], 'granted_at': r['granted_at']} for r in rows]


def partner_user(partner_key: str, session_user: Dict) -> Dict:
    """The signed-in person as a partner sees them: the subject, the name they show (null when they
    hide it) and whether they are a member of the #BEmesh server. Never the Discord id."""
    shows = claims.get_settings(session_user['id'])['show_name']
    name = session_user.get('global_name') or session_user.get('username')
    return {
        'subject': subject(partner_key, session_user['id']),
        'displayName': name if shows else None,
        'isMember': bool(session_user.get('is_guild_member')),
    }
