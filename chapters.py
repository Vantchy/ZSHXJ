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


# 子时算稿前三页：陶寺旧学舍，一间房、一条九步任务链、无可见 NPC。
# 服务端仍校验每个教学板的答卷；三页分别有自述、题板、算稿记录。
def taosi_quest():
    lessons = [
        ('taosi-one', '通断一·表示与运算之别', 'taosi-representation-board'),
        ('taosi-two', '通断二·方向是算的前提', 'taosi-direction-board'),
        ('taosi-three', '通断三·单向导通', 'taosi-oneway-board'),
    ]
    steps = []
    for stem, name, board in lessons:
        intro = f'{stem}-intro'
        board_step = f'{stem}-board'
        finished_board = f'{stem}-board-done'
        note = f'{stem}-note'
        steps.extend([
            {'id':intro, 'title':f'{name}：子独白', 'description':'到书案翻阅遗玉，听子自述。',
             'condition':{'type':'dialogue-finished','dialogueId':intro}},
            {'id':board_step, 'title':f'{name}：教学操作', 'description':'走近书案完成本关教学题板。',
             'condition':{'type':'dialogue-finished','dialogueId':finished_board,'boardId':board}},
            {'id':note, 'title':f'{name}：写成算稿', 'description':'记录知识结论和算稿批注。',
             'condition':{'type':'dialogue-finished','dialogueId':note}},
        ])
    return {
        'id':'taosi-three-pages','type':'side','title':'子时·陶寺 算稿前三页',
        'description':'子守旧学舍，以遗玉推演表示与运算、玉网方向、顺通逆断，逐页记下算稿。',
        'hint':'每关依次完成自述、教学操作、算稿批注；共三关九步。',
        'chapterId':'ch1','locationId':'taosi-old-academy','steps':steps,
        'prerequisites':['mengjin-school-lower'],'rewards':[],
        'tags':['taosi','zi','solo-story','three-lessons'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }



# 子时 · 嫣沩算稿后三页。第四关白昼，第五、六关在同一水畔工坊夜景。
# 单独任务对应地点（日/夜），沿用陶寺的「独白 → 题板 → 算稿」正式任务证据。


def taosi_chou_handoff_quest():
    return {
        'id':'taosi-chou-handoff','type':'side','title':'丑时·旧学舍重归',
        'description':'丑回到旧学舍，与老妇交谈，查看子留下的算稿，并接下制门的第一步。',
        'hint':'与老妇交谈 → 前往书案阅读算稿 → 确认后续制门方向。',
        'chapterId':'ch1','locationId':'taosi-old-academy-return',
        'steps':[
            {'id':'chou-meet-old-woman','title':'与老妇交谈',
             'description':'向守着旧学舍的老妇问明近况，确认子已离去。',
             'condition':{'type':'dialogue-finished','dialogueId':'taosi-chou-intro'}},
            {'id':'chou-read-manuscript','title':'前往书案，阅读算稿',
             'description':'走到旧书案前，翻看子留下的算稿与制门引导。',
             'condition':{'type':'dialogue-finished','dialogueId':'taosi-chou-board-done',
                          'boardId':'taosi-handoff-board'}},
            {'id':'chou-take-responsibility','title':'接下制门第一步',
             'description':'理清与非门的地位，决定由丑继续把图纸化为器物。',
             'condition':{'type':'dialogue-finished','dialogueId':'taosi-chou-report'}},
        ],
        'prerequisites':['yanwei-night-five-six'],'rewards':[],
        'tags':['taosi','chou','handoff','nand-intro'],
        'completion':{'mode':'test-only','levelIds':[],'requireAllSteps':True},
    }



def taosi_nand_quest():
    # 继承已有电路编辑器：评测必须是服务端完成的正式与非门成绩，不能靠对白代替。
    return {
        'id':'taosi-nand-first','type':'side','title':'丑时·旧学舍夜制与非',
        'description':'旧学舍夜里，丑依子留下的算稿，制作第一枚与非门。',
        'hint':'夜读算稿 → 正式电路编辑器 → 首门完成。',
        'chapterId':'ch1','locationId':'taosi-old-academy-night',
        'steps':[
            {'id':'taosi-nand-intro','title':'灯下沉思与非',
             'description':'翻看子留下的算稿，准备动手。',
             'condition':{'type':'dialogue-finished','dialogueId':'taosi-nand-intro'}},
            {'id':'taosi-nand-level','title':'用电路编辑器制作与非门',
             'description':'提交并通过现有 ch1_cmos_nand 正式服务端评测。',
             'condition':{'type':'level-completed','levelId':'ch1_cmos_nand'}},
            {'id':'taosi-nand-report','title':'记下第一枚门已成',
             'description':'返回旧学舍夜景，收好首门；其余六门留待行军。',
             'condition':{'type':'dialogue-finished','dialogueId':'taosi-nand-report'}},
        ],
        'prerequisites':['taosi-chou-handoff'],'rewards':[],
        'tags':['taosi','chou','night','nand','official-circuit'],
        'completion':{'mode':'official-circuit','levelIds':['ch1_cmos_nand'],'requireAllSteps':True},
    }


# 阳城随军六事：六个真实的正式电路关卡，各自依赖上一个任务已交付。
# 每件事对白 → 现有电路编辑器 → 服务端真值表核验 → 返回场景回报。

def yangcheng_army_quest(index: int):
    army_story_meta = (
        ('not', '其一·识诈', 'yangcheng-valley-deception', 'ch1_army_not', 'taosi-nand-first', '谷口遭遇诱敌之诈。反观表象，制作非门。', '斥候来报 → 与非门组合非门 → 避过伏兵。'),
        ('and', '其二·会攻', 'yangcheng-camp-assault', 'ch1_army_and', 'yangcheng-army-not', '东南两路同至方可出击，制作与门。', '两军会合 → 与非后再取反 → 总攻。'),
        ('or', '其三·粮道', 'yangcheng-camp-supply', 'ch1_army_or', 'yangcheng-army-and', '陆路或水路有一条畅通即可运粮，制作或门。', '粮道受阻 → 用与非门合成或门 → 改走水路。'),
        ('nor', '其四·扎营', 'yangcheng-valley-bivouac', 'ch1_army_nor', 'yangcheng-army-or', '高阜与近水均为禁忌，只有两忌皆无才能扎营，制作或非门。', '查两处地势 → 由与非构成或非 → 决定营址。'),
        ('xor', '其五·夜巡口令', 'yangcheng-watch-night', 'ch1_army_xor', 'yangcheng-army-nor', '两处哨火约定同举，出现不同便须示警，制作异或门。', '夜间举火 → 与非门组异或 → 哨位警戒。'),
        ('xnor', '其六·验符', 'yangcheng-camp-seal', 'ch1_army_xnor', 'yangcheng-army-xor', '信使呈符，两半信息相同方可信，制作同或门。', '信使验符 → 异或后取反 → 六门归齐。'),
    
    )
    key, title, location_id, level_id, prerequisite, description, hint = army_story_meta[index]
    return {
        'id':f'yangcheng-army-{key}', 'type':'side',
        'title':f'丑时·阳城 {title}', 'description':description, 'hint':hint,
        'chapterId':'ch1', 'locationId':location_id,
        'steps':[
            {'id':f'army-{key}-intro', 'title':f'{title}：军中议事',
             'description':'依据军情推演所需的判断条件。',
             'condition':{'type':'dialogue-finished','dialogueId':f'army-{key}-intro'}},
            {'id':f'army-{key}-circuit', 'title':f'正式制作{title}所需的门',
             'description':'用与非门组合，完成电路编辑器中的真值表评测。',
             'condition':{'type':'level-completed','levelId':level_id}},
            {'id':f'army-{key}-report', 'title':f'{title}：回报军中',
             'description':'返回原场景，记录制门的用处并交付。',
             'condition':{'type':'dialogue-finished','dialogueId':f'army-{key}-report'}},
        ],
        'prerequisites':[prerequisite], 'rewards':[],
        'tags':['yangcheng','army','chou','circuit','nand-composition'],
        'completion':{'mode':'official-circuit','levelIds':[level_id], 'requireAllSteps':True},
    }

def yanwei_quest(lesson_start: int):
    if lesson_start == 4:
        lessons = [('yanwei-four','通断四·不可逆防倒灌','yanwei-backflow-board')]
        previous = 'taosi-three-pages'
        location = 'yanwei-riverside-day'
        title = '子时·嫣沩 算稿第四页（日）'
    elif lesson_start == 5:
        lessons = [('yanwei-five','通断五·自动驱动','yanwei-cascade-board'),
                   ('yanwei-six','通断六·单向通路不是门','yanwei-merge-board')]
        previous = 'yanwei-day-four'
        location = 'yanwei-riverside-night'
        title = '子时·嫣沩 算稿第五、六页（夜）'
    else:
        raise ValueError('未知嫣沩算稿章节')
    steps = []
    for stem, name, board in lessons:
        for suffix, label in [('intro','自述'),('board','玉网试验'),('note','写入算稿')]:
            step_id = f'{stem}-{suffix}'
            condition = {'type':'dialogue-finished',
                         'dialogueId':f'{stem}-board-done' if suffix == 'board' else step_id}
            if suffix == 'board': condition['boardId'] = board
            steps.append({'id':step_id, 'title':f'{name}：{label}',
                          'description':('靠近水畔或书案，听子独白并梳理问题。' if suffix=='intro'
                                         else '在玉网实验台完成本关全部操作。' if suffix=='board'
                                         else '写成这一页算稿，保存本关结论。'),
                          'condition':condition})
    return {
        'id':'yanwei-day-four' if lesson_start==4 else 'yanwei-night-five-six',
        'type':'side','title':title,'description':'子继续推演定向玉网，完成算稿新的篇章。',
        'hint':'每一页先自述、再完成玉网试验，最后记录算稿。',
        'chapterId':'ch1','locationId':location,'steps':steps,
        'prerequisites':[previous],'rewards':[],
        'tags':['yanwei','zi','solo-story','ordered-board'],
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
                     mengjin_school_upper_quest(), mengjin_school_lower_quest(),
                     taosi_quest(), yanwei_quest(4), yanwei_quest(5), taosi_chou_handoff_quest(), taosi_nand_quest(),
                     *(yangcheng_army_quest(i) for i in range(6))],
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
            {'id':'taosi-old-academy','name':'陶寺·器派旧学舍',
             'card':'旧学舍','roomTitle':'子时 · 算稿前三页（陶寺）',
             'npc':'子','npcLine':'',
             'background':'/assets/scenes/taosi-old-academy-day.png',
             'mapPoint':{'x':0.54,'y':0.56}, 'spawnX':908,
             'entryPrerequisites':['mengjin-school-lower'], 'roomType':'story',
             'soloNarration':True, 'soloPlayerName':'子', 'soloStationX':446},
            {'id':'taosi-old-academy-return','name':'陶寺·器派旧学舍（丑归来）',
             'card':'旧学舍','roomTitle':'丑时 · 旧学舍重归（陶寺）',
             'npc':'老妇','npcLine':'',
             'background':'/assets/scenes/taosi-old-academy-day.png',
             'mapPoint':{'x':0.54,'y':0.56}, 'spawnX':908,
             'entryPrerequisites':['yanwei-night-five-six'], 'roomType':'story'},
            {'id':'taosi-old-academy-night','name':'陶寺·旧学舍（夜）',
             'card':'旧学舍','roomTitle':'丑时 · 与非门起手（夜）',
             'npc':'丑','npcLine':'',
             'background':'/assets/scenes/taosi-old-academy-night.png',
             'mapPoint':{'x':0.54,'y':0.56},'spawnX':908,
             'entryPrerequisites':['taosi-chou-handoff'],'roomType':'story',
             'soloNarration':True,'soloPlayerName':'丑','soloStationX':446},
            {'id':'yangcheng-valley-deception','name':'阳城·其一·识诈（山谷）',
             'card':'其一·识诈','roomTitle':'丑时 · 其一·识诈（日）',
             'npc':'斥候','npcLine':'',
             'background':'/assets/scenes/yangcheng-valley-day.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['taosi-nand-first'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yangcheng-camp-assault','name':'阳城·其二·会攻（营地）',
             'card':'其二·会攻','roomTitle':'丑时 · 其二·会攻（日）',
             'npc':'将军','npcLine':'',
             'background':'/assets/scenes/yangcheng-camp-day.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['yangcheng-army-not'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yangcheng-camp-supply','name':'阳城·其三·粮道（营地）',
             'card':'其三·粮道','roomTitle':'丑时 · 其三·粮道（日）',
             'npc':'军吏','npcLine':'',
             'background':'/assets/scenes/yangcheng-camp-day.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['yangcheng-army-and'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yangcheng-valley-bivouac','name':'阳城·其四·扎营（山谷）',
             'card':'其四·扎营','roomTitle':'丑时 · 其四·扎营（日）',
             'npc':'将军','npcLine':'',
             'background':'/assets/scenes/yangcheng-valley-day.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['yangcheng-army-or'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yangcheng-watch-night','name':'阳城·其五·夜巡口令（夜哨）',
             'card':'其五·夜巡口令','roomTitle':'丑时 · 其五·夜巡口令（夜）',
             'npc':'哨兵','npcLine':'',
             'background':'/assets/scenes/yangcheng-watch-night.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['yangcheng-army-nor'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yangcheng-camp-seal','name':'阳城·其六·验符（营地）',
             'card':'其六·验符','roomTitle':'丑时 · 其六·验符（日）',
             'npc':'信使','npcLine':'',
             'background':'/assets/scenes/yangcheng-camp-day.png',
             'mapPoint':{'x':0.50,'y':0.50},'spawnX':835,
             'entryPrerequisites':['yangcheng-army-xor'], 'roomType':'story',
             'soloNarration':False, 'soloPlayerName':'丑'},
            {'id':'yanwei-riverside-day','name':'嫣沩·水畔玉网工坊（日）',
             'card':'水畔工坊','roomTitle':'子时 · 算稿第四页（嫣沩·日）',
             'npc':'子','npcLine':'',
             'background':'/assets/scenes/yanwei-riverside-day.png',
             'mapPoint':{'x':0.54,'y':0.54},'spawnX':915,
             'entryPrerequisites':['taosi-three-pages'],'roomType':'story',
             'soloNarration':True,'soloPlayerName':'子','soloStationX':735},
            {'id':'yanwei-riverside-night','name':'嫣沩·水畔玉网工坊（夜）',
             'card':'水畔工坊','roomTitle':'子时 · 算稿第五、六页（嫣沩·夜）',
             'npc':'子','npcLine':'',
             'background':'/assets/scenes/yanwei-riverside-night.png',
             'mapPoint':{'x':0.54,'y':0.54},'spawnX':915,
             'entryPrerequisites':['yanwei-day-four'],'roomType':'story',
             'soloNarration':True,'soloPlayerName':'子','soloStationX':475},
        ],
        'levels': [*FORMAL_LEVELS, *[
    {'id':'ch1_army_not','title':'行军六事·其一·识诈（非门）','lineage':'','item':'','faction':None},
    {'id':'ch1_army_and','title':'行军六事·其二·会攻（与门）','lineage':'','item':'','faction':None},
    {'id':'ch1_army_or','title':'行军六事·其三·粮道（或门）','lineage':'','item':'','faction':None},
    {'id':'ch1_army_nor','title':'行军六事·其四·扎营（或非门）','lineage':'','item':'','faction':None},
    {'id':'ch1_army_xor','title':'行军六事·其五·夜巡口令（异或门）','lineage':'','item':'','faction':None},
    {'id':'ch1_army_xnor','title':'行军六事·其六·验符（同或门）','lineage':'','item':'','faction':None},
], BINARY_LEVEL], 'faction': None, 'implemented': True,
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
