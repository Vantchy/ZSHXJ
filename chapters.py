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

# 寅时全新关卡与地图只增量登记；原有任务/关卡 ID 不变。
YIN_NEW_QUESTS = [{'id': 'yin-majority', 'type': 'side', 'title': '寅时·承军与三人表决器', 'description': '钟病榻交军，三位旧将表态；寅制器，使决议有凭。', 'hint': '寅时·承军与三人表决器', 'chapterId': 'ch1', 'locationId': 'yin-zhongcun-tent', 'steps': [{'id': 'yin-majority-talk', 'title': '病榻前的交军', 'description': '病榻前的交军', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-majority-intro'}}, {'id': 'yin-majority-level', 'title': '制作三人表决器', 'description': '制作三人表决器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_majority'}}, {'id': 'yin-majority-report', 'title': '三将议决，父子诀别', 'description': '三将议决，父子诀别', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-majority-report'}}], 'prerequisites': ['yangcheng-army-xnor'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_majority'], 'requireAllSteps': True}}, {'id': 'yin-mux', 'type': 'side', 'title': '寅时·山道多路选择器', 'description': '山道被围，寅以令旗选择军报；先建二选一，再用它组合四选一。', 'hint': '寅时·山道多路选择器', 'chapterId': 'ch1', 'locationId': 'yin-zhenxun-road', 'steps': [{'id': 'yin-mux-talk', 'title': '谷口险情与选路之计', 'description': '谷口险情与选路之计', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-mux-intro'}}, {'id': 'yin-mux2-level', 'title': '制作二选一选择器', 'description': '制作二选一选择器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_mux2'}}, {'id': 'yin-mux-mid', 'title': '四路军情再至', 'description': '四路军情再至', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-mux-mid'}}, {'id': 'yin-mux4-level', 'title': '组合四选一选择器', 'description': '组合四选一选择器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_mux4'}}, {'id': 'yin-mux-report', 'title': '撤出谷口，拾得香囊', 'description': '撤出谷口，拾得香囊', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-mux-report'}}], 'prerequisites': ['yin-majority'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_mux2', 'ch1_yin_mux4'], 'requireAllSteps': True}}, {'id': 'yin-summit', 'type': 'side', 'title': '寅时·景亳会盟', 'description': '会盟争执中，寅以三日为期，答应拿出可验的器。', 'hint': '寅时·景亳会盟', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-meeting', 'steps': [{'id': 'yin-summit-talk', 'title': '诸侯争盟，寅立三日之约', 'description': '诸侯争盟，寅立三日之约', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-summit-intro'}}], 'prerequisites': ['yin-mux'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}, {'id': 'yin-halfadder', 'type': 'side', 'title': '寅时·桃林半加器', 'description': '两路相加，既要看和位，也要留下进位；寅在桃林遇见青衣女子。', 'hint': '寅时·桃林半加器', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-peach-dusk', 'steps': [{'id': 'yin-half-talk', 'title': '桃林偶遇，分辨和与进位', 'description': '桃林偶遇，分辨和与进位', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-half-intro'}}, {'id': 'yin-half-level', 'title': '制作半加器', 'description': '制作半加器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_halfadder'}}, {'id': 'yin-half-report', 'title': '三日之约，器成于桃林', 'description': '三日之约，器成于桃林', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-half-report'}}], 'prerequisites': ['yin-summit'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_halfadder'], 'requireAllSteps': True}}, {'id': 'yin-fulladder', 'type': 'side', 'title': '寅时·月下全加器', 'description': '寅将两台半加器接为全加器，青衣女子在旁看他折腾。', 'hint': '寅时·月下全加器', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-peach-night', 'steps': [{'id': 'yin-full-talk', 'title': '旧案重逢，三路相加', 'description': '旧案重逢，三路相加', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-full-intro'}}, {'id': 'yin-full-level', 'title': '制作全加器', 'description': '制作全加器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_fulladder'}}, {'id': 'yin-full-report', 'title': '月色下的约定', 'description': '月色下的约定', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-full-report'}}], 'prerequisites': ['yin-halfadder'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_fulladder'], 'requireAllSteps': True}}, {'id': 'yin-ripple', 'type': 'side', 'title': '寅时·行波进位四位加法器', 'description': '将四台全加器首尾相接，审查最长进位链；不能把逐级传递误当成同时计算。', 'hint': '寅时·行波进位四位加法器', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-accounts', 'steps': [{'id': 'yin-ripple-talk', 'title': '账册堆案，粮兵待算', 'description': '账册堆案，粮兵待算', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-ripple-intro'}}, {'id': 'yin-ripple-level', 'title': '正式制作四位行波加法器', 'description': '正式制作四位行波加法器', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_ripple4'}}, {'id': 'yin-ripple-report', 'title': '进位如波，慢由此生', 'description': '进位如波，慢由此生', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-ripple-report'}}], 'prerequisites': ['yin-fulladder'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_ripple4'], 'requireAllSteps': True}}, {'id': 'yin-cla', 'type': 'side', 'title': '寅时·超前进位四位加法器', 'description': '寅和青衣女子推算生成、传播规律；玩家亲写 C₂—C₄，再搭建真正的超前进位电路。', 'hint': '寅时·超前进位四位加法器', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-peach-cla', 'steps': [{'id': 'yin-cla-talk', 'title': '夜林重遇，进位从何而生', 'description': '夜林重遇，进位从何而生', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-cla-intro'}}, {'id': 'yin-cla-expand', 'title': '手写三级超前进位展开式', 'description': '手写三级超前进位展开式', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-cla-board-done', 'boardId': 'yin-cla-expansion'}}, {'id': 'yin-cla-level', 'title': '亲手搭建四位超前进位电路', 'description': '亲手搭建四位超前进位电路', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_cla4'}}, {'id': 'yin-cla-report', 'title': '一夜之后，进位不再等', 'description': '一夜之后，进位不再等', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-cla-report'}}], 'prerequisites': ['yin-ripple'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_cla4'], 'requireAllSteps': True}}, {'id': 'yin-final-exam', 'type': 'side', 'title': '寅时·决战前的八位终考', 'description': '决战前，寅须亲手接成八位加法器，完成军帐总账。', 'hint': '寅时·决战前的八位终考', 'chapterId': 'ch1', 'locationId': 'yin-zhenxun-hq-exam', 'steps': [{'id': 'yin-final-talk', 'title': '决战在即，联军总账', 'description': '决战在即，联军总账', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-intro'}}, {'id': 'yin-eight-level', 'title': '八位加法器正式电路终考', 'description': '八位加法器正式电路终考', 'condition': {'type': 'level-completed', 'levelId': 'ch1_yin_eightbit'}}, {'id': 'yin-eight-report', 'title': '总账归整，明日出征', 'description': '总账归整，明日出征', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-report'}}], 'prerequisites': ['yin-cla'], 'rewards': [], 'tags': ['yin', 'story', 'official-circuit'], 'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_yin_eightbit'], 'requireAllSteps': True}}, {'id': 'yin-final-vow', 'type': 'side', 'title': '寅时结局·战前之约', 'description': '寅时结局演出：战前之约', 'hint': '寅时结局·战前之约', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-peach-vow', 'steps': [{'id': 'yin-final-vow-dialogue', 'title': '战前之约', 'description': '战前之约', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-promise'}}], 'prerequisites': ['yin-final-exam'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}, {'id': 'yin-final-war', 'type': 'side', 'title': '寅时结局·决战', 'description': '寅时结局演出：决战', 'hint': '寅时结局·决战', 'chapterId': 'ch1', 'locationId': 'yin-zhenxun-hq-war', 'steps': [{'id': 'yin-final-war-dialogue', 'title': '决战', 'description': '决战', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-battle'}}], 'prerequisites': ['yin-final-vow'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}, {'id': 'yin-final-insight', 'type': 'side', 'title': '寅时结局·算完即散', 'description': '寅时结局演出：算完即散', 'hint': '寅时结局·算完即散', 'chapterId': 'ch1', 'locationId': 'yin-zhenxun-hq-insight', 'steps': [{'id': 'yin-final-insight-dialogue', 'title': '算完即散', 'description': '算完即散', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-insight'}}], 'prerequisites': ['yin-final-war'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}, {'id': 'yin-final-wait', 'type': 'side', 'title': '寅时结局·失约', 'description': '寅时结局演出：失约', 'hint': '寅时结局·失约', 'chapterId': 'ch1', 'locationId': 'yin-jingbo-peach-wait', 'steps': [{'id': 'yin-final-wait-dialogue', 'title': '失约', 'description': '失约', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-missed'}}], 'prerequisites': ['yin-final-insight'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}, {'id': 'yin-final-death', 'type': 'side', 'title': '寅时结局·寅时终', 'description': '寅时结局演出：寅时终', 'hint': '寅时结局·寅时终', 'chapterId': 'ch1', 'locationId': 'yin-zhenxun-hq-death', 'steps': [{'id': 'yin-final-death-dialogue', 'title': '寅时终', 'description': '寅时终', 'condition': {'type': 'dialogue-finished', 'dialogueId': 'yin-final-death'}}], 'prerequisites': ['yin-final-wait'], 'rewards': [], 'tags': ['yin', 'story'], 'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}}]
YIN_NEW_LOCATIONS = [{'id': 'yin-zhongcun-tent', 'name': '钟村·义军主帐（夜）', 'card': '义军主帐（夜）', 'roomTitle': '钟村·义军主帐（夜）', 'npc': '钟', 'npcLine': '', 'background': '/assets/scenes/yin-zhongcun-tent-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yangcheng-army-xnor'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-zhenxun-road', 'name': '斟鄩·赴景亳山道（日）', 'card': '赴景亳山道（日）', 'roomTitle': '斟鄩·赴景亳山道（日）', 'npc': '斥候', 'npcLine': '', 'background': '/assets/scenes/yin-zhenxun-road-day.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-majority'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-meeting', 'name': '景亳·会盟营帐（日）', 'card': '会盟营帐（日）', 'roomTitle': '景亳·会盟营帐（日）', 'npc': '一位首领', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-meeting-day.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-mux'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-peach-dusk', 'name': '景亳·桃林（日暮）', 'card': '桃林（日暮）', 'roomTitle': '景亳·桃林（日暮）', 'npc': '青衣女子', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-peach-dusk.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-summit'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-peach-night', 'name': '景亳·桃林（夜）', 'card': '桃林（夜）', 'roomTitle': '景亳·桃林（夜）', 'npc': '青衣女子', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-peach-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-halfadder'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-accounts', 'name': '景亳·军营账房（日）', 'card': '军营账房（日）', 'roomTitle': '景亳·军营账房（日）', 'npc': '书吏', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-accounts-day.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-fulladder'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-peach-cla', 'name': '景亳·桃林（深夜至晨）', 'card': '桃林（深夜至晨）', 'roomTitle': '景亳·桃林（深夜至晨）', 'npc': '青衣女子', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-peach-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-ripple'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-zhenxun-hq-exam', 'name': '斟鄩·前线中军帐（夜）', 'card': '前线中军帐（夜）', 'roomTitle': '斟鄩·前线中军帐（夜）', 'npc': '汤', 'npcLine': '', 'background': '/assets/scenes/yin-zhenxun-hq-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-cla'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-peach-vow', 'name': '景亳·桃林（战前之约）', 'card': '桃林（战前之约）', 'roomTitle': '景亳·桃林（战前之约）', 'npc': '青衣女子', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-peach-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-final-exam'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-zhenxun-hq-war', 'name': '斟鄩·中军帐（决战）', 'card': '中军帐（决战）', 'roomTitle': '斟鄩·中军帐（决战）', 'npc': '传令兵', 'npcLine': '', 'background': '/assets/scenes/yin-zhenxun-hq-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-final-vow'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-zhenxun-hq-insight', 'name': '斟鄩·战后军帐', 'card': '战后军帐', 'roomTitle': '斟鄩·战后军帐', 'npc': '书吏', 'npcLine': '', 'background': '/assets/scenes/yin-zhenxun-hq-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-final-war'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-jingbo-peach-wait', 'name': '景亳·桃林（失约）', 'card': '桃林（失约）', 'roomTitle': '景亳·桃林（失约）', 'npc': '亲兵', 'npcLine': '', 'background': '/assets/scenes/yin-jingbo-peach-dusk.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-final-insight'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}, {'id': 'yin-zhenxun-hq-death', 'name': '斟鄩·中军帐（寅时终）', 'card': '中军帐（寅时终）', 'roomTitle': '斟鄩·中军帐（寅时终）', 'npc': '汤', 'npcLine': '', 'background': '/assets/scenes/yin-zhenxun-hq-night.png', 'mapPoint': {'x': 0.5, 'y': 0.5}, 'spawnX': 908, 'entryPrerequisites': ['yin-final-wait'], 'roomType': 'story', 'soloNarration': False, 'soloPlayerName': '寅'}]
YIN_NEW_LEVELS = [{'id': 'ch1_yin_majority', 'title': '寅时·三人表决器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_mux2', 'title': '寅时·二选一选择器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_mux4', 'title': '寅时·四选一选择器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_halfadder', 'title': '寅时·半加器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_fulladder', 'title': '寅时·全加器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_ripple4', 'title': '寅时·四位行波进位加法器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_cla4', 'title': '寅时·四位超前进位加法器', 'lineage': '', 'item': '', 'faction': None}, {'id': 'ch1_yin_eightbit', 'title': '寅时·八位加法器终考', 'lineage': '', 'item': '', 'faction': None}]


# 卯时：桃林回望 + 西麓山居院落/书屋日夜/渡口，严格按任务前置链开放。
MAO_NEW_QUESTS = [{'id': 'mao-peach-return',
  'type': 'side',
  'title': '卯时·桃林旧信',
  'description': '景亳桃林，卯重返旧地，记起将军府旧信与那一场失约。',
  'hint': '在景亳桃林与蔺娘交谈，完成开场过渡。',
  'chapterId': 'ch1',
  'locationId': 'mao-jingbo-peach-return',
  'steps': [{'id': 'mao-peach-return-intro-step',
             'title': '重访桃花林，读旧信',
             'description': '重访桃花林，读旧信',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-peach-return-intro'}}],
  'prerequisites': ['yin-final-death'],
  'rewards': [],
  'tags': ['mao', 'story'],
  'completion': {'mode': 'test-only', 'levelIds': [], 'requireAllSteps': True}},
 {'id': 'mao-rs',
  'type': 'side',
  'title': '卯时·第一场 雨后借粮册',
  'description': '西麓山居院落。雨水打湿借粮牌，卯与弟子试作能保持状态的存储器。',
  'hint': '听取缘由 → 亲手搭建 → 服务端评测通过 → 回报交付。',
  'chapterId': 'ch1',
  'locationId': 'mao-courtyard-day',
  'steps': [{'id': 'mao-rs-intro-step',
             'title': '听取本场缘起',
             'description': '听取本场缘起',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-rs-intro'}},
            {'id': 'mao-rs-circuit-step',
             'title': '制作 RS 锁存器',
             'description': '制作 RS 锁存器',
             'condition': {'type': 'level-completed', 'levelId': 'ch1_mao_rs'}},
            {'id': 'mao-rs-report-step',
             'title': '回报并完成本场',
             'description': '回报并完成本场',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-rs-report'}}],
  'prerequisites': ['mao-peach-return'],
  'rewards': [],
  'tags': ['mao', 'story', 'official-circuit'],
  'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_mao_rs'], 'requireAllSteps': True}},
 {'id': 'mao-d-latch',
  'type': 'side',
  'title': '卯时·第二场 封存药方',
  'description': '西麓山居书屋日景。药方误改，卯要让器物只在准许时写入。',
  'hint': '听取缘由 → 亲手搭建 → 服务端评测通过 → 回报交付。',
  'chapterId': 'ch1',
  'locationId': 'mao-study-day',
  'steps': [{'id': 'mao-d-latch-intro-step',
             'title': '听取本场缘起',
             'description': '听取本场缘起',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-d-latch-intro'}},
            {'id': 'mao-d-latch-circuit-step',
             'title': '制作门控 D 锁存器',
             'description': '制作门控 D 锁存器',
             'condition': {'type': 'level-completed', 'levelId': 'ch1_mao_d_latch'}},
            {'id': 'mao-d-latch-report-step',
             'title': '回报并完成本场',
             'description': '回报并完成本场',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-d-latch-report'}}],
  'prerequisites': ['mao-rs'],
  'rewards': [],
  'tags': ['mao', 'story', 'official-circuit'],
  'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_mao_d_latch'], 'requireAllSteps': True}},
 {'id': 'mao-edge',
  'type': 'side',
  'title': '卯时·第三场 渡口击木',
  'description': '山间渡口黄昏。卯与渡伯只在击木一瞬记录放粮数量。',
  'hint': '听取缘由 → 亲手搭建 → 服务端评测通过 → 回报交付。',
  'chapterId': 'ch1',
  'locationId': 'mao-ferry-dusk',
  'steps': [{'id': 'mao-edge-intro-step',
             'title': '听取本场缘起',
             'description': '听取本场缘起',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-edge-intro'}},
            {'id': 'mao-edge-circuit-step',
             'title': '制作边沿 D 触发器',
             'description': '制作边沿 D 触发器',
             'condition': {'type': 'level-completed', 'levelId': 'ch1_mao_edge_dff'}},
            {'id': 'mao-edge-report-step',
             'title': '回报并完成本场',
             'description': '回报并完成本场',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-edge-report'}}],
  'prerequisites': ['mao-d-latch'],
  'rewards': [],
  'tags': ['mao', 'story', 'official-circuit'],
  'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_mao_edge_dff'], 'requireAllSteps': True}},
 {'id': 'mao-reg4',
  'type': 'side',
  'title': '卯时·第四场 冬夜存卷',
  'description': '西麓山居书屋夜景。四枚玉片共用时钟，同一刻写入与保留。',
  'hint': '听取缘由 → 亲手搭建 → 服务端评测通过 → 回报交付。',
  'chapterId': 'ch1',
  'locationId': 'mao-study-night',
  'steps': [{'id': 'mao-reg4-intro-step',
             'title': '听取本场缘起',
             'description': '听取本场缘起',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-reg4-intro'}},
            {'id': 'mao-reg4-circuit-step',
             'title': '制作四位寄存器',
             'description': '制作四位寄存器',
             'condition': {'type': 'level-completed', 'levelId': 'ch1_mao_register4'}},
            {'id': 'mao-reg4-report-step',
             'title': '回报并完成本场',
             'description': '回报并完成本场',
             'condition': {'type': 'dialogue-finished', 'dialogueId': 'mao-reg4-report'}}],
  'prerequisites': ['mao-edge'],
  'rewards': [],
  'tags': ['mao', 'story', 'official-circuit'],
  'completion': {'mode': 'official-circuit', 'levelIds': ['ch1_mao_register4'], 'requireAllSteps': True}}]
MAO_NEW_LOCATIONS = [{'id': 'mao-jingbo-peach-return',
  'name': '景亳·桃林（卯归来）',
  'card': '桃林旧信',
  'roomTitle': '卯时·桃林重访',
  'npc': '蔺娘',
  'npcLine': '',
  'background': '/assets/scenes/yin-jingbo-peach-dusk.png',
  'mapPoint': {'x': 0.77, 'y': 0.36},
  'spawnX': 890,
  'entryPrerequisites': ['yin-final-death'],
  'roomType': 'story',
  'soloNarration': False,
  'soloPlayerName': '卯'},
 {'id': 'mao-courtyard-day',
  'name': '西麓山居·院落（日）',
  'card': '山居院落',
  'roomTitle': '卯时·雨后借粮册',
  'npc': '田婶',
  'npcLine': '',
  'background': '/assets/scenes/mao-courtyard-day.webp',
  'mapPoint': {'x': 0.29, 'y': 0.68},
  'spawnX': 908,
  'entryPrerequisites': ['mao-peach-return'],
  'roomType': 'story',
  'soloNarration': False,
  'soloPlayerName': '卯'},
 {'id': 'mao-study-day',
  'name': '西麓山居·书屋（日）',
  'card': '书屋',
  'roomTitle': '卯时·封存药方',
  'npc': '穗',
  'npcLine': '',
  'background': '/assets/scenes/mao-study-day.webp',
  'mapPoint': {'x': 0.52, 'y': 0.59},
  'spawnX': 908,
  'entryPrerequisites': ['mao-rs'],
  'roomType': 'story',
  'soloNarration': False,
  'soloPlayerName': '卯'},
 {'id': 'mao-ferry-dusk',
  'name': '西麓山居·溪桥渡口（黄昏）',
  'card': '溪桥渡口',
  'roomTitle': '卯时·渡口击木',
  'npc': '渡伯',
  'npcLine': '',
  'background': '/assets/scenes/mao-ferry-dusk.webp',
  'mapPoint': {'x': 0.2, 'y': 0.84},
  'spawnX': 908,
  'entryPrerequisites': ['mao-d-latch'],
  'roomType': 'story',
  'soloNarration': False,
  'soloPlayerName': '卯'},
 {'id': 'mao-study-night',
  'name': '西麓山居·书屋（夜）',
  'card': '书屋',
  'roomTitle': '卯时·冬夜存卷',
  'npc': '穗',
  'npcLine': '',
  'background': '/assets/scenes/mao-study-night.webp',
  'mapPoint': {'x': 0.52, 'y': 0.59},
  'spawnX': 908,
  'entryPrerequisites': ['mao-edge'],
  'roomType': 'story',
  'soloNarration': False,
  'soloPlayerName': '卯'}]
MAO_NEW_LEVELS = [{'id': 'ch1_mao_rs', 'title': '卯时·第一场 雨后借粮册 · 制作 RS 锁存器', 'lineage': '', 'item': '', 'faction': None},
 {'id': 'ch1_mao_d_latch', 'title': '卯时·第二场 封存药方 · 制作门控 D 锁存器', 'lineage': '', 'item': '', 'faction': None},
 {'id': 'ch1_mao_edge_dff', 'title': '卯时·第三场 渡口击木 · 制作边沿 D 触发器', 'lineage': '', 'item': '', 'faction': None},
 {'id': 'ch1_mao_register4', 'title': '卯时·第四场 冬夜存卷 · 制作四位寄存器', 'lineage': '', 'item': '', 'faction': None}]

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
                     *(yangcheng_army_quest(i) for i in range(6)), *YIN_NEW_QUESTS, *MAO_NEW_QUESTS],
        },
        'locations': [
            *YIN_NEW_LOCATIONS, *MAO_NEW_LOCATIONS,
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
], *YIN_NEW_LEVELS, *MAO_NEW_LEVELS, BINARY_LEVEL], 'faction': None, 'implemented': True,
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

# Official fixed circuit teaching components; no user-generated packages.
from official_components import activate as _activate_official_components
_activate_official_components()

