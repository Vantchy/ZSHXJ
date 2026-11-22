"""Authoritative Mengjin room registration and script-only assessment boundary."""
from pathlib import Path
import unittest

from chapters import BY_ID, STORY_ROUTES
from location_model import validate_location_definitions, validate_location_transition
from story_route_rules import validate_story_routes


class MengjinJadePreviewTest(unittest.TestCase):
    def setUp(self):
        self.chapter = BY_ID['ch1']
        self.story = STORY_ROUTES['ch1']
        self.location = next(loc for loc in self.chapter['locations']
                             if loc['id'] == 'mengjin-jade-courtyard')

    def test_new_location_is_separate_from_published_demo(self):
        legacy = self.chapter['locations'][0]
        self.assertEqual(legacy['id'], 'gate-road')
        self.assertEqual(legacy['background'], '/assets/scenes/workshop-background.png')
        self.assertEqual(self.location['roomType'], 'story-preview')
        self.assertEqual(self.location['spawnX'], 914)
        self.assertEqual(self.location['background'], '/assets/scenes/mengjin-jade-workshop.png')
        self.assertTrue((Path(__file__).resolve().parents[1] / 'public' /
                         self.location['background'].lstrip('/')).is_file())
        self.assertEqual(self.location['mapPoint'], {'x':0.542, 'y':0.5399})
        self.assertEqual(self.chapter['quests']['side'][-1]['id'],'binary-decoder')
        self.assertNotIn('mengjin-jade-courtyard',
                         [q['locationId'] for q in self.chapter['quests']['side']])

    def test_authoritative_declarations_still_validate(self):
        validate_location_definitions((self.chapter,))
        self.assertIs(validate_story_routes(self.chapter,self.story),self.story)
        placement = next(loc for loc in self.story['locations']
                         if loc['id']=='mengjin-jade-courtyard')
        self.assertEqual(placement['characterPlacements'], [
            {'characterId':'artisan-chui','x':304,
             'dialogueId':'mengjin-jade-preview-opening'}])

    def test_existing_game_state_cannot_be_modified_by_preview_dialogue(self):
        paragraphs = [p for p in self.story['dialogues']
                      if p['id'].startswith('mengjin-jade-preview-')]
        self.assertEqual(len(paragraphs),3)
        self.assertEqual(sum(len(p['lines']) for p in paragraphs),10)
        self.assertEqual(paragraphs[-1]['lines'][-1]['text'],
                         '（低声）一态无言，两态成话。')
        for paragraph in paragraphs:
            for option in paragraph.get('options',[]):
                self.assertEqual(option['target']['type'],'dialogue')
        self.assertNotIn('mengjin-jade-courtyard',self.story.get('questTargets',{}))

    def test_location_switch_allowed_and_positions_must_stay_consistent(self):
        before={'schemaVersion':2,'locationId':'gate-road',
                'position':{'x':625},'tasks':{}}
        after={'schemaVersion':2,'locationId':'mengjin-jade-courtyard',
               'position':{'x':914},
               'locationPositions':{'gate-road':{'x':625},
                                    'mengjin-jade-courtyard':{'x':914}},
               'tasks':{}}
        validate_location_transition(self.chapter,before,after)
        after['position']['x']=100
        with self.assertRaisesRegex(ValueError,'position.*locationPositions'):
            validate_location_transition(self.chapter,before,after)


if __name__ == '__main__':
    unittest.main()
