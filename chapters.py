"""Student-facing test content. Unimplemented chapters are intentionally empty.

Stable internal IDs (ch1, gate-road, main) preserve existing room routes,
server-side circuit results and progress compatibility. UI labels are plain
placeholders until the team provides authored content.
"""
from quest_model import validate_chapter_definitions


def test_steps():
    return [
        {'id': 'step-1', 'title': '步骤一', 'description': '', 'condition': None},
        {'id': 'step-2', 'title': '步骤二', 'description': '', 'condition': None},
    ]


def test_quest(quest_id, kind, mode, level_ids=None):
    return {
        'id': quest_id, 'type': kind,
        'title': '主线任务' if kind == 'main' else '支线任务',
        'description': '', 'hint': '',
        'chapterId': 'ch1', 'locationId': 'gate-road',
        'steps': test_steps(),
        'prerequisites': [], 'rewards': [], 'tags': [],
        'completion': {'mode': mode, 'levelIds': list(level_ids or [])},
    }


FORMAL_LEVELS = [
    {'id': 'ch1_cmos_not', 'title': 'CMOS 晶体管搭建非门', 'lineage': '', 'item': '', 'faction': None},
    {'id': 'ch1_cmos_nand', 'title': '四晶体管 CMOS 与非门', 'lineage': '', 'item': '', 'faction': None},
    {'id': 'ch1_half_adder', 'title': '利用逻辑门搭建半加器', 'lineage': '', 'item': '', 'faction': None},
    {'id': 'ch1_sr_latch', 'title': '用与非门搭建 SR 锁存器', 'lineage': '', 'item': '', 'faction': None},
]

CHAPTERS = (
    {
        'id': 'ch1', 'title': '第一章', 'spaceTitle': '地图', 'subtitle': '',
        'order': 1, 'region': '', 'room': '地图', 'npc': '人物', 'npcLine': '',
        'entry': '',
        'quests': {
            'main': test_quest('main', 'main', 'official-circuit', [level['id'] for level in FORMAL_LEVELS]),
            'side': [test_quest('side-test', 'side', 'test-only')],
        },
        'locations': [
            {'id': 'gate-road', 'name': '地图', 'card': '地图', 'roomTitle': '地图',
             'npc': '人物', 'npcLine': '', 'background': '/assets/scenes/workshop-background.png',
             'roomType': 'test'},
        ],
        'levels': FORMAL_LEVELS, 'faction': None, 'implemented': True,
    },
    *(
        {'id': f'ch{order}', 'title': f'第{ordinal}章', 'spaceTitle': '', 'subtitle': '',
         'order': order, 'region': '', 'room': '', 'npc': '', 'npcLine': '',
         'entry': '',
         'quests': {'main': None, 'side': []}, 'locations': [], 'levels': [],
         'faction': None, 'implemented': False}
        for order, ordinal in ((2, '二'), (3, '三'), (4, '四'))
    ),
)

validate_chapter_definitions(CHAPTERS)
BY_ID = {chapter['id']: chapter for chapter in CHAPTERS}
