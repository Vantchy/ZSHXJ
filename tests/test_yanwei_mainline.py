"""嫣沩日夜正式主线：服务端证据、场景绑定、全部三页算稿。"""
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


def quest(start):
    tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
    definitions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='yanwei_quest']
    assert len(definitions)==1
    scope={}
    exec(compile(ast.Module(body=definitions,type_ignores=[]),'chapters.py','exec'),scope)
    return scope['yanwei_quest'](start)

class TestYanweiMainline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.dialogues={d['id']:d for d in cls.story['dialogues']}
        cls.rules=json.loads((ROOT/'public/scene-activities/mengjin-teaching-boards.json').read_text('utf-8'))['yanwei']

    def test_two_lights_two_quests_three_lessons_nine_steps(self):
        day=quest(4);night=quest(5)
        self.assertEqual((day['id'],night['id']),('yanwei-day-four','yanwei-night-five-six'))
        self.assertEqual((day['prerequisites'],night['prerequisites']),(['taosi-three-pages'],['yanwei-day-four']))
        self.assertEqual((day['locationId'],night['locationId']),('yanwei-riverside-day','yanwei-riverside-night'))
        self.assertEqual((len(day['steps']),len(night['steps'])),(3,6))
        self.assertEqual([step['condition'].get('boardId') for step in day['steps']+night['steps'] if step['condition'].get('boardId')],
            ['yanwei-backflow-board','yanwei-cascade-board','yanwei-merge-board'])
        for q in [day,night]:
            self.assertEqual(q['completion']['mode'],'test-only')
            self.assertTrue(q['completion']['requireAllSteps'])
            targets=self.story['questTargets'][q['id']]
            steps=[step['id'] for step in q['steps']]
            self.assertEqual(set(targets['steps']),set(steps))
            self.assertEqual(set(targets['scene']['checkpoints']['steps']),set(steps))
            self.assertEqual(set(targets['scene']['actions']),set(steps)|{'done','review'})
            self.assertEqual(set(targets['scene']['hints']),set(steps)|{'done'})
            self.assertEqual(targets['scene']['actions'][steps[-1]][0]['action'],'complete-and-submit')
            for step in q['steps']:
                evidence=step['condition']
                self.assertEqual(targets['steps'][step['id']]['id'],evidence['dialogueId'])
                self.assertIn(evidence['dialogueId'],self.dialogues)
                for line in self.dialogues[evidence['dialogueId']]['lines']:
                    self.assertIn(line['speaker'].get('characterId'),[None,'zi'])
        for location_id in ['yanwei-riverside-day','yanwei-riverside-night']:
            at=next(x for x in self.story['locations'] if x['id']==location_id)
            self.assertNotIn('dialogueId',at)
            self.assertNotIn('characterPlacements',at)

    def test_server_board_validation_and_tamper(self):
        answers={
            'yanwei-backflow-board':{'blocked':['C>B','D>A'],'diagnosis':'reverse-backflow','perturbationPassed':True},
            'yanwei-cascade-board':{'start':'A=1','stableTicks':[1,2,3],'fanoutLoads':2,'fanoutConclusion':'within-limit'},
            'yanwei-merge-board':{'tried':['pass-a','pass-b','const-0','const-1'],
                                  'targetOutputs':[0,0,0,1],'missingStructure':'merge-two'},
        }
        for q in [quest(4),quest(5)]:
            for step in q['steps']:
                board=step['condition'].get('boardId')
                if board is None:continue
                answer=answers[board]
                self.assertTrue(valid_board_answers(board,answer))
                progress={'steps':{step['id']:{'status':'done','evidence':{
                    'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
                    'boardId':board,'boardAnswers':answer,
                }}}}
                validate_ordered_evidence(q,progress)
                bad=copy.deepcopy(answer);bad['extra']=True
                self.assertFalse(valid_board_answers(board,bad))
                progress['steps'][step['id']]['evidence']['boardAnswers']=bad
                with self.assertRaises(ValueError):validate_ordered_evidence(q,progress)
        self.assertFalse(valid_board_answers('yanwei-backflow-board',
            {**answers['yanwei-backflow-board'],'blocked':['C>B']}))
        self.assertFalse(valid_board_answers('yanwei-backflow-board',
            {**answers['yanwei-backflow-board'],'blocked':[{'bad':'edge'},'D>A']}))
        self.assertFalse(valid_board_answers('yanwei-cascade-board',
            {**answers['yanwei-cascade-board'],'stableTicks':[3,2,1]}))
        self.assertFalse(valid_board_answers('yanwei-merge-board',
            {**answers['yanwei-merge-board'],'tried':[{},'pass-a','pass-b','const-0']}))
        self.assertFalse(valid_board_answers('yanwei-merge-board',
            {**answers['yanwei-merge-board'],'targetOutputs':[0,0,1,1]}))

    def test_no_new_circuit_grades_and_expected_art(self):
        manifest=json.loads((ROOT/'tools/asset-manifest.json').read_text('utf-8'))
        for time in ['day','night']:
            path=ROOT/f'public/assets/scenes/yanwei-riverside-{time}.png'
            item=next(x for x in manifest['active_assets'] if x['to']==f'/assets/scenes/yanwei-riverside-{time}.png')
            self.assertEqual((item['sha256'],item['size']),
                             (hashlib.sha256(path.read_bytes()).hexdigest(),path.stat().st_size))
        chapters=(ROOT/'chapters.py').read_text('utf-8')
        self.assertIn("'soloNarration':True,'soloPlayerName':'子'",chapters)
        self.assertIn("'entryPrerequisites':['taosi-three-pages']",chapters)
        self.assertIn("'entryPrerequisites':['yanwei-day-four']",chapters)
        route=(ROOT/'public/mengjin-stage-route.js').read_text('utf-8')
        self.assertIn("spot?.id === 'yanwei-workshop-dot'",route)
        app=(ROOT/'public/app.js').read_text('utf-8')
        self.assertIn("function showChapterMap(chapterId, regionId",app)
        self.assertNotIn("mountMengjinCatalog(",app)
        self.assertIn("location.id.startsWith('yanwei-riverside-')",app)

if __name__=='__main__':unittest.main()
