"""V8.1 army scenes: real actors, no old desk trigger, immutable circuit specs."""
import ast
from pathlib import Path
import json
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
NAMES=['not','and','or','nor','xor','xnor']
SITES=[
    ('not','yangcheng-valley-deception',{'将军','斥候'}),
    ('and','yangcheng-camp-assault',{'将军','军吏'}),
    ('or','yangcheng-camp-supply',{'军吏'}),
    ('nor','yangcheng-valley-bivouac',{'将军','军吏'}),
    ('xor','yangcheng-watch-night',{'哨兵'}),
    ('xnor','yangcheng-camp-seal',{'信使','将军'}),
]
class TestYangchengNpcV81(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text(encoding='utf-8'))
        cls.roster={c['id']:c['name'] for c in cls.story['characters']}
        cls.locations={v['id']:v for v in cls.story['locations']}
        cls.dialogues={v['id']:v for v in cls.story['dialogues']}

    def test_per_scene_real_npcs_and_primary_binding(self):
        for key,loc_id,required in SITES:
            with self.subTest(key=key):
                loc=self.locations[loc_id]
                slots=loc['characterPlacements']
                self.assertGreaterEqual(len(slots),2)
                self.assertEqual(len({s['characterId'] for s in slots}),len(slots))
                self.assertEqual(len({s['x'] for s in slots}),len(slots))
                self.assertTrue(all(0<=s['x']<=1024 for s in slots))
                xs=[s['x'] for s in slots]
                self.assertTrue(all(abs(a-b)>=70 for i,a in enumerate(xs) for b in xs[i+1:]))
                names={self.roster[s['characterId']] for s in slots}
                self.assertTrue(required.issubset(names))
                self.assertIn(loc['npc'],names)
                owners=[s for s in slots if s.get('questId')]
                self.assertEqual(len(owners),1)
                self.assertEqual(owners[0]['questId'],f'yangcheng-army-{key}')
                self.assertEqual(owners[0]['dialogueId'],f'army-{key}-intro')
                self.assertEqual(owners[0]['characterId'],slots[0]['characterId'])
                dialogue=self.dialogues[f'army-{key}-intro']
                spoken={line['speaker'].get('name') for line in dialogue['lines']}
                self.assertTrue((spoken-{'旁白', None}).issubset(names|{'丑'}))

    def test_previous_six_scenes_and_levels_remain_intact(self):
        # Portable across developer machines; do not require a /tmp baseline.
        for key in NAMES:
            self.assertIn(f'yangcheng-army-{key}',self.story['questTargets'])
            for suffix in ('intro','practice','report'):
                self.assertIn(f'army-{key}-{suffix}',self.dialogues)
            spec=json.loads((ROOT/f'levels/ch1_army_{key}_v1.json').read_text('utf8'))
            self.assertEqual(spec['allowedTypes'],['input','output','nand'])
            self.assertEqual(spec['allowedPackages'],['cmos_nand'])
        for _,loc_id,_ in SITES:
            self.assertIn(loc_id,self.locations)

    def test_js_only_changes_to_scoped_display(self):
        room=(ROOT/'public/room.js').read_text('utf-8')
        app=(ROOT/'public/app.js').read_text('utf-8')
        self.assertIn('room-stage--army-dialogue',room)
        self.assertIn('const questForActor = actor',room)
        self.assertIn('armyDialogue && actor && sceneQuests.length === 1',room)
        self.assertIn("? [] : spec.allowedPackages",app)
        self.assertIn("location.soloNarration === true",room)
        self.assertIn("node('span',location.soloPlayerName||'丑',playerElement)",room)
        self.assertTrue((ROOT/'public/yangcheng-scene.css').exists())

if __name__=='__main__': unittest.main()
