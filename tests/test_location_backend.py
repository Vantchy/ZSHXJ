"""Location-ready backend, without installing extra playable rooms or art."""
from __future__ import annotations

import copy
import json
import math
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import database as db
from chapters import BY_ID, CHAPTERS, STORY_ROUTES
from location_model import (
    public_location_entries, validate_location_definitions,
    validate_location_state, validate_location_transition,
)
from server import create_server
from story_route_rules import validate_story_routes


def two_place_chapter():
    chapter = copy.deepcopy(BY_ID['ch1'])
    # Keep this legacy two-place adversarial fixture independent of the
    # newly published, unlocked Mengjin story-preview location.
    chapter['locations'] = chapter['locations'][:1]
    chapter['locations'].append({
        'id':'forge-square', 'name':'测试冶铸坊', 'roomTitle':'测试冶铸坊',
        'npc':'测试人物', 'background':'/assets/scenes/chapter-city-map.png',
        'mapPoint':{'x':0.65,'y':0.36}, 'spawnX':480,
        'entryPrerequisites':['side-test'],
        'characterPlacements':[{'characterId':'fixture-person','x':320}],
    })
    return chapter


class LocationDefinitionRules(unittest.TestCase):
    def test_current_one_room_remains_byte_compatible_in_identity(self):
        validate_location_definitions(CHAPTERS)
        current=BY_ID['ch1']['locations']
        self.assertEqual([loc['id'] for loc in current],['gate-road','mengjin-jade-courtyard'])
        self.assertEqual(current[0]['background'],'/assets/scenes/workshop-background.png')
        self.assertEqual(current[0]['mapPoint'],{'x':0.498,'y':0.458})
        self.assertEqual(current[0]['spawnX'],180)
        self.assertEqual(BY_ID['ch2']['locations'],[])

    def test_second_scene_background_and_marker_are_valid_without_publishing_room(self):
        chapter=two_place_chapter()
        validate_location_definitions((chapter,))
        self.assertNotIn('forge-square', [x['id'] for x in BY_ID['ch1']['locations']])
        places=public_location_entries(chapter, {})
        self.assertEqual(len(places),2)
        self.assertTrue(places[0]['canEnter'])
        self.assertFalse(places[1]['canEnter'])
        self.assertEqual(places[1]['background'],'/assets/scenes/chapter-city-map.png')
        self.assertEqual(places[1]['resumeX'],480)
        self.assertEqual(places[1]['blockedBy'],['side-test'])
        self.assertEqual(places[1]['characterPlacements'][0]['characterId'],'fixture-person')

    def test_story_can_overlay_npc_but_cannot_override_server_scene(self):
        story=copy.deepcopy(STORY_ROUTES['ch1'])
        scene=public_location_entries(BY_ID['ch1'],{},story)[0]
        self.assertEqual(scene['npc'],'玉匠垂')
        self.assertEqual(scene['characterId'],'artisan-chui')
        self.assertEqual(scene['background'],'/assets/scenes/workshop-background.png')
        for field,bad,reason in (
            ('background','/assets/scenes/another.webp','不能覆盖背景'),
            ('mapPoint',{'x':0.5,'y':0.5},'不能覆盖背景'),
            ('entryPrerequisites',['binary-decoder'],'不能覆盖背景'),
            ('dialogueId','not-a-story-paragraph','默认对白不存在'),
        ):
            invalid=copy.deepcopy(story)
            invalid['locations'][0][field]=bad
            with self.subTest(field=field), self.assertRaisesRegex(ValueError,reason):
                validate_story_routes(BY_ID['ch1'],invalid)
        invalid=copy.deepcopy(story)
        invalid['locations'].append({'id':'ghost-room'})
        with self.assertRaisesRegex(ValueError,'未知地点'):
            validate_story_routes(BY_ID['ch1'],invalid)
        invalid=copy.deepcopy(story)
        invalid['locations'].append({'id':'gate-road'})
        with self.assertRaisesRegex(ValueError,'重复'):
            validate_story_routes(BY_ID['ch1'],invalid)
        # Two authored NPCs can be attached to one registered location, while
        # unknown identities, duplicate slots and out-of-range placement fail.
        multi=copy.deepcopy(story)
        multi['locations'][0].pop('characterId')
        multi['locations'][0].pop('dialogueId')
        multi['locations'][0]['characterPlacements']=[
            {'characterId':'hai','x':310,'dialogueId':'mengjin-workshop-opening'},
            {'characterId':'artisan-chui','x':710},
        ]
        validate_story_routes(BY_ID['ch1'],multi)
        published=public_location_entries(BY_ID['ch1'],{},multi)[0]
        self.assertEqual(len(published['characterPlacements']),2)
        for changes,reason in (
            ({'characterId':'ghost'},'角色未知'),
            ({'x':1025},'0..1024'),
            ({'x':710},'坐标重复'),
        ):
            invalid=copy.deepcopy(multi)
            invalid['locations'][0]['characterPlacements'][0].update(changes)
            with self.subTest(changes=changes),self.assertRaisesRegex(ValueError,reason):
                validate_story_routes(BY_ID['ch1'],invalid)

    def test_duplicate_unknown_prerequisite_unsafe_images_and_points_rejected(self):
        def rejected(field, value, reason):
            chapter=two_place_chapter()
            chapter['locations'][1][field]=value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError,reason):
                validate_location_definitions((chapter,))
        rejected('id','gate-road','重复')
        rejected('id','../unsafe','地点 ID')
        rejected('name','  ','名称')
        rejected('background','https://example.com/evil.png','背景')
        rejected('background','/assets/scenes/../secret.png','背景')
        rejected('background','/assets/story/ch1/images/a.webp','背景')
        rejected('background','/assets/scenes/another.svg','背景')
        rejected('mapPoint',{'x':1.1,'y':0.2},'mapPoint')
        rejected('mapPoint',{'x':True,'y':0.2},'mapPoint')
        rejected('mapPoint',{'x':math.nan,'y':0.2},'mapPoint')
        rejected('spawnX',1030,'spawnX')
        rejected('entryPrerequisites',['ghost'],'entryPrerequisites')
        rejected('entryPrerequisites',['side-test','side-test'],'entryPrerequisites')


class SavedLocationRules(unittest.TestCase):
    def setUp(self):
        self.chapter=two_place_chapter()

    def test_legacy_one_room_state_is_unchanged_not_migrated_automatically(self):
        legacy={'schemaVersion':2,'locationId':'gate-road','position':{'x':635}}
        before=copy.deepcopy(legacy)
        validate_location_state(self.chapter, legacy)
        validate_location_transition(self.chapter, {}, legacy)
        self.assertEqual(before,legacy)
        self.assertNotIn('locationPositions',legacy)
        self.assertEqual(public_location_entries(self.chapter,legacy)[0]['resumeX'],635)
        self.assertEqual(public_location_entries(self.chapter,legacy)[1]['resumeX'],480)
        without_location={'schemaVersion':2,'position':{'x':550}}
        self.assertEqual(public_location_entries(self.chapter,without_location)[0]['resumeX'],550)
        self.assertEqual(public_location_entries(self.chapter,without_location)[1]['resumeX'],480)
        # Previous 1400-wide positions still resolve without altering the save.
        legacy['position']['x']=1400
        validate_location_state(self.chapter,legacy)
        self.assertEqual(public_location_entries(self.chapter,legacy)[0]['resumeX'],989)

    def test_new_location_positions_are_independent_and_have_no_unknown_ids(self):
        state={'locationId':'forge-square','position':{'x':725},
               'locationPositions':{'gate-road':{'x':182},'forge-square':{'x':725}}}
        validate_location_state(self.chapter,state)
        entries=public_location_entries(self.chapter,state)
        self.assertEqual(entries[0]['resumeX'],182)
        self.assertEqual(entries[1]['resumeX'],725)
        state['locationPositions']['gate-road']['x']=805
        self.assertEqual(public_location_entries(self.chapter,state)[1]['resumeX'],725)

    def test_new_location_positions_reject_bad_shapes_and_mismatched_active(self):
        template={'locationId':'forge-square','position':{'x':720},
                  'locationPositions':{'forge-square':{'x':720}}}
        for field,bad,pattern in (
            ('locationId','unknown-room','不存在的地点'),
            ('locationPositions',{'ghost':{'x':240}},'未登记地点'),
            ('locationPositions',{'forge-square':{'x':False}},'有限坐标'),
            ('locationPositions',{'forge-square':{'x':math.nan}},'有限坐标'),
            ('locationPositions',{'forge-square':{'x':1100}},'有限坐标'),
            ('locationPositions',{'forge-square':{'x':720,'y':3}},'有限坐标'),
            ('position',{'x':500},'位置不一致'),
        ):
            state=copy.deepcopy(template)
            state[field]=bad
            with self.subTest(field=field, bad=bad), self.assertRaisesRegex(ValueError,pattern):
                validate_location_state(self.chapter,state)

    def test_locked_entry_checks_previous_committed_tasks_not_same_put_claims(self):
        old={'locationId':'gate-road','position':{'x':190},
             'tasks':{'main':{},'side':{'side-test':{'status':'accepted'}}}}
        next_state=copy.deepcopy(old)
        next_state['locationId']='forge-square'
        next_state['position']={'x':480}
        next_state['tasks']['side']['side-test']['status']='completed'
        with self.assertRaisesRegex(ValueError,'前置任务未完成'):
            validate_location_transition(self.chapter,old,next_state)
        committed=copy.deepcopy(old)
        committed['tasks']['side']['side-test']['status']='submitted'
        validate_location_transition(self.chapter,committed,next_state)
        # Existing visits are not reset when a new authored prerequisite is added.
        old_existing=copy.deepcopy(next_state)
        old_existing['tasks']['side']['side-test']['status']='accepted'
        validate_location_transition(self.chapter,old_existing,next_state)


class LocationHttpAndDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.temp.name)/'location.sqlite3'
        cls.server=create_server('127.0.0.1',0,cls.path)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.server.server_address[1]}'
        cls.a=db.create_user(cls.path,'location_a','Pass12345!','地点学生A')
        cls.b=db.create_user(cls.path,'location_b','Pass12345!','地点学生B')
        cls.teacher=db.create_user(cls.path,'location_teacher','Pass12345!','地点教师',role='teacher')
        cls.token_a=db.login(cls.path,'location_a','Pass12345!')['token']
        cls.token_b=db.login(cls.path,'location_b','Pass12345!')['token']
        cls.token_teacher=db.login(cls.path,'location_teacher','Pass12345!')['token']

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=4)
        cls.temp.cleanup()

    def request(self,method,path,body=None,token=None):
        data=None if body is None else json.dumps(body).encode('utf-8')
        headers={'Authorization':'Bearer '+(token or self.token_a)}
        if data is not None:
            headers['Content-Type']='application/json'
        request=Request(self.base+path,headers=headers,method=method,data=data)
        try:response=urlopen(request,timeout=12)
        except HTTPError as error:response=error
        with response:
            return response.status,json.loads(response.read())

    def test_current_single_sample_location_endpoint_and_student_isolation(self):
        code,result=self.request('GET','/api/chapters/ch1/locations')
        self.assertEqual(code,200)
        self.assertEqual(result['revision'],0)
        self.assertEqual([x['id'] for x in result['locations']],['gate-road','mengjin-jade-courtyard'])
        self.assertEqual(result['locations'][0]['background'],
                         '/assets/scenes/workshop-background.png')
        self.assertTrue(result['locations'][0]['canEnter'])
        self.assertEqual(result['locations'][0]['npc'],'玉匠垂')
        self.assertEqual(result['locations'][0]['characterId'],'artisan-chui')
        self.assertEqual(result['locations'][0]['resumeX'],180)
        self.assertEqual(result['locations'][1]['background'], '/assets/scenes/mengjin-jade-workshop.png')
        self.assertEqual(result['locations'][1]['resumeX'],914)
        self.assertTrue(result['locations'][1]['canEnter'])
        code,result=self.request('GET','/api/chapters/ch1/locations',token=self.token_teacher)
        self.assertEqual(code,403)
        code,result=self.request('GET','/api/chapters/no-such/locations')
        self.assertEqual(code,404)
        code,result=self.request('GET','/api/chapters/ch2/locations')
        self.assertEqual(code,200)
        self.assertEqual(result['locations'],[])

    def test_multi_location_http_and_save_enforces_unlock_and_isolation(self):
        chapter=two_place_chapter()
        validate_location_definitions((chapter,))
        with patch.dict(BY_ID,{'ch1':chapter}):
            user_a_state={'schemaVersion':2,'locationId':'gate-road',
                'position':{'x':190},'tasks':{'side':{
                  'side-test':{'status':'not-accepted','steps':{}}}}}
            rec,rev=db.save_progress(self.path,self.a['id'],'ch1','initial_location',user_a_state,0)
            self.assertEqual(rev,1)
            code,result=self.request('GET','/api/chapters/ch1/locations')
            self.assertEqual(code,200)
            self.assertEqual(result['revision'],1)
            self.assertFalse(result['locations'][1]['canEnter'])
            self.assertEqual(result['locations'][0]['resumeX'],190)
            self.assertEqual(result['locations'][1]['resumeX'],480)
            move=copy.deepcopy(user_a_state)
            move['locationId']='forge-square'
            move['position']={'x':725}
            move['locationPositions']={'gate-road':{'x':190},'forge-square':{'x':725}}
            code,result=self.request('PUT','/api/progress/ch1',{
                'checkpoint':'enter_locked','expectedRevision':1,'state':move})
            self.assertEqual(code,409)
            self.assertEqual(result['code'],'INVALID_TASK_TRANSITION')
            self.assertIn('前置任务未完成',result['error'])
            self.assertEqual(db.list_progress(self.path,self.a['id'])[0]['revision'],1)
            # Even reporting a fabricated prerequisite completion in the same
            # request cannot authorize entering the second room.
            move['tasks']['side']['side-test']['status']='completed'
            code,result=self.request('PUT','/api/progress/ch1',{
                'checkpoint':'same_put','expectedRevision':1,'state':move})
            self.assertEqual(code,409)
            self.assertIn('前置任务未完成',result['error'])
            # Historical committed completion unlocks the place. This fixture
            # seeds it as existing trusted state (without awarding test rewards).
            user_a_state['tasks']['side']['side-test']['status']='submitted'
            with db.closing(db.connect(self.path)) as con:
                con.execute('UPDATE progress SET state_json=? WHERE user_id=? AND chapter_id=?',
                            (json.dumps(user_a_state),self.a['id'],'ch1'))
                con.commit()
            move['tasks']['side']['side-test']['status']='submitted'
            code,result=self.request('PUT','/api/progress/ch1',{
                'checkpoint':'enter_open','expectedRevision':1,'state':move})
            self.assertEqual(code,200,result)
            self.assertEqual(result['progress']['revision'],2)
            self.assertEqual(result['progress']['state']['locationPositions']['gate-road']['x'],190)
            code,result=self.request('GET','/api/chapters/ch1/locations')
            self.assertEqual(code,200)
            self.assertTrue(result['locations'][1]['canEnter'])
            self.assertEqual(result['locations'][1]['resumeX'],725)
            # Re-entering the first room restores its own earlier coordinate,
            # while the second room keeps its last visit. Neither one moves.
            back=copy.deepcopy(move)
            back['locationId']='gate-road'
            back['position']={'x':190}
            code,back_result=self.request('PUT','/api/progress/ch1',{
                'checkpoint':'return_first_room','expectedRevision':2,'state':back})
            self.assertEqual(code,200,back_result)
            self.assertEqual(back_result['progress']['revision'],3)
            code,both=self.request('GET','/api/chapters/ch1/locations')
            self.assertEqual(code,200)
            self.assertEqual([loc['resumeX'] for loc in both['locations']],[190,725])
            code,other=self.request('GET','/api/chapters/ch1/locations',token=self.token_b)
            self.assertEqual(code,200)
            self.assertFalse(other['locations'][1]['canEnter'])
            self.assertEqual(other['revision'],0)
            self.assertEqual(other['locations'][1]['resumeX'],480)
            # Data is never copied across users even though they share chapter.
            self.assertEqual(db.list_progress(self.path,self.b['id']),[])

    def test_malformed_position_and_unknown_room_rejected_without_revision_change(self):
        chapter=two_place_chapter()
        with patch.dict(BY_ID,{'ch1':chapter}):
            baseline=db.list_progress(self.path,self.a['id'])
            revision=baseline[0]['revision'] if baseline else 0
            for field,bad in (
                ('locationId','unknown'),
                ('locationPositions',{'forge-square':{'x':math.inf}}),
                ('locationPositions',{'hidden':{'x':123}}),
            ):
                state={'schemaVersion':2,'locationId':'gate-road','position':{'x':120}}
                state[field]=bad
                with self.subTest(field=field):
                    # JSON turns infinities into NaN-like input; standard Python
                    # json.loads permits it and the explicit finite check rejects.
                    code,result=self.request('PUT','/api/progress/ch1',{
                        'checkpoint':'invalid_location','expectedRevision':revision,
                        'state':state})
                    self.assertEqual(code,400,result)
                    self.assertEqual(result['code'],'INVALID_LOCATION_STATE')
                    self.assertEqual(db.list_progress(self.path,self.a['id']),baseline)


if __name__=='__main__':
    unittest.main()
