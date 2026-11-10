"""Quest definitions, schema constraints and safe DB initialization."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from chapters import CHAPTERS, BY_ID
from quest_model import blank_progress, normalize_progress, validate_quest_state, validate_chapter_definitions
from tools.reset_test_db import reset


class QuestModelTests(unittest.TestCase):
    def test_fixture_content_is_unambiguous(self):
        validate_chapter_definitions(CHAPTERS)
        chapter = BY_ID['ch1']
        self.assertEqual([x['name'] for x in chapter['locations']], ['地图'])
        quests=[chapter['quests']['main'], *chapter['quests']['side']]
        self.assertEqual([q['title'] for q in quests], ['主线任务','支线任务'])
        for quest in quests:
            self.assertEqual([x['title'] for x in quest['steps']], ['步骤一','步骤二'])
            self.assertEqual(quest['description'], '')
            self.assertEqual(quest['rewards'], [])
            self.assertEqual(quest['prerequisites'], [])
        self.assertEqual([q['completion']['mode'] for q in quests], ['official-circuit','test-only'])

    def test_normalization_and_unknown_step_rejection(self):
        quest = BY_ID['ch1']['quests']['main']
        progress = normalize_progress({'status':'accepted'}, quest)
        self.assertEqual(set(progress['steps']), {'step-1','step-2'})
        self.assertEqual(progress['status'],'accepted')
        validate_quest_state(BY_ID['ch1'],{'tasks':{'main':progress,'side':{}}})
        progress['steps']['random']={'status':'done'}
        with self.assertRaisesRegex(ValueError,'steps'):
            validate_quest_state(BY_ID['ch1'],{'tasks':{'main':progress,'side':{}}})

    def test_official_pass_allows_forward_only_main_transition(self):
        import database as db
        from server import create_server
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'official.sqlite3'
            server=create_server('127.0.0.1',0,path)
            server.server_close()
            with closing(db.connect(path)) as con:
                with con:
                    user=con.execute(
                      'INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)',
                      ('officialstudent','测试学生','unused','student',db.now_iso()))
                    uid=user.lastrowid
            definition=BY_ID['ch1']['quests']['main']
            main=blank_progress(definition)
            main['status']='accepted'
            saved,rev=db.save_progress(path,uid,'ch1','test',{'tasks':{'main':main,'side':{}}},0)
            with closing(db.connect(path)) as con:
                with con:
                    # This is a DB-level integration fixture: scores and their official
                    # circuit attempts must reference each other, not merely exist.
                    score=con.execute('INSERT INTO scores(user_id,chapter_id,score,completed,details_json,attempt_id,submitted_at) VALUES(?,?,?,?,?,?,?)',
                      (uid,'ch1',0,1,'{}','official-test-attempt',db.now_iso()))
                    con.execute('INSERT INTO attempts(attempt_id,user_id,chapter_id,started_at) VALUES(?,?,?,?)',
                      ('official-test-attempt',uid,'ch1',db.now_iso()))
                    con.execute('INSERT INTO circuit_level_attempts(attempt_id,user_id,level_id,level_version,score_id) VALUES(?,?,?,?,?)',
                      ('official-test-attempt',uid,'ch1_cmos_not',1,score.lastrowid))
            main['status']='completed'
            record,rev=db.save_progress(path,uid,'ch1','test',{'tasks':{'main':main,'side':{}}},rev)
            self.assertEqual(record['state']['tasks']['main']['status'],'completed')
            main['status']='submitted'
            record,rev=db.save_progress(path,uid,'ch1','test',{'tasks':{'main':main,'side':{}}},rev)
            self.assertEqual(record['state']['tasks']['main']['status'],'submitted')
            self.assertEqual(db.game_profile(path,uid)['balance'],0,
               'No fictional quest reward is configured')

    def test_only_intended_reset_can_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'new.sqlite3'
            reset(path)
            with closing(sqlite3.connect(path)) as con:
                self.assertEqual(con.execute('SELECT count(*) FROM users').fetchone()[0], 0)
                self.assertEqual(con.execute('SELECT count(*) FROM progress').fetchone()[0], 0)
                self.assertEqual(con.execute('SELECT count(*) FROM circuit_level_snapshots').fetchone()[0], 4)
            with self.assertRaises(FileExistsError):
                reset(path)


if __name__ == '__main__':
    unittest.main()
