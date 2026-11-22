"""Mengjin official school: chapter routes, NPC placements, four board rules,
trusted submitted evidence and preservation of both original map coordinates."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from story_board_rules import valid_board_answers, RULES
from story_step_evidence import validate_ordered_evidence


def school_quests():
    tree=ast.parse((ROOT/'chapters.py').read_text(encoding='utf-8'))
    names={'mengjin_school_upper_quest','mengjin_school_lower_quest'}
    selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
    env={}
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(ROOT/'chapters.py'),'exec'),env)
    return [env['mengjin_school_upper_quest'](),env['mengjin_school_lower_quest']()]


class TestSchoolMainline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upper, cls.lower=school_quests()
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text(encoding='utf-8'))
        cls.dialogues={d['id']:d for d in cls.story['dialogues']}

    def test_story_targets_and_dialogues(self):
        for quest in (self.upper,self.lower):
            target=self.story['questTargets'][quest['id']]
            self.assertEqual(target['scene']['autoAccept'],True)
            self.assertEqual(target['scene']['autoSubmit'],True)
            self.assertEqual(set(target['steps']),{s['id'] for s in quest['steps']})
            self.assertEqual(set(target['scene']['actions']),{s['id'] for s in quest['steps']}|{'done','review'})
            self.assertEqual(quest['completion']['mode'],'test-only')
            self.assertEqual(quest['completion']['levelIds'],[])
            self.assertTrue(quest['completion']['requireAllSteps'])
            for step in quest['steps']:
                did=step['condition']['dialogueId']
                self.assertEqual(target['steps'][step['id']]['id'],did)
                self.assertIn(did,self.dialogues)
                self.assertNotIn('options',self.dialogues[did])
            self.assertEqual(target['scene']['actions'][quest['steps'][-1]['id']][0]['action'],'complete-and-submit')
        self.assertEqual(self.upper['prerequisites'],['mengjin-diviner-mainline'])
        self.assertEqual(self.lower['prerequisites'],[self.upper['id']])

    def test_school_has_separate_actors_and_the_right_npc_binds_to_each_quest(self):
        overlays={d['id']:d for d in self.story['locations']}
        slots=overlays['mengjin-school-courtyard']['characterPlacements']
        self.assertEqual([(s['characterId'],s['x'],s['questId']) for s in slots],
                         [('zi',450,self.upper['id']),('chou',658,self.lower['id'])])
        self.assertIn('hai',{c['id'] for c in self.story['characters']})
        self.assertEqual({c['id'] for c in self.story['characters']} & {'zi','chou'}, {'zi','chou'})
        # Confirm school board lesson is never accidentally bound to the old decoder.
        self.assertFalse(any('ch1_binary_decoder' in str(t) for t in
                             [self.story['questTargets'][self.upper['id']],self.story['questTargets'][self.lower['id']]]))

    def test_truth_table_correctness_and_strict_server_evidence(self):
        board='mengjin-school-truth-table'; right={'outputs':[0,0,0,1,0,1,1,1]}
        self.assertTrue(valid_board_answers(board,right))
        for wrong in ({'outputs':[0]*8}, {'outputs':right['outputs'][:7]},
                      {'outputs':[False,0,0,1,0,1,1,1]},
                      {'outputs':right['outputs'],'passed':True}):
            self.assertFalse(valid_board_answers(board,wrong))
        step=self.upper['steps'][1]
        progress={'steps':{step['id']:{'status':'done','evidence':{
          'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
          'boardId':board,'boardAnswers':right}}}}
        validate_ordered_evidence(self.upper,progress)
        modified=copy.deepcopy(progress)
        modified['steps'][step['id']]['evidence']['boardAnswers']['outputs'][3]=0
        with self.assertRaisesRegex(ValueError,'教学题板'):validate_ordered_evidence(self.upper,modified)
        with self.assertRaisesRegex(ValueError,'不得修改'):validate_ordered_evidence(self.upper,modified,progress)

    def test_remaining_tasks_have_server_verified_answers(self):
        table=[
          ('mengjin-school-fault-check',{'faultInput':'10'}, {'faultInput':'11'}),
          ('mengjin-school-delay-path',{'criticalPath':'lower','totalDelay':7}, {'criticalPath':'upper','totalDelay':3}),
          ('mengjin-school-signal-regen',{'action':'regenerate','numericLimit':'unknown'},
            {'action':'ignore','numericLimit':'unknown'}),
        ]
        for board,correct,incorrect in table:
            with self.subTest(board=board):
                self.assertTrue(valid_board_answers(board,correct))
                self.assertFalse(valid_board_answers(board,incorrect))
                self.assertFalse(valid_board_answers(board,{**correct,'isPassed':True}))
                step=next(s for s in self.lower['steps'] if s['condition'].get('boardId')==board)
                evidence={'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
                          'boardId':board,'boardAnswers':correct}
                validate_ordered_evidence(self.lower,{'steps':{step['id']:{'status':'done','evidence':evidence}}})

    def test_board_specifications_are_explicit_and_image_is_user_upload(self):
        specs=RULES['school']
        self.assertEqual(set(specs),{'truth','fault','delay','regen'})
        self.assertEqual(len(specs['truth']['inputs']),8)
        self.assertEqual(specs['delay']['paths'],{'upper':3,'lower':7})
        self.assertIn('没有给定',specs['regen']['note'])
        manifest=json.loads((ROOT/'tools/asset-manifest.json').read_text(encoding='utf-8'))
        entry=next(item for item in manifest['active_assets']
                   if item['to']=='/assets/scenes/mengjin-school-day.png')
        binary=(ROOT/'public/assets/scenes/mengjin-school-day.png').read_bytes()
        self.assertEqual(entry['size'],len(binary))
        self.assertEqual(entry['sha256'],hashlib.sha256(binary).hexdigest())

    def test_map_has_only_two_original_spots_in_original_positions(self):
        js=(ROOT/'public/chapter-one-region-maps.js').read_text(encoding='utf-8')
        self.assertIn("id:'mengjin-inner-court', x:0.3522, y:0.4274",js)
        self.assertIn("id:'mengjin-river-gate', x:0.5420, y:0.5399",js)
        self.assertIn("locationId:'mengjin-school-courtyard'",js)
        self.assertNotIn('mengjin-third-dot',js)

if __name__=='__main__':unittest.main()
