"""Third-round authoritative quest prerequisites and target-link regression."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import database as db
from chapters import BY_ID, CHAPTERS, STORY_ROUTES
from quest_model import blank_progress, validate_chapter_definitions
from server import create_server
from story_route_rules import validate_story_routes


def diviner_definition():
    return {
        'id':'diviner-study', 'type':'side', 'title':'贞人习题', 'description':'',
        'hint':'', 'chapterId':'ch1', 'locationId':'gate-road',
        'steps':[
            {'id':'hear-diviner', 'title':'听说明', 'description':'',
             'condition':{'type':'dialogue-finished','dialogueId':'diviner-end'}},
            {'id':'make-adder', 'title':'制作半加器', 'description':'',
             'condition':{'type':'level-completed','levelId':'ch1_half_adder'}},
            {'id':'return-diviner', 'title':'回报', 'description':'',
             'condition':{'type':'dialogue-finished','dialogueId':'diviner-report'}},
        ],
        'prerequisites':['binary-decoder'], 'rewards':[], 'tags':[],
        'completion':{'mode':'official-circuit','levelIds':['ch1_half_adder'],
                      'requireAllSteps':True},
    }


def synthetic_chapter_and_story():
    chapter = copy.deepcopy(BY_ID['ch1'])
    chapter['quests']['side'].append(diviner_definition())
    story = copy.deepcopy(STORY_ROUTES['ch1'])
    def dialogue(id_, destination=None):
        item={'id':id_, 'lines':[{'speaker':{'name':'测试叙事'},'text':'测试台词。'}]}
        if destination:
            item['options']=[{'text':'继续','target':{'type':'dialogue','id':destination}}]
        return item
    story['dialogues'] += [dialogue('diviner-start','diviner-end'),
                           dialogue('diviner-end'),dialogue('diviner-report')]
    story['questTargets']['diviner-study']={'steps':{
        'hear-diviner':{'type':'dialogue','id':'diviner-start'},
        'make-adder':{'type':'level','id':'ch1_half_adder'},
        'return-diviner':{'type':'dialogue','id':'diviner-report'},
    }}
    return chapter, story


class AuthoredRouteValidation(unittest.TestCase):
    def test_real_chapter_config_validates_against_deployed_json(self):
        validate_chapter_definitions(CHAPTERS)
        self.assertIn('binary-decoder', STORY_ROUTES['ch1']['questTargets'])
        validate_story_routes(BY_ID['ch1'], STORY_ROUTES['ch1'])

    def test_second_different_quest_works_without_workshop_ids(self):
        chapter, story = synthetic_chapter_and_story()
        validate_chapter_definitions((chapter,))
        validate_story_routes(chapter, story)

    def test_unknown_prerequisite_and_cycle_rejected_on_startup(self):
        chapter, _ = synthetic_chapter_and_story()
        chapter['quests']['side'][-1]['prerequisites'] = ['missing-quest']
        with self.assertRaisesRegex(ValueError,'前置条件'):
            validate_chapter_definitions((chapter,))
        chapter['quests']['side'][-1]['prerequisites'] = ['diviner-study']
        with self.assertRaisesRegex(ValueError,'前置条件'):
            validate_chapter_definitions((chapter,))
        chapter['quests']['side'][-1]['prerequisites'] = ['binary-decoder']
        chapter['quests']['side'][-2]['prerequisites'] = ['diviner-study']
        with self.assertRaisesRegex(ValueError,'循环'):
            validate_chapter_definitions((chapter,))

    def test_step_target_must_match_real_registered_level(self):
        chapter, story = synthetic_chapter_and_story()
        story['questTargets']['diviner-study']['steps']['make-adder']['id']='ch1_cmos_not'
        with self.assertRaisesRegex(ValueError,'关卡'):
            validate_story_routes(chapter,story)

    def test_unreachable_or_missing_dialogue_ending_rejected(self):
        chapter, story = synthetic_chapter_and_story()
        story['questTargets']['diviner-study']['steps']['hear-diviner']['id']='diviner-report'
        with self.assertRaisesRegex(ValueError,'无法从本步骤入口抵达'):
            validate_story_routes(chapter,story)
        chapter, story = synthetic_chapter_and_story()
        story['questTargets']['diviner-study']['steps']['hear-diviner']['id']='unknown'
        with self.assertRaisesRegex(ValueError,'对白不存在'):
            validate_story_routes(chapter,story)

    def test_location_unknown_step_and_nonterminal_end_rejected(self):
        chapter, story = synthetic_chapter_and_story()
        chapter['quests']['side'][-1]['locationId']='unknown-room'
        with self.assertRaisesRegex(ValueError,'地点'):
            validate_story_routes(chapter,story)
        chapter, story = synthetic_chapter_and_story()
        story['questTargets']['diviner-study']['steps']['wrong-step']={
            'type':'dialogue','id':'diviner-start'}
        with self.assertRaisesRegex(ValueError,'未知步骤'):
            validate_story_routes(chapter,story)
        chapter, story = synthetic_chapter_and_story()
        story['dialogues'][-2]['options']=[{
            'text':'再次选择','target':{'type':'dialogue','id':'diviner-start'}}]
        with self.assertRaisesRegex(ValueError,'末段'):
            validate_story_routes(chapter,story)


class PrerequisiteDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path=Path(self.folder.name)/'third-round.sqlite3'
        server=create_server('127.0.0.1',0,self.path)
        server.server_close()
        self.user=db.create_user(self.path,'thirdround','Password123','验证玩家')
        self.chapter,self.story=synthetic_chapter_and_story()
        validate_chapter_definitions((self.chapter,))
        validate_story_routes(self.chapter,self.story)
        self.patch_chapter=patch.dict(BY_ID,{'ch1':self.chapter})
        self.patch_chapter.start()
        self.addCleanup(self.patch_chapter.stop)
        self.main=blank_progress(self.chapter['quests']['main'])
        self.workshop=blank_progress(next(q for q in self.chapter['quests']['side']
                                          if q['id']=='binary-decoder'))
        self.diviner=blank_progress(self.chapter['quests']['side'][-1])
        self.state={'schemaVersion':2,'position':{'x':300},'locationId':'gate-road',
                    'tasks':{'main':self.main,'side':{
                        'binary-decoder':self.workshop,
                        'diviner-study':self.diviner,
                    }}}
        self.record,self.revision=db.save_progress(self.path,self.user['id'],
                                                    'ch1','initial',self.state,0)

    def save(self, state):
        record,revision=db.save_progress(self.path,self.user['id'],
                                         'ch1','third_round',state,self.revision)
        self.state=copy.deepcopy(record['state'])
        self.revision=revision
        return record

    def rejected(self, state, message):
        with self.assertRaisesRegex(ValueError,message):
            db.save_progress(self.path,self.user['id'],'ch1',
                             'bad_advance',state,self.revision)
        self.assertEqual(db.list_progress(self.path,self.user['id'])[0]['revision'],self.revision)

    def mark_workshop_historically_done(self):
        # Seed a genuine historic completed prerequisite from a previous
        # version without fabricating a newly earned formal score.
        state=copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['status']='submitted'
        with db.closing(db.connect(self.path)) as con:
            con.execute('UPDATE progress SET state_json=? WHERE user_id=? AND chapter_id=?',
                        (json.dumps(state),self.user['id'],'ch1'))
            con.commit()
        self.state=state

    def insert_formal_grade(self,level_id='ch1_half_adder'):
        with db.closing(db.connect(self.path)) as con:
            with con:
                con.execute('INSERT INTO attempts(attempt_id,user_id,chapter_id,started_at) '
                            'VALUES(?,?,?,?)',('test-half',self.user['id'],'ch1',db.now_iso()))
                cur=con.execute('INSERT INTO scores(user_id,chapter_id,score,completed,details_json,attempt_id,submitted_at) '
                    'VALUES(?,?,?,?,?,?,?)',(self.user['id'],'ch1',100,1,'{}','test-half',db.now_iso()))
                con.execute('INSERT INTO circuit_level_attempts(attempt_id,user_id,level_id,level_version,score_id) '
                    'VALUES(?,?,?,?,?)',('test-half',self.user['id'],level_id,1,cur.lastrowid))

    def test_server_blocks_accept_and_step_claim_before_prerequisite(self):
        pending=copy.deepcopy(self.state)
        pending['tasks']['side']['diviner-study']['status']='accepted'
        self.rejected(pending,'前置任务')
        pending=copy.deepcopy(self.state)
        pending['tasks']['side']['diviner-study']['steps']['hear-diviner']={
            'status':'done','evidence':{'type':'dialogue-finished','dialogueId':'diviner-end'}}
        self.rejected(pending,'前置任务')

    def test_old_unchanged_active_progress_keeps_legacy_save_compatible(self):
        old=copy.deepcopy(self.state)
        old['tasks']['side']['diviner-study']['status']='accepted'
        with db.closing(db.connect(self.path)) as con:
            con.execute('UPDATE progress SET state_json=? WHERE user_id=? AND chapter_id=?',
                        (json.dumps(old),self.user['id'],'ch1'))
            con.commit()
        self.state=old
        updated=copy.deepcopy(old)
        updated['position']={'x':860}
        self.save(updated)
        self.assertEqual(self.state['tasks']['side']['diviner-study']['status'],'accepted')
        next_state=copy.deepcopy(self.state)
        next_state['tasks']['side']['diviner-study']['steps']['hear-diviner']={
            'status':'done','evidence':{'type':'dialogue-finished','dialogueId':'diviner-end'}}
        self.rejected(next_state,'前置任务')

    def test_cannot_unlock_dependency_and_accept_child_in_one_put(self):
        # The prerequisite must have been completed in the PREVIOUS committed
        # revision, not merely be marked completed in the same forged payload.
        old=copy.deepcopy(self.state)
        workshop=old['tasks']['side']['binary-decoder']
        workshop['status']='accepted'
        workshop['steps']['listen-workshop']={'status':'done', 'evidence':{
            'type':'dialogue-finished','dialogueId':'mengjin-workshop-closing'}}
        workshop['steps']['decode-four-combinations']={'status':'done', 'evidence':{
            'levelId':'ch1_binary_decoder','assessmentType':'circuit_server'}}
        with db.closing(db.connect(self.path)) as con:
            con.execute('UPDATE progress SET state_json=? WHERE user_id=? AND chapter_id=?',
                        (json.dumps(old),self.user['id'],'ch1'))
            con.commit()
        self.state=old
        self.insert_formal_grade('ch1_binary_decoder')
        forged=copy.deepcopy(old)
        binary=forged['tasks']['side']['binary-decoder']
        binary['steps']['report-workshop']={'status':'done','evidence':{
            'type':'dialogue-finished','dialogueId':'mengjin-workshop-report'}}
        binary['status']='completed'
        forged['tasks']['side']['diviner-study']['status']='accepted'
        self.rejected(forged,'前置任务')

    def test_ordered_steps_cannot_be_batched_in_one_progress_put(self):
        self.mark_workshop_historically_done()
        ready=copy.deepcopy(self.state)
        ready['tasks']['side']['diviner-study']['status']='accepted'
        self.save(ready)
        self.insert_formal_grade()
        # All evidence is syntactically correct and the circuit grade exists,
        # but one transaction must not skip multiple authored story stages.
        bulk=copy.deepcopy(self.state)
        diviner=bulk['tasks']['side']['diviner-study']
        diviner['steps']['hear-diviner']={
            'status':'done','evidence':{
                'type':'dialogue-finished','dialogueId':'diviner-end'}}
        diviner['steps']['make-adder']={
            'status':'done','evidence':{
                'levelId':'ch1_half_adder','assessmentType':'circuit_server'}}
        diviner['steps']['return-diviner']={
            'status':'done','evidence':{
                'type':'dialogue-finished','dialogueId':'diviner-report'}}
        diviner['status']='completed'
        self.rejected(bulk,'一次只能完成一个新步骤')
        # Even a two-step request cannot claim the first step as completed
        # in the same transaction that it claims the second.
        diviner['steps']['return-diviner']={
            'status':'pending','evidence':None}
        diviner['status']='accepted'
        self.rejected(bulk,'一次只能完成一个新步骤')
        # A genuine single-step transition from the previous committed
        # revision is still accepted.
        diviner['steps']['make-adder']={
            'status':'pending','evidence':None}
        self.save(bulk)
        self.assertEqual(self.state['tasks']['side']['diviner-study']
                         ['steps']['hear-diviner']['status'],'done')

    def test_second_quest_dialogue_level_report_end_to_end(self):
        self.mark_workshop_historically_done()
        current=copy.deepcopy(self.state)
        current['tasks']['side']['diviner-study']['status']='accepted'
        self.save(current)
        bad=copy.deepcopy(self.state)
        bad['tasks']['side']['diviner-study']['steps']['hear-diviner']={
            'status':'done','evidence':{'type':'dialogue-finished','dialogueId':'diviner-report'}}
        self.rejected(bad,'证据与任务定义不一致')
        first=copy.deepcopy(self.state)
        first['tasks']['side']['diviner-study']['steps']['hear-diviner']={
            'status':'done','evidence':{'type':'dialogue-finished','dialogueId':'diviner-end'}}
        self.save(first)
        no_grade=copy.deepcopy(self.state)
        no_grade['tasks']['side']['diviner-study']['steps']['make-adder']={
            'status':'done','evidence':{'levelId':'ch1_half_adder','assessmentType':'circuit_server'}}
        self.rejected(no_grade,'真实电路评测')
        self.insert_formal_grade()
        self.save(no_grade)
        report=copy.deepcopy(self.state)
        report['tasks']['side']['diviner-study']['steps']['return-diviner']={
            'status':'done','evidence':{'type':'dialogue-finished','dialogueId':'diviner-report'}}
        report['tasks']['side']['diviner-study']['status']='completed'
        self.save(report)
        self.assertEqual(self.state['tasks']['side']['diviner-study']['status'],'completed')
        submitted=copy.deepcopy(self.state)
        submitted['tasks']['side']['diviner-study']['status']='submitted'
        self.save(submitted)
        self.assertEqual(self.state['tasks']['side']['diviner-study']['status'],'submitted')


if __name__ == '__main__':
    unittest.main()
