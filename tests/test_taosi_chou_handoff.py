"""丑返旧学舍：与老妇对白、书案引导板、正式主线交接。"""
import ast
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from story_board_rules import valid_board_answers
from story_step_evidence import validate_ordered_evidence


def quest():
    tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
    definitions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='taosi_chou_handoff_quest']
    assert len(definitions)==1
    scope={}
    exec(compile(ast.Module(body=definitions,type_ignores=[]),'chapters.py','exec'),scope)
    return scope['taosi_chou_handoff_quest']()

class TestTaosiChouHandoff(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.dialogues={d['id']:d for d in cls.story['dialogues']}

    def test_story_quest_shape(self):
        q=quest()
        self.assertEqual(q['id'],'taosi-chou-handoff')
        self.assertEqual(q['locationId'],'taosi-old-academy-return')
        self.assertEqual(q['prerequisites'],['yanwei-night-five-six'])
        self.assertEqual([step['id'] for step in q['steps']],
            ['chou-meet-old-woman','chou-read-manuscript','chou-take-responsibility'])
        self.assertEqual(q['steps'][1]['condition']['boardId'],'taosi-handoff-board')
        targets=self.story['questTargets'][q['id']]
        self.assertEqual(set(targets['steps']),set(step['id'] for step in q['steps']))
        self.assertEqual(targets['scene']['actions'][q['steps'][-1]['id']][0]['action'],'complete-and-submit')
        loc=next(x for x in self.story['locations'] if x['id']=='taosi-old-academy-return')
        self.assertEqual(loc['characterPlacements'][0]['characterId'],'old-woman')
        for dialogue_id in ['taosi-chou-intro','taosi-chou-board-done','taosi-chou-report']:
            self.assertIn(dialogue_id,self.dialogues)

    def test_chapters_registry_contains_every_story_location(self):
        # Validate the same authoritative location set referenced by the
        # startup story router. This catches the V7 missing-location regression.
        tree=ast.parse((ROOT/'chapters.py').read_text('utf-8'))
        names={'FORMAL_LEVELS','BINARY_LEVEL','CHAPTERS'}
        selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) or
                  (isinstance(node,ast.Assign) and any(
                      isinstance(target,ast.Name) and target.id in names
                      for target in node.targets))]
        scope={}
        exec(compile(ast.Module(body=selected,type_ignores=[]),'chapters.py','exec'),scope)
        chapter=scope['CHAPTERS'][0]
        locations={item['id']:item for item in chapter['locations']}
        self.assertTrue(set(item['id'] for item in self.story['locations']) <= set(locations))
        for quest_def in chapter['quests']['side']:
            self.assertIn(quest_def['locationId'],locations)
            for dependency in quest_def['prerequisites']:
                self.assertIn(dependency,{q['id'] for q in chapter['quests']['side']})
        loc=locations['taosi-old-academy-return']
        self.assertEqual(loc['background'],'/assets/scenes/taosi-old-academy-day.png')
        self.assertEqual(loc['entryPrerequisites'],['yanwei-night-five-six'])
        self.assertEqual(loc['spawnX'],908)
        self.assertEqual(loc['roomType'],'story')

    def test_board_validation_and_evidence(self):
        q=quest()
        step=q['steps'][1]
        answer={'source':'zi-notes','obstacle':'needs-merge-and-craft','firstTask':'nand-first'}
        self.assertTrue(valid_board_answers('taosi-handoff-board',answer))
        progress={'steps':{step['id']:{'status':'done','evidence':{
            'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
            'boardId':'taosi-handoff-board','boardAnswers':answer,
        }}}}
        validate_ordered_evidence(q,progress)
        bad=copy.deepcopy(answer);bad['firstTask']='xor-first'
        self.assertFalse(valid_board_answers('taosi-handoff-board',bad))
        progress['steps'][step['id']]['evidence']['boardAnswers']=bad
        with self.assertRaises(ValueError):
            validate_ordered_evidence(q,progress)

if __name__=='__main__':
    unittest.main()
