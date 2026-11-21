"""New lesson: real solver, HTTP assessment/save/grade, and old-db upgrade."""
import copy
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import patch

import circuit_service
import database as db
import level_content
from chapters import BY_ID
from quest_model import blank_progress
from server import create_server

ROOT = Path(__file__).resolve().parents[1]
LEVEL_ID = 'ch1_binary_decoder'


def load(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


class BinaryDecoderContentTests(unittest.TestCase):
    def test_six_gate_solution_matches_all_four_combinations(self):
        spec = load('levels/ch1_binary_decoder_v1.json')
        graph = load('tests/circuit_fixtures/binary_decoder.json')
        level_content.validate_spec(spec)
        result = circuit_service._grade(spec, graph, {})
        self.assertEqual((result['passedCount'], result['totalCount']), (4, 4))
        self.assertTrue(result['completed'])
        self.assertEqual(result['warnings'], [])
        self.assertEqual((result['componentCount'], result['minimalComponentCount']), (6, 6))

    def test_bit_order_and_every_output_are_actually_checked(self):
        spec = load('levels/ch1_binary_decoder_v1.json')
        graph = load('tests/circuit_fixtures/binary_decoder.json')
        for component in graph['components']:
            if component.get('name') == 'A1': component['name'] = 'A0'
            elif component.get('name') == 'A0': component['name'] = 'A1'
        result = circuit_service._grade(spec, graph, {})
        self.assertEqual(result['passedCount'], 2)
        self.assertFalse(result['completed'])
        self.assertIsNotNone(result['firstFailure'])
        empty = circuit_service._grade(spec, spec['initialGraph'], {})
        self.assertEqual(empty['passedCount'], 0)
        self.assertFalse(empty['completed'])

    def test_additive_publish_keeps_old_level_and_draft(self):
        specs = level_content.installed_specs()
        old_specs = [spec for spec in specs if spec['id'] != LEVEL_ID]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'upgrade.sqlite3'
            with patch('level_content.installed_specs', return_value=old_specs):
                service = create_server('127.0.0.1', 0, path)
                service.server_close()
            user = db.create_user(path, 'existing_student', 'Password123', '旧学生', role='student')
            old_level = circuit_service.get_level(path, user['id'], 'ch1_cmos_not')['level']
            state = {'schemaVersion': 2, 'circuitLevels': {'ch1_cmos_not': {
                'levelVersion': 1, 'graph': old_level['initialGraph'], 'simulationState': {}}}}
            record, revision = db.save_progress(path, user['id'], 'ch1', 'old_draft', state, 0)
            service = create_server('127.0.0.1', 0, path)
            service.server_close()
            self.assertEqual(db.list_progress(path, user['id'])[0]['state'], state)
            self.assertEqual(db.list_progress(path, user['id'])[0]['revision'], revision)
            self.assertEqual(circuit_service.get_level(path, user['id'], 'ch1_cmos_not')['level']['levelVersion'], 1)
            self.assertEqual(circuit_service.get_level(path, user['id'], LEVEL_ID)['level']['levelVersion'], 1)
            with db.closing(db.connect(path)) as con:
                self.assertEqual(con.execute('SELECT COUNT(*) FROM circuit_level_snapshots').fetchone()[0], 5)

    def test_description_is_public_but_hidden_tests_stay_private(self):
        spec = load('levels/ch1_binary_decoder_v1.json')
        public = level_content.public_spec(spec)
        self.assertIn('A1', public['description'])
        self.assertIn('只亮 Y3', public['description'])
        self.assertNotIn('hiddenVectors', public)
        self.assertNotIn('sequentialScripts', public)
        broken = copy.deepcopy(spec)
        broken['description'] = []
        with self.assertRaisesRegex(ValueError, '关卡说明'):
            level_content.validate_spec(broken)


class BinaryDecoderHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temp.name) / 'binary.sqlite3'
        cls.server = create_server('127.0.0.1', 0, cls.path)
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_address[1])
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        teacher = db.create_user(cls.path, 'binary_teacher', 'Password123', '教师', role='teacher')
        with db.closing(db.connect(cls.path)) as con:
            cls.class_id = con.execute('INSERT INTO classes(name,created_at) VALUES(?,?)', ('二进制测试班', db.now_iso())).lastrowid
            con.execute('INSERT INTO teacher_classes(teacher_id,class_id) VALUES(?,?)', (teacher['id'], cls.class_id))
            con.commit()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        cls.temp.cleanup()

    def request(self, method, path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token is None: token = getattr(self, 'token', None)
        if token: headers['Authorization'] = 'Bearer ' + token
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = urllib.request.Request(self.base + path, method=method, headers=headers, data=data)
        try: reply = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error: reply = error
        with reply: return reply.status, json.loads(reply.read())

    def setUp(self):
        username = 'binary_' + uuid.uuid4().hex[:12]
        self.user = db.create_user(self.path, username, 'Password123', '译码学生', role='student')
        with db.closing(db.connect(self.path)) as con:
            con.execute('UPDATE users SET class_id=? WHERE id=?', (self.class_id, self.user['id'])); con.commit()
        status, reply = self.request('POST', '/api/auth/login', {'username': username, 'password': 'Password123'})
        self.assertEqual(status, 200); self.token = reply['token']
        self.graph = load('tests/circuit_fixtures/binary_decoder.json')

    def open_and_save(self, graph=None, accept_main=False):
        status, reply = self.request('GET', '/api/levels/' + LEVEL_ID)
        self.assertEqual(status, 200); self.assertEqual(reply['level']['allowedPackages'], [])
        chapter = BY_ID['ch1']
        main = blank_progress(chapter['quests']['main'])
        if accept_main: main['status'] = 'accepted'
        definition = next(q for q in chapter['quests']['side'] if q['id'] == 'binary-decoder')
        binary = blank_progress(definition); binary['status'] = 'accepted'
        binary['steps']['listen-workshop']['status'] = 'done'
        binary['steps']['listen-workshop']['evidence'] = {'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-closing'}
        binary['steps']['decode-four-combinations']['status'] = 'current'
        state = {'schemaVersion': 2, 'locationId': 'gate-road', 'position': {'x': 630},
                 'tasks': {'main': main, 'side': {'binary-decoder': binary}},
                 'circuitLevels': {LEVEL_ID: {'levelVersion': 1, 'graph': graph or self.graph, 'simulationState': {}}}}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint': 'binary_draft', 'expectedRevision': 0, 'state': state})
        self.assertEqual(status, 200, reply)
        return state, reply['progress']['revision']

    def submit(self, graph):
        status, attempt = self.request('POST', '/api/levels/' + LEVEL_ID + '/attempts/start', {'levelVersion': 1})
        self.assertEqual(status, 201)
        body = {'levelVersion': 1, 'attemptId': attempt['attemptId'], 'graph': graph}
        status, result = self.request('POST', '/api/levels/' + LEVEL_ID + '/submit', body)
        self.assertEqual(status, 201, result)
        return body, result

    def test_save_live_assessment_package_and_teacher_result(self):
        state, revision = self.open_and_save()
        status, before = self.request('GET', '/api/circuit/results/mine')
        self.assertEqual(before['results'], [])
        for n in range(4):
            status, reply = self.request('POST', '/api/levels/' + LEVEL_ID + '/simulate', {
                'levelVersion': 1, 'graph': self.graph, 'inputs': {'A1': n // 2, 'A0': n % 2}})
            self.assertEqual(status, 200, reply)
            self.assertEqual(reply['outputs'], {'Y'+str(i): int(i == n) for i in range(4)})
        body, result = self.submit(self.graph)
        self.assertEqual((result['submission']['passedCount'], result['submission']['totalCount']), (4, 4))
        self.assertTrue(result['submission']['completed'])
        self.assertEqual(result['package']['symbol'], 'binary_decoder_2to4')
        status, duplicate = self.request('POST', '/api/levels/' + LEVEL_ID + '/submit', body)
        self.assertEqual(status, 200); self.assertEqual(duplicate['record']['submissionCount'], 1)
        status, progress = self.request('GET', '/api/progress')
        self.assertEqual(progress['progress'][0]['state'], state)
        status, grade = self.request('GET', '/api/circuit/results/mine')
        self.assertEqual(len(grade['results']), 1)
        self.assertEqual(grade['results'][0]['levelId'], LEVEL_ID)
        self.assertEqual(grade['results'][0]['assessmentType'], 'circuit_server')
        status, login = self.request('POST', '/api/auth/login', {'username': 'binary_teacher', 'password': 'Password123'})
        status, teacher = self.request('GET', '/api/teacher/circuit-results', token=login['token'])
        self.assertEqual(status, 200)
        self.assertTrue(any(row['levelId'] == LEVEL_ID and row['completed'] for row in teacher['results']))

    def test_partial_solution_never_unlocks_package(self):
        broken = copy.deepcopy(self.graph)
        for c in broken['components']:
            if c.get('name') == 'A1': c['name'] = 'A0'
            elif c.get('name') == 'A0': c['name'] = 'A1'
        self.open_and_save(broken)
        body, result = self.submit(broken)
        self.assertEqual(result['submission']['passedCount'], 2)
        self.assertFalse(result['submission']['completed'])
        self.assertIsNone(result.get('package'))

    def test_binary_evidence_completes_only_its_own_task(self):
        state, revision = self.open_and_save(accept_main=True)
        self.submit(self.graph)
        invalid = copy.deepcopy(state); invalid['tasks']['main']['status'] = 'completed'
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint': 'wrong_task', 'expectedRevision': revision, 'state': invalid})
        self.assertEqual(status, 409)
        binary = state['tasks']['side']['binary-decoder']; binary['status'] = 'completed'
        binary['steps']['decode-four-combinations']['status'] = 'done'
        binary['steps']['decode-four-combinations']['evidence'] = {'levelId': LEVEL_ID, 'assessmentType': 'circuit_server'}
        # A circuit pass is necessary but the new dialogue report is also required.
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint': 'too_early', 'expectedRevision': revision, 'state': state})
        self.assertEqual(status, 409)
        binary['steps']['report-workshop']['status'] = 'done'
        binary['steps']['report-workshop']['evidence'] = {'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-report'}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint': 'binary_completed', 'expectedRevision': revision, 'state': state})
        self.assertEqual(status, 200, reply)
        self.assertEqual(reply['progress']['state']['tasks']['main']['status'], 'accepted')

    def test_unrelated_main_task_does_not_authorize_binary_attempt(self):
        self.request('GET', '/api/levels/' + LEVEL_ID)
        main = blank_progress(BY_ID['ch1']['quests']['main']); main['status'] = 'accepted'
        state = {'schemaVersion': 2, 'tasks': {'main': main, 'side': {}}, 'circuitLevels': {
            LEVEL_ID: {'levelVersion': 1, 'graph': self.graph, 'simulationState': {}}}}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint': 'not_binary_task', 'expectedRevision': 0, 'state': state})
        self.assertEqual(status, 200, reply)
        status, reply = self.request('POST', '/api/levels/' + LEVEL_ID + '/attempts/start', {'levelVersion': 1})
        self.assertEqual(status, 409)
        self.assertEqual(reply['code'], 'LEVEL_NOT_READY')


    def test_exercise_step_itself_requires_a_formal_pass(self):
        state, revision = self.open_and_save()
        state['tasks']['side']['binary-decoder']['steps']['decode-four-combinations']['status'] = 'done'
        state['tasks']['side']['binary-decoder']['steps']['decode-four-combinations']['evidence'] = {'levelId': LEVEL_ID, 'assessmentType': 'circuit_server'}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'forged_step', 'expectedRevision':revision, 'state':state})
        self.assertEqual(status, 409)
        self.assertIn('真实电路评测', reply['error'])

    def test_complete_scene_then_replay_is_idempotent_and_preserves_draft(self):
        state, revision = self.open_and_save()
        self.submit(self.graph)
        binary = state['tasks']['side']['binary-decoder']
        binary['steps']['decode-four-combinations']['status'] = 'done'
        binary['steps']['decode-four-combinations']['evidence'] = {'levelId': LEVEL_ID, 'assessmentType': 'circuit_server'}
        binary['steps']['report-workshop']['status'] = 'current'
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'exercise_done', 'expectedRevision':revision, 'state':state})
        self.assertEqual(status, 200, reply)
        revision = reply['progress']['revision']
        self.assertEqual(reply['progress']['state']['tasks']['side']['binary-decoder']['status'], 'accepted')
        binary['steps']['report-workshop']['status'] = 'done'
        binary['steps']['report-workshop']['evidence'] = {'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-report'}
        binary['status'] = 'completed'
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'report_done', 'expectedRevision':revision, 'state':state})
        self.assertEqual(status, 200, reply)
        binary['status'] = 'submitted'
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'scene_done', 'expectedRevision':reply['progress']['revision'], 'state':state})
        self.assertEqual(status, 200, reply)
        balance = db.game_profile(self.path, self.user['id'])['balance']
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'replay', 'expectedRevision':reply['progress']['revision'], 'state':state})
        self.assertEqual(status, 200, reply)
        self.assertEqual(db.game_profile(self.path, self.user['id'])['balance'], balance)
        self.assertEqual(reply['progress']['state']['circuitLevels'][LEVEL_ID]['graph'], self.graph)
        binary['steps']['listen-workshop']['status'] = 'current'
        status, _ = self.request('PUT', '/api/progress/ch1', {'checkpoint':'rewind', 'expectedRevision':reply['progress']['revision'], 'state':state})
        self.assertEqual(status, 409)

    def test_v08_completed_save_remains_usable_without_reset(self):
        state, revision = self.open_and_save()
        self.submit(self.graph)
        legacy = {'status':'submitted', 'steps':{'decode-four-combinations':{'status':'done'}}}
        state['tasks']['side']['binary-decoder'] = legacy
        # Seed exactly the old on-disk shape, as it existed before this patch.
        with db.closing(db.connect(self.path)) as con:
            con.execute('UPDATE progress SET state_json=? WHERE user_id=? AND chapter_id=?',
                        (json.dumps(state), self.user['id'], 'ch1'))
            con.commit()
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'old_save_unchanged', 'expectedRevision':revision, 'state':state})
        self.assertEqual(status, 200, reply)
        legacy['steps']['listen-workshop'] = {'status':'done', 'evidence':{'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-closing'}}
        legacy['steps']['report-workshop'] = {'status':'current'}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'old_intro', 'expectedRevision':reply['progress']['revision'], 'state':state})
        self.assertEqual(status, 200, reply)
        legacy['steps']['report-workshop'] = {'status':'done', 'evidence':{'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-report'}}
        status, reply = self.request('PUT', '/api/progress/ch1', {'checkpoint':'old_report', 'expectedRevision':reply['progress']['revision'], 'state':state})
        self.assertEqual(status, 200, reply)
        self.assertEqual(reply['progress']['state']['circuitLevels'][LEVEL_ID]['graph'], self.graph)


if __name__ == '__main__':
    unittest.main()
