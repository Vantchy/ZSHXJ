"""Test-only tasks never generate fictional items or currency rewards."""
import tempfile
import unittest
from pathlib import Path
import database as db
from chapters import BY_ID
from quest_model import blank_progress


class GameRewardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "test.sqlite3"
        db.init(self.path)
        with db.connect(self.path) as con:
            user = con.execute(
                "INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                ("test_student", "测试用户", "unused", "student", db.now_iso()),
            )
            self.user_id = user.lastrowid
            con.commit()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, data, expected):
        return db.save_progress(self.path,self.user_id,'ch1','test',{'tasks':data},expected)

    def test_test_only_side_progress_has_no_reward(self):
        definitions = BY_ID['ch1']['quests']
        main = blank_progress(definitions['main'])
        side = blank_progress(definitions['side'][0])
        side['status'] = 'accepted'
        record,rev = self.save({'main':main, 'side':{'side-test':side}},0)
        for step in definitions['side'][0]['steps']:
            side['steps'][step['id']]['status'] = 'done'
        side['status'] = 'completed'
        record,rev = self.save({'main':main,'side':{'side-test':side}},rev)
        side['status'] = 'submitted'
        record,rev = self.save({'main':main,'side':{'side-test':side}},rev)
        self.assertEqual(db.game_profile(self.path,self.user_id)['balance'],0)
        self.assertEqual(db.game_profile(self.path,self.user_id)['inventory'],{})

    def test_main_quest_cannot_skip_or_fake_official_pass(self):
        main = blank_progress(BY_ID['ch1']['quests']['main'])
        main['status'] = 'accepted'
        record,rev = self.save({'main':main,'side':{}},0)
        main['status'] = 'submitted'
        with self.assertRaisesRegex(ValueError,'跳转不合法'):
            self.save({'main':main,'side':{}},rev)
        main['status'] = 'completed'
        with self.assertRaisesRegex(ValueError,'真实电路'):
            self.save({'main':main,'side':{}},rev)
        self.assertEqual(db.game_profile(self.path,self.user_id)['balance'],0)

    def test_level_coin_reward_once_without_placeholder_artifact(self):
        self.assertTrue(db.award_level_reward(self.path,self.user_id,'ch1','ch1_cmos_not'))
        self.assertFalse(db.award_level_reward(self.path,self.user_id,'ch1','ch1_cmos_not'))
        profile=db.game_profile(self.path,self.user_id)
        self.assertEqual(profile['balance'],30)
        self.assertEqual(profile['inventory'],{})


if __name__ == '__main__':
    unittest.main()
