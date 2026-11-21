"""Student-facing test content. Unimplemented chapters are intentionally empty.

Stable internal IDs (ch1, gate-road, main) preserve existing room routes,
server-side circuit results and progress compatibility. UI labels are plain
placeholders until the team provides authored content.
"""
from quest_model import validate_chapter_definitions
from story_model import load_character_registry, validate_story_definitions
from story_route_rules import load_story_routes
from location_model import validate_location_definitions


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

BINARY_LEVEL = {
    'id': 'ch1_binary_decoder', 'title': '两位二进制译码：00、01、10、11',
    'lineage': '', 'item': '', 'faction': None,
}


def binary_decoder_quest():
    return {
        'id': 'binary-decoder', 'type': 'side', 'title': '玉匠铺·两纹记数',
        'description': '向玉匠垂请教两纹记数，完成两位二进制译码，再将结果带回铺中。',
        'hint': '听取说明 → 完成译码 → 回报玉匠。',
        'chapterId': 'ch1', 'locationId': 'gate-road',
        'steps': [{
            'id': 'listen-workshop', 'title': '向玉匠请教两纹记数',
            'description': '听完两种纹路、四种组合及译码练习的说明。',
            'condition': {'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-closing'},
        }, {
            'id': 'decode-four-combinations', 'title': '通过全部四种输入组合',
            'description': '完成两位二进制译码器并提交服务端评测。',
            'condition': {'type': 'level-completed', 'levelId': BINARY_LEVEL['id']},
        }, {
            'id': 'report-workshop', 'title': '返回玉匠铺，回报译码结果',
            'description': '与玉匠垂交谈，听完反馈并结束本场。',
            'condition': {'type': 'dialogue-finished', 'dialogueId': 'mengjin-workshop-report'},
        }],
        'prerequisites': [], 'rewards': [], 'tags': ['binary', 'decoder'],
        'completion': {'mode': 'official-circuit', 'levelIds': [BINARY_LEVEL['id']], 'requireAllSteps': True},
    }

CHAPTERS = (
    {
        'id': 'ch1', 'title': '第一章', 'spaceTitle': '地图', 'subtitle': '',
        'order': 1, 'region': '', 'room': '地图', 'npc': '人物', 'npcLine': '',
        'entry': '',
        'quests': {
            'main': test_quest('main', 'main', 'official-circuit', [level['id'] for level in FORMAL_LEVELS]),
            'side': [test_quest('side-test', 'side', 'test-only'), binary_decoder_quest()],
        },
        'locations': [
            {'id': 'gate-road', 'name': '地图', 'card': '地图', 'roomTitle': '地图',
             'npc': '人物', 'npcLine': '', 'background': '/assets/scenes/workshop-background.png',
             'mapPoint': {'x': 0.498, 'y': 0.458}, 'spawnX': 180,
             'entryPrerequisites': [], 'roomType': 'test'},
        ],
        'levels': [*FORMAL_LEVELS, BINARY_LEVEL], 'faction': None, 'implemented': True,
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
validate_location_definitions(CHAPTERS)
# Import-time content validation: server.py imports chapters before HTTP startup.
# No story fields or rendering are added to the existing placeholder content.
CHARACTERS = load_character_registry()
validate_story_definitions(CHAPTERS, CHARACTERS)
# Authoritative target links, checked against deployed story JSON at startup.
STORY_ROUTES = load_story_routes(CHAPTERS, registry=CHARACTERS)
BY_ID = {chapter['id']: chapter for chapter in CHAPTERS}
