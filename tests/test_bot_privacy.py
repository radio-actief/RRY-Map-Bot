"""The two privacy choices in the Discord bot: what its messages say about a node's owner or
managers, /privacy, and managers by invitation from Discord (/node invite-manager, /node managers).

Nodes: Gent Rep and Old Alice belong to 111 (alice), Bob Rep to 222 (bob), Hid Rep to 555 (hugo),
who switched "Show my name with my nodes" off."""

import re
import sqlite3
from datetime import datetime, timedelta, timezone

import discord
import pytest

import backend.claims as claims
import backend.discord_bot as bot_mod
import backend.discord_formatting as fmt
import backend.discord_queries as dq
from test_discord_bot import FakeInteraction, FakeMessage, _claims, _insert, _owner, db, run  # noqa: F401

HID = "b7" * 32
HUGO = "555"


class Channel:
    """A channel the bot can post in (or not)."""

    def __init__(self, allowed=True):
        self.sent = []
        self.allowed = allowed

    async def send(self, content=None, **kwargs):
        if not self.allowed:
            raise discord.HTTPException(type("R", (), {"status": 403, "reason": "Forbidden"})(), "no")
        self.sent.append((content, kwargs))
        return FakeMessage([kwargs["embed"]] if kwargs.get("embed") is not None else [])


def interaction(user_id=111, name="alice", **kw):
    inter = FakeInteraction(user_id=user_id, name=name, **kw)
    inter.channel = Channel()
    return inter


@pytest.fixture
def hidden(db):
    _insert(db, HID, "Hid Rep", city="Namur", owner=HUGO, owner_name="hugo")
    claims.save_settings(HUGO, show_name=False)
    return db


def _text(embed):
    return "\n".join([embed.title or "", embed.description or ""]
                     + [f"{f.name}\n{f.value}" for f in embed.fields]
                     + [embed.footer.text or ""])


def _names_hugo(text):
    return HUGO in text or "hugo" in text.lower()


def _add_manager(db_path, pk, discord_id, name):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO node_managers (public_key, discord_id, display_name, added_at, added_by) "
        "VALUES (?, ?, ?, '2026-11-01T00:00:00Z', '111')",
        (pk, discord_id, name),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------- the node as the bot may show it

def test_hide_owners_strips_the_person_and_keeps_the_claim(hidden):
    rows = [dq.get_node_by_key(HID), dq.get_node_by_key("a5" * 32), dq.get_node_by_key("a1" * 32)]
    hid, bob, free = claims.hide_owners(rows)
    assert hid["discord_owner_id"] is None and hid["discord_owner_name"] is None and hid["owner_hidden"] is True
    assert bob["discord_owner_id"] == "222" and not bob.get("owner_hidden")
    assert free["discord_owner_id"] is None and not free.get("owner_hidden")
    assert rows[0]["discord_owner_id"] == HUGO  # the rows given are left as they were
    # The person themself still sees their own node in full.
    assert claims.hide_owners(rows, viewer_id=HUGO)[0]["discord_owner_id"] == HUGO


def test_lines_and_details_say_claimed_without_a_name(hidden):
    hid = claims.hide_owners([dq.get_node_by_key(HID)])[0]
    bob = claims.hide_owners([dq.get_node_by_key("a5" * 32)])[0]

    assert fmt.format_digest_node_line(bob).endswith("· <@222>")
    line = fmt.format_digest_node_line(hid)
    assert line.endswith("· claimed") and not _names_hugo(line)

    assert fmt.format_node_line(bob).split(" · seen ")[0].endswith("<@222>")
    line = fmt.format_node_line(hid)
    assert " · claimed · seen " in line and not _names_hugo(line)
    assert "claimed" not in fmt.format_node_line(hid, owner=False)

    assert fmt.format_node_compact(bob).endswith("- <@222>")
    assert fmt.format_node_compact(hid).endswith("- Claimed")

    owner = {f.name: f.value for f in bot_mod.format_full_node_details(dict(hid)).fields}["Owner"]
    assert owner == "Claimed"
    owner = {f.name: f.value for f in bot_mod.format_full_node_details(dict(bob)).fields}["Owner"]
    assert owner == "<@222>"
    assert not _names_hugo(_text(bot_mod.format_full_node_details(dict(hid))))


def test_claim_and_unclaim_announcements_without_a_person():
    node = {"public_key": "ab" * 32, "adv_name": "N", "type": 2, "city": "Gent"}
    assert fmt.build_claim_embed_dict(node, None)["description"].startswith("A member claimed this node.\n")
    assert fmt.build_claim_embed_dict(node, None, via_web=True)["description"].startswith(
        "A member claimed this node on the map.\n")
    assert fmt.build_unclaim_embed_dict(node, None)["description"].startswith("A member unclaimed this node.\n")
    assert fmt.build_unclaim_embed_dict(node, None, via_web=True)["description"].startswith(
        "A member unclaimed this node on the map.\n")
    assert "<@" not in fmt.build_claim_embed_dict(node, None)["description"]


# ---------------------------------------------------------------- /search

def test_search_shows_a_hidden_owner_as_claimed(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, query="rep"))
    text = inter.followup.sent[0][1]["embed"].description
    assert "Found **4** nodes" in text
    hid_line = next(line for line in text.split("\n") if "Hid Rep" in line)
    assert " · claimed · seen " in hid_line
    assert not _names_hugo(text) and "<@222>" in text


def test_search_single_hit_of_a_hidden_owner(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, query="Hid Rep"))
    embed = inter.followup.sent[0][1]["embed"]
    assert {f.name: f.value for f in embed.fields}["Owner"] == "Claimed"
    assert not _names_hugo(_text(embed))


def test_search_by_owner_name_finds_only_people_who_show_their_name(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, query="hugo"))
    assert "No nodes found" in inter.followup.sent[0][1]["embed"].description
    assert dq.count_nodes_substring(query="hugo") == 0

    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, query="bob"))
    assert "Bob Rep" in inter.followup.sent[0][1]["embed"].description

    # Not even for the person themself: a /search by text is answered in the channel.
    inter = interaction(user_id=int(HUGO), name="hugo")
    run(bot_mod.search_nodes.callback(inter, query="hugo"))
    assert inter.response.deferred == {"thinking": True}
    assert "No nodes found" in inter.followup.sent[0][1]["embed"].description


def test_search_by_owner_does_not_return_a_hidden_persons_nodes(hidden):
    hugo = discord.Object(id=int(HUGO))
    hugo.mention = f"<@{HUGO}>"
    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, owner=hugo))
    assert inter.response.deferred == {"thinking": True}
    assert "No nodes found" in inter.followup.sent[0][1]["embed"].description
    assert dq.count_nodes_substring(owner_id=HUGO) == 0
    assert dq.query_nodes_substring(query=HID, owner_id=HUGO) == []  # nor by the full key

    bob = discord.Object(id=222)
    bob.mention = "<@222>"
    inter = interaction(user_id=333)
    run(bot_mod.search_nodes.callback(inter, owner=bob))
    assert "Bob Rep" in _text(inter.followup.sent[0][1]["embed"])


def test_search_by_owner_for_yourself_is_private_when_you_hide_your_name(hidden):
    hugo = discord.Object(id=int(HUGO))
    hugo.mention = f"<@{HUGO}>"
    inter = interaction(user_id=int(HUGO), name="hugo")
    run(bot_mod.search_nodes.callback(inter, owner=hugo))
    assert inter.response.deferred == {"ephemeral": True, "thinking": True}
    _, kwargs = inter.followup.sent[0]
    assert kwargs["ephemeral"] is True
    assert "Hid Rep" in _text(kwargs["embed"])
    assert inter.channel.sent == []


def test_search_relevance_does_not_use_a_hidden_name(hidden):
    # "hug" is in Hid Rep's hidden owner name and in the name of another node only.
    _insert(hidden, "c1" * 32, "Hugs Rep", city="Namur")
    assert [n["adv_name"] for n in dq.query_nodes_substring(query="hug")] == ["Hugs Rep"]


# ---------------------------------------------------------------- claim and unclaim

def test_claim_says_claimed_without_naming_a_hidden_owner(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.node_claim.callback(inter, "Hid Rep"))
    text = inter.followup.sent[0][1]["embed"].description
    assert text.startswith("This node is already claimed:\n")
    assert not _names_hugo(text)

    inter = interaction(user_id=int(HUGO), name="hugo")
    run(bot_mod.node_claim.callback(inter, "Hid Rep"))
    assert inter.followup.sent[0][1]["embed"].description.startswith("This node is already yours:")


def test_claim_by_someone_who_hides_their_name_is_announced_without_them(hidden):
    async def flow():
        inter = interaction(user_id=int(HUGO), name="hugo")
        await bot_mod.node_claim.callback(inter, "a1" * 32)
        prompt = inter.followup.sent[0][1]["embed"].description
        assert "without your name" in prompt and "shown as its owner" not in prompt
        click = interaction(user_id=int(HUGO), name="hugo")
        await inter.followup.sent[0][1]["view"].confirm_claim.callback(click)
        return click

    click = run(flow())
    assert _owner(hidden, "a1" * 32) == HUGO
    # Not as a follow-up of the person's command: a plain message of the bot in the channel.
    assert click.followup.sent == []
    _, kwargs = click.channel.sent[0]
    assert kwargs["embed"].description.split("\n")[0] == "A member claimed this node."
    assert not _names_hugo(_text(kwargs["embed"]))
    assert "doesn't name you" in click.original_edits[0]["embed"].description


def test_claim_prompt_for_someone_who_shows_their_name_is_unchanged(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.node_claim.callback(inter, "a1" * 32))
    assert "After this, you are shown as its owner on the map." in inter.followup.sent[0][1]["embed"].description


def test_unclaim_by_someone_who_hides_their_name_is_announced_without_them(hidden):
    async def flow():
        inter = interaction(user_id=int(HUGO), name="hugo")
        await bot_mod.node_unclaim.callback(inter, "Hid Rep")
        click = interaction(user_id=int(HUGO), name="hugo")
        await inter.followup.sent[0][1]["view"].confirm_unclaim.callback(click)
        return click

    click = run(flow())
    assert _owner(hidden, HID) is None
    assert click.followup.sent == []
    _, kwargs = click.channel.sent[0]
    assert kwargs["embed"].description.split("\n")[0] == "A member unclaimed this node."
    assert not _names_hugo(_text(kwargs["embed"]))


def test_hidden_claim_where_the_bot_cannot_post_announces_nothing(hidden):
    async def flow():
        inter = interaction(user_id=int(HUGO), name="hugo")
        await bot_mod.node_claim.callback(inter, "a1" * 32)
        click = interaction(user_id=int(HUGO), name="hugo")
        click.channel = Channel(allowed=False)
        await inter.followup.sent[0][1]["view"].confirm_claim.callback(click)
        return click

    click = run(flow())
    assert _owner(hidden, "a1" * 32) == HUGO
    assert click.followup.sent == [] and click.channel.sent == []
    assert "Nothing was announced" in click.original_edits[0]["embed"].description


def test_web_claim_notifications_follow_the_choice(hidden, monkeypatch):
    import backend.discord_notifications as dn

    sent = []
    monkeypatch.setattr(dn, "_send_in_background", lambda embed, components: sent.append(embed))
    node = dq.get_node_by_key("a1" * 32)
    dn.notify_node_claimed(node, HUGO, "hugo")
    dn.notify_node_unclaimed(node, HUGO, "hugo")
    dn.notify_node_claimed(node, "222", "bob")
    assert sent[0]["description"].startswith("A member claimed this node on the map.")
    assert sent[1]["description"].startswith("A member unclaimed this node on the map.")
    assert not _names_hugo(str(sent[0])) and not _names_hugo(str(sent[1]))
    assert sent[2]["description"].startswith("<@222> claimed this node on the map.")


def test_web_claim_notification_hides_the_person_when_the_choice_cannot_be_read(monkeypatch):
    import backend.discord_notifications as dn

    def broken(discord_id):
        raise sqlite3.OperationalError("no such table")

    sent = []
    monkeypatch.setattr(dn.claims, "get_settings", broken)
    monkeypatch.setattr(dn, "_send_in_background", lambda embed, components: sent.append(embed))
    dn.notify_node_claimed({"public_key": "ab" * 32, "adv_name": "N", "type": 2}, "42", "x")
    assert sent[0]["description"].startswith("A member claimed this node on the map.")


# ---------------------------------------------------------------- digest and sync message

def test_digest_lists_a_hidden_owners_node_as_claimed(hidden):
    import backend.daily_digest as dd
    from backend.database import get_connection

    conn = get_connection()
    try:
        nodes = dd._get_node_details_by_keys([HID, "a5" * 32], conn)
    finally:
        conn.close()
    text = dd.render_node_list(nodes, len(nodes))
    assert "<@222>" in text and not _names_hugo(text)
    assert next(line for line in text.split("\n") if "Hid Rep" in line).endswith("· claimed")


def test_sync_message_lists_a_hidden_owners_node_as_claimed(hidden):
    import backend.sync_belgian_nodes as sync
    from backend.database import get_connection

    conn = get_connection()
    try:
        nodes = sync.get_node_details_by_keys([HID, "a5" * 32], conn)
    finally:
        conn.close()
    lines = sorted(fmt.format_node_compact(n) for n in nodes)
    assert any(line.endswith("- <@222>") for line in lines)
    assert any("Hid Rep" in line and line.endswith("- Claimed") for line in lines)
    assert not _names_hugo("\n".join(lines))


def test_stats_and_autocomplete_never_name_an_owner(hidden):
    inter = interaction(user_id=333)
    run(bot_mod.stats.callback(inter))
    text = _text(inter.followup.sent[0][1]["embed"])
    assert "<@" not in text and not _names_hugo(text) and "bob" not in text

    for current in ("", "hugo", "bob", "rep"):
        choices = run(bot_mod.claim_query_autocomplete(interaction(user_id=333), current))
        assert all(not _names_hugo(c.name) and "bob" not in c.name.lower() for c in choices)
    assert run(bot_mod.claim_query_autocomplete(interaction(user_id=333), "hugo")) == []


def test_my_nodes_still_lists_everything_for_someone_who_hides_their_name(hidden):
    inter = interaction(user_id=int(HUGO), name="hugo")
    run(bot_mod.mynodes.callback(inter))
    _, kwargs = inter.followup.sent[0]
    assert kwargs["ephemeral"] is True and "Hid Rep" in kwargs["embed"].description


# ---------------------------------------------------------------- /privacy

SHOW = "Show my name with my nodes"
SHOW_OFF = "Off: the map and partner tools show your nodes as claimed, without your name."
SHARE = "Share my nodes with partner tools"
SHARE_OFF = ("Off: partner tools don't see which nodes you own or manage. "
             "They never get your Discord account.")


def test_privacy_wording_is_the_account_pages():
    import json
    from test_discord_bot import ROOT

    page = json.loads((ROOT / "src/shared/i18n/account.en.json").read_text(encoding="utf-8"))
    assert bot_mod.PRIVACY_CHOICES == (
        ("show_name", page["account.showName"], page["account.showName.hint"]),
        ("share_partners", page["account.sharePartners"], page["account.sharePartners.hint"]),
    )
    assert bot_mod.PRIVACY_TITLE == page["account.privacy"]
    assert (page["account.showName"], page["account.showName.hint"]) == (SHOW, SHOW_OFF)
    assert (page["account.sharePartners"], page["account.sharePartners.hint"]) == (SHARE, SHARE_OFF)


def _privacy(user_id=111):
    inter = interaction(user_id=user_id)
    run(bot_mod.privacy.callback(inter))
    return inter


def _row(db_path, user_id):
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT show_name, share_partners FROM person_settings WHERE discord_id = ?",
                       (str(user_id),)).fetchone()
    conn.close()
    return row


def test_privacy_shows_both_choices_on_for_someone_without_a_row(db):
    inter = _privacy(777)
    content, kwargs = inter.response.sent[0]
    assert content is None and kwargs["ephemeral"] is True
    embed = kwargs["embed"]
    assert embed.title == "Privacy"
    assert f"**{SHOW}: On**\n{SHOW_OFF}" in embed.description
    assert f"**{SHARE}: On**\n{SHARE_OFF}" in embed.description
    assert "777" not in _text(embed)
    labels = [item.label for item in kwargs["view"].children]
    assert labels == [f"Turn off: {SHOW}", f"Turn off: {SHARE}", "Account page"]
    assert kwargs["view"].children[2].url == "https://meshmap.radio-actief.be/account"
    assert _row(db, 777) is None  # looking changes nothing


def test_privacy_shows_what_the_account_page_stored(db):
    claims.save_settings("111", show_name=False)
    inter = _privacy(111)
    _, kwargs = inter.response.sent[0]
    assert f"**{SHOW}: Off**" in kwargs["embed"].description
    assert f"**{SHARE}: On**" in kwargs["embed"].description
    assert [item.label for item in kwargs["view"].children][:2] == [f"Turn on: {SHOW}", f"Turn off: {SHARE}"]


def test_privacy_buttons_switch_one_choice_and_confirm(db):
    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.privacy.callback(inter)
        view = inter.response.sent[0][1]["view"]
        click = interaction(user_id=111)
        await view.children[0].callback(click)
        return click

    click = run(flow())
    assert _row(db, 111) == (0, 1)
    assert claims.get_settings("111") == {"show_name": False, "share_partners": True}
    edit = click.response.edited[0]
    assert f"**{SHOW}: Off**" in edit["embed"].description
    assert f"✅ Saved. {SHOW} is now **Off**." in edit["embed"].description
    assert [item.label for item in edit["view"].children][:2] == [f"Turn on: {SHOW}", f"Turn off: {SHARE}"]

    async def second():
        click2 = interaction(user_id=111)
        await edit["view"].children[1].callback(click2)
        click3 = interaction(user_id=111)
        await click2.response.edited[0]["view"].children[0].callback(click3)
        return click2, click3

    click2, click3 = run(second())
    assert f"✅ Saved. {SHARE} is now **Off**." in click2.response.edited[0]["embed"].description
    assert f"✅ Saved. {SHOW} is now **On**." in click3.response.edited[0]["embed"].description
    assert _row(db, 111) == (1, 0)


def test_privacy_button_does_what_its_label_says_even_after_a_change_elsewhere(db):
    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.privacy.callback(inter)
        claims.save_settings("111", show_name=False)  # meanwhile, on the account page
        click = interaction(user_id=111)
        await inter.response.sent[0][1]["view"].children[0].callback(click)  # "Turn off"
        return click

    run(flow())
    assert _row(db, 111) == (0, 1)


def test_privacy_buttons_refuse_anyone_else(db):
    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.privacy.callback(inter)
        view = inter.response.sent[0][1]["view"]
        other = interaction(user_id=444)
        allowed = await view.interaction_check(other)
        return allowed, other

    allowed, other = run(flow())
    assert allowed is False
    assert other.response.sent == [("This prompt is not for you.", {"ephemeral": True})]
    assert _row(db, 111) is None and _row(db, 444) is None


def test_private_menus_lose_their_buttons_when_they_expire(db):
    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.privacy.callback(inter)
        first = inter.response.sent[0][1]["view"]
        click = interaction(user_id=111)
        await first.children[0].callback(click)
        assert first.is_finished()  # replaced: it won't strip the new buttons later
        await click.response.edited[0]["view"].on_timeout()
        return click

    click = run(flow())
    assert click.original_edits == [{"view": None}]


def test_privacy_only_for_members_of_the_home_server(db, monkeypatch):
    monkeypatch.setattr(bot_mod, "DISCORD_GUILD_ID", "999")
    for inter in (interaction(guild_id=None), interaction(guild_id=123), interaction(member=False)):
        run(bot_mod.privacy.callback(inter))
        assert inter.response.sent == [(bot_mod.PRIVACY_NOT_IN_SERVER, {"ephemeral": True})]


def test_privacy_switch_changes_what_the_bot_shows(db):
    async def flow():
        inter = interaction(user_id=222, name="bob")
        await bot_mod.privacy.callback(inter)
        await inter.response.sent[0][1]["view"].children[0].callback(interaction(user_id=222, name="bob"))
        search = interaction(user_id=333)
        await bot_mod.search_nodes.callback(search, query="Bob Rep")
        return search

    search = run(flow())
    embed = search.followup.sent[0][1]["embed"]
    assert {f.name: f.value for f in embed.fields}["Owner"] == "Claimed"


def test_privacy_clicks_are_logged_without_the_choice(db, capsys):
    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.privacy.callback(inter)
        await inter.response.sent[0][1]["view"].children[0].callback(interaction(user_id=111))

    run(flow())
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT command, user_id, ok FROM command_log").fetchall()
    conn.close()
    assert rows == [("privacy button", "111", 1)]
    out = capsys.readouterr().out
    assert "show_name" not in out and "Show my name" not in out and "Off" not in out


# ---------------------------------------------------------------- /node invite-manager

def _invites(db_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT token_hash, public_key, created_by, expires_at, used_at FROM manager_invites ORDER BY rowid"
    ).fetchall()
    conn.close()
    return rows


def test_invite_manager_gives_the_owner_a_one_time_link_privately(db):
    inter = interaction(user_id=111)
    run(bot_mod.node_invite_manager.callback(inter, "a3" * 32))
    assert inter.response.deferred == {"ephemeral": True, "thinking": True}
    assert len(inter.followup.sent) == 1 and inter.channel.sent == []
    content, kwargs = inter.followup.sent[0]
    assert content is None and kwargs["ephemeral"] is True
    embed = kwargs["embed"]
    assert embed.title == "🔗 Invitation link"
    token = re.search(r"https://meshmap\.radio-actief\.be/invite/([A-Za-z0-9_-]+)\n", embed.description).group(1)
    assert "Gent Rep" in embed.description
    assert bot_mod.INVITE_TEXT in embed.description
    assert "Send this link to one person. It works once, for 7 days." in bot_mod.INVITE_TEXT
    assert "111" not in _text(embed) and "<@" not in _text(embed)

    # The same invitation the account page makes: hashed in the same table, 7 days, one use.
    (token_hash, key, created_by, expires_at, used_at), = _invites(db)
    assert token_hash == claims._token_hash(token) and token not in token_hash
    assert (key, created_by, used_at) == ("a3" * 32, "111", None)
    left = datetime.fromisoformat(expires_at.replace("Z", "+00:00")) - datetime.now(timezone.utc)
    assert timedelta(days=6, hours=23) < left <= timedelta(days=7)
    assert claims.invite_info(token, "333")["state"] == "ok"
    assert claims.accept_invite(token, "333", "Carol")["state"] == "ok"
    assert claims.accept_invite(token, "444", "Dave")["state"] == "gone"
    assert claims.role_of("a3" * 32, "333") == "manager"


def test_invite_manager_by_typed_name(db):
    inter = interaction(user_id=111)
    run(bot_mod.node_invite_manager.callback(inter, "gent"))
    assert inter.followup.sent[0][1]["embed"].title == "🔗 Invitation link"
    assert len(_invites(db)) == 1


@pytest.mark.parametrize("user_id,query", [
    (333, "a3" * 32),      # someone else's node
    (333, "Gent Rep"),
    (111, "a5" * 32),      # bob's node
    (111, "Old Alice"),    # the caller's own, but not on the map any more
    (111, "nothing-like-this"),
])
def test_invite_manager_only_for_the_owner_of_an_active_node(db, user_id, query):
    inter = interaction(user_id=user_id)
    run(bot_mod.node_invite_manager.callback(inter, query))
    _, kwargs = inter.followup.sent[0]
    assert kwargs["ephemeral"] is True
    assert kwargs["embed"].description.startswith("You don't own an active node matching")
    assert "/invite/" not in _text(kwargs["embed"])
    assert _invites(db) == []


def test_invite_manager_not_for_a_manager_of_the_node(db):
    _add_manager(db, "a3" * 32, "333", "Carol")
    inter = interaction(user_id=333)
    run(bot_mod.node_invite_manager.callback(inter, "a3" * 32))
    assert inter.followup.sent[0][1]["embed"].description.startswith("You don't own an active node matching")
    assert _invites(db) == []
    choices = run(bot_mod.own_active_node_autocomplete(interaction(user_id=333), ""))
    assert choices == []


def test_invite_manager_with_several_matches_asks_which(db):
    _insert(db, "a7" * 32, "Gent Two", city="Gent", owner="111", owner_name="alice")
    inter = interaction(user_id=111)
    run(bot_mod.node_invite_manager.callback(inter, "gent"))
    assert inter.followup.sent[0][1]["embed"].description.startswith("**2** of your nodes match `gent`.")
    assert _invites(db) == []


def test_invite_manager_stops_at_the_account_pages_limit(db):
    for _ in range(claims.MAX_OPEN_INVITES):
        assert isinstance(claims.create_invite("a3" * 32, "111"), dict)
    inter = interaction(user_id=111)
    run(bot_mod.node_invite_manager.callback(inter, "a3" * 32))
    text = inter.followup.sent[0][1]["embed"].description
    assert text == "This node has 10 open invitations. Wait until one is used or expires."
    assert len(_invites(db)) == claims.MAX_OPEN_INVITES


def test_invite_manager_only_for_members_of_the_home_server(db, monkeypatch):
    monkeypatch.setattr(bot_mod, "DISCORD_GUILD_ID", "999")
    inter = interaction(user_id=111, guild_id=123)
    run(bot_mod.node_invite_manager.callback(inter, "a3" * 32))
    assert inter.response.sent == [(bot_mod.INVITE_NOT_IN_SERVER, {"ephemeral": True})]
    assert _invites(db) == []


def test_own_node_suggestions_are_the_callers_active_nodes(db):
    choices = run(bot_mod.own_active_node_autocomplete(interaction(user_id=111), ""))
    assert [c.value for c in choices] == ["a3" * 32]  # not Old Alice (inactive), not Bob Rep
    assert choices[0].name == "📡 Gent Rep · Gent · A3A3A3"
    assert run(bot_mod.own_active_node_autocomplete(interaction(user_id=111), "bob")) == []


def test_invitation_link_is_not_logged(db, capsys):
    inter = interaction(user_id=111)
    run(bot_mod.node_invite_manager.callback(inter, "a3" * 32))
    assert "/invite/" not in capsys.readouterr().out


# ---------------------------------------------------------------- /node managers

def test_managers_lists_them_for_the_owner_only(db):
    _add_manager(db, "a3" * 32, "333", "Carol")
    _add_manager(db, "a3" * 32, "444", "Dave")
    claims.save_settings("444", show_name=False)

    inter = interaction(user_id=111)
    run(bot_mod.node_managers.callback(inter, "a3" * 32))
    assert inter.response.deferred == {"ephemeral": True, "thinking": True}
    _, kwargs = inter.followup.sent[0]
    assert kwargs["ephemeral"] is True
    text = kwargs["embed"].description
    assert "1. Carol" in text and "2. A manager who hides their name" in text
    assert "Dave" not in text and "333" not in text and "444" not in text
    select = kwargs["view"].children[0]
    assert [o.label for o in select.options] == ["Carol", "Manager 2 (name hidden)"]

    other = interaction(user_id=333)  # a manager, not the owner
    run(bot_mod.node_managers.callback(other, "a3" * 32))
    assert other.followup.sent[0][1]["embed"].description.startswith("You don't own an active node matching")


def test_managers_of_a_node_without_any(db):
    inter = interaction(user_id=111)
    run(bot_mod.node_managers.callback(inter, "a3" * 32))
    _, kwargs = inter.followup.sent[0]
    assert "no managers yet" in kwargs["embed"].description
    assert "/node invite-manager" in kwargs["embed"].description
    assert kwargs.get("view") is None or not any(
        isinstance(c, discord.ui.Select) for c in kwargs["view"].children)


def test_owner_removes_a_manager_after_a_confirmation(db):
    _add_manager(db, "a3" * 32, "333", "Carol")

    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.node_managers.callback(inter, "a3" * 32)
        view = inter.followup.sent[0][1]["view"]
        stranger = interaction(user_id=444)
        assert await view.interaction_check(stranger) is False

        pick = interaction(user_id=111)
        pick.data = {"values": [view.children[0].options[0].value]}
        await view.children[0].callback(pick)
        prompt = pick.response.edited[0]
        assert prompt["embed"].description.startswith("Remove Carol as manager of Gent Rep?")
        assert claims.role_of("a3" * 32, "333") == "manager"  # nothing removed yet
        assert await prompt["view"].interaction_check(stranger) is False

        yes = interaction(user_id=111)
        await prompt["view"].confirm_remove.callback(yes)
        return yes

    yes = run(flow())
    assert "Removed" in yes.response.edited[0]["embed"].description
    assert claims.role_of("a3" * 32, "333") is None
    assert claims.managers_of("a3" * 32) == []


def test_remove_manager_can_be_cancelled(db):
    _add_manager(db, "a3" * 32, "333", "Carol")

    async def flow():
        inter = interaction(user_id=111)
        await bot_mod.node_managers.callback(inter, "a3" * 32)
        view = inter.followup.sent[0][1]["view"]
        pick = interaction(user_id=111)
        pick.data = {"values": [view.children[0].options[0].value]}
        await view.children[0].callback(pick)
        cancel = interaction(user_id=111)
        await pick.response.edited[0]["view"].cancel.callback(cancel)
        return cancel

    cancel = run(flow())
    assert "Nothing changed" in cancel.response.edited[0]["embed"].description
    assert claims.role_of("a3" * 32, "333") == "manager"


# ---------------------------------------------------------------- commands and instructions

def test_new_commands_are_registered_and_guild_only():
    tree = bot_mod.bot.tree
    names = {c.name for c in tree.get_commands()}
    assert "privacy" in names
    node = {c.name for c in bot_mod.node_group.commands}
    assert {"claim", "unclaim", "invite-manager", "managers"} <= node
    assert tree.get_command("privacy").to_dict(tree)["dm_permission"] is False


def test_instructions_list_the_new_commands():
    from test_discord_bot import ROOT

    text = bot_mod.render_instructions((ROOT / "DISCORDBOT_INSTRUCTIONS.md").read_text(encoding="utf-8"))
    for command in ("/privacy", "/node invite-manager", "/node managers"):
        assert command in text
    assert len(text) < 4096 - len("\n\n... (content truncated)")
