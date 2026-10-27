"""Discord bot command handlers, run against fake interactions and a temporary DB."""

import ast
import asyncio
import itertools
import re
import sqlite3
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import discord
import pytest
from discord import app_commands

import backend.discord_bot as bot_mod

ROOT = Path(__file__).resolve().parent.parent
_ids = itertools.count(1000)


# ---------------------------------------------------------------- fakes

class FakeMessage:
    def __init__(self, embeds=None, content=None, view=None):
        self.id = next(_ids)
        self.embeds = list(embeds or [])
        self.content = content
        self.view = view
        self.edits = []

    async def edit(self, **kwargs):
        self.edits.append(kwargs)
        if kwargs.get("embed") is not None:
            self.embeds = [kwargs["embed"]]


class FakeResponse:
    def __init__(self):
        self.sent = []
        self.deferred = None
        self.edited = []
        self._done = False

    def is_done(self):
        return self._done

    async def send_message(self, content=None, **kwargs):
        self._done = True
        self.sent.append((content, kwargs))

    async def defer(self, **kwargs):
        self._done = True
        self.deferred = kwargs

    async def edit_message(self, **kwargs):
        self._done = True
        self.edited.append(kwargs)


class FakeFollowup:
    def __init__(self):
        self.sent = []

    async def send(self, content=None, **kwargs):
        self.sent.append((content, kwargs))
        embeds = [kwargs["embed"]] if kwargs.get("embed") is not None else []
        return FakeMessage(embeds, content, kwargs.get("view"))


class FakeInteraction:
    def __init__(self, user_id=111, name="alice", guild_id=999, member=True):
        self.id = next(_ids)
        self.user = MagicMock(spec=discord.Member if member else discord.User)
        self.user.id = user_id
        self.user.name = name
        self.user.mention = f"<@{user_id}>"
        self.guild_id = guild_id
        self.guild = None
        self.type = discord.InteractionType.application_command
        self.command = None
        self.response = FakeResponse()
        self.followup = FakeFollowup()
        self.original_edits = []

    async def edit_original_response(self, **kwargs):
        self.original_edits.append(kwargs)


def run(coro):
    return asyncio.run(coro)


def _insert(db_path, pk, name, *, city="Leuven", type_=2, active=1, owner=None, owner_name=None):
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO belgian_nodes (
            public_key, type, adv_name, adv_lat, adv_lon, city,
            last_advert, inserted_date, updated_date, params,
            link, source, is_active, created_at, discord_owner_id, discord_owner_name
        ) VALUES (?, ?, ?, 50.88, 4.70, ?, '2026-10-20T12:00:00Z', '2026-01-01T00:00:00Z',
                  '2026-10-20T12:00:00Z', '{"freq": 869.618, "sf": 8, "bw": 62.5, "cr": 8}',
                  'meshcore://x', 'app', ?, '2026-01-01 00:00:00', ?, ?)
        """,
        (pk, type_, name, city, active, owner, owner_name),
    )
    conn.commit()
    conn.close()


def _claims(db_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT public_key, discord_owner_id, action, source FROM node_claims ORDER BY id").fetchall()
    conn.close()
    return rows


def _owner(db_path, pk):
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT discord_owner_id FROM belgian_nodes WHERE public_key = ?", (pk,)).fetchone()
    conn.close()
    return row[0]


def _buttons(view):
    return [(item.label, item.url) for item in view.children]


@pytest.fixture
def db(temp_db, monkeypatch):
    monkeypatch.setattr(bot_mod, "DISCORD_GUILD_ID", None)
    _insert(temp_db, "a1" * 32, "Leuven Rep", city="Leuven")
    _insert(temp_db, "a2" * 32, "Leuven Two", city="Leuven", type_=1)
    _insert(temp_db, "a3" * 32, "Gent Rep", city="Gent", owner="111", owner_name="alice")
    _insert(temp_db, "a4" * 32, "Old Alice", city="Gent", active=0, owner="111", owner_name="alice")
    _insert(temp_db, "a5" * 32, "Bob Rep", city="Brugge", owner="222", owner_name="bob")
    _insert(temp_db, "a6" * 32, "Dead Node", city="Brugge", active=0)
    return temp_db


# ---------------------------------------------------------------- I1 emoji

SHORTCODE = re.compile(r":([a-z_]+):")


def _string_literals(path):
    """String constants in a module, docstrings left out."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            yield node.value


def test_user_facing_strings_have_no_unicode_shortcodes():
    """Discord shows :shortcodes: sent by a bot as plain text; only server emojis may use them."""
    allowed = set(bot_mod.SERVER_EMOJI_NAMES)
    texts = []
    for name in ("discord_bot.py", "discord_formatting.py", "discord_notifications.py"):
        texts.extend(_string_literals(ROOT / "backend" / name))
    texts.append((ROOT / "DISCORDBOT_INSTRUCTIONS.md").read_text(encoding="utf-8"))
    found = {code for text in texts for code in SHORTCODE.findall(text)} - allowed
    assert found == set()


def test_unresolved_server_emojis_are_dropped():
    assert bot_mod.resolve_custom_emojis_in_text("a :meshcore: b", None) == "a b"
    guild = SimpleNamespace(emojis=[SimpleNamespace(name="meshcore", id=5, animated=False)])
    assert bot_mod.resolve_custom_emojis_in_text("a :meshcore: b", guild) == "a <:meshcore:5> b"


def test_stats_title_uses_real_emoji():
    embed = bot_mod.build_stats_embed({}, {}, None)
    assert embed.title == "🇧🇪 #BEmesh MeshCore statistics 📊"


# ---------------------------------------------------------------- I2 errors

def test_command_errors_get_one_short_ephemeral_answer_and_a_log_row(db, monkeypatch, capsys):
    def broken(*a, **k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(bot_mod, "get_user_nodes", broken)
    inter = FakeInteraction()
    inter.command = bot_mod.mynodes
    with pytest.raises(sqlite3.OperationalError) as exc:
        run(bot_mod.mynodes.callback(inter))
    error = app_commands.CommandInvokeError(bot_mod.mynodes, exc.value)
    run(bot_mod.on_app_command_error(inter, error))

    assert inter.followup.sent == [(bot_mod.GENERIC_ERROR, {"ephemeral": True})]
    assert "database is locked" in capsys.readouterr().err  # traceback logged
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT command, user_id, ok FROM command_log").fetchall() == [("mynodes", "111", 0)]
    conn.close()


def test_error_before_any_answer_uses_the_initial_response(db):
    inter = FakeInteraction()
    run(bot_mod.send_error_reply(inter))
    assert inter.response.sent == [(bot_mod.GENERIC_ERROR, {"ephemeral": True})]


# ---------------------------------------------------------------- I6 command log

def test_every_command_is_logged_with_duration_and_no_arguments(db):
    inter = FakeInteraction(user_id=555)
    assert run(bot_mod.bot.tree.interaction_check(inter))
    run(bot_mod.on_app_command_completion(inter, bot_mod.node_group.get_command("claim")))
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT command, user_id, ok, duration_ms FROM command_log").fetchall()
    conn.close()
    assert rows[0][:3] == ("node claim", "555", 1)
    assert isinstance(rows[0][3], int) and rows[0][3] >= 0


# ---------------------------------------------------------------- I3 search

def test_search_with_no_criteria_is_rejected_privately(db):
    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter))
    assert inter.response.sent[0][1] == {"ephemeral": True}
    assert inter.followup.sent == []


def test_search_reports_the_real_total_in_one_public_embed(db):
    for i in range(60):
        _insert(db, f"{i:02x}" * 32, f"Mass Rep {i:02d} with a rather long name", city="Mechelen")
    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, query="mass"))

    assert inter.response.deferred == {"thinking": True}  # public
    assert len(inter.followup.sent) == 1
    _, kwargs = inter.followup.sent[0]
    embed = kwargs["embed"]
    shown = len([line for line in embed.description.split("\n") if "?node=" in line])
    assert f"Showing **{shown}** of **60** nodes" in embed.description
    assert f"+{60 - shown} more — refine your search or [open the map](" in embed.description
    assert len(embed.description) <= 4096
    assert "ephemeral" not in kwargs
    assert _buttons(kwargs["view"]) == [("Open map", "https://meshmap.radio-actief.be"), ("My nodes", None)]


def test_search_lists_compact_lines_with_short_links(db):
    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, query="rep"))
    embed = inter.followup.sent[0][1]["embed"]
    assert "Found **3** nodes" in embed.description
    assert "📡 [Leuven Rep](https://meshmap.radio-actief.be/?node=a1a1a1a1a1a1) · Leuven" in embed.description
    assert "seen <t:" in embed.description
    assert "`" not in embed.footer.text if embed.footer.text else True


def test_search_single_hit_is_the_slim_detail_view(db):
    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, query="Leuven Two"))
    _, kwargs = inter.followup.sent[0]
    embed = kwargs["embed"]
    assert embed.title == "📱 Node details"
    assert "found by" not in embed.description
    assert [f.name for f in embed.fields] == ["Public key", "Type", "Town", "Owner", "Frequency", "First seen", "Last seen"]
    assert _buttons(kwargs["view"]) == [
        ("Open on map", "https://meshmap.radio-actief.be/?node=a2a2a2a2a2a2"),
        ("My nodes", None),
    ]


def test_search_offers_belgian_presets_and_still_accepts_other_preset_names(db):
    choices = [c.name for c in bot_mod.frequency_preset_choices]
    assert choices == ["EU/UK (Narrow)", "EU/UK (Long Range)", "EU/UK (Medium Range)", "EU 433MHz (Long Range)"]

    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, frequency_preset="eu/uk (narrow)"))
    assert "Found **4** nodes" in inter.followup.sent[0][1]["embed"].description

    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, frequency_preset="Australia"))
    assert "No nodes found" in inter.followup.sent[0][1]["embed"].description

    inter = FakeInteraction()
    run(bot_mod.search_nodes.callback(inter, frequency_preset="Mars"))
    assert inter.response.sent[0] == ("Unknown frequency preset. Pick one from the list.", {"ephemeral": True})


def test_search_runs_db_work_off_the_event_loop(db, monkeypatch):
    threads = []
    real = bot_mod.run_search

    def spy(filters):
        threads.append(threading.current_thread())
        return real(filters)

    monkeypatch.setattr(bot_mod, "run_search", spy)
    run(bot_mod.search_nodes.callback(FakeInteraction(), query="rep"))
    assert threads and threads[0] is not threading.main_thread()


# ---------------------------------------------------------------- I5 guild only

def test_commands_are_guild_only_and_digest_is_hidden():
    tree = bot_mod.bot.tree
    for command in tree.get_commands():
        assert command.to_dict(tree)["dm_permission"] is False, command.name
    digest = bot_mod.digest_group.to_dict(tree)
    assert int(digest["default_member_permissions"]) == discord.Permissions(manage_guild=True).value


def test_claim_outside_the_home_server_is_refused(db, monkeypatch):
    monkeypatch.setattr(bot_mod, "DISCORD_GUILD_ID", "999")
    for inter in (FakeInteraction(guild_id=None), FakeInteraction(guild_id=123), FakeInteraction(member=False)):
        run(bot_mod.node_claim.callback(inter, "a1" * 32))
        assert inter.response.sent == [(bot_mod.NOT_IN_SERVER, {"ephemeral": True})]
    assert _owner(db, "a1" * 32) is None


# ---------------------------------------------------------------- claim

def test_claim_success_is_private_then_announced_with_a_map_button(db, monkeypatch):
    monkeypatch.setattr(bot_mod, "DISCORD_GUILD_ID", "999")
    inter = FakeInteraction(user_id=333, name="carol")
    run(bot_mod.node_claim.callback(inter, "a1" * 32))

    assert inter.response.deferred == {"ephemeral": True, "thinking": True}
    assert "Claimed" in inter.original_edits[0]["embed"].description
    _, kwargs = inter.followup.sent[0]
    assert "ephemeral" not in kwargs  # the announcement is public
    lines = kwargs["embed"].description.split("\n")
    assert lines[0] == "<@333> claimed this node." and len(lines) == 2
    assert _buttons(kwargs["view"])[0] == ("Open on map", "https://meshmap.radio-actief.be/?node=a1a1a1a1a1a1")
    assert _claims(db) == [("a1" * 32, "333", "claim", "bot")]


@pytest.mark.parametrize("user_id,query,expected", [
    (111, "Gent Rep", "This node is already yours:"),
    (333, "Bob Rep", "This node is already claimed by <@222>:"),
    (333, "Dead Node", "This node is inactive, so it can't be claimed:"),
    (333, "nothing-like-this", "No node matches `nothing-like-this`."),
])
def test_claim_says_why_a_node_cannot_be_claimed(db, user_id, query, expected):
    inter = FakeInteraction(user_id=user_id)
    run(bot_mod.node_claim.callback(inter, query))
    assert inter.followup.sent[0][1]["embed"].description.startswith(expected)
    assert _claims(db) == []


def test_claim_with_several_matches_lists_them_compactly(db):
    inter = FakeInteraction(user_id=333)
    run(bot_mod.node_claim.callback(inter, "leuven"))
    text = inter.followup.sent[0][1]["embed"].description
    assert text.startswith("**2** unclaimed nodes match `leuven`.")
    assert "[Leuven Rep](https://meshmap.radio-actief.be/?node=a1a1a1a1a1a1)" in text


def test_claim_lost_race_explains_instead_of_a_db_error(db, monkeypatch):
    monkeypatch.setattr(bot_mod, "update_ownership", lambda *a, **k: False)

    def claimed_meanwhile(query, user_id):
        return "This node is already claimed by <@9>:\nline"

    monkeypatch.setattr(bot_mod, "explain_unclaimable", claimed_meanwhile)
    inter = FakeInteraction(user_id=333)
    run(bot_mod.node_claim.callback(inter, "a1" * 32))
    assert inter.followup.sent[0][1]["embed"].description.startswith("This node is already claimed by <@9>")


# ---------------------------------------------------------------- I4 unclaim

def test_unclaim_only_looks_at_your_own_nodes(db):
    inter = FakeInteraction(user_id=111)
    run(bot_mod.node_unclaim.callback(inter, "rep"))  # Gent Rep (mine) and Bob Rep (not mine)
    _, kwargs = inter.followup.sent[0]
    assert kwargs["embed"].title == "⚠️ Unclaim this node?"
    assert "Gent Rep" in kwargs["embed"].description
    assert isinstance(kwargs["view"], bot_mod.UnclaimConfirmView)

    inter = FakeInteraction(user_id=111)
    run(bot_mod.node_unclaim.callback(inter, "bob"))
    assert inter.followup.sent[0][1]["embed"].description.startswith("You don't own a node matching `bob`.")


def test_unclaim_confirm_flow(db):
    async def flow():
        inter = FakeInteraction(user_id=111)
        await bot_mod.node_unclaim.callback(inter, "Gent Rep")
        view = inter.followup.sent[0][1]["view"]
        assert view.message is not None  # M1: the prompt can be edited on timeout

        click = FakeInteraction(user_id=111)
        await view.confirm_unclaim.callback(click)
        assert "Unclaimed" in click.original_edits[0]["embed"].description
        assert click.original_edits[0]["view"] is None
        _, kwargs = click.followup.sent[0]
        assert kwargs["embed"].description.startswith("<@111> released this node.")
        assert _buttons(kwargs["view"]) == [("Open on map", "https://meshmap.radio-actief.be/?node=a3a3a3a3a3a3")]

        second = FakeInteraction(user_id=111)
        await view.confirm_unclaim.callback(second)
        assert second.response.deferred == {}  # acknowledged, no "interaction failed"

    run(flow())
    assert _owner(db, "a3" * 32) is None
    assert _claims(db) == [("a3" * 32, "111", "unclaim", "bot")]


def test_unclaim_prompt_shows_the_timeout(db):
    async def flow():
        view = bot_mod.UnclaimConfirmView({"public_key": "a3" * 32}, "111")
        view.message = FakeMessage([bot_mod.notice_embed("Unclaim?")])
        await view.on_timeout()
        return view

    view = run(flow())
    assert "No answer in time" in view.message.edits[0]["embed"].description
    assert all(item.disabled for item in view.children)


# ---------------------------------------------------------------- mynodes

def test_mynodes_is_one_private_embed_with_sections(db):
    inter = FakeInteraction(user_id=111)
    run(bot_mod.mynodes.callback(inter))
    assert inter.response.deferred == {"ephemeral": True, "thinking": True}
    content, kwargs = inter.followup.sent[0]
    embed = kwargs["embed"]
    assert kwargs["ephemeral"] is True
    assert embed.title == "Your nodes (2)"
    assert "**Active (1)**" in embed.description and "**Inactive (1)**" in embed.description
    assert "<@111>" not in embed.description
    assert embed.footer.text == "Release a node with /node unclaim."
    assert _buttons(kwargs["view"]) == [("Open map", "https://meshmap.radio-actief.be")]


def test_my_nodes_button_runs_the_same_code_privately(db):
    async def click():
        button = bot_mod.MyNodesButton()
        inter = FakeInteraction(user_id=222)
        inter.type = discord.InteractionType.component
        await button.callback(inter)
        return inter

    inter = run(click())
    assert inter.followup.sent[0][1]["embed"].title == "Your nodes (1)"
    assert inter.followup.sent[0][1]["ephemeral"] is True
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT command, ok FROM command_log").fetchall() == [("mynodes button", 1)]
    conn.close()


# ---------------------------------------------------------------- stats / digest

def test_stats_uses_map_base_url_and_buttons(db, monkeypatch):
    import backend.discord_formatting as fmt

    monkeypatch.setattr(fmt, "MAP_BASE_URL", "https://test.example")
    inter = FakeInteraction()
    run(bot_mod.stats.callback(inter))
    _, kwargs = inter.followup.sent[0]
    embed = kwargs["embed"]
    data = embed.to_dict()
    data.pop("author")  # brand logo, not a map link
    text = str(data)
    assert "meshmap.radio-actief.be" not in text and "https://test.example" in text
    assert "inserted\\\\_date" not in text and "Source type **" in [f.name for f in embed.fields]
    assert _buttons(kwargs["view"]) == [
        ("Open map", "https://test.example"),
        ("Full statistics", "https://test.example/stats"),
    ]


def test_digest_run_hides_internals(db, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("secret path /app/data")

    monkeypatch.setattr(bot_mod, "post_daily_digest", boom)
    inter = FakeInteraction()
    inter.user.guild_permissions = discord.Permissions(manage_guild=True)
    inter.command = bot_mod.digest_group.get_command("run")
    with pytest.raises(RuntimeError) as exc:
        run(bot_mod.digest_run.callback(inter))
    run(bot_mod.on_app_command_error(inter, app_commands.CommandInvokeError(inter.command, exc.value)))
    assert inter.followup.sent == [(bot_mod.GENERIC_ERROR, {"ephemeral": True})]


# ---------------------------------------------------------------- M13 intents

def test_bot_does_not_ask_for_message_content():
    assert bot_mod.bot.intents.message_content is False
    assert not hasattr(bot_mod.bot, "command_prefix")


# ---------------------------------------------------------------- autocomplete

def test_autocomplete_suggestions(db):
    claim = run(bot_mod.claim_query_autocomplete(FakeInteraction(user_id=333), "leu"))
    assert [c.value for c in claim] == ["a1" * 32, "a2" * 32]
    assert claim[0].name == "📡 Leuven Rep · Leuven · A1A1A1"

    unclaim = run(bot_mod.unclaim_query_autocomplete(FakeInteraction(user_id=111), ""))
    assert [c.value for c in unclaim] == ["a3" * 32, "a4" * 32]
    assert unclaim[1].name.endswith("· inactive")

    cities = run(bot_mod.search_city_autocomplete(FakeInteraction(), "l"))
    assert [c.value for c in cities] == ["Leuven"]


# ---------------------------------------------------------------- M5 instructions post

class FakeChannel:
    def __init__(self, messages=(), pinned=()):
        self.messages = {m.id: m for m in messages}
        self.pinned = list(pinned)
        self.posted = []
        self.guild = None

    async def fetch_message(self, message_id):
        if message_id in self.messages:
            return self.messages[message_id]
        raise discord.NotFound(MagicMock(status=404), "unknown message")

    def pins(self):
        async def gen():
            for m in self.pinned:
                yield m
        return gen()

    def history(self, limit=50):
        async def gen():
            for m in list(self.messages.values())[::-1][:limit]:
                yield m
        return gen()

    async def send(self, embed=None, **kwargs):
        message = FakeMessage([embed])
        message.author = SimpleNamespace(id=1)
        self.messages[message.id] = message
        self.posted.append(message)
        return message


def _fake_bot(monkeypatch, channel):
    monkeypatch.setattr(bot_mod, "bot", SimpleNamespace(get_channel=lambda cid: channel, user=SimpleNamespace(id=1)))
    monkeypatch.setattr(bot_mod, "STARTUP_CHANNEL_ID", "42")
    monkeypatch.setattr(bot_mod, "STARTUP_MESSAGE_ID", None)


def test_instructions_post_is_posted_once_then_edited(db, monkeypatch):
    channel = FakeChannel()
    _fake_bot(monkeypatch, channel)
    run(bot_mod.update_bot_instructions_post())
    run(bot_mod.update_bot_instructions_post())
    assert len(channel.posted) == 1
    assert len(channel.posted[0].edits) == 1


def test_instructions_post_is_found_by_the_bots_own_pinned_post(db, monkeypatch):
    mine = FakeMessage([discord.Embed(title="📡 Radio-Actieve Bot - MeshCore Node Beheer")])
    mine.author = SimpleNamespace(id=1)
    channel = FakeChannel(pinned=[mine])
    _fake_bot(monkeypatch, channel)
    run(bot_mod.update_bot_instructions_post())
    assert channel.posted == [] and len(mine.edits) == 1


def test_instructions_text_is_current():
    text = bot_mod.render_instructions((ROOT / "DISCORDBOT_INSTRUCTIONS.md").read_text(encoding="utf-8"))
    assert "{MAP_URL}" not in text and "https://meshmap.radio-actief.be" in text
    for command in ("/search", "/mynodes", "/node claim", "/node unclaim", "/stats"):
        assert command in text
    assert "via de bot doet" not in text  # no edit command exists
    assert "#BEMesh" not in text and "BEMesh Map" not in text
