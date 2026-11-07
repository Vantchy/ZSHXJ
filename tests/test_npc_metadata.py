"""Empty future chapters and explicit placeholder map/quest definitions."""
import unittest
from chapters import CHAPTERS
from quest_model import validate_chapter_definitions


class NpcMetadataTests(unittest.TestCase):
    def test_only_first_chapter_has_test_data(self):
        self.assertEqual(len(CHAPTERS),4)
        validate_chapter_definitions(CHAPTERS)
        first,*others=CHAPTERS
        self.assertEqual(first['npc'],'人物')
        self.assertEqual(first['npcLine'],'')
        self.assertEqual([x['name'] for x in first['locations']],['地图'])
        self.assertEqual(first['quests']['main']['title'],'主线任务')
        self.assertEqual([q['title'] for q in first['quests']['side']],['支线任务'])
        self.assertEqual([step['title'] for step in first['quests']['main']['steps']],['步骤一','步骤二'])
        for chapter in others:
            self.assertFalse(chapter['implemented'])
            self.assertEqual(chapter['locations'],[])
            self.assertEqual(chapter['quests'],{'main':None,'side':[]})
            self.assertEqual(chapter['npcLine'],'')
            self.assertEqual(chapter['levels'],[])


if __name__=='__main__':
    unittest.main()
