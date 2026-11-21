"""Reusable NPC-scene configuration is checked against the real quest model."""
import copy
import unittest

from chapters import BY_ID, STORY_ROUTES
from story_route_rules import validate_story_routes


class ScenePolicyValidation(unittest.TestCase):
    def setUp(self):
        self.chapter = copy.deepcopy(BY_ID['ch1'])
        self.story = copy.deepcopy(STORY_ROUTES['ch1'])
        self.route = self.story['questTargets']['binary-decoder']
        self.scene = self.route['scene']

    def assert_bad(self, expected):
        with self.assertRaisesRegex(ValueError, expected):
            validate_story_routes(self.chapter, self.story)

    def test_deployed_workshop_policy_is_authorized(self):
        self.assertIs(validate_story_routes(self.chapter, self.story), self.story)
        self.assertEqual(self.scene['actions']['listen-workshop'][0]['action'],
                         'complete-and-level')

    def test_unsupported_manual_accept_or_submit_does_not_create_dead_end(self):
        self.scene['autoAccept'] = False
        self.assert_bad('自动接取和自动交付')
        self.scene['autoAccept'] = True
        self.scene['autoSubmit'] = False
        self.assert_bad('自动接取和自动交付')

    def test_two_primary_npc_scenes_in_same_room_are_not_silently_ignored(self):
        another = copy.deepcopy(self.chapter['quests']['side'][-1])
        another['id'] = 'other-scene'
        self.chapter['quests']['side'].append(another)
        other_routes = copy.deepcopy(self.route)
        self.story['questTargets']['other-scene'] = other_routes
        self.assert_bad('同一地点存在多个场景主任务')

    def test_second_location_and_different_quest_ids_use_same_scene_contract(self):
        new_location = copy.deepcopy(self.chapter['locations'][0])
        new_location.update(id='weaver-hut', name='织者居',
                            background='/assets/scenes/weaver-hut.png')
        self.chapter['locations'].append(new_location)
        original = next(q for q in self.chapter['quests']['side']
                        if q['id'] == 'binary-decoder')
        quest = copy.deepcopy(original)
        quest.update(id='weaver-numbers', locationId='weaver-hut')
        quest['completion']['levelIds'] = ['ch1_half_adder']
        quest['steps'][0]['id'] = 'hear-weaver'
        quest['steps'][0]['condition']['dialogueId'] = 'weaver-end'
        quest['steps'][1]['id'] = 'build-pattern'
        quest['steps'][1]['condition']['levelId'] = 'ch1_half_adder'
        quest['steps'][2]['id'] = 'return-weaver'
        quest['steps'][2]['condition']['dialogueId'] = 'weaver-report'
        self.chapter['quests']['side'].append(quest)
        self.story['locations'].append({
            'id':'weaver-hut', 'npc':'织者', 'dialogueId':'weaver-start'
        })
        self.story['dialogues'].extend([
            {'id':'weaver-start', 'lines':[{'speaker':{'name':'织者'},'text':'甲'}],
             'options':[{'text':'好', 'target':{'type':'dialogue','id':'weaver-end'}}]},
            {'id':'weaver-end', 'lines':[{'speaker':{'name':'织者'},'text':'乙'}]},
            {'id':'weaver-practice', 'lines':[{'speaker':{'name':'织者'},'text':'丙'}]},
            {'id':'weaver-report', 'lines':[{'speaker':{'name':'织者'},'text':'丁'}]},
            {'id':'weaver-finished', 'lines':[{'speaker':{'name':'织者'},'text':'戊'}]},
        ])
        scene = copy.deepcopy(self.scene)
        scene['supportingDialogues'] = {'build-pattern':'weaver-practice'}
        scene['reviewEntryId'] = 'weaver-start'
        scene['hints'] = {
            'hear-weaver':'听讲', 'build-pattern':'推演',
            'return-weaver':'回报','done':'完成'}
        scene['actions'] = {
            'hear-weaver':copy.deepcopy(self.scene['actions']['listen-workshop']),
            'build-pattern':copy.deepcopy(self.scene['actions']['decode-four-combinations']),
            'return-weaver':copy.deepcopy(self.scene['actions']['report-workshop']),
            'done':copy.deepcopy(self.scene['actions']['done']),
            'review':copy.deepcopy(self.scene['actions']['review']),
        }
        scene['checkpoints']['steps'] = {
            'hear-weaver':'weaver_intro_done',
            'return-weaver':'weaver_report_done',
        }
        self.story['questTargets']['weaver-numbers'] = {
            'steps':{
                'hear-weaver':{'type':'dialogue','id':'weaver-start'},
                'build-pattern':{'type':'level','id':'ch1_half_adder'},
                'return-weaver':{'type':'dialogue','id':'weaver-report'},
            },
            'review':{'type':'dialogue','id':'weaver-finished'},
            'scene':scene,
        }
        self.assertIs(validate_story_routes(self.chapter,self.story),self.story)

    def test_unknown_narrative_action_is_rejected(self):
        self.scene['actions']['report-workshop'][0]['action'] = 'grant-reward'
        self.assert_bad('动作')

    def test_scene_cannot_call_an_unknown_supporting_dialogue(self):
        self.scene['supportingDialogues']['decode-four-combinations'] = 'wrong-id'
        self.assert_bad('提示对白')

    def test_scene_cannot_silently_skip_supporting_level_dialogue(self):
        self.scene['supportingDialogues'] = {}
        self.assert_bad('缺少关卡阶段')

    def test_replay_requires_explicit_opt_in(self):
        self.scene['allowReplay'] = False
        self.assert_bad('启用关卡重玩')

    def test_duplicate_action_labels_are_not_accepted(self):
        self.scene['actions']['done'][1]['label'] = self.scene['actions']['done'][0]['label']
        self.assert_bad('文字或动作')

    def test_unexpected_action_field_does_not_get_ignored(self):
        self.scene['actions']['done'][0]['checkpoint'] = 'forged'
        self.assert_bad('文字或动作')

    def test_wrong_step_checkpoint_is_rejected(self):
        self.scene['checkpoints']['steps']['unknown-step'] = 'invalid'
        self.assert_bad('对白保存点')

    def test_first_dialogue_cannot_auto_submit_before_final_step(self):
        self.scene['actions']['listen-workshop'][0]['action'] = 'complete-and-submit'
        self.assert_bad('最终对白步骤')

    def test_report_cannot_jump_to_a_previous_level(self):
        self.scene['actions']['report-workshop'][0]['action'] = 'complete-and-level'
        self.assert_bad('紧接的关卡步骤')

    def test_unknown_scene_entry_is_rejected(self):
        self.scene['reviewEntryId'] = 'bogus-dialogue'
        self.assert_bad('复述入口')

    def test_scene_does_not_override_task_steps_or_server_levels(self):
        self.scene['steps'] = {'decode-four-combinations':'ch1_cmos_not'}
        self.assert_bad('未知字段')


if __name__ == '__main__':
    unittest.main()
