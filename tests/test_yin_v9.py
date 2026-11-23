"""Second-part content contracts: new quest routing, server vectors, no duplicate palettes.
No side effects; tests run with Python stdlib only, independently of user database.
"""
import ast
import itertools
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def literal(name):
    tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
    for node in tree.body:
        if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError('Definition missing: '+name)


class YinContentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quests=literal('YIN_NEW_QUESTS')
        cls.locations=literal('YIN_NEW_LOCATIONS')
        cls.levels=literal('YIN_NEW_LEVELS')
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.known_dialogues={d['id'] for d in cls.story['dialogues']}

    def test_quest_prerequisites_and_server_grade_paths(self):
        self.assertEqual(len(self.quests),13)
        known={quest['id'] for quest in self.quests}
        for quest in self.quests:
            self.assertEqual(quest['completion']['requireAllSteps'],True)
            self.assertIn(quest['locationId'],{loc['id'] for loc in self.locations})
            self.assertIn(quest['id'],self.story['questTargets'])
            self.assertEqual(set(self.story['questTargets'][quest['id']]['steps']),
                             {s['id'] for s in quest['steps']})
            for prereq in quest['prerequisites']:
                self.assertIn(prereq,known|{'yangcheng-army-xnor'})
            for step in quest['steps']:
                condition=step['condition']
                if condition['type']=='dialogue-finished':
                    self.assertIn(condition['dialogueId'],self.known_dialogues)
                if condition['type']=='level-completed':
                    self.assertIn(condition['levelId'],{lvl['id'] for lvl in self.levels})
                    self.assertEqual(quest['completion']['mode'],'official-circuit')
            self.assertEqual(quest['steps'][-1]['condition']['type'],'dialogue-finished')

    def test_real_npc_placements_and_scene_assets(self):
        for loc in self.locations:
            overlay=next(x for x in self.story['locations'] if x['id']==loc['id'])
            self.assertEqual(loc['roomType'],'story')
            self.assertFalse(loc.get('soloNarration',False))
            self.assertTrue((ROOT/'public'/loc['background'].removeprefix('/')).is_file())
            self.assertGreaterEqual(len(overlay['characterPlacements']),2)
            self.assertEqual(len({item['characterId'] for item in overlay['characterPlacements']}),
                             len(overlay['characterPlacements']))
            self.assertEqual(len([i for i in overlay['characterPlacements'] if i.get('questId')]),1)

    def test_one_tool_representation_no_double_offer(self):
        for level in self.levels:
            obj=json.loads((ROOT/f"levels/{level['id']}_v1.json").read_text('utf-8'))
            self.assertEqual(obj['id'],level['id'])
            self.assertTrue(set(obj['allowedTypes']).isdisjoint({'mux2','half_adder','full_adder'}))
            self.assertEqual(len(set(obj['allowedTypes'])),len(obj['allowedTypes']))
            self.assertEqual(len(set(obj['allowedPackages'])),len(obj['allowedPackages']))
            self.assertNotIn('cmos_nand',obj['allowedPackages'])
            self.assertEqual(obj['layer'],'gate')
            self.assertEqual(obj['version'],1)
            self.assertEqual(obj['chapterId'],'ch1')
            self.assertEqual(obj['initialGraph']['wires'],[])
            self.assertTrue(obj['hiddenVectors'] or obj['sequentialScripts'])
            self.assertLessEqual(len(obj['hiddenVectors']),64)
            for script in obj['sequentialScripts']:
                self.assertLessEqual(len(script['steps']),64)

    def test_512_server_truth_vectors_for_four_bit(self):
        for name in ['ripple4','cla4']:
            obj=json.loads((ROOT/f'levels/ch1_yin_{name}_v1.json').read_text('utf-8'))
            rows=[step for script in obj['sequentialScripts'] for step in script['steps']]
            self.assertEqual(len(rows),512)
            cases=set()
            for row in rows:
                A=sum(row['inputs'][f'A{i}']<<i for i in range(4))
                B=sum(row['inputs'][f'B{i}']<<i for i in range(4))
                C=row['inputs']['Cin']
                cases.add((A,B,C))
                target=A+B+C
                self.assertEqual(row['expect'],{**{f'S{i}':(target>>i)&1 for i in range(4)},'Cout':(target>>4)&1})
            self.assertEqual(len(cases),512)

    def test_cla_equations_server_validation(self):
        from yin_carry_rules import valid_expansion_answers
        correct={
         'C2':'G1 + P1*G0 + P1*P0*C0',
         'C3':'G2+P2*G1+P2*P1*G0+P2*P1*P0*C0',
         'C4':'G3+P3*G2+P3*P2*G1+P3*P2*P1*G0+P3*P2*P1*P0*C0',
        }
        self.assertTrue(valid_expansion_answers(correct))
        self.assertFalse(valid_expansion_answers(dict(correct,C4='G3+P3*G2')))
        self.assertFalse(valid_expansion_answers(dict(correct,C2='G1 + P1*C1')))
        self.assertFalse(valid_expansion_answers(dict(correct,C2='__import__("os")')))
        self.assertFalse(valid_expansion_answers({'C2':correct['C2']}))

    def test_existing_history_and_quest_names_preserved(self):
        # Portable: do not depend on developer-only /tmp paths.
        for quest_id in ('mengjin-jade-mainline','taosi-chou-handoff',
                         'taosi-nand-first','yangcheng-army-xnor'):
            self.assertIn(quest_id,self.story['questTargets'])
        for dialogue_id in ('mengjin-jade-story-opening', 'taosi-chou-intro',
                            'taosi-nand-intro', 'army-xnor-report'):
            self.assertIn(dialogue_id,self.known_dialogues)
        self.assertEqual(len(self.story['dialogues']),len(self.known_dialogues))
        self.assertEqual(len(self.story['locations']),
                         len({place['id'] for place in self.story['locations']}))

if __name__=='__main__':unittest.main()
