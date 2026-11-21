
import copy
import json
import tempfile
import unittest
from pathlib import Path
from quest_model import validate_quest_state, blank_progress
from story_step_evidence import validate_ordered_evidence

WORKSHOP = {
    'id':'binary-decoder','type':'side','chapterId':'ch1',
    'completion':{'mode':'official-circuit','levelIds':['ch1_binary_decoder'],'requireAllSteps':True},
    'steps':[
      {'id':'listen-workshop','condition':{'type':'dialogue-finished','dialogueId':'mengjin-workshop-closing'}},
      {'id':'decode-four-combinations','condition':{'type':'level-completed','levelId':'ch1_binary_decoder'}},
      {'id':'report-workshop','condition':{'type':'dialogue-finished','dialogueId':'mengjin-workshop-report'}},
    ]
}
EXTRA = {
    'id':'yin-study','type':'side','chapterId':'ch1',
    'completion':{'mode':'official-circuit','levelIds':['ch1_half_adder'],'requireAllSteps':True},
    'steps':[
      {'id':'ask-yin','condition':{'type':'dialogue-finished','dialogueId':'yin-lesson'}},
      {'id':'build-adder','condition':{'type':'level-completed','levelId':'ch1_half_adder'}}
    ]
}
MAIN = {
    'id':'main','type':'main','chapterId':'ch1','completion':{'mode':'test-only','levelIds':[]},
    'steps':[{'id':'step-1','condition':None}]
}
CHAPTER = {'id':'ch1','quests':{'main':MAIN,'side':[WORKSHOP,EXTRA]}}
INTRO = {'type':'dialogue-finished','dialogueId':'mengjin-workshop-closing'}
LEVEL = {'levelId':'ch1_binary_decoder','assessmentType':'circuit_server'}
REPORT = {'type':'dialogue-finished','dialogueId':'mengjin-workshop-report'}

def make_state(*,intro=None,level=None,report=None):
    p=blank_progress(WORKSHOP); p['status']='accepted'
    for id,evidence in [('listen-workshop',intro),('decode-four-combinations',level),
                        ('report-workshop',report)]:
        if evidence is not None:
            p['steps'][id]={'status':'done','updatedAt':None,'evidence':copy.deepcopy(evidence)}
    return {'tasks':{'schemaVersion':1,'main':blank_progress(MAIN),
                     'side':{'binary-decoder':p}}}

class EvidenceValidation(unittest.TestCase):
    def valid(self, state):
        # Public schema validation must be backward compatible, because it
        # runs before the server has loaded the previous saved revision.
        validate_quest_state(CHAPTER,state)
        # Standalone strict verification is used by the transition layer for
        # NEW completions, or to check fresh content fixtures explicitly.
        for quest in CHAPTER['quests']['side']:
            saved = state.get('tasks', {}).get('side', {}).get(quest['id'])
            if saved is not None:
                validate_ordered_evidence(quest, saved)
    def invalid(self,state):
        with self.assertRaises(ValueError):
            self.valid(state)
    def test_fresh(self):
        self.valid(make_state())
    def test_intro(self):
        self.valid(make_state(intro=INTRO))
    def test_complete(self):
        self.valid(make_state(intro=INTRO,level=LEVEL,report=REPORT))
    def test_wrong_dialogue(self):
        self.invalid(make_state(intro={'type':'dialogue-finished','dialogueId':'other'}))
    def test_wrong_dialogue_type(self):
        self.invalid(make_state(intro={'type':'dialogue-opened','dialogueId':INTRO['dialogueId']}))
    def test_missing_evidence_on_completed_dialogue(self):
        x=make_state(); x['tasks']['side']['binary-decoder']['steps']['listen-workshop']['status']='done'
        self.invalid(x)
    def test_wrong_level(self):
        self.invalid(make_state(level={'levelId':'ch1_cmos_not','assessmentType':'circuit_server'}))
    def test_local_level_test(self):
        self.invalid(make_state(level={'levelId':LEVEL['levelId'],'assessmentType':'local'}))
    def test_missing_evidence_on_completed_level(self):
        x=make_state(); x['tasks']['side']['binary-decoder']['steps']['decode-four-combinations']['status']='done'
        self.invalid(x)
    def test_valid_historical_pass_ahead_of_intro(self):
        self.valid(make_state(level=LEVEL))
    def test_unfinished_dialogue_needs_no_evidence(self):
        self.valid(make_state())
    def test_second_quest_generic_rule(self):
        x=make_state()
        p=blank_progress(EXTRA); p['status']='accepted'
        p['steps']['ask-yin']={'status':'done','updatedAt':None,
            'evidence':{'type':'dialogue-finished','dialogueId':'yin-lesson'}}
        x['tasks']['side']['yin-study']=p
        self.valid(x)
        p['steps']['ask-yin']['evidence']['dialogueId']='wrong'
        self.invalid(x)
    def test_legacy_other_quest_unchanged(self):
        x=make_state()
        x['tasks']['main']['steps']['step-1']['status']='done'
        self.valid(x)
    def test_legacy_circuit_only(self):
        self.valid({'circuits':{}})
    def test_unknown_side_quest_rejected(self):
        self.invalid({'tasks':{'side':{'unknown':{'status':'accepted'}}}})
    def test_no_unwarranted_sequence_restriction(self):
        # Database, not this schema check, verifies chronological transitions.
        self.valid(make_state(report=REPORT))


class LegacyEvidenceCompatibility(unittest.TestCase):
    """Regression: preserve historical saves without weakening NEW transitions."""

    def test_schema_accepts_historical_done_without_evidence(self):
        old = make_state()
        step = old['tasks']['side']['binary-decoder']['steps']['decode-four-combinations']
        step['status'] = 'done'
        self.assertIsNone(step['evidence'])
        validate_quest_state(CHAPTER, old)  # structure checking does not know history
        with self.assertRaisesRegex(ValueError, '缺少证据'):
            validate_ordered_evidence(WORKSHOP, old['tasks']['side']['binary-decoder'])

    def test_unchanged_historical_done_can_be_kept_without_backfill(self):
        old = blank_progress(WORKSHOP)
        old['status'] = 'submitted'
        old['steps']['decode-four-combinations'] = {'status':'done'}
        new = copy.deepcopy(old)
        new['updatedAt'] = 'later-other-save'
        validate_ordered_evidence(WORKSHOP, new, old)
        self.assertNotIn('evidence', old['steps']['decode-four-combinations'])
        self.assertNotIn('evidence', new['steps']['decode-four-combinations'])

    def test_legacy_evidence_forgery_and_deletion_both_rejected(self):
        old = blank_progress(WORKSHOP)
        old['status'] = 'accepted'
        old['steps']['decode-four-combinations'] = {'status':'done'}
        forged = copy.deepcopy(old)
        forged['steps']['decode-four-combinations']['evidence'] = LEVEL
        with self.assertRaisesRegex(ValueError, '证据不得修改'):
            validate_ordered_evidence(WORKSHOP, forged, old)

        old2 = copy.deepcopy(old)
        old2['steps']['decode-four-combinations']['evidence'] = LEVEL
        removed = copy.deepcopy(old2)
        removed['steps']['decode-four-combinations']['evidence'] = None
        with self.assertRaisesRegex(ValueError, '证据不得修改'):
            validate_ordered_evidence(WORKSHOP, removed, old2)

        altered = copy.deepcopy(old2)
        altered['steps']['decode-four-combinations']['evidence']['levelId'] = 'other'
        with self.assertRaisesRegex(ValueError, '证据不得修改'):
            validate_ordered_evidence(WORKSHOP, altered, old2)

    def test_new_completion_requires_exact_matching_claim(self):
        old = blank_progress(WORKSHOP)
        old['status'] = 'accepted'
        new = copy.deepcopy(old)
        new['steps']['listen-workshop'] = {'status':'done'}
        with self.assertRaisesRegex(ValueError, '缺少证据'):
            validate_ordered_evidence(WORKSHOP, new, old)
        new['steps']['listen-workshop']['evidence'] = {'type':'dialogue-finished','dialogueId':'wrong'}
        with self.assertRaisesRegex(ValueError, '不一致'):
            validate_ordered_evidence(WORKSHOP, new, old)
        new['steps']['listen-workshop']['evidence'] = INTRO
        validate_ordered_evidence(WORKSHOP, new, old)

    def test_new_report_can_follow_unchanged_legacy_level(self):
        old = blank_progress(WORKSHOP)
        old['status'] = 'submitted'
        old['steps']['decode-four-combinations'] = {'status':'done'}
        new = copy.deepcopy(old)
        new['steps']['listen-workshop'] = {'status':'done','evidence':INTRO}
        new['steps']['report-workshop'] = {'status':'done','evidence':REPORT}
        validate_ordered_evidence(WORKSHOP, new, old)


class DatabaseEvidenceCompatibility(unittest.TestCase):
    """Exercise the real atomic save and its revision/rollback guarantees."""

    def setUp(self):
        import database as db
        from server import create_server
        self.db = db
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'compat.sqlite3'
        server = create_server('127.0.0.1', 0, self.path)
        server.server_close()
        user = db.create_user(self.path, 'compat_student', 'Password123', '旧存档用户')
        self.user_id = user['id']
        from chapters import BY_ID
        self.quest = next(q for q in BY_ID['ch1']['quests']['side']
                          if q['id'] == 'binary-decoder')
        self.main = blank_progress(BY_ID['ch1']['quests']['main'])
        self.legacy = blank_progress(self.quest)
        self.legacy['status'] = 'submitted'
        # Genuine legacy format: level-completed step without evidence.
        self.legacy['steps'] = {'decode-four-combinations': {'status':'done'}}
        self.state = {'schemaVersion': 2, 'locationId': 'gate-road',
                      'tasks': {'main': self.main, 'side': {'binary-decoder': self.legacy}}}
        with db.closing(db.connect(self.path)) as con:
            con.execute('INSERT INTO progress(user_id,chapter_id,checkpoint,state_json,revision,updated_at) '
                        'VALUES (?,?,?,?,?,?)',
                        (self.user_id, 'ch1', 'old_version', json.dumps(self.state), 1, db.now_iso()))
            con.commit()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, state, revision=1):
        return self.db.save_progress(self.path, self.user_id, 'ch1',
                                     'compatibility_check', state, revision)

    def test_old_save_can_be_resaved_with_no_fabricated_proof(self):
        state = copy.deepcopy(self.state)
        state['position'] = {'x': 123}
        result, revision = self.save(state)
        self.assertEqual(revision, 2)
        self.assertEqual(result['state']['position'], {'x': 123})
        self.assertNotIn('evidence', result['state']['tasks']['side']['binary-decoder']
                                    ['steps']['decode-four-combinations'])

    def test_no_client_backfill_into_old_done_step(self):
        state = copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['steps']['decode-four-combinations'] = {
            'status':'done', 'evidence': {'levelId':'ch1_binary_decoder',
                                          'assessmentType':'circuit_server'}}
        with self.assertRaisesRegex(ValueError, '证据不得修改'):
            self.save(state)
        saved = self.db.list_progress(self.path,self.user_id)[0]
        self.assertEqual(saved['revision'],1)
        self.assertEqual(saved['state'],self.state)

    def test_new_done_without_proof_is_rejected_atomically(self):
        state = copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['steps']['listen-workshop'] = {'status':'done'}
        with self.assertRaisesRegex(ValueError, '缺少证据'):
            self.save(state)
        self.assertEqual(self.db.list_progress(self.path,self.user_id)[0]['revision'],1)

    def test_new_dialogue_with_correct_proof_is_accepted(self):
        state = copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['steps']['listen-workshop'] = {
            'status':'done', 'evidence':{'type':'dialogue-finished',
                                           'dialogueId':'mengjin-workshop-closing'}}
        result, revision = self.save(state)
        self.assertEqual(revision,2)
        self.assertEqual(result['state']['tasks']['side']['binary-decoder']
                         ['steps']['listen-workshop']['status'],'done')

    def test_wrong_new_dialogue_id_is_rejected(self):
        state = copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['steps']['listen-workshop'] = {
            'status':'done', 'evidence':{'type':'dialogue-finished',
                                          'dialogueId':'mengjin-workshop-report'}}
        with self.assertRaisesRegex(ValueError,'证据与任务定义不一致'):
            self.save(state)

    def test_old_completed_step_must_not_regress(self):
        state = copy.deepcopy(self.state)
        state['tasks']['side']['binary-decoder']['steps']['decode-four-combinations'] = {
            'status':'current'}
        with self.assertRaisesRegex(ValueError, '不得退回'):
            self.save(state)
