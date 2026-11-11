"""Contract tests: data-only story/media, startup failure and legacy compatibility."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from chapters import CHAPTERS, CHARACTERS
from quest_model import validate_chapter_definitions
from story_model import (
    load_character_registry, resolve_location_story, resolve_location_placements,
    validate_character_registry, validate_story_definitions,
)

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = json.loads(
    (ROOT / "examples" / "story-media-ch1.example.json").read_text(encoding="utf-8")
)


def sample_chapter() -> dict:
    chapter = copy.deepcopy(CHAPTERS[0])
    chapter["locations"] = copy.deepcopy(EXAMPLE["locations"])
    chapter["dialogues"] = copy.deepcopy(EXAMPLE["dialogues"])
    return chapter


def sample_registry() -> dict:
    return {"characters": copy.deepcopy(EXAMPLE["characters"])}


class StoryMediaValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.chapter = sample_chapter()
        self.registry = sample_registry()

    def validate(self) -> None:
        validate_chapter_definitions((self.chapter,))
        validate_story_definitions((self.chapter,), self.registry)

    def test_current_legacy_chapters_pass_without_new_fields(self):
        self.assertEqual(CHARACTERS, {"characters": []})
        validate_story_definitions(CHAPTERS, CHARACTERS)
        self.assertNotIn("dialogues", CHAPTERS[0])
        location = CHAPTERS[0]["locations"][0]
        self.assertIn("npc", location)
        self.assertIn("npcLine", location)

    def test_documented_full_example_passes_all_validations(self):
        self.validate()
        self.assertEqual(len(self.chapter["locations"]), 2)
        self.assertEqual(len(self.chapter["dialogues"]), 5)
        self.assertEqual(len(self.registry["characters"]), 2)
        self.assertEqual(
            self.chapter["locations"][0]["characterId"], "artisan-yan"
        )
        forge_slots = self.chapter["locations"][1]["characterPlacements"]
        self.assertEqual(len(forge_slots), 2)
        self.assertEqual(
            [item["characterId"] for item in forge_slots],
            ["artisan-yan", "apprentice-lin"],
        )
        self.assertEqual(forge_slots[0]["dialogueId"], "choice-at-forge")
        self.assertNotIn("dialogueId", forge_slots[1])

    def test_optional_missing_portraits_and_media_files_are_legal(self):
        self.registry["characters"][0].pop("scenePortrait")
        self.registry["characters"][0].pop("dialoguePortrait")
        # Images/videos intentionally do not exist in this delivery.
        self.assertFalse((ROOT / "public/assets/story/ch1/images/forge-awakening.webp").exists())
        self.validate()

    def test_character_id_must_be_unique_globally(self):
        self.registry["characters"].append(copy.deepcopy(self.registry["characters"][0]))
        with self.assertRaisesRegex(ValueError, "角色标识重复"):
            self.validate()

    def test_character_name_and_portrait_fields_checked(self):
        self.registry["characters"][0]["name"] = ""
        with self.assertRaisesRegex(ValueError, "name"):
            self.validate()
        self.registry = sample_registry()
        for field, path in [
            ("dialoguePortrait", "https://example.com/portrait.webp"),
            ("scenePortrait", "../scene.webp"),
            ("dialoguePortrait", "/assets/story/ch1/images/incorrect.webp"),
            ("scenePortrait", "/assets/story/characters/other-person/images/scene.webp"),
            ("scenePortrait", "/assets/story/characters/artisan-yan/images/scene.gif"),
            ("scenePortrait", "/assets/story/characters/artisan-yan/images/Scene.webp"),
            ("scenePortrait", ""),
        ]:
            with self.subTest(field=field, path=path):
                registry = sample_registry()
                registry["characters"][0][field] = path
                with self.assertRaisesRegex(ValueError, field):
                    validate_character_registry(registry)

    def test_location_character_reference_must_exist(self):
        self.chapter["locations"][0]["characterId"] = "ghost"
        with self.assertRaisesRegex(ValueError, "locations\\[0\\]\\.characterId"):
            self.validate()

    def test_line_character_reference_must_exist(self):
        self.chapter["dialogues"][0]["lines"][0]["speaker"] = {"characterId": "ghost"}
        with self.assertRaisesRegex(ValueError, "speaker\\.characterId"):
            self.validate()

    def test_speaker_must_be_exactly_one_supported_shape(self):
        for speaker in ({}, {"characterId": "artisan-yan", "name": "旁白"},
                        {"role": "artisan-yan"}, {"name": ""}, {"characterId": None}):
            with self.subTest(speaker=speaker):
                chapter = sample_chapter()
                chapter["dialogues"][0]["lines"][0]["speaker"] = speaker
                with self.assertRaises(ValueError):
                    validate_story_definitions((chapter,), self.registry)

    def test_media_type_is_a_strict_enum(self):
        for value in ("gif", "audio", "动画", 7, None, ["video"]):
            with self.subTest(value=value):
                chapter = sample_chapter()
                chapter["dialogues"][0]["lines"][0]["media"]["type"] = value
                with self.assertRaisesRegex(ValueError, "media\\.type"):
                    validate_story_definitions((chapter,), self.registry)

    def test_media_display_is_a_strict_enum(self):
        for value in ("popup", "inline", "全屏", "", None, ["fullscreen"]):
            with self.subTest(value=value):
                chapter = sample_chapter()
                chapter["dialogues"][0]["lines"][0]["media"]["display"] = value
                with self.assertRaisesRegex(ValueError, "media\\.display"):
                    validate_story_definitions((chapter,), self.registry)

    def test_media_path_enforces_chapter_folder_and_extension(self):
        invalid = (
            "https://example.com/cg.webp",
            "/assets/story/ch2/images/forge-awakening.webp",
            "/assets/story/ch1/videos/forge-awakening.webp",
            "/assets/story/ch1/images/../cg.webp",
            "/assets/story/ch1/images/My-CG.webp",
            "/assets/story/ch1/images/cg.gif",
            "/assets/story/ch1/images/cg.webp?v=2",
            "/assets/story/ch1/images/cg.mp4",
            "assets/story/ch1/images/cg.webp",
        )
        for path in invalid:
            with self.subTest(path=path):
                chapter = sample_chapter()
                chapter["dialogues"][0]["lines"][0]["media"]["path"] = path
                with self.assertRaisesRegex(ValueError, "media\\.path"):
                    validate_story_definitions((chapter,), self.registry)

    def test_video_path_requires_video_folder_and_extension(self):
        chapter = sample_chapter()
        chapter["dialogues"][4]["lines"][0]["media"]["path"] = (
            "/assets/story/ch1/images/forge-flame.webm"
        )
        with self.assertRaisesRegex(ValueError, "media\\.path"):
            validate_story_definitions((chapter,), self.registry)

    def test_missing_location_dialogue_id_rejected(self):
        self.chapter["locations"][0]["dialogueId"] = "missing-dialogue"
        with self.assertRaisesRegex(ValueError, "引用不存在的对话"):
            self.validate()

    def test_duplicate_dialogue_ids_rejected(self):
        self.chapter["dialogues"].append(copy.deepcopy(self.chapter["dialogues"][0]))
        with self.assertRaisesRegex(ValueError, "对话标识重复"):
            self.validate()

    def test_duplicate_location_ids_rejected(self):
        self.chapter["locations"][1]["id"] = self.chapter["locations"][0]["id"]
        with self.assertRaisesRegex(ValueError, "地点标识重复"):
            self.validate()

    def test_lines_must_be_nonempty_and_have_text(self):
        self.chapter["dialogues"][0]["lines"] = []
        with self.assertRaisesRegex(ValueError, "lines"):
            self.validate()
        self.chapter = sample_chapter()
        self.chapter["dialogues"][0]["lines"][0]["text"] = " "
        with self.assertRaisesRegex(ValueError, "lines\\[0\\]\\.text"):
            self.validate()

    def test_invalid_choice_target_type_rejected(self):
        target = self.chapter["dialogues"][3]["options"][0]["target"]
        for value in ("scene", "task", "视频", None, []):
            with self.subTest(value=value):
                target["type"] = value
                with self.assertRaisesRegex(ValueError, "target\\.type"):
                    self.validate()

    def test_missing_option_destinations_rejected(self):
        for option_index, missing_kind in [(0, "对话"), (1, "地点"), (2, "任务")]:
            with self.subTest(missing=missing_kind):
                chapter = sample_chapter()
                chapter["dialogues"][3]["options"][option_index]["target"]["id"] = "does-not-exist"
                with self.assertRaisesRegex(ValueError, "引用不存在的" + missing_kind):
                    validate_story_definitions((chapter,), self.registry)

    def test_quest_action_enum_rejected(self):
        for action in (None, "complete", "accept-quest", "接取", [], 9):
            with self.subTest(action=action):
                chapter = sample_chapter()
                chapter["dialogues"][3]["options"][2]["target"]["action"] = action
                with self.assertRaisesRegex(ValueError, "target\\.action"):
                    validate_story_definitions((chapter,), self.registry)

    def test_unexpected_fields_do_not_silently_pass(self):
        self.chapter["dialogues"][0]["lines"][0]["medium"] = {}
        with self.assertRaisesRegex(ValueError, "未知字段.*medium"):
            self.validate()

    def test_empty_options_invalid_but_absent_options_legal(self):
        self.chapter["dialogues"][0]["options"] = []
        with self.assertRaisesRegex(ValueError, "非空数组"):
            self.validate()
        self.chapter["dialogues"][0].pop("options")
        self.validate()

    def test_new_references_have_data_precedence_without_rendering(self):
        location = self.chapter["locations"][0]
        location["npc"] = "旧 NPC 名"
        location["npcLine"] = "旧单句台词"
        result = resolve_location_story(self.chapter, location, self.registry)
        self.assertEqual(result["npcName"], "匠人严")
        self.assertEqual(result["dialogue"]["id"], "opening-cg")
        self.assertIsNone(result["legacyLine"])
        self.validate()

    def test_old_npc_and_single_line_keep_original_resolution(self):
        legacy = CHAPTERS[0]
        location = legacy["locations"][0]
        result = resolve_location_story(legacy, location, {"characters": []})
        self.assertEqual(result["npcName"], location["npc"])
        self.assertIsNone(result["dialogue"])
        self.assertEqual(result["legacyLine"], location["npcLine"])


    def test_two_characters_with_distinct_dialogues_are_valid(self):
        self.chapter["dialogues"].append({
            "id": "apprentice-greeting",
            "lines": [{
                "speaker": {"characterId": "apprentice-lin"},
                "text": "师傅，我也来帮忙。",
            }],
        })
        slots = self.chapter["locations"][1]["characterPlacements"]
        slots[1]["dialogueId"] = "apprentice-greeting"
        self.validate()
        result = resolve_location_placements(
            self.chapter, self.chapter["locations"][1], self.registry
        )
        self.assertEqual(
            [item["dialogueId"] for item in result],
            ["choice-at-forge", "apprentice-greeting"],
        )
        self.assertEqual(
            [item["character"]["name"] for item in result],
            ["匠人严", "学徒林"],
        )
        self.assertEqual(
            result[1]["dialogue"]["lines"][0]["speaker"]["characterId"],
            "apprentice-lin",
        )
        self.assertEqual([item["x"] for item in result], [320, 720])

    def test_standing_role_without_dialogue_is_valid(self):
        self.validate()
        result = resolve_location_placements(
            self.chapter, self.chapter["locations"][1], self.registry
        )
        self.assertIsNone(result[1]["dialogueId"])
        self.assertIsNone(result[1]["dialogue"])
        self.assertEqual(result[1]["characterId"], "apprentice-lin")

    def test_new_placements_allow_same_character_at_different_locations(self):
        self.assertEqual(
            self.chapter["locations"][0]["characterId"],
            self.chapter["locations"][1]["characterPlacements"][0]["characterId"],
        )
        self.validate()

    def test_placement_character_reference_must_exist(self):
        self.chapter["locations"][1]["characterPlacements"][1]["characterId"] = "ghost"
        with self.assertRaisesRegex(
            ValueError, r"locations\[1\]\.characterPlacements\[1\]\.characterId"
        ):
            self.validate()

    def test_placement_x_numeric_finite_and_in_range(self):
        for invalid in (-0.01, -1, 1025, 1024.001, True, False,
                        "512", None, [], float("nan"),
                        float("inf"), float("-inf"), 10 ** 400):
            with self.subTest(x=invalid):
                chapter = sample_chapter()
                chapter["locations"][1]["characterPlacements"][1]["x"] = invalid
                with self.assertRaisesRegex(
                    ValueError,
                    r"locations\[1\]\.characterPlacements\[1\]\.x",
                ):
                    validate_story_definitions((chapter,), self.registry)

    def test_boundary_x_coordinates_are_valid(self):
        for first, second in [(0, 1024), (0.5, 1023.5), (0.0, 1024.0)]:
            with self.subTest(first=first, second=second):
                self.chapter = sample_chapter()
                slots = self.chapter["locations"][1]["characterPlacements"]
                slots[0]["x"], slots[1]["x"] = first, second
                self.validate()

    def test_duplicate_x_same_location_is_rejected(self):
        for second_x in (320, 320.0):
            with self.subTest(x=second_x):
                chapter = sample_chapter()
                chapter["locations"][1]["characterPlacements"][1]["x"] = second_x
                with self.assertRaisesRegex(ValueError, "横坐标重复"):
                    validate_story_definitions((chapter,), self.registry)

    def test_duplicate_character_in_same_location_is_rejected(self):
        self.chapter["locations"][1]["characterPlacements"][1]["characterId"] = "artisan-yan"
        with self.assertRaisesRegex(ValueError, "角色重复站位"):
            self.validate()

    def test_placement_array_must_be_nonempty_when_present(self):
        for invalid in ([], None, {}, "artisan-yan", 12):
            with self.subTest(placements=invalid):
                chapter = sample_chapter()
                chapter["locations"][1]["characterPlacements"] = invalid
                with self.assertRaisesRegex(ValueError, "characterPlacements"):
                    validate_story_definitions((chapter,), self.registry)

    def test_placement_requires_character_and_x_only_known_fields(self):
        bad_cases = (
            {"characterId": "artisan-yan"},
            {"x": 320},
            {"characterId": "artisan-yan", "x": 320, "y": 5},
            "bad-placement",
            None,
        )
        for invalid in bad_cases:
            with self.subTest(placement=invalid):
                chapter = sample_chapter()
                chapter["locations"][1]["characterPlacements"] = [invalid]
                with self.assertRaisesRegex(ValueError, "characterPlacements\\[0\\]"):
                    validate_story_definitions((chapter,), self.registry)

    def test_new_and_legacy_location_references_cannot_mix(self):
        for fields in (
            {"characterId": "artisan-yan"},
            {"dialogueId": "opening-cg"},
            {"characterId": "artisan-yan", "dialogueId": "opening-cg"},
        ):
            with self.subTest(fields=fields):
                chapter = sample_chapter()
                chapter["locations"][1].update(fields)
                with self.assertRaisesRegex(
                    ValueError, r"locations\[1\].*新旧角色站位写法不能混用"
                ):
                    validate_story_definitions((chapter,), self.registry)

    def test_missing_placement_dialogue_is_rejected_with_its_position(self):
        self.chapter["locations"][1]["characterPlacements"][1]["dialogueId"] = "ghost-talk"
        with self.assertRaisesRegex(
            ValueError, r"locations\[1\]\.characterPlacements\[1\]\.dialogueId"
        ):
            self.validate()

    def test_previous_single_character_dialogue_remains_compatible(self):
        legacy = self.chapter["locations"][0]
        self.assertNotIn("characterPlacements", legacy)
        self.validate()
        resolved = resolve_location_placements(self.chapter, legacy, self.registry)
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0]["characterId"], "artisan-yan")
        self.assertIsNone(resolved[0]["x"])
        self.assertEqual(resolved[0]["dialogueId"], "opening-cg")
        self.assertEqual(resolved[0]["dialogue"]["id"], "opening-cg")

    def test_npc_only_old_chapter_yields_no_new_placements(self):
        location = CHAPTERS[0]["locations"][0]
        self.assertEqual(
            resolve_location_placements(CHAPTERS[0], location, CHARACTERS), []
        )

    def test_registry_loader_detects_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "characters.json"
            contents = {"characters": EXAMPLE["characters"] * 2}
            path.write_text(json.dumps(contents, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "角色标识重复"):
                load_character_registry(path)


class StoryStartupValidationTests(unittest.TestCase):
    """Start the real HTTP server from isolated chapter/registry fixtures."""

    def _run_startup(self, fault: str | None,
                     example_kind: str = "all",
                     probe_api: bool = False) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            source_chapters = (ROOT / "chapters.py").read_text(encoding="utf-8")
            anchor = "validate_chapter_definitions(CHAPTERS)"
            self.assertEqual(source_chapters.count(anchor), 1)
            fixture_setup = """
import copy as _copy
import json as _json
from pathlib import Path as _Path
_fixture = _json.loads((_Path(__file__).parent / "example.json").read_text(encoding="utf-8"))
CHAPTERS = tuple(_copy.deepcopy(chapter) for chapter in CHAPTERS)
CHAPTERS[0]["locations"] = _fixture["locations"]
CHAPTERS[0]["dialogues"] = _fixture["dialogues"]
_modes = {
    "cg": {"opening-cg"},
    "background": {"background-change"},
    "embed": {"bronze-detail"},
    "video": {"opening-video"},
    "options": {"choice-at-forge", "background-change"},
}
_chosen = _modes.get(_example_kind)
if _chosen is not None:
    CHAPTERS[0]["dialogues"] = [
        item for item in CHAPTERS[0]["dialogues"] if item["id"] in _chosen
    ]
    _fallback = next(iter(_chosen))
    for _location in CHAPTERS[0]["locations"]:
        if "characterPlacements" in _location:
            for _slot in _location["characterPlacements"]:
                if ("dialogueId" in _slot
                        and _slot["dialogueId"] not in _chosen):
                    _slot["dialogueId"] = _fallback
        elif ("dialogueId" in _location
                and _location["dialogueId"] not in _chosen):
            _location["dialogueId"] = _fallback
if _example_kind == "two-talkers":
    CHAPTERS[0]["dialogues"].append({
        "id": "apprentice-greeting",
        "lines": [{
            "speaker": {"characterId": "apprentice-lin"},
            "text": "师傅，我也来帮忙。",
        }],
    })
    CHAPTERS[0]["locations"][1]["characterPlacements"][1]["dialogueId"] = "apprentice-greeting"
"""
            faults = {
                "enum": 'CHAPTERS[0]["dialogues"][0]["lines"][0]["media"]["display"] = "popup"\n',
                "character": 'CHAPTERS[0]["locations"][0]["characterId"] = "ghost"\n',
                "target": 'CHAPTERS[0]["dialogues"][3]["options"][0]["target"]["id"] = "ghost"\n',
                "placement_x": 'CHAPTERS[0]["locations"][1]["characterPlacements"][1]["x"] = 1025\n',
                "placement_mixed": 'CHAPTERS[0]["locations"][1]["characterId"] = "artisan-yan"\n',
                "placement_dialogue": 'CHAPTERS[0]["locations"][1]["characterPlacements"][1]["dialogueId"] = "ghost-talk"\n',
            }
            modifier = faults.get(fault, "")
            self.assertIn(example_kind, ("all", "cg", "background", "embed", "video", "options", "two-talkers"))
            fixture_setup = "_example_kind = " + repr(example_kind) + "\n" + fixture_setup
            # Create a transient chapters.py copy that executes the real, unmodified
            # quest and story startup validators against the documented example.
            source_chapters = source_chapters.replace(
                anchor, fixture_setup + modifier + "\n" + anchor, 1
            )
            (folder / "chapters.py").write_text(source_chapters, encoding="utf-8")
            (folder / "story_model.py").write_text(
                (ROOT / "story_model.py").read_text(encoding="utf-8"), encoding="utf-8"
            )
            registry_path = folder / "public/story/characters.json"
            registry_path.parent.mkdir(parents=True)
            registry_path.write_text(
                json.dumps({"characters": EXAMPLE["characters"]}, ensure_ascii=False),
                encoding="utf-8",
            )
            (folder / "example.json").write_text(
                json.dumps(EXAMPLE, ensure_ascii=False), encoding="utf-8"
            )
            environment = dict(os.environ)
            environment["PYTHONPATH"] = os.pathsep.join((str(folder), str(ROOT)))
            command = (
                "from server import create_server; "
                "import tempfile; from pathlib import Path; "
                "server = create_server('127.0.0.1', 0, "
                "str(Path(tempfile.mkdtemp()) / 'startup-check.sqlite3')); "
                "server.server_close(); print('STORY_STARTUP_OK')"
            )
            if probe_api:
                command = """
import json
import tempfile
import threading
import urllib.request
from pathlib import Path
import database
from server import create_server

dbpath = str(Path(tempfile.mkdtemp()) / "transport-check.sqlite3")
server = create_server("127.0.0.1", 0, dbpath)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    database.create_user(dbpath, "story_student", "12345678", "剧情测试学生", role="student")
    data = json.dumps({"username":"story_student","password":"12345678"}).encode("utf-8")
    base = "http://127.0.0.1:" + str(server.server_address[1])
    login_request = urllib.request.Request(
        base + "/api/auth/login", method="POST",
        headers={"Content-Type":"application/json"}, data=data)
    with urllib.request.urlopen(login_request, timeout=6) as response:
        token = json.loads(response.read())["token"]
    chapter_request = urllib.request.Request(
        base + "/api/chapters",
        headers={"Authorization":"Bearer " + token})
    with urllib.request.urlopen(chapter_request, timeout=6) as response:
        chapter = json.loads(response.read())["chapters"][0]
    slots = chapter["locations"][1]["characterPlacements"]
    assert len(slots) == 2 and slots[0]["x"] == 320 and slots[1]["x"] == 720
    assert slots[0]["dialogueId"] == "choice-at-forge"
    assert "dialogueId" not in slots[1]
    assert chapter["locations"][0]["characterId"] == "artisan-yan"
    print("STORY_HTTP_PASSTHROUGH_OK")
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)
"""
            return subprocess.run(
                [sys.executable, "-S", "-c", command], cwd=folder, env=environment,
                capture_output=True, text=True, timeout=20,
            )

    def test_existing_chapter_api_transparently_carries_placements(self):
        # No server.py changes or new endpoints: existing chapter JSON forwards slots.
        result = self._run_startup(None, probe_api=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STORY_HTTP_PASSTHROUGH_OK", result.stdout)

    def test_documented_example_starts_real_http_server(self):
        result = self._run_startup(None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STORY_STARTUP_OK", result.stdout)

    def test_each_documented_example_starts_real_http_server(self):
        # Every copyable CG/background/embed/video/option sample must work when
        # authored into a separate first-chapter definition.
        for kind in ("cg", "background", "embed", "video", "options"):
            with self.subTest(example=kind):
                result = self._run_startup(None, kind)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("STORY_STARTUP_OK", result.stdout)


    def test_two_talking_characters_example_starts_real_http_server(self):
        result = self._run_startup(None, "two-talkers")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("STORY_STARTUP_OK", result.stdout)

    def test_out_of_range_placement_prevents_http_startup(self):
        result = self._run_startup("placement_x")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("locations[1].characterPlacements[1].x", result.stderr)
        self.assertIn("1024", result.stderr)

    def test_placement_and_legacy_character_mixing_prevents_http_startup(self):
        result = self._run_startup("placement_mixed")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("locations[1]", result.stderr)
        self.assertIn("不能混用", result.stderr)

    def test_unknown_placement_dialogue_prevents_http_startup(self):
        result = self._run_startup("placement_dialogue")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("characterPlacements[1].dialogueId", result.stderr)
        self.assertIn("ghost-talk", result.stderr)

    def test_invalid_enum_fails_startup_with_field_name(self):
        result = self._run_startup("enum")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("media.display", result.stderr)
        self.assertIn("popup", result.stderr)

    def test_missing_character_fails_startup_with_field_name(self):
        result = self._run_startup("character")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("characterId", result.stderr)
        self.assertIn("ghost", result.stderr)

    def test_missing_choice_target_fails_startup_with_field_name(self):
        result = self._run_startup("target")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("target.id", result.stderr)
        self.assertIn("ghost", result.stderr)


if __name__ == "__main__":
    unittest.main()
