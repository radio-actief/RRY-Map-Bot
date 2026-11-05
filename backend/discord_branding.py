"""Shared Radio-Actief branding for Discord embeds."""

from __future__ import annotations

from typing import Any, Dict

try:
    from config.config import BRAND_LOGO_URL, BRAND_NAME
except (ImportError, ModuleNotFoundError):
    import os

    _base = os.getenv("MAP_BASE_URL", "https://meshmap.radio-actief.be").rstrip("/")
    BRAND_NAME = os.getenv("BRAND_NAME", "Radio-Actief.be")
    BRAND_LOGO_URL = os.getenv("BRAND_LOGO_URL", f"{_base}/img/radio-actief-logo-128.png")


def apply_brand_to_embed(embed):
    embed.set_author(name=BRAND_NAME, icon_url=BRAND_LOGO_URL)
    return embed


def apply_brand_to_embed_dict(embed: Dict[str, Any]) -> Dict[str, Any]:
    embed["author"] = {"name": BRAND_NAME, "icon_url": BRAND_LOGO_URL}
    return embed
