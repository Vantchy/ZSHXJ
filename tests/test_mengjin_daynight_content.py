import unittest
from pathlib import Path
from chapters import BY_ID
from story_route_rules import validate_story_routes
import json

class MengjinDayNightTests(unittest.TestCase):
    def test_quests_and_dependency(self):
        c=BY_ID['ch1']; side={q['id']:q for q in c['quests']['side']}
        self.assertEqual(side['mengjin-diviner-story']['prerequisites'],['mengjin-jade-story'])
        self.assertTrue(side['mengjin-diviner-story']['completion']['requireAllSteps'])
        self.assertEqual(len(side['mengjin-diviner-story']['steps']),3)
        self.assertEqual(side['mengjin-diviner-story']['completion']['levelIds'],[])
        self.assertEqual(side['binary-decoder']['id'],'binary-decoder')
    def test_places_and_scene(self):
        c=BY_ID['ch1']; places={loc['id']:loc for loc in c['locations']}
        self.assertEqual(places['mengjin-diviner-residence']['spawnX'],900)
        self.assertEqual(places['mengjin-diviner-residence']['entryPrerequisites'],['mengjin-jade-story'])
        self.assertEqual(places['mengjin-jade-courtyard']['roomType'],'story')
        art=Path(__file__).resolve().parents[1]/'public/assets/scenes/mengjin-diviner-night.png'
        self.assertTrue(art.is_file())
    def test_story_route_valid(self):
        c=BY_ID['ch1']; story=json.loads((Path(__file__).resolve().parents[1]/'public/story/ch1.json').read_text('utf8'))
        validated=validate_story_routes(c,story)
        self.assertIn('mengjin-diviner-story', validated['questTargets'])
        self.assertIn('mengjin-jade-story', validated['questTargets'])
if __name__=='__main__':unittest.main()
