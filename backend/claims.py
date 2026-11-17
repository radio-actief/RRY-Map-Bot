"""Who may be named with a node, and how: each person's choices on the account page.

A person is their Discord id. Without a row in ``person_settings`` both choices are on: the map
shows their name with their nodes (as it always did), and partner tools may learn which nodes they
own or manage (the owner's decision: opt-out).
"""

from typing import Dict, Optional

from backend.database import get_connection, get_current_timestamp

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
