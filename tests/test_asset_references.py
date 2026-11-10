"""Runtime artwork, HTTP serving and local ES-module dependencies."""
import json
import re
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from check_assets import check  # noqa: E402
from server import create_server


class AssetReferenceTests(unittest.TestCase):
    def test_all_runtime_images_resolve(self):
        self.assertEqual([], check())

    def test_js_module_imports_have_no_cycles(self):
        public = ROOT / "public"
        graph = {}
        pattern = re.compile(r'from\s+["\'](\.[^"\']+)["\']')
        for file in public.rglob("*.js"):
            imports = []
            for relative in pattern.findall(file.read_text(encoding="utf-8")):
                target = (file.parent / relative).resolve()
                self.assertTrue(target.is_file(), f"Unresolved module import: {file} => {relative}")
                imports.append(target)
            graph[file.resolve()] = imports

        visited, stack = set(), set()

        def walk(node):
            if node in stack:
                raise AssertionError(f"Local ES module dependency cycle at {node}")
            if node in visited:
                return
            stack.add(node)
            for child in graph.get(node, []):
                walk(child)
            stack.remove(node)
            visited.add(node)

        for module in graph:
            walk(module)

    def test_static_server_serves_every_active_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            server = create_server("127.0.0.1", 0, Path(directory) / "assets.sqlite3")
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                manifest = json.loads(
                    (ROOT / "tools/asset-manifest.json").read_text(encoding="utf-8")
                )
                host = f"http://127.0.0.1:{server.server_address[1]}"
                for item in manifest["active_assets"]:
                    request = urllib.request.Request(host + item["to"], method="HEAD")
                    with urllib.request.urlopen(request, timeout=10) as response:
                        self.assertEqual(200, response.status, item["to"])
                        self.assertGreater(int(response.headers["Content-Length"]), 0)
                        self.assertEqual("nosniff", response.headers.get("X-Content-Type-Options"))
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
