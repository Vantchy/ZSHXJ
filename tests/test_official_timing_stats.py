"""Fourth-round timing and teacher formal-grade separation (real SQLite)."""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import circuit_results
import circuit_service
import database as db
import management
from chapters import BY_ID
from quest_model import blank_progress
from server import create_server

ROOT = Path(__file__).resolve().parents[1]
LEVEL = 'ch1_cmos_not'


class OfficialTimingTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'timers.sqlite3'
        server = create_server('127.0.0.1', 0, self.path)
        server.server_close()
        self.user = db.create_user(self.path, 'timed_student', 'Password123', '计时学生')
        self.uid = self.user['id']
        self.graph = json.loads((ROOT / 'tests/circuit_fixtures/cmos_not.json').read_text())
        self.base = datetime.now(timezone.utc) - timedelta(minutes=5)

    def enter(self, elapsed):
        now = (self.base + timedelta(seconds=elapsed)).isoformat(timespec='microseconds')
        with patch.object(circuit_service, '_utc_now', return_value=now):
            info = circuit_service.get_level(self.path, self.uid, LEVEL)
        return now, info['level']['levelVersion']

    def timer(self):
        with db.closing(db.connect(self.path)) as con:
            row = con.execute('SELECT started_at FROM circuit_level_run_timers '
                              'WHERE user_id=? AND level_id=?', (self.uid, LEVEL)).fetchone()
            return row['started_at'] if row else None

    def save_draft(self, version):
        main = blank_progress(BY_ID['ch1']['quests']['main'])
        main['status'] = 'accepted'
        state = {'schemaVersion': 2,
                 'tasks': {'main': main, 'side': {}},
                 'circuitLevels': {LEVEL: {
                     'levelVersion': version, 'graph': self.graph, 'simulationState': {}}}}
        result, revision = db.save_progress(self.path, self.uid, 'ch1', 'draft', state, 0)
        self.assertIsNotNone(result)
        self.assertEqual(revision, 1)

    def start(self, version):
        return circuit_service.start_attempt(self.path, self.uid, LEVEL, version)['attemptId']

    def attempt_started(self, attempt):
        with db.closing(db.connect(self.path)) as con:
            return con.execute('SELECT started_at FROM attempts WHERE attempt_id=?',
                               (attempt,)).fetchone()['started_at']

    def test_first_entry_and_repeated_gets_do_not_reset_active_clock(self):
        first, version = self.enter(0)
        self.assertEqual(self.timer(), first)
        later, _ = self.enter(30)
        self.assertNotEqual(later, first)
        self.assertEqual(self.timer(), first,
                         'A second tab/refresh GET cannot reset the timer')
        self.save_draft(version)
        attempt = self.start(version)
        last, _ = self.enter(50)
        self.assertEqual(self.timer(), first,
                         'A pending, unsubmitted attempt keeps the original clock')
        self.assertEqual(self.attempt_started(attempt), first)
        attempt2 = self.start(version)
        self.assertEqual(self.attempt_started(attempt2), first)

    def test_scored_attempt_allows_next_run_without_mutating_old_attempt(self):
        first, version = self.enter(0)
        self.save_draft(version)
        attempt = self.start(version)
        result = circuit_service.submit(self.path, self.uid, LEVEL, {
            'attemptId': attempt, 'levelVersion': version, 'graph': self.graph})
        self.assertTrue(result['submission']['completed'])
        # A second submission for the same attempt cannot create a new score.
        duplicate = circuit_service.submit(self.path, self.uid, LEVEL, {
            'attemptId': attempt, 'levelVersion': version, 'graph': self.graph})
        self.assertFalse(duplicate['created'])
        self.assertEqual(self.attempt_started(attempt), first)
        second, _ = self.enter(75)
        self.assertEqual(self.timer(), second,
                         'Re-entering after a settled attempt starts a new run')
        _, _ = self.enter(120)
        self.assertEqual(self.timer(), second,
                         'Refresh after re-entry must not repeatedly restart the clock')
        newer = self.start(version)
        self.assertEqual(self.attempt_started(newer), second)
        self.assertEqual(self.attempt_started(attempt), first,
                         'A new run cannot rewrite the old signed attempt time')
        with db.closing(db.connect(self.path)) as con:
            num = con.execute('SELECT COUNT(*) FROM scores WHERE user_id=?', (self.uid,)).fetchone()[0]
        self.assertEqual(num, 1)


class TeacherOfficialStatsTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'stats.sqlite3'
        service = create_server('127.0.0.1', 0, self.path)
        service.server_close()
        self.teacher = db.create_user(self.path, 'formal_teacher', 'Password123', '教师', role='teacher')
        self.demo = db.create_user(self.path, 'demo_student', 'Password123', '演示学生')
        self.formal = db.create_user(self.path, 'formal_student', 'Password123', '正式学生')
        with db.closing(db.connect(self.path)) as con:
            with con:
                cid=con.execute("INSERT INTO classes(name,created_at) VALUES(?,?)",
                                ('正式测试班', db.now_iso())).lastrowid
                self.class_id=cid
                con.execute('INSERT INTO teacher_classes(teacher_id,class_id) VALUES(?,?)',
                            (self.teacher['id'],cid))
                con.execute('UPDATE users SET class_id=? WHERE id IN (?,?)',
                            (cid,self.demo['id'],self.formal['id']))
        circuit_service.get_level(self.path,self.formal['id'],LEVEL)
        with db.closing(db.connect(self.path)) as con:
            with con:
                # Demo score exists in the very same chapter and looks passed.
                # There is intentionally no circuit_level_attempts association.
                self.add_score(con,self.demo['id'],'demo-attempt',completed=True,
                               passed=2, total=2, official=False)
                self.add_score(con,self.formal['id'],'real-attempt',completed=True,
                               passed=2,total=2, official=True)

    def add_score(self, con, uid, attempt, *, completed, passed, total, official):
        con.execute('INSERT INTO attempts(attempt_id,user_id,chapter_id,started_at) '
                    'VALUES(?,?,?,?)',(attempt,uid,'ch1',db.now_iso()))
        row=con.execute('INSERT INTO scores(user_id,chapter_id,score,completed,details_json,attempt_id,submitted_at) '
            'VALUES(?,?,?,?,?,?,?)',(
                uid,'ch1',0,int(completed),json.dumps({'passedCount':passed,'totalCount':total,
                    'unit':'组','mock':not official}),attempt,db.now_iso()))
        if official:
            con.execute('INSERT INTO circuit_level_attempts(attempt_id,user_id,level_id,level_version,score_id) '
                'VALUES(?,?,?,?,?)',(attempt,uid,LEVEL,1,row.lastrowid))

    def test_teacher_pagination_detail_and_not_completed_are_formal_only(self):
        teacher_view=circuit_results.teacher(self.path,self.teacher,class_id=self.class_id)
        self.assertEqual(teacher_view['pagination']['total'],1)
        self.assertEqual(len(teacher_view['results']),1)
        self.assertEqual(teacher_view['results'][0]['student']['id'],self.formal['id'])
        self.assertEqual(teacher_view['results'][0]['assessmentType'],'circuit_server')
        self.assertFalse(any(x['levelId'].startswith('demo:') for x in teacher_view['results']))
        self.assertEqual(circuit_results.teacher(self.path,self.teacher,
            class_id=self.class_id,all_rows=True)['pagination']['total'],1)
        incomplete=management.teacher_students(self.path,self.teacher,class_id=self.class_id,
            status='not_completed',chapter_id='ch1')
        self.assertEqual([x['id'] for x in incomplete['students']],[self.demo['id']])
        legacy=management.teacher_student_detail(self.path,self.teacher,self.demo['id'])
        self.assertFalse(legacy['chapters'][0]['completed'])
        self.assertTrue(legacy['chapters'][0]['legacyDemoCompleted'])
        self.assertTrue(legacy['chapters'][0]['scores'], 'Historical demo raw scores must survive')
        self.assertTrue(any(x['assessmentType']=='legacy_demo' for x in legacy['levelResults']))
        complete=management.teacher_student_detail(self.path,self.teacher,self.formal['id'])
        self.assertTrue(complete['chapters'][0]['completed'])
        self.assertFalse(complete['chapters'][0]['legacyDemoCompleted'])
        self.assertTrue(any(x['assessmentType']=='circuit_server' for x in complete['levelResults']))
        mine=circuit_results.mine(self.path,self.demo['id'])
        self.assertEqual(mine['results'][0]['assessmentType'],'legacy_demo')
        self.assertEqual(mine['results'][0]['status'],'已完成')


if __name__ == '__main__':
    unittest.main()
