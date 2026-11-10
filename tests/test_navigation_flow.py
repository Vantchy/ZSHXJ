"""Regression coverage for the intentionally direct room-to-first-level route."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DirectLevelEntryTests(unittest.TestCase):
    def test_room_entrance_opens_first_formal_level_directly(self):
        source = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        room_start = source.index("async function showRoom(")
        sync_start = source.index("async function syncFirstCircuitQuestCompletion(", room_start)
        room = source[room_start:sync_start]

        self.assertIn("onStartLevel: async () =>", room)
        self.assertIn("const firstLevelId = chapter.levels?.[0]?.id;", room)
        self.assertIn("await showLevel(chapterId, firstLevelId);", room)
        self.assertNotIn("showLevelList(", room)
        self.assertIn(
            "The room's circuit entrance leads directly to this chapter's first formal",
            room,
        )

    def test_level_list_is_not_the_active_room_entry(self):
        source = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        room_start = source.index("async function showRoom(")
        room_end = source.index("async function syncFirstCircuitQuestCompletion(", room_start)
        room = source[room_start:room_end]
        self.assertRegex(room, r"onStartLevel:[\s\S]*?showLevel\(chapterId, firstLevelId\)")
        self.assertNotIn("showLevelList", room)


if __name__ == "__main__":
    unittest.main()
