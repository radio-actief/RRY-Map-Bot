"""Security rules of the API: what other sites may read, who may change things, sessions, timeouts."""

import os
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import backend.api.app as api  # noqa: E402
import backend.auth as auth  # noqa: E402

KEY = "a" * 64


def signed_in(client):
    with client.session_transaction() as sess:
        sess["user_id"] = "1"
        sess["username"] = "tester"
        sess["is_guild_member"] = True


class TestCrossSite(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()

    def test_public_api_is_readable_from_any_site_without_cookies(self):
        r = self.client.get("/api/v1/version", headers={"Origin": "https://other.example"})
        self.assertEqual(r.headers.get("Access-Control-Allow-Origin"), "*")
        self.assertNotEqual(r.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_auth_endpoints_are_not_shared_with_other_sites(self):
        r = self.client.get("/auth/me", headers={"Origin": "https://other.example"})
        self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))

    def test_claim_from_another_site_is_refused(self):
        signed_in(self.client)
        for path in (f"/api/v1/nodes/{KEY}/claim", f"/api/v1/nodes/{KEY}/unclaim"):
            with self.subTest(path=path):
                r = self.client.post(path, headers={"Origin": "https://other.example"})
                self.assertEqual(r.status_code, 403)
                self.assertEqual(r.get_json().get("error"), "cross_site_request")

    def test_claim_without_origin_or_referer_is_refused(self):
        signed_in(self.client)
        r = self.client.post(f"/api/v1/nodes/{KEY}/claim")
        self.assertEqual(r.status_code, 403)

    def test_claim_from_the_map_itself_passes_the_site_check(self):
        signed_in(self.client)
        with mock.patch.object(api, "get_current_user", side_effect=RuntimeError("stop after the check")):
            for headers in ({"Origin": "http://localhost"}, {"Referer": "http://localhost/?node=x"}):
                with self.subTest(headers=headers):
                    r = self.client.post(f"/api/v1/nodes/{KEY}/claim", headers=headers)
                    self.assertNotEqual((r.get_json() or {}).get("error"), "cross_site_request")


class TestLogout(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()

    def test_logout_is_a_post_from_the_map(self):
        signed_in(self.client)
        r = self.client.post("/auth/logout?next=/stats", headers={"Origin": "http://localhost"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/stats")
        with self.client.session_transaction() as sess:
            self.assertNotIn("user_id", sess)

    def test_a_link_cannot_log_you_out(self):
        signed_in(self.client)
        r = self.client.get("/auth/logout")
        self.assertNotIn("logout=success", r.headers.get("Location", ""))
        with self.client.session_transaction() as sess:
            self.assertEqual(sess.get("user_id"), "1")

    def test_logout_from_another_site_is_refused(self):
        signed_in(self.client)
        r = self.client.post("/auth/logout", headers={"Origin": "https://other.example"})
        self.assertEqual(r.status_code, 403)


class TestSecretKey(unittest.TestCase):
    def test_the_environment_wins(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"FLASK_SECRET_KEY": "from-env"}):
            self.assertEqual(api._secret_key(d), "from-env")
            self.assertEqual(os.listdir(d), [])

    def test_without_one_a_key_is_made_once_and_kept(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FLASK_SECRET_KEY", None)
            first = api._secret_key(d)
            self.assertGreaterEqual(len(first), 64)
            self.assertEqual(api._secret_key(d), first)  # survives a restart
            path = os.path.join(d, ".flask_secret_key")
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)


class TestTimeouts(unittest.TestCase):
    def test_every_discord_call_has_a_timeout(self):
        calls = []

        def fake(*args, **kwargs):
            calls.append(kwargs)
            raise auth.requests.exceptions.ConnectionError("offline")

        with mock.patch.object(auth.requests, "get", side_effect=fake), mock.patch.object(auth.requests, "post", side_effect=fake):
            auth.exchange_code_for_token("code")
            auth.get_user_info("token")
            auth.get_user_guilds("token")
            auth.verify_guild_membership_bot("1", "2")
        self.assertTrue(calls)
        self.assertTrue(all(c.get("timeout") for c in calls), calls)


if __name__ == "__main__":
    unittest.main()


class TestPathsOutsideTheSite(unittest.TestCase):
    def test_paths_outside_the_site_all_look_the_same(self):
        client = api.app.test_client()
        codes = {}
        up = "/%2e%2e" * 12
        for path in (up + "/etc/hostname", up + "/etc/no-such-file-here"):
            r = client.get(path)
            codes[path] = r.status_code
            r.close()
        # Whether a file exists outside the site must not show: both are a plain 404.
        self.assertEqual(set(codes.values()), {404}, codes)
