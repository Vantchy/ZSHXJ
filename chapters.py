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


def mengjin_jade_story_quest():
    return {
        'id': 'mengjin-jade-mainline', 'type': 'side', 'title': '孟津主线·第一场 玉匠铺',
        'description': '向玉匠垂学习两态编码，用六位玉纹完成九村五贡物的记录，再回报所学。',
        'hint': '听取说明 → 完成六位编码题板 → 复述与回报。',
        'chapterId': 'ch1', 'locationId': 'mengjin-jade-courtyard',
        'steps': [
            {'id':'hear-jade-story','title':'向玉匠垂请教阴阳两态',
             'description':'听完绳结、玉版和九村五贡物的说明。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-jade-story-opening'}},
            {'id':'solve-jade-board','title':'在玉版上完成六位编码与解码',
             'description':'计算最少位数，查表解码，再反向刻出贡麦玉纹。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-jade-board-done',
                          'boardId':'mengjin-jade-sixbit'}},
            {'id':'reflect-jade','title':'理解为什么选择两态',
             'description':'与玉匠垂讨论复杂刻纹容易混淆的原因。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-jade-story-reflection'}},
            {'id':'report-jade','title':'向玉匠垂回报并完成第一场',
             'description':'完成白昼剧情，为夜访贞人解锁。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-jade-story-report'}},
        ],
        'prerequisites':[], 'rewards':[], 'tags':['mengjin','jade','narrative'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }

def mengjin_diviner_story_quest():
    return {
        'id':'mengjin-diviner-mainline','type':'side','title':'孟津主线·第二场 贞人居所',
        'description':'入夜后拜访老贞，观察双玉璜的四种排列，回报并完成夜访。',
        'hint':'拜访老贞 → 操作双玉璜 → 回到老贞身边。',
        'chapterId':'ch1','locationId':'mengjin-diviner-residence',
        'steps':[
            {'id':'meet-diviner','title':'与老贞交谈',
             'description':'亥从右侧入场，走近中左位置的老贞。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-diviner-intro'}},
            {'id':'learn-four-patterns','title':'观察双玉璜四象',
             'description':'依次亲手摆出阴阴、阴阳、阳阴、阳阳。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-diviner-board-done',
                          'boardId':'mengjin-diviner-four-symbols'}},
            {'id':'report-diviner','title':'回报老贞并完成夜访',
             'description':'复述两态叠加得到四象的意义。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-diviner-report'}},
        ],
        'prerequisites':['mengjin-jade-mainline'],'rewards':[],
        'tags':['mengjin','diviner','narrative'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }


def mengjin_school_upper_quest():
    """MJ09—MJ13: years pass; Hai teaches Zi the eight-row truth-table method."""
    return {
        'id':'mengjin-school-upper','type':'side','title':'孟津主线·第三场 授业学舍（上）',
        'description':'数年后，亥在学舍向子授业：列齐三位输入的八种情况，再归纳真值表。',
        'hint':'寻找子 → 完成三位真值表 → 回顾授业上。',
        'chapterId':'ch1','locationId':'mengjin-school-courtyard',
        'steps':[
            {'id':'school-upper-intro','title':'数年后，与子开始授业',
             'description':'进入学舍，与子谈论三位组合为什么有八种。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-upper-intro'}},
            {'id':'school-truth-table','title':'亲手填好八行真值表',
             'description':'先逐行枚举三位输入，再按本次明示的示例规则写出输出。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-truth-done',
                          'boardId':'mengjin-school-truth-table'}},
            {'id':'school-upper-report','title':'向子回顾真值表',
             'description':'说明穷举的作用，完成授业上。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-upper-report'}},
        ],
        'prerequisites':['mengjin-diviner-mainline'],'rewards':[],
        'tags':['mengjin','school','narrative','truth-table'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }


def mengjin_school_lower_quest():
    """MJ13—MJ18: Chou joins; fault, delay, signal propagation and handoff."""
    return {
        'id':'mengjin-school-lower','type':'side','title':'孟津主线·第四场 授业学舍（下）',
        'description':'子与丑继续课堂：查故障、找关键路径、辨信号衰减，收束孟津所学。',
        'hint':'与丑交谈 → 查故障 → 算延迟 → 认识再生 → 课堂收束。',
        'chapterId':'ch1','locationId':'mengjin-school-courtyard',
        'steps':[
            {'id':'school-lower-intro','title':'丑加入课堂',
             'description':'听亥和子说明新的课堂挑战，丑首次参与发言。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-lower-intro'}},
            {'id':'school-find-fault','title':'定位与期望不同的真值表行',
             'description':'对照“应得”与“实测”，定位值得先检查的输入组合。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-fault-done',
                          'boardId':'mengjin-school-fault-check'}},
            {'id':'school-critical-path','title':'计算两路玉链的最长延迟',
             'description':'三片与七片玉器各耗一息，找出关键路径。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-delay-done',
                          'boardId':'mengjin-school-delay-path'}},
            {'id':'school-signal-regeneration','title':'辨别信号衰减与再生',
             'description':'了解阈值不清时为何需要再生；不虚构定量衰减参数。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-regen-done',
                          'boardId':'mengjin-school-signal-regen'}},
            {'id':'school-lower-report','title':'与子、丑归纳课堂所得',
             'description':'复述真值表、异常输入、关键路径和信号恢复。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-lower-report'}},
            {'id':'school-mengjin-summary','title':'完成孟津知识结算与交接',
             'description':'亥将算稿与方法交予子，为下一时期留好故事接口。',
             'condition':{'type':'dialogue-finished','dialogueId':'mengjin-school-summary'}},
        ],
        'prerequisites':['mengjin-school-upper'],'rewards':[],
        'tags':['mengjin','school','narrative','fault','delay','regeneration'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }


CHAPTERS = (
    {
        'id': 'ch1', 'title': '第一章', 'spaceTitle': '地图', 'subtitle': '',
        'order': 1, 'region': '', 'room': '地图', 'npc': '人物', 'npcLine': '',
        'entry': '',
        'quests': {
            'main': test_quest('main', 'main', 'official-circuit', [level['id'] for level in FORMAL_LEVELS]),
            'side': [test_quest('side-test', 'side', 'test-only'), binary_decoder_quest(),
                     mengjin_jade_story_quest(), mengjin_diviner_story_quest(),
                     mengjin_school_upper_quest(), mengjin_school_lower_quest()],
        },
        'locations': [
            {'id': 'gate-road', 'name': '地图', 'card': '地图', 'roomTitle': '地图',
             'npc': '人物', 'npcLine': '', 'background': '/assets/scenes/workshop-background.png',
             'mapPoint': {'x': 0.498, 'y': 0.458}, 'spawnX': 180,
             'entryPrerequisites': [], 'roomType': 'test'},
            {'id': 'mengjin-jade-courtyard', 'name': '孟津·玉匠铺',
             'card': '玉匠铺', 'roomTitle': '第一场 · 玉匠铺',
             'npc': '玉匠垂', 'npcLine': '',
             'background': '/assets/scenes/mengjin-jade-workshop.png',
             'mapPoint': {'x': 0.5420, 'y': 0.5399}, 'spawnX': 914,
             'entryPrerequisites': [], 'roomType': 'story'},
            {'id': 'mengjin-diviner-residence', 'name': '孟津·贞人居所',
             'card': '贞人居所', 'roomTitle': '第二场 · 贞人居所（夜）',
             'npc': '老贞', 'npcLine': '',
             'background': '/assets/scenes/mengjin-diviner-night.png',
             'mapPoint': {'x': 0.5420, 'y': 0.5399}, 'spawnX': 900,
             'entryPrerequisites': ['mengjin-jade-mainline'], 'roomType': 'story'},
            {'id': 'mengjin-school-courtyard', 'name':'孟津·营地学舍',
             'card':'授业学舍', 'roomTitle':'第三、四场 · 授业学舍（日）',
             'npc':'子', 'npcLine':'',
             'background':'/assets/scenes/mengjin-school-day.png',
             'mapPoint':{'x':0.3522,'y':0.4274}, 'spawnX':920,
             'entryPrerequisites':['mengjin-diviner-mainline'], 'roomType':'story'},
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
