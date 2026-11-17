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
