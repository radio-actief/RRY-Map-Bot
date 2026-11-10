"""Tests for the Flask app's static file serving and request parsing."""

import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import backend.api.app as api  # noqa: E402
import backend.auth as auth  # noqa: E402

# What a browser sends with a POST from the map's own pages.
SAME_SITE = {"Origin": "http://localhost"}


class TestStaticFiles(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()

    def test_pages_and_assets_are_served(self):
        for path in (
            "/",
            "/stats",
            "/configurator",
            "/region-map",
            "/index.html",
            "/favicon.ico",
            "/favicon-32.png",
            "/css/map.css",
            "/lib/leaflet.js",
            "/img/node_types/1.svg",
            "/src/map.js",
            "/data/be-locode.json",
            "/data/be-provinces.geojson",
        ):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 200)
                r.close()

    def test_shared_restyle_assets_are_served(self):
        for path in (
            "/src/shared/bemesh-shell.css",
            "/src/shared/bemesh-tokens.css",
            "/src/shared/theme.js",
        ):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 200)
                r.close()

    def test_project_files_outside_the_allowlist_are_404(self):
        for path in (
            "/backend/database.py",
            "/backend/api/app.py",
            "/config/config.py",
            "/requirements.txt",
            "/README.md",
            "/Dockerfile",
            "/docker-compose.yml",
            "/.env.example",
            "/data/.gitkeep",
            "/tests/test_api_routes.py",
            "/css/../backend/database.py",
        ):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 404)
                r.close()

    def _temp_root(self):
        """Point the app at a throwaway project root with a data/ folder."""
        root = tempfile.mkdtemp()
        os.mkdir(os.path.join(root, "data"))
        old = api.PROJECT_ROOT
        api.PROJECT_ROOT = root
        self.addCleanup(shutil.rmtree, root)
        self.addCleanup(setattr, api, "PROJECT_ROOT", old)
        return root

    def _write(self, root, rel, text):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)

    def test_data_dir_serves_only_json_and_geojson(self):
        root = self._temp_root()
        self._write(root, "data/zz.geojson", "{}")
        self._write(root, "data/zz.json", "{}")
        for name in ("belgian_nodes.db", "geocode_failures.log", "belgian_nodes.db-wal"):
            self._write(root, "data/" + name, "secret")
        for name in ("zz.geojson", "zz.json"):
            with self.subTest(name=name):
                r = self.client.get("/data/" + name)
                self.assertEqual(r.status_code, 200)
                r.close()
        for name in ("belgian_nodes.db", "geocode_failures.log", "belgian_nodes.db-wal"):
            with self.subTest(name=name):
                r = self.client.get("/data/" + name)
                self.assertEqual(r.status_code, 404)
                self.assertNotIn(b"secret", r.data)
                r.close()

    def test_data_subdirectories_are_404(self):
        root = self._temp_root()
        self._write(root, "data/backups/x.json", "{}")
        r = self.client.get("/data/backups/x.json")
        self.assertEqual(r.status_code, 404)
        r.close()

    def test_session_and_log_folders_are_404(self):
        root = self._temp_root()
        self._write(root, "flask_session/2029fbc5", "secret")
        self._write(root, "logs/api.log", "secret")
        for path in ("/flask_session/2029fbc5", "/logs/api.log"):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 404)
                self.assertNotIn(b"secret", r.data)
                r.close()

    def test_missing_file_is_a_real_404(self):
        for path in ("/data/nope.geojson", "/css/nope.css", "/nope.txt"):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 404)
                r.close()


class TestAuthNext(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()
        # The login redirect needs a client id; a checkout without .env (CI) has none.
        patcher = mock.patch.object(auth, "DISCORD_OAUTH2_CLIENT_ID", "test-client-id")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_logout_returns_to_a_tool_page(self):
        r = self.client.post("/auth/logout?next=/stats", headers=SAME_SITE)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/stats")

    def test_logout_home_keeps_the_success_flag(self):
        for query in ("?next=/", ""):
            with self.subTest(query=query):
                r = self.client.post("/auth/logout" + query, headers=SAME_SITE)
                self.assertEqual(r.headers["Location"], "/?logout=success")

    def test_logout_ignores_other_targets(self):
        for target in ("https://evil.example", "//evil.example", "/foo"):
            with self.subTest(target=target):
                r = self.client.post("/auth/logout", query_string={"next": target}, headers=SAME_SITE)
                self.assertEqual(r.headers["Location"], "/?logout=success")

    def _pending(self):
        cookie = self.client.get_cookie(api.OAUTH_COOKIE, path="/auth/")
        self.assertIsNotNone(cookie)
        return api.read_oauth_pending(cookie.value)

    def test_login_stores_a_tool_page(self):
        r = self.client.get("/auth/login?next=/region-map")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self._pending()["next"], "/region-map")

    def test_login_drops_other_targets(self):
        self.client.get("/auth/login?next=//evil.example")
        self.assertIsNone(self._pending()["next"])

    def test_login_writes_no_server_side_session(self):
        """Anonymous sign-in starts must not fill the session store (and push real sessions out)."""
        session_dir = api.app.config["SESSION_FILE_DIR"]
        before = set(os.listdir(session_dir)) if os.path.isdir(session_dir) else set()
        for _ in range(5):
            r = api.app.test_client().get("/auth/login")
            self.assertEqual(r.status_code, 302)
            self.assertNotIn(api.app.config.get("SESSION_COOKIE_NAME", "session") + "=",
                             " ".join(r.headers.getlist("Set-Cookie")))
        after = set(os.listdir(session_dir)) if os.path.isdir(session_dir) else set()
        self.assertEqual(after, before)

    def _callback(self, state):
        with mock.patch.object(api, "exchange_code_for_token", return_value={"access_token": "t"}), \
             mock.patch.object(api, "get_user_info", return_value={"id": "42", "username": "ann"}), \
             mock.patch.object(auth, "is_guild_member", return_value=True):
            return self.client.get("/auth/callback", query_string={"code": "c", "state": state})

    def test_callback_with_the_login_state_signs_in(self):
        self.client.get("/auth/login?next=/region-map")
        state = self._pending()["state"]
        r = self._callback(state)
        self.assertEqual(r.headers["Location"], "/region-map")
        self.assertIsNone(self.client.get_cookie(api.OAUTH_COOKIE, path="/auth/"))
        self.assertEqual(self.client.get("/auth/me").get_json()["user"]["id"], "42")

    def test_callback_with_another_state_is_refused(self):
        self.client.get("/auth/login")
        r = self._callback("not-the-state")
        self.assertEqual(r.headers["Location"], "/auth/failed?reason=expired")
        self.assertFalse(self.client.get("/auth/me").get_json()["authenticated"])

    def test_a_non_member_is_signed_in_and_sent_to_the_join_page(self):
        self.client.get("/auth/login?next=/region-map")
        state = self._pending()["state"]
        with mock.patch.object(api, "exchange_code_for_token", return_value={"access_token": "t"}), \
             mock.patch.object(api, "get_user_info", return_value={"id": "42", "username": "ann"}), \
             mock.patch.object(auth, "is_guild_member", return_value=False):
            r = self.client.get("/auth/callback", query_string={"code": "c", "state": state})
        self.assertEqual(r.headers["Location"], "/auth/failed?reason=not_member&next=%2Fregion-map")

    def test_tampered_or_old_login_cookie_is_ignored(self):
        self.assertIsNone(api.read_oauth_pending("garbage"))
        token = api._oauth_serializer().dumps({"state": "s", "next": None})
        with mock.patch("itsdangerous.timed.time.time", return_value=__import__("time").time() + 3600):
            self.assertIsNone(api.read_oauth_pending(token))
        self.assertEqual(api.read_oauth_pending(token)["state"], "s")

    def test_success_redirect_target(self):
        self.assertEqual(api._after_auth_target("/configurator", "login=success"), "/configurator")
        self.assertEqual(api._after_auth_target("/", "login=success"), "/?login=success")
        self.assertEqual(api._after_auth_target(None, "login=success"), "/?login=success")


class TestRadioCustomParams(unittest.TestCase):
    def _parse(self, query):
        with api.app.test_request_context("/api/v1/stats?" + query):
            return api._parse_radio_custom_from_request()

    def test_single_params_are_parsed(self):
        self.assertEqual(self._parse("freq=869.618"), {"freq": 869.618})
        self.assertEqual(self._parse("sf=8"), {"sf": 8})
        self.assertEqual(self._parse("bw=62.5"), {"bw": 62.5})
        self.assertEqual(self._parse("cr=8"), {"cr": 8})

    def test_combined_params_without_cr_are_parsed(self):
        self.assertEqual(
            self._parse("freq=869.618&sf=8&bw=62.5"),
            {"freq": 869.618, "sf": 8, "bw": 62.5},
        )

    def test_no_params_or_invalid_value_is_none(self):
        self.assertIsNone(self._parse(""))
        self.assertIsNone(self._parse("freq=abc"))
        self.assertIsNone(self._parse("sf=8&bw=5000"))


class _BrokenConnection:
    """A database that fails every query with a message naming internals."""

    def cursor(self):
        return self

    def execute(self, *a, **k):
        raise sqlite3.OperationalError("no such table: secret_table_xyz")

    def close(self):
        pass


class TestErrorResponses(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()
        patcher = mock.patch.object(api, "get_connection", lambda: _BrokenConnection())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_node_list_failure_is_a_500_not_an_empty_map(self):
        r = self.client.get("/api/v1/belgian-nodes")
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("secret_table_xyz", r.get_data(as_text=True))

    def test_errors_do_not_show_internal_details(self):
        for path in (
            "/api/v1/belgian-nodes/count",
            "/api/v1/node-changes",
            "/api/v1/sync-history",
            "/api/v1/stats",
            "/api/v1/repeaters/contacts",
        ):
            with self.subTest(path=path):
                r = self.client.get(path)
                self.assertEqual(r.status_code, 500)
                body = r.get_data(as_text=True)
                self.assertNotIn("secret_table_xyz", body)
                self.assertEqual(r.get_json()["error"], "Internal server error")


if __name__ == "__main__":
    unittest.main()
