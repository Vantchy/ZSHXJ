"""Protect the narrowly scoped imported score/ranking appearance."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


class ResultsViewIntegrityTests(unittest.TestCase):
    def test_independent_stylesheet_is_loaded_and_scoped(self):
        html = (PUBLIC / "index.html").read_text(encoding="utf-8")
        css = (PUBLIC / "results-visual.css").read_text(encoding="utf-8")
        self.assertIn('href="/results-visual.css"', html)
        self.assertIn("#app.page--scores", css)
        self.assertIn("#app.page--leaderboard", css)
        for forbidden in ("page--achievements", "page--settings",
                          "#app.page--placeholder", "/scenes/scores-"):
            self.assertNotIn(forbidden, css, forbidden)
        self.assertIn("/assets/results/landscape-background.png", css)
        self.assertIn("/assets/results/parchment-panel.png", css)

    def test_existing_score_api_and_achievements_remain_intact(self):
        script = (PUBLIC / "app.js").read_text(encoding="utf-8")
        self.assertIn('api("GET", "/api/circuit/results/mine")', script)
        self.assertIn('reply.results.map((record)', script)
        self.assertIn('record.bestPassedCount', script)
        self.assertIn('if (title === "排行榜") return showLeaderboard();', script)
        self.assertIn('button("成就", root, () => showPlaceholder("成就"))', script)
        self.assertIn('page(title, "placeholder"); el("p", "待开发", root)', script)
        self.assertNotIn("/achievement-icons/demo-", script)

    def test_obsolete_result_styles_and_nodes_removed(self):
        css = (PUBLIC / "results-visual.css").read_text(encoding="utf-8")
        source = (PUBLIC / "app.js").read_text(encoding="utf-8")
        for selector in (
            ".scores-paper-heading", ".scores-paper-footer", ".scores-paper-back",
            ".paper-demo-heading", ".paper-demo-meta", ".paper-demo-footer",
            ".paper-demo-back", ".paper-demo-emblem",
        ):
            self.assertNotIn(selector, css)
        self.assertNotIn('el("h3", "关卡记录", content)', source)
        self.assertNotIn('el("h3", "闯关排行", content)', source)
        self.assertNotIn('el("span", "暂无排行数据", meta)', source)
        self.assertIn('renderResultsHeader("排行"', source)
        self.assertIn('renderResultsHeader("成绩"', source)
        self.assertIn('/assets/quests/go-button.png', css)

    def test_no_unrelated_new_assets(self):
        folder = PUBLIC / "assets" / "results"
        self.assertEqual({"landscape-background.png", "parchment-panel.png"},
                         {p.name for p in folder.iterdir() if p.is_file()})
