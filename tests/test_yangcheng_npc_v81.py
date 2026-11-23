"""阳城六事：实际军中人物站位、主要任务持有人及对话引用。"""
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
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
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.names={c['id']:c['name'] for c in cls.story['characters']}
        cls.locations={loc['id']:loc for loc in cls.story['locations']}
        cls.dialogues={dlg['id']:dlg for dlg in cls.story['dialogues']}

    def test_each_event_has_real_characters_and_one_quest_owner(self):
        for key,locid,expected in SITES:
            with self.subTest(event=key):
                scene=self.locations[locid]
                slots=scene['characterPlacements']
                self.assertGreaterEqual(len(slots),2)
                self.assertEqual(len({slot['x'] for slot in slots}),len(slots))
                self.assertTrue(all(0<=slot['x']<=1024 for slot in slots))
                present={self.names[slot['characterId']] for slot in slots}
                self.assertTrue(expected<=present)
                self.assertIn(scene['npc'],present)
                owners=[slot for slot in slots if slot.get('questId')]
                self.assertEqual(len(owners),1)
                self.assertEqual(owners[0]['questId'],f'yangcheng-army-{key}')
                self.assertEqual(owners[0]['dialogueId'],f'army-{key}-intro')
                spoken={line['speaker'].get('name') for line in
                    self.dialogues[f'army-{key}-intro']['lines']}
                self.assertTrue((spoken-{'旁白',None})<=present|{'丑'})

    def test_army_rooms_are_not_old_academy_solo_narration(self):
        # Actors talk in the camp; the old academy desk control must not be reused.
        for _,locid,_ in SITES:
            with self.subTest(room=locid):
                self.assertFalse(self.locations[locid].get('soloNarration',False))
        source=(ROOT/'public/room.js').read_text('utf-8')
        self.assertIn('room-stage--army-dialogue',source)
        self.assertIn('armyDialogue',source)
        self.assertTrue((ROOT/'public/yangcheng-scene.css').is_file())

    def test_six_formal_levels_exist(self):
        for name,_,_ in SITES:
            f=ROOT/f'levels/ch1_army_{name}_v1.json'
            self.assertTrue(f.is_file(),str(f))
            data=json.loads(f.read_text('utf-8'))
            self.assertEqual(data['id'],f'ch1_army_{name}')
            self.assertIn('nand',data['allowedTypes'])

if __name__=='__main__': unittest.main()
