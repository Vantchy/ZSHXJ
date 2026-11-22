"""剧情二稿对白精度回归：保护原稿台词与当前任务契约。"""
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'public/story/ch1.json').read_text(encoding='utf-8'))
BY={d['id']:d for d in D['dialogues']}

def of(dialogue,who):
    return [line['text'] for line in BY[dialogue]['lines'] if
            line.get('speaker')=={'characterId':who}]

class TestDialogueFidelity(unittest.TestCase):
    def test_chou_and_old_woman_source_lines_exact(self):
        self.assertEqual(of('taosi-chou-intro','old-woman'),[
            '是丑娃回来了？屋里灰厚，婶子帮你扫扫？',
            '（看见牌位前的算稿）你师兄的东西？',
        ])
        self.assertEqual(of('taosi-chou-intro','chou'),[
            '（摇头）……不必。',
            '（沉默良久，点头）……他留的。',
        ])
        self.assertTrue(any(x['speaker']=={'name':'算稿'} and
             x['text']=='（子的字迹）与非一门，万门之母。得此一门者，六门皆出。'
             for x in BY['taosi-chou-board-done']['lines']))

    def test_craft_success_line_is_not_premature(self):
        text=''.join(x['text'] for dialogue in ('taosi-chou-intro','taosi-chou-board-done','taosi-chou-report')
                     for x in BY[dialogue]['lines'])
        self.assertNotIn('师兄。理，我替你凿出来了。',text)
        self.assertNotIn('案上的灰我日日替你们拂',text)
        self.assertNotIn('后头真正难的',text)

    def test_zi_original_language_is_restored(self):
        self.assertTrue(any('贡麦四十，刻四十道。' in x['text'] for x in BY['taosi-one-intro']['lines']))
        self.assertTrue(any('甲推乙，乙推丙，丙又推甲' in x['text'] for x in BY['taosi-two-intro']['lines']))
        self.assertTrue(any('顺则通，逆则断' in x['text'] for x in BY['taosi-three-intro']['lines']))
        self.assertTrue(any('下游举错了旗，上游跟着错' in x['text'] for x in BY['yanwei-four-intro']['lines']))
        self.assertTrue(any('人阵要三千人，玉网只要我拨一下' in x['text'] for x in BY['yanwei-five-intro']['lines']))
        self.assertTrue(any('（又试）不行。（再试）还是不行' in x['text'] for x in BY['yanwei-six-intro']['lines']))
        self.assertTrue(any('我想得清……做不出。' in x['text'] for x in BY['yanwei-six-note']['lines']))

    def test_same_quest_and_stage_ids(self):
        self.assertEqual(set(D['questTargets']) & {'taosi-chou-handoff','yanwei-night-five-six','taosi-three-pages'},
                         {'taosi-chou-handoff','yanwei-night-five-six','taosi-three-pages'})
        self.assertIn('taosi-chou-intro',BY)
        self.assertIn('taosi-chou-board-done',BY)
        self.assertIn('taosi-chou-report',BY)
        self.assertEqual(len(D['dialogues']),len(BY))

if __name__=='__main__':unittest.main()
