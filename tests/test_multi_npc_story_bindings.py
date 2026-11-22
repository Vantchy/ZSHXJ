"""Server-side multi-NPC quest ownership: two authored scenes, one room."""
import copy
import unittest

from chapters import BY_ID, STORY_ROUTES
from story_route_rules import validate_story_routes


def fixture():
    chapter = copy.deepcopy(BY_ID['ch1'])
    story = copy.deepcopy(STORY_ROUTES['ch1'])
    original = next(q for q in chapter['quests']['side'] if q['id'] == 'binary-decoder')
    woven = copy.deepcopy(original)
    woven['id'] = 'weaver-patterns'
    woven['title'] = '织者推演'
    woven['prerequisites'] = []
    woven['steps'][0]['id'] = 'listen-weaver'
    woven['steps'][0]['condition']['dialogueId'] = 'weaver-end'
    woven['steps'][1]['id'] = 'make-weave'
    woven['steps'][1]['condition']['levelId'] = 'ch1_half_adder'
    woven['steps'][2]['id'] = 'report-weaver'
    woven['steps'][2]['condition']['dialogueId'] = 'weaver-report'
    woven['completion']['levelIds'] = ['ch1_half_adder']
    chapter['quests']['side'].append(woven)
    old = story['questTargets']['binary-decoder']
    scene = copy.deepcopy(old['scene'])
    scene['supportingDialogues'] = {'make-weave':'weaver-practice'}
    scene['reviewEntryId'] = 'weaver-opening'
    scene['hints'] = {'listen-weaver':'听讲', 'make-weave':'完成推演',
                      'report-weaver':'向织者回报', 'done':'已完成'}
    scene['checkpoints']['steps'] = {'listen-weaver':'weaver_intro_done',
                                     'report-weaver':'weaver_report_done'}
    scene['actions'] = {
        'listen-weaver':copy.deepcopy(old['scene']['actions']['listen-workshop']),
        'make-weave':copy.deepcopy(old['scene']['actions']['decode-four-combinations']),
        'report-weaver':copy.deepcopy(old['scene']['actions']['report-workshop']),
        'done':copy.deepcopy(old['scene']['actions']['done']),
        'review':copy.deepcopy(old['scene']['actions']['review']),
    }
    story['questTargets']['weaver-patterns'] = {
        'steps':{'listen-weaver':{'type':'dialogue','id':'weaver-opening'},
                 'make-weave':{'type':'level','id':'ch1_half_adder'},
                 'report-weaver':{'type':'dialogue','id':'weaver-report'}},
        'review':{'type':'dialogue','id':'weaver-finished'},
        'scene':scene,
    }
    story['dialogues'].extend([
        {'id':'weaver-opening','lines':[{'speaker':{'name':'织者'},'text':'先听讲。'}],
         'options':[{'text':'继续','target':{'type':'dialogue','id':'weaver-end'}}]},
        {'id':'weaver-end','lines':[{'speaker':{'name':'织者'},'text':'开始推演。'}]},
        {'id':'weaver-practice','lines':[{'speaker':{'name':'织者'},'text':'继续练习。'}]},
        {'id':'weaver-report','lines':[{'speaker':{'name':'织者'},'text':'回报已收到。'}]},
        {'id':'weaver-finished','lines':[{'speaker':{'name':'织者'},'text':'可以重练。'}]},
    ])
    location = story['locations'][0]
    location.pop('characterId',None)
    location.pop('dialogueId',None)
    location['characterPlacements'] = [
        {'characterId':'artisan-chui','x':300,'questId':'binary-decoder',
         'dialogueId':'mengjin-workshop-opening'},
        {'characterId':'hai','x':750,'questId':'weaver-patterns',
         'dialogueId':'weaver-opening'},
    ]
    return chapter,story


class MultiNpcBindings(unittest.TestCase):
    def test_two_scene_quests_belong_to_separate_npcs(self):
        chapter,story = fixture()
        self.assertIs(validate_story_routes(chapter,story),story)

    def test_ambient_npc_can_have_own_dialogue_without_quest(self):
        chapter,story = fixture()
        story['characters'].append({'id':'apprentice','name':'学徒'})
        story['dialogues'].append({'id':'apprentice-hello',
             'lines':[{'speaker':{'name':'学徒'},'text':'你好。'}]})
        story['locations'][0]['characterPlacements'].append({
            'characterId':'apprentice','x':520,'dialogueId':'apprentice-hello'})
        self.assertIs(validate_story_routes(chapter,story),story)

    def test_absent_quest_owner_rejected(self):
        chapter,story = fixture()
        del story['locations'][0]['characterPlacements'][1]['questId']
        with self.assertRaisesRegex(ValueError,'明确绑定'):
            validate_story_routes(chapter,story)

    def test_unknown_or_cross_location_binding_rejected(self):
        for bad in ('unknown-quest','main'):
            with self.subTest(bad=bad):
                chapter,story = fixture()
                story['locations'][0]['characterPlacements'][1]['questId']=bad
                with self.assertRaisesRegex(ValueError,'任务不存在|地点不匹配|场景配置'):
                    validate_story_routes(chapter,story)

    def test_same_quest_cannot_be_owned_by_two_characters(self):
        chapter,story=fixture()
        story['locations'][0]['characterPlacements'][1]['questId']='binary-decoder'
        with self.assertRaisesRegex(ValueError,'重复绑定'):
            validate_story_routes(chapter,story)

    def test_npcs_cannot_share_same_click_target(self):
        chapter,story=fixture()
        story['locations'][0]['characterPlacements'][1]['x']=333
        with self.assertRaisesRegex(ValueError,'站位过近'):
            validate_story_routes(chapter,story)

    def test_sample_legacy_single_npc_is_unchanged(self):
        self.assertIs(validate_story_routes(BY_ID['ch1'],STORY_ROUTES['ch1']),
                      STORY_ROUTES['ch1'])


if __name__=='__main__':
    unittest.main()
