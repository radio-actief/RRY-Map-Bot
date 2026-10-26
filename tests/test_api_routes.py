"""Tests for the Flask app's static file serving and request parsing."""

import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import backend.api.app as api  # noqa: E402


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
            "/css/style.css",
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


if __name__ == "__main__":
    unittest.main()
