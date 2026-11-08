# 铸算·华夏纪 · 联调基线

本仓库是前端、后端、任务系统和电路关卡的**开发测试工程**。本版以团队已合并的工程为基础，合回最新版任务书布局与素材，统一任务状态结构，并将试验数据改为无故事设定的占位数据。未开发内容保留空值，不借助虚构场景或奖励掩盖缺口。

## 功能范围

- **已有功能**：登录、章节地图、房间移动与 NPC 交互、任务书、房间物品调查、章节存档、教师/管理员后台、正式电路编辑与服务器评测。
- **第一章可测内容**：一个名为“地图”的地点；一条“主线任务”和一条“支线任务”，任务步骤均只使用“步骤一”“步骤二”。
- **正式教学内容仍保留**：第一章四个真实电路关卡（CMOS 非门、CMOS 与非门、半加器、SR 锁存器）及其判分、版本快照、数据库约束和回归测试。任务名称测试化不意味着修改电路规则。
- **未开发章节**：第二至第四章保留章节编号与入口展示，但 `locations: []`、`levels: []`、`quests: {main:null,side:[]}`、`entry:""`；不可进入，不创建演示地点。
- **人物视觉**：房间玩家、NPC 与对话立绘以简单长方形显示。原有图片及名牌资源仍在资源库/归档目录，后续替换不会破坏角色坐标和碰撞逻辑。
- **任务书**：桌面/横屏使用 1898×829 无内置固定横纹的双页素材；手机/竖屏使用 829×1897 单页素材，顶部横排“任务”，底部“前往”居中。独立 741×46 横纹在任务介绍下方参与内容流布局，介绍变长时不会覆盖文本。
- **成绩**：采用 V2.12 排行榜的凤鸟云纹背景与原有古纸列表面板，数据仍来自 `GET /api/circuit/results/mine`，空记录显示“暂无已提交成绩”，不生成测试成绩。
- **排行榜**：采用新上传的龙纹全屏背景及 V2.12 凤鸟纹镂空装饰底板（`assets/leaderboard/`）。表头直接以深色文字印在底板上，不再使用深色或其他底色条；**目前没有排名接口和排名记录**，不虚构玩家或名次。
- **成就**：完全沿用整理后的 V2 版本（当前为“待开发”入口），没有导入本次外部包中的成就图标或示例成就数据。设置、房间、任务书、关卡等其他页面也没有被外部代码覆盖。

## 启动

需 Python 3.10+，不要求 npm 安装。项目根目录：

```bash
python3 server.py --db test.sqlite3
```

访问 `http://127.0.0.1:8765/`。`test.sqlite3` 是**重新初始化的空白测试库**：没有旧账号、班级、会话、任务进度、成绩或奖励；包含数据库表结构与四个正式关卡的版本快照。需要本机创建新账号后才能登录：

```bash
python3 server.py --db test.sqlite3 --init-admin
```

用管理员界面创建教师、班级与学生。不要将临时账号或测试数据库部署到公网。`server.py` 不指定 `--db` 时默认采用 `game.sqlite3`，不要误以为它就是此包的空白测试库。

如需**有意重建**测试库，先停止服务器并备份数据，然后执行：

```bash
python3 tools/reset_test_db.py --output test.sqlite3 --force
```

重置脚本不会在没有 `--force` 时覆盖文件。**绝不能在真实教学数据库上使用该命令。**

## 任务数据模型

任务定义由 `chapters.py` 提供，玩家进度保存在原有 `progress.state_json` 中，二者严格分开：

| 模型 | 内容 | 说明 |
|---|---|---|
| `QuestDefinition` | `id`、`type`、`title`、`description`、`hint`、`chapterId`、`locationId`、`steps`、`prerequisites`、`rewards`、`tags`、`completion` | 静态定义。未设计好的字段使用 `""`、`null`、`[]`，不自动补故事 |
| `QuestStepDefinition` | `id`、`title`、`description`、`condition` | 此版本两条步骤仅为“步骤一”“步骤二”，`condition:null` |
| `QuestCompletion` | `mode`、`levelIds` | `official-circuit` 用真实评测；`test-only` 仅用于联调；`not-implemented` 表示未开发 |
| `QuestCollection` | `schemaVersion:1`、`main`、`side` | 每位玩家、每章一个状态集合 |
| `QuestProgress` | `status`、`steps`、`acceptedAt`、`completedAt`、`submittedAt`、`updatedAt` | `steps` 是按步骤 ID 索引的独立进度，不写回任务定义 |
| `StepProgress` | `status`、`updatedAt`、`evidence` | 状态 `pending/current/done/skipped`；尚无证据时 `null` |

`QuestStatus` 只有四种有序状态：

```text
not-accepted → accepted → completed → submitted
    未接取          已接取      待交付       已交付
```

不能跳级，也不能由“已完成”退回“已接取”。

**第一章主线**：接取后可以进入正式电路关卡；只有数据库中存在**真实电路提交记录与通过成绩的关联**，才允许从 `accepted` 进入 `completed`；完成后才能交付。两条“步骤”仅供任务书测试排版，**不会冒充真实实验完成凭证**。

**测试支线**：只允许按 NPC 选项逐一标记“步骤一（测试）”“步骤二（测试）”，全部步骤为 `done` 后才变成 `completed`，随后可以测试交付。当前 `rewards: []`，不发放虚构铜钱或器物。

**任务目标图标**：仅 `current` 的步骤显示玉质标记；`done` 不显示图标。未接取时步骤保持待执行。

**空数据**：未配置步骤时显示空任务目标，不会把“与 NPC 交谈”“返回交付”等剧情自动拼成目标；未开发章节不生成虚构地点。`前往` 按钮暂为无跳转占位功能。

代码契约：

- `quest_model.py`：Python `TypedDict`、任务定义与存档结构验证。
- `public/task-model.js`：纯函数式状态归一化、状态迁移、测试步骤推进。
- `public/task-model.d.ts`：前端 TypeScript 类型声明（原生 JS 无须编译）。
- `schemas/quest-model.schema.json`：跨模块 JSON Schema（Draft 2020-12）。
- `database.py`：数据库事务内检查状态迁移、完成凭证和重复提交，避免前端伪造完成状态。
- `server.py`：保存 API 在入库前校验任务数据，错误时返回明确的 400/409 响应。

## 源码与素材布局

```text
zhusuan_huaxiaji/
├── README.md                      # 唯一项目说明
├── chapters.py                    # 章节、地图与测试任务定义
├── quest_model.py                 # 服务端任务数据类型与校验
├── database.py / server.py        # SQLite 与 HTTP API
├── circuit_engine.py / circuit_service.py / level_content.py
├── management.py / roster.py      # 教学管理及名单
├── levels/                        # 四项真实电路关卡
├── schemas/quest-model.schema.json
├── public/
│   ├── app.js / api.js             # 前端入口与 API
│   ├── room.js                     # NPC 与任务书编排
│   ├── room-world.js               # 角色坐标与相机
│   ├── map-viewport.js             # 全屏大/小地图平移镜头与固定地图锚点
│   ├── room-interactions.js        # 陶范交互示例
│   ├── task-model.js / task-model.d.ts
│   ├── style.css / room-visual.css
│   ├── results-visual.css          # 原有个人成绩样式及共用的成绩/排行顶栏
│   ├── leaderboard-visual.css      # 新版排行榜独立视觉样式
│   └── assets/
│       ├── scenes/                 # 当前使用的地图/房间背景
│       ├── room/                   # 房间 UI 资源
│       ├── quests/                 # 双页、单页、独立横纹与任务小图
│       ├── results/                # 成绩页凤鸟云纹背景和原有古纸面板
│       └── leaderboard/            # 新龙纹背景与原有凤鸟纹透明装饰底板
├── tests/                         # Python / Node / 前端布局回归
├── tools/check_assets.py          # 资源引用审计
├── tools/reset_test_db.py         # 显式重建空白测试库
├── archive/unused-assets/         # 未使用美术资源（不公开访问）
├── archive/deprecated/            # 退役的章节占位插件
├── archive/asset-cleanup-manifest.json
└── test.sqlite3                   # 空白测试库，含四项正式关卡快照
```

原始素材路径、规范化路径及 SHA-256 在 `archive/asset-cleanup-manifest.json`；任何资源重命名都要同步更新引用和该清单。

## 检验

```bash
python3 tools/check_assets.py
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/js_smoke.mjs
node tests/js_npc_dialogue_smoke.mjs
node tests/js_room_objects_smoke.mjs
node tests/js_room_world_scenery_smoke.mjs
node tests/js_map_pan_smoke.mjs
node tests/js_task_model_smoke.mjs
node tests/js_ui_smoke.mjs
node tests/js_circuit_smoke.mjs
node tests/js_editor_geometry.mjs
node tests/js_live_drafting.mjs
```

正式联调应在本机登录后逐步测试：进入“地图”→房间→接取主线→正式电路评测→返回房间→交付；以及测试支线的两步推进、任务书横竖屏适配、教师后台与 SQLite 持久化。

## 待开发与注意事项

1. **字体文件由团队后续补充**。CSS 仍引用 `public/fonts/zhaohua-typewriter.woff2` 和 `meirenzhuan.woff2`，当前缺失时自动回退。测试截图反映的是字体回退状态。
2. **剧情、真实步骤条件、奖励、人物立绘与后续地图均为空**。不要将测试状态迁移等同于完整的剧情与教学流程。
3. **“前往”按钮尚未连接真实目的地**，测试支线的推进仅用于验证状态、存档与 UI；正式逻辑需要把 `condition` 关联到可信服务器事件。
4. **无默认演示账户**，请由管理员按本机测试流程创建。对数据库、章节 ID、任务 ID 或进度 schema 做变更前先备份并执行所有测试。
5. 被归档的旧占位插件及美术并未参与当前运行，需人工确认内容成熟后再使用。
6. 排行榜仍为真实业务**未开发**状态，当前只有外观；成绩页接入真实接口，但无数据时只是空表，不应误认为排名或成绩已生成。

## 当前界面与导航

### 全屏地图与路径模型

`public/navigation-path.js` 是大地图、小地图和房间的共同路径模型。页面不再拼接章节名称充当路径，而是根据当前阶段生成：

- 大地图：`大地图`
- 小地图：`大地图 › 小地图`
- 房间：`大地图 › 小地图 › 房间`

上级路径节点可点击返回，房间离开前先保存进度；顶栏品牌、当前位置、铜钱、返回/设置按钮继续沿用房间视觉规范。地图画布在顶栏下方铺满可见区域；鼠标/触控拖拽与方向键/WASD 按住连续平移由 `public/map-viewport.js` 处理，键盘松开或窗口失焦后停止。

两个地图入口以**图片归一化坐标**配置，而不是依靠在固定屏幕尺寸上偏移像素：大地图城市中心为 `(0.806, 0.568)`，小地图城门中心为 `(0.498, 0.458)`。标记位于地图镜头坐标层，地图拖动、缩放和切换屏幕大小时不会脱离建筑。

### 行囊

装饰横/竖底板是行囊的外框，原内部纸面底板置于其中。分类栏是内底板的兄弟元素，通过 `--bag-inner-top` 共用定位基准，再用 `--bag-tab-overlap` 与纸面顶部轻微叠合（桌面 5px、手机竖屏 4px），避免露出接缝。分类栏仍保留“分类栏”测试占位，选中/未选中使用原素材；**尚未进行真正的物品类别筛选**。

物品格在桌面为 `52×52px`，手机竖屏 `44×44px`，窄屏 `40×40px`。列数根据可用宽度自动调整；物品过多时面板内部滚动。点击已有物品可查看说明，叉号关闭面板。行囊数据结构与存档接口未改变。

### 排行榜与个人成绩

两页顶部只渲染一个居中的「排行」或「成绩」标题，字距扩大；左上角并列「返回」「菜单」两枚按钮，复用 `assets/quests/go-button.png` 素材。「返回」回到来源页面（从房间进入排行榜时回房间，离开房间前先保存进度）；「菜单」一律回主界面。

排行榜采用用户新提供的凤鸟云纹背景、镂空装饰底板和独立 `leaderboard-visual.css`。标题仍为「排行」，左上「返回 / 菜单」沿用项目按钮素材。新排行榜使用原生表格语义，五列表头直接显示深色字及淡分隔线，不绘制表头色块；桌面与竖屏使用同一套自适应九宫格底板切片，避免纹样整体拉伸。旧排行榜 `paper-demo-*` 节点和样式已删除。**排行榜业务接口仍未开发**，页面只保留字段名称与「静候揭榜」提示，不创建测试排名。

个人成绩继续使用原有古纸底板，通过 `/api/circuit/results/mine` 获取成绩；背景在 V2.13 中换为 V2.12 排行榜使用的凤鸟云纹素材。背景变更不涉及成绩数据、表格结构和交互。

### 测试与边界

现有 Python、Node 回归测试及资源完整性检查继续使用；新增导航路径专项测试。Chromium 使用实际 CSS、地图镜头 JS、页面布局逻辑与当前素材验证地图按钮落点、行囊分类栏接缝、排行榜和成绩页在多种视口下的布局。浏览器画面采用隔离的测试渲染环境，并未完成真实账号登录后端的端到端部署验收。正式项目仍需补入两种字体文件，并在团队测试环境联调。

### V2.7 行囊接缝修正补充

- 行囊分类栏与内层底板之间出现的深棕细条，定位为 **样式补偿叠加 + 内层底板素材顶部半透明暗边** 的组合问题，不是单纯布局偏移。
- 处理方式：
  1. 删除分类栏底部额外的深色渐变补偿；
  2. 缩小分类栏与整个行囊外框；
  3. 新增修正版 `public/assets/room/bag-content-panel-landscape-fixed.png`，抹平原素材顶部半透明暗边；
  4. 以更小的 `--bag-tab-overlap` 重新对齐分类栏和内层底板。


### V2.8 行囊内板重做
- 撤销 V2.7 中用于遮缝的浅色补偿思路。
- 直接重做内层底板素材为不带半透明上边沿的纯圆角长方形：
  - public/assets/room/bag-content-panel-landscape-clean.png
  - public/assets/room/bag-content-panel-portrait-clean.png
- 分类栏缩小，并让其底边与内层底板上边沿直接对齐。


### V2.9 行囊内板回调深色
- 将行囊内层底板颜色改回与深色分类栏一致的棕金色系。
- 不改动分类栏结构、尺寸与贴边方式，仅修正取色。

### V2.10 行囊分类栏收窄
- 四个分类栏改为靠内板左侧排列，不再平均铺满整个顶部区域。
- 分类栏整体宽度收窄，彼此间距减小，文字缩小并保持水平、垂直居中。
- 保持分类栏底边与内层底板上沿的既有对齐锚点，不改变底板颜色与素材。

### V2.11 行囊分类栏进一步收窄
- 分类栏组宽度调整为 V2.10 的 50%，最左侧锚点保持不变。
- 分类栏之间的间距保持 V2.10 不变。
- 分类栏文字缩小至原来的 75%，继续水平、垂直居中。
- 桌面与手机竖屏规则同步调整；底板、颜色、接缝和其他模块不变。


## V2.13 背景素材定向整合

- 排行榜背景替换为用户新上传的龙纹图片：`public/assets/leaderboard/dragon-background.png`。
- V2.12 排行榜原凤鸟背景转用于成绩页：`public/assets/results/phoenix-background.png`。
- 排行榜仍使用 `public/assets/leaderboard/phoenix-frame.png` 作为透明凤鸟纹装饰底板；成绩页保留 `public/assets/results/parchment-panel.png`。
- 原成绩山水背景移入 `archive/unused-assets/results/landscape-background.png`，方便恢复，不再参与运行时引用。
- 不修改页面 DOM、顶栏按钮、表格结构、成绩接口、排行榜占位状态，也不修改房间、任务、地图和数据库。
