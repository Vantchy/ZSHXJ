"""孟津亥篇二稿场次、说话人及关键句回归。无运行时 DOCX 依赖。"""
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class TestHaiSourceFidelity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story=json.loads((ROOT/'public/story/ch1.json').read_text('utf-8'))
        cls.dialogues={item['id']:item['lines'] for item in cls.story['dialogues']}

    def test_character_order_matches_authored_script(self):
        expected={
            'mengjin-jade-story-opening':['旁白','hai','artisan-chui','hai','artisan-chui'],
            'mengjin-jade-story-reflection':['hai','artisan-chui','hai'],
            'mengjin-diviner-intro':['旁白','diviner-zhen','hai','diviner-zhen'],
            'mengjin-diviner-board-done':['hai'],
            'mengjin-diviner-report':['diviner-zhen','旁白'],
            'mengjin-school-upper-intro':['旁白','zi','hai','zi','hai'],
            'mengjin-school-upper-report':['zi','hai'],
            'mengjin-school-lower-intro':['zi','hai'],
            'mengjin-school-fault-done':['旁白','hai'],
            'mengjin-school-delay-done':['chou'],
            'mengjin-school-regen-done':['hai','zi','hai'],
            'mengjin-school-lower-report':['旁白'],
        }
        for did,order in expected.items():
            with self.subTest(did=did):
                actual=[line['speaker'].get('characterId') or line['speaker'].get('name')
                        for line in self.dialogues[did]]
                self.assertEqual(actual,order)

    def test_author_canonical_lines_retained(self):
        signatures={
            'mengjin-jade-story-opening':['老丈刻的是什么？一道痕是一？', '九个村、五种贡物，拢共四十五样记号'],
            'mengjin-jade-story-reflection':['五位三十有二，不够；六位六十有四', '一态无言，两态成话'],
            'mengjin-diviner-intro':['你来，是要问天的', '两璜相配——阳阳、阳阴、阴阳、阴阴'],
            'mengjin-diviner-board-done':['阴就是〇，阳就是一'],
            'mengjin-diviner-report':['玉只能守住你刻下的话'],
            'mengjin-school-upper-intro':['一张真值表，有两层用处'],
            'mengjin-school-upper-report':['一行不符，全器皆错'],
            'mengjin-school-lower-intro':['指到行，不指到人'],
            'mengjin-school-fault-done':['最长的那条路', '关键路径'],
            'mengjin-school-delay-done':['……凿得深的纹，传得慢么？'],
            'mengjin-school-regen-done':['这叫“衰减”','玉链不能无限长？','级联级数的上限'],
        }
        for did,expected in signatures.items():
            text=' '.join(line['text'] for line in self.dialogues[did])
            for phrase in expected:
                with self.subTest(did=did,phrase=phrase):
                    self.assertIn(phrase,text)

    def test_ui_action_shortening_preserves_operation_keys(self):
        for qid,qtarget in self.story['questTargets'].items():
            if qid in ('main','binary-decoder'):continue
            for step,actions in qtarget.get('scene',{}).get('actions',{}).items():
                for action in actions:
                    self.assertLessEqual(len(action['label']),6,(qid,step,action))

if __name__=='__main__':unittest.main()
