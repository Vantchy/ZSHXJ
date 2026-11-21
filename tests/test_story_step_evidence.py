
import copy
import unittest
from quest_model import validate_quest_state, blank_progress

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
        validate_quest_state(CHAPTER,state)
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
