"""Two authored Mengjin story chapters: trusted board evidence and content contract."""
import ast
import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from story_board_rules import valid_board_answers, RULES
from story_step_evidence import validate_ordered_evidence


def quest_functions():
    tree=ast.parse((ROOT/'chapters.py').read_text(encoding='utf-8'))
    wanted={'mengjin_jade_story_quest','mengjin_diviner_story_quest'}
    namespace={}
    exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in wanted],type_ignores=[]),str(ROOT/'chapters.py'),'exec'),namespace)
    return [namespace['mengjin_jade_story_quest'](),namespace['mengjin_diviner_story_quest']()]


class TestMengjinMainline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quests=quest_functions()
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text(encoding='utf-8'))
        cls.dialogues={node['id']:node for node in cls.story['dialogues']}

    def test_mapped_narrative_steps_are_complete(self):
        for q in self.quests:
            self.assertTrue(q['completion']['requireAllSteps'])
            self.assertEqual(q['completion']['levelIds'], [])
            routes=self.story['questTargets'][q['id']]
            self.assertEqual(set(routes['steps']),{step['id'] for step in q['steps']})
            self.assertEqual(set(routes['scene']['actions']),{step['id'] for step in q['steps']}|{'done','review'})
            for step in q['steps']:
                target=routes['steps'][step['id']]
                self.assertEqual(target['type'],'dialogue')
                self.assertEqual(target['id'],step['condition']['dialogueId'])
                self.assertIn(target['id'],self.dialogues)
                self.assertNotIn('options',self.dialogues[target['id']])
            self.assertEqual(routes['scene']['actions'][q['steps'][-1]['id']][0]['action'],'complete-and-submit')
        self.assertEqual(self.quests[1]['prerequisites'],[self.quests[0]['id']])

    def test_board_answers_accepted_and_bad_ones_rejected(self):
        yes={'bits':6,'decodedOffering':'豆','encoded':'000101'}
        self.assertTrue(valid_board_answers('mengjin-jade-sixbit',yes))
        self.assertTrue(valid_board_answers('mengjin-diviner-four-symbols',{'seen':['00','01','10','11']}))
        for wrong in ({'bits':5,'decodedOffering':'豆','encoded':'000101'},
                      {'bits':6,'decodedOffering':'麻','encoded':'000101'},
                      {'bits':6,'decodedOffering':'豆','encoded':'000111'},
                      {'bits':6,'decodedOffering':'豆','encoded':'000101','isPassed':True}):
            self.assertFalse(valid_board_answers('mengjin-jade-sixbit',wrong))
        self.assertFalse(valid_board_answers('mengjin-diviner-four-symbols',{'seen':['00','01','11','11']}))

    def test_evidence_checks_board_and_retains_existing_step(self):
        quest=self.quests[0]
        step=quest['steps'][1]
        evidence={'type':'dialogue-finished','dialogueId':step['condition']['dialogueId'],
                  'boardId':step['condition']['boardId'],
                  'boardAnswers':{'bits':6,'decodedOffering':'豆','encoded':'000101'}}
        progress={'steps':{step['id']:{'status':'done','evidence':evidence}}}
        validate_ordered_evidence(quest,progress)
        broken=copy.deepcopy(progress)
        broken['steps'][step['id']]['evidence']['boardAnswers']['bits']=7
        with self.assertRaisesRegex(ValueError,'教学题板'):
            validate_ordered_evidence(quest,broken)
        old=copy.deepcopy(progress)
        # Immutable progress is accepted; evidence cannot be changed after save.
        validate_ordered_evidence(quest,progress,old)
        with self.assertRaisesRegex(ValueError,'不得修改'):
            validate_ordered_evidence(quest,broken,old)

    def test_original_preview_is_not_active_location(self):
        overlays={loc['id']:loc for loc in self.story['locations']}
        self.assertEqual(overlays['mengjin-jade-courtyard']['characterPlacements'][0]['questId'],self.quests[0]['id'])
        self.assertEqual(overlays['mengjin-diviner-residence']['characterPlacements'][0]['x'],470)
        self.assertEqual(RULES['jade']['villages'][:2],['上邽村','下邽村'])
        self.assertEqual(len(RULES['jade']['villages'])*len(RULES['jade']['offerings']),45)


if __name__ == '__main__': unittest.main()
