"""New leaderboard art and unboxed headings must stay isolated from scores."""
from pathlib import Path
import hashlib
import json
import unittest

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/"public"

class LeaderboardArtworkTests(unittest.TestCase):
    def test_art_and_manifest_hashes(self):
        manifest=json.loads((ROOT/"archive/asset-cleanup-manifest.json").read_text(encoding="utf-8"))
        assets={item["to"]:item for item in manifest["active_assets"]}
        for file in ("dragon-background.png","phoenix-frame.png"):
            url="/assets/leaderboard/"+file
            self.assertIn(url,assets)
            target=PUBLIC/url.lstrip("/")
            self.assertTrue(target.is_file())
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),assets[url]["sha256"])

    def test_no_colored_header_box_and_no_old_art(self):
        css=(PUBLIC/"leaderboard-visual.css").read_text(encoding="utf-8")
        self.assertIn("#app.page--leaderboard .leaderboard-table th {",css)
        self.assertIn("#app.page--leaderboard .leaderboard-table thead,",css)
        self.assertIn("background:transparent;",css)
        self.assertIn("/assets/leaderboard/phoenix-frame.png",css)
        self.assertIn("/assets/leaderboard/dragon-background.png",css)
        self.assertNotIn("/assets/results/",css)
        self.assertNotIn(".paper-demo",css)
        app=(PUBLIC/"app.js").read_text(encoding="utf-8")
        self.assertIn('el("table", undefined, content)',app)
        self.assertIn('el("tbody", undefined, table)',app)
        self.assertNotIn('el("span", "暂无排行数据",',app)

    def test_scores_unchanged_interface(self):
        script=(PUBLIC/"app.js").read_text(encoding="utf-8")
        score=(PUBLIC/"results-visual.css").read_text(encoding="utf-8")
        self.assertIn('api("GET", "/api/circuit/results/mine")',script)
        self.assertIn("/assets/results/phoenix-background.png",score)
        self.assertNotIn("/assets/results/parchment-panel.png",score)
        self.assertNotIn("scores-paper-sheet", score)
        self.assertIn(".scores-content", score)
        self.assertNotIn("/assets/results/landscape-background.png", score)
        ranking_css=(PUBLIC/"leaderboard-visual.css").read_text(encoding="utf-8")
        self.assertIn("/assets/leaderboard/phoenix-frame.png", ranking_css)
        self.assertNotIn("/assets/leaderboard/phoenix-background.png", ranking_css)
