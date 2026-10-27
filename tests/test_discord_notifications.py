"""Web claim notifications: timeout, map button, background send, one retry on 429."""

import threading

import pytest

import backend.discord_notifications as dn


class _Resp:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body or {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise dn.requests.HTTPError(f"{self.status_code}")


@pytest.fixture
def posts(monkeypatch):
    calls = []
    replies = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json, "timeout": timeout})
        return replies.pop(0) if replies else _Resp(200)

    monkeypatch.setattr(dn, "DISCORD_BOT_TOKEN", "token")
    monkeypatch.setattr(dn, "STARTUP_CHANNEL_ID", "123")
    monkeypatch.setattr(dn.requests, "post", fake_post)
    monkeypatch.setattr(dn.time, "sleep", lambda s: None)
    return calls, replies


def test_send_uses_a_timeout_and_components(posts):
    calls, _ = posts
    assert dn.send_discord_message({"title": "x"}, [{"type": 1}])
    assert calls[0]["timeout"] == dn.REQUEST_TIMEOUT_S
    assert calls[0]["json"] == {"embeds": [{"title": "x"}], "components": [{"type": 1}]}


def test_send_retries_once_after_a_short_rate_limit(posts):
    calls, replies = posts
    replies.extend([_Resp(429, {"retry_after": 0.5}), _Resp(200)])
    assert dn.send_discord_message({"title": "x"})
    assert len(calls) == 2


def test_send_gives_up_on_errors(posts):
    calls, replies = posts
    replies.extend([_Resp(500)])
    assert dn.send_discord_message({"title": "x"}) is False


def test_claim_notification_runs_in_the_background_with_a_map_button(posts, monkeypatch):
    calls, _ = posts
    started = []
    real_thread = threading.Thread

    def thread(*args, **kwargs):
        t = real_thread(*args, **kwargs)
        started.append(t)
        return t

    monkeypatch.setattr(dn.threading, "Thread", thread)
    node = {"public_key": "ab" * 32, "adv_name": "N", "type": 2, "city": "Gent"}
    assert dn.notify_node_claimed(node, "42", "x") is None
    started[0].join(2)
    payload = calls[0]["json"]
    assert payload["embeds"][0]["description"].startswith("<@42> claimed this node on the map.")
    button = payload["components"][0]["components"][0]
    assert button["label"] == "Open on map" and button["url"].endswith("?node=abababababab")
