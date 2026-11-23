"""陶寺 3 关 9 步：一项正式有序任务，无 NPC、自述和服务端题板证据。"""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from story_board_rules import valid_board_answers
from story_step_evidence import validate_ordered_evidence


def taosi_quest():
    tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
    selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='taosi_quest']
    context={}
    exec(compile(ast.Module(body=selected,type_ignores=[]),'chapters.py','exec'),context)
    return context['taosi_quest']()

class TestTaosiMainline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quest=taosi_quest()
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.dialogue={dialogue['id']:dialogue for dialogue in cls.story['dialogues']}

    def test_three_formal_lessons_in_one_ordered_quest(self):
        q=self.quest
        self.assertEqual(q['id'],'taosi-three-pages')
        self.assertEqual(q['prerequisites'],['mengjin-school-lower'])
        self.assertEqual(q['locationId'],'taosi-old-academy')
        self.assertTrue(q['completion']['requireAllSteps'])
        self.assertEqual(q['completion']['levelIds'],[])
        self.assertEqual(len(q['steps']),9)
        self.assertEqual(sum(bool(step['condition'].get('boardId')) for step in q['steps']),3)
        self.assertEqual([step['id'] for step in q['steps'] if step['condition'].get('boardId')],
                         ['taosi-one-board','taosi-two-board','taosi-three-board'])

    def test_routes_and_story_no_npc(self):
        q=self.quest
        targets=self.story['questTargets'][q['id']]
        ids={step['id'] for step in q['steps']}
        self.assertEqual(set(targets['steps']),ids)
        self.assertEqual(set(targets['scene']['actions']),ids | {'done','review'})
        self.assertEqual(set(targets['scene']['checkpoints']['steps']),ids)
        self.assertEqual(set(targets['scene']['hints']),ids | {'done'})
        for step in q['steps']:
            dialogue_id=targets['steps'][step['id']]['id']
            self.assertEqual(dialogue_id,step['condition']['dialogueId'])
            self.assertIn(dialogue_id,self.dialogue)
            self.assertTrue(all(line['speaker'].get('characterId') in (None,'zi')
                for line in self.dialogue[dialogue_id]['lines']))
        for step in q['steps'][:-1]:
            self.assertNotEqual(targets['scene']['actions'][step['id']][0]['action'],'complete-and-submit')
        self.assertEqual(targets['scene']['actions'][q['steps'][-1]['id']][0]['action'],'complete-and-submit')
        location=next(location for location in self.story['locations'] if location['id']=='taosi-old-academy')
        self.assertNotIn('characterPlacements',location)
        self.assertNotIn('dialogueId',location)
        src=(ROOT/'public/room.js').read_text('utf-8')
        self.assertIn("location.soloNarration === true",src)
        self.assertIn("element.hidden=true",src)

    def test_server_validates_all_three_board_answers(self):
        q=self.quest
        rep={
          'categories':{'jade':'representation','sundial':'representation','flags':'representation','counters':'operation'},
          'relations':{'jade':'copy','sundial':'copy','flags':'copy','counters':'plus-one'},
          'counterexample':'moving-tablet'
        }
        direction={'edges':['A>B','B>C','C>D'],'order':'ABCD','ringConclusion':'cycle-needs-rule'}
        oneway={'forward':'pass','reverse':'block','maxStages':7,'tradeoff':'reverse-lost'}
        for step,answer in zip([s for s in q['steps'] if s['condition'].get('boardId')],
                               [rep,direction,oneway]):
            board_id=step['condition']['boardId']
            self.assertTrue(valid_board_answers(board_id,answer))
            progress={'steps':{step['id']:{'status':'done','evidence':{
                'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
                'boardId':board_id,'boardAnswers':answer}}}}
            validate_ordered_evidence(q,progress)
            bad=copy.deepcopy(answer);bad['fakePass']=True
            self.assertFalse(valid_board_answers(board_id,bad))
            broken=copy.deepcopy(progress)
            broken['steps'][step['id']]['evidence']['boardAnswers']=bad
            with self.assertRaisesRegex(ValueError,'服务端校验'):
                validate_ordered_evidence(q,broken)
            with self.assertRaisesRegex(ValueError,'不得修改'):
                validate_ordered_evidence(q,broken,progress)
        self.assertFalse(valid_board_answers('taosi-oneway-board', {**oneway,'maxStages':True}))
        self.assertFalse(valid_board_answers('taosi-direction-board', {**direction,'edges':['D>C','B>C','C>D']}))

    def test_backend_one_solo_owner_constraint_and_art(self):
        self.assertEqual(len([k for k in self.story['questTargets'] if k.startswith('taosi')]),2)
        mp=(ROOT/'public/chapter-one-region-maps.js').read_text('utf-8')
        self.assertIn("id:'taosi-old-academy-dot'",mp)
        self.assertIn('hotspots:TAOSI_SPOTS',mp)
        self.assertIn("id:'mengjin-inner-court', x:0.3340, y:0.4030",mp)
        self.assertIn("id:'mengjin-river-gate', x:0.5930, y:0.5660",mp)
        uploaded=(ROOT/'public/assets/scenes/taosi-old-academy-day.png').read_bytes()
        manifest=json.loads((ROOT/'tools/asset-manifest.json').read_text('utf-8'))
        asset=next(p for p in manifest['active_assets'] if p['to']=='/assets/scenes/taosi-old-academy-day.png')
        self.assertEqual(asset['size'],len(uploaded))
        self.assertEqual(asset['sha256'],hashlib.sha256(uploaded).hexdigest())

if __name__=='__main__':unittest.main()
