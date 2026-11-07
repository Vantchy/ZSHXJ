"""关卡内容与版本快照。

每个关卡版本具有固定接口和后端测试；学生首次打开后绑定发布版本，
公开关卡接口仅输出可见说明及测试示例。
"""
import hashlib
import json
import re
from pathlib import Path

import circuit_engine as engine
import database as db

LEVELS_DIR = Path(__file__).resolve().parent / "levels"
CHAPTER_STATE_VERSION = 2
LEVEL_ID = re.compile(r"^ch[1-4]_[a-z][a-z0-9_]{2,39}$")


def canonical(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False)


def digest(obj):
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def validate_spec(level):
    if not isinstance(level, dict) or not LEVEL_ID.fullmatch(str(level.get("id", ""))):
        raise ValueError("关卡ID不合法")
    if (type(level.get("version")) is not int or level["version"] < 1
        or level.get("chapterId") != level["id"].split("_")[0]):
        raise ValueError("关卡所属章节或版本不合法")
    if level.get("schemaVersion") != engine.SCHEMA_VERSION:
        raise ValueError("关卡电路结构版本不受支持")
    if level.get("layer") not in ("transistor", "gate", "sequential"):
        raise ValueError("关卡层级不合法")
    engine._external_pins(level.get("interface"))
    allowed = {"types": level.get("allowedTypes"), "packages": level.get("allowedPackages")}
    if (not isinstance(allowed["types"], list) or not isinstance(allowed["packages"], list)
        or not all(x in engine.COMPONENTS for x in allowed["types"])
        or not all(isinstance(x,str) and re.fullmatch(r"[a-z][a-z0-9_]{1,39}", x)
                    for x in allowed["packages"])):
        raise ValueError("关卡允许元件列表不合法")
    engine.validate_graph(level.get("initialGraph"), allowed=allowed,
                          interface=level["interface"])
    names = engine._external_pins(level["interface"])
    for key in ("hiddenVectors", "publicVectors", "sequentialScripts"):
        if not isinstance(level.get(key), list) or len(level[key]) > 64:
            raise ValueError(f"{key}必须是有限数组")
    if not level["hiddenVectors"] and not level["sequentialScripts"]:
        raise ValueError("正式关卡必须具备后端隐藏判定测试")
    for vector in level["hiddenVectors"] + level["publicVectors"]:
        check_vector(vector, names, allow_extra=True)
    for script in level["sequentialScripts"]:
        if (not isinstance(script, dict)
            or not isinstance(script.get("steps"), list)
            or not 1 <= len(script["steps"]) <= 64):
            raise ValueError("时序脚本缺少测试步骤")
        for step in script["steps"]:
            check_vector(step, names, allow_extra=True)
            if (type(step.get("cycles", 1)) is not int
                or not 1 <= step.get("cycles", 1) <= engine.MAX_SIM_STEPS):
                raise ValueError("时序测试步数不合法")
    award = level.get("award")
    if (not isinstance(award, dict)
        or not re.fullmatch(r"[a-z][a-z0-9_]{1,39}",str(award.get("symbol","")))
        or not isinstance(award.get("name"),str)
        or not 1 <= len(award["name"]) <= 60):
        raise ValueError("关卡封装元件名称不合法")
    if type(level.get("efficientAtMost")) is not int or level["efficientAtMost"] < 1:
        raise ValueError("精简称号阈值不合法")
    # New published versions may declare their own immutable minimum.
    if "minimalComponentCount" in level:
        minimum=level["minimalComponentCount"]
        if type(minimum) is not int or not 0<=minimum<=engine.MAX_COMPONENTS:
            raise ValueError("最简元件数应为非负整数且不超出元件数量上限")


def check_vector(vector, names, allow_extra=False):
    if not isinstance(vector, dict):
        raise ValueError("测试向量格式不合法")
    inputs, expect = vector.get("inputs"), vector.get("expect")
    if not isinstance(inputs, dict) or not isinstance(expect, dict):
        raise ValueError("测试向量必须有inputs/expect")
    if set(inputs) != set(names["inputs"]) or set(expect) != set(names["outputs"]):
        raise ValueError("测试向量必须包含完整输入和预期输出")
    if not all(engine.is_bit(x) for x in list(inputs.values())+list(expect.values())):
        raise ValueError("测试向量只允许0或1")
    weight = vector.get("weight", 1)
    if type(weight) not in (float,int) or isinstance(weight,bool) or not 0 < weight <= 100:
        raise ValueError("向量权重不合法")
    if "group" in vector and not isinstance(vector["group"],str):
        raise ValueError("向量类别不合法")


def installed_specs():
    found = []
    for f in sorted(LEVELS_DIR.glob("*_v*.json")):
        level = json.loads(f.read_text(encoding="utf-8"))
        validate_spec(level)
        if f.name != f"{level['id']}_v{level['version']}.json":
            raise ValueError(f"关卡文件名必须与ID和版本对应：{f.name}")
        found.append(level)
    if not found:
        raise ValueError("找不到任何正式关卡定义")
    seen = set()
    for level in found:
        key=level["id"],level["version"]
        if key in seen:
            raise ValueError(f"重复关卡版本：{key}")
        seen.add(key)
    return found


def publish(path):
    """初始化电路关卡表并注册不可变的已发布关卡快照。"""
    specs = installed_specs()
    with db.closing(db.connect(path)) as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS circuit_level_snapshots(
          level_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          digest TEXT NOT NULL,
          spec_json TEXT NOT NULL,
          published_at TEXT NOT NULL,
          PRIMARY KEY(level_id,version)
        );
        CREATE TABLE IF NOT EXISTS circuit_enrollments(
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          level_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          PRIMARY KEY(user_id,level_id)
        );
        CREATE TABLE IF NOT EXISTS circuit_components(
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          symbol TEXT NOT NULL,
          version INTEGER NOT NULL,
          level_id TEXT NOT NULL,
          level_version INTEGER NOT NULL,
          name TEXT NOT NULL,
          interface_json TEXT NOT NULL,
          graph_json TEXT NOT NULL,
          digest TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(user_id,symbol,version)
        );
        CREATE INDEX IF NOT EXISTS idx_circuit_owner
          ON circuit_components(user_id,symbol);
        CREATE TABLE IF NOT EXISTS circuit_level_attempts(
          attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          level_id TEXT NOT NULL,
          level_version INTEGER NOT NULL,
          graph_digest TEXT,
          score_id INTEGER REFERENCES scores(id)
        );
        CREATE INDEX IF NOT EXISTS idx_circuit_attempt_user
          ON circuit_level_attempts(user_id,level_id);
        """)
        con.execute("BEGIN IMMEDIATE")
        for level in specs:
            key = (level["id"],level["version"])
            old = con.execute(
                "SELECT digest FROM circuit_level_snapshots WHERE level_id=? AND version=?",
                key).fetchone()
            hashval = digest(level)
            if old and old["digest"] != hashval:
                con.rollback()
                raise RuntimeError(
                    f"发布过的关卡不可原地修改：{level['id']} v{level['version']}；请发新版本")
            if not old:
                con.execute(
                    """INSERT INTO circuit_level_snapshots
                       (level_id,version,digest,spec_json,published_at)
                       VALUES(?,?,?,?,?)""",
                    (*key,hashval,canonical(level),db.now_iso()))
        con.commit()


def level_for(con, user_id, level_id, enroll=True):
    old = con.execute(
        "SELECT version FROM circuit_enrollments WHERE user_id=? AND level_id=?",
        (user_id,level_id)).fetchone()
    if old:
        version = old["version"]
    else:
        found = con.execute(
            "SELECT MAX(version) AS v FROM circuit_level_snapshots WHERE level_id=?",
            (level_id,)).fetchone()
        if not found or found["v"] is None:
            raise engine.CircuitError("LEVEL_NOT_FOUND","关卡不存在",404)
        version = found["v"]
        if enroll:
            con.execute(
                """INSERT OR IGNORE INTO circuit_enrollments
                   (user_id,level_id,version,started_at) VALUES(?,?,?,?)""",
                (user_id,level_id,version,db.now_iso()))
            old = con.execute(
                "SELECT version FROM circuit_enrollments WHERE user_id=? AND level_id=?",
                (user_id,level_id)).fetchone()
            version = old["version"]
    row = con.execute(
        "SELECT spec_json FROM circuit_level_snapshots WHERE level_id=? AND version=?",
        (level_id,version)).fetchone()
    if row is None:
        raise engine.CircuitError("LEVEL_VERSION_MISSING",
                                  "存档所关联的旧关卡版本缺失；不会删除存档",409)
    return json.loads(row["spec_json"])


def public_spec(level):
    return {
        "id":level["id"],"title":level["title"],
        "chapterId":level["chapterId"],"levelVersion":level["version"],
        "circuitSchemaVersion":engine.SCHEMA_VERSION,
        "chapterSaveSchemaVersion":CHAPTER_STATE_VERSION,
        "layer":level["layer"],"interface":level["interface"],
        "allowedTypes":list(dict.fromkeys([*level["allowedTypes"], "junction"])),
        "allowedPackages":level["allowedPackages"],
        "initialGraph":level["initialGraph"],
        "publicVectors":level["publicVectors"],
        "award":{"name":level["award"]["name"],"symbol":level["award"]["symbol"]},
        "efficientAtMost":level["efficientAtMost"],
    }


def levels_public(con, user_id):
    all_ids = [x["level_id"] for x in con.execute(
        "SELECT DISTINCT level_id FROM circuit_level_snapshots ORDER BY level_id")]
    return [{"id":x["id"],"title":x["title"],"chapterId":x["chapterId"],
             "version":x["version"],"layer":x["layer"]}
            for x in (level_for(con,user_id,i,enroll=False) for i in all_ids)]


def owned(con, user_id):
    rows=con.execute(
        """SELECT symbol,version,name,interface_json,graph_json,level_id,
                  level_version,digest
           FROM circuit_components WHERE user_id=? ORDER BY symbol,version""",
        (user_id,)).fetchall()
    result = {}
    for row in rows:
        typ = f"pkg:{row['symbol']}@{row['version']}"
        result[typ] = {
            "type":typ,"symbol":row["symbol"],"version":row["version"],
            "name":row["name"],"levelId":row["level_id"],
            "levelVersion":row["level_version"],
            "interface":json.loads(row["interface_json"]),
            "graph":json.loads(row["graph_json"]),
            "digest":row["digest"],
        }
    return result


def validate_package_dag(definitions, prospective_symbol=None,
                         new_graph=None):
    dependencies = {}
    for typ, pkg in definitions.items():
        packages={c["type"] for c in pkg["graph"]["components"]
                  if c["type"].startswith("pkg:")}
        dependencies[typ] = packages
    if prospective_symbol is not None:
        # Even a package referencing an older snapshot of *its own symbol* is
        # disallowed: direct and transitive self-contained packaging only.
        dependencies["new"] = {c["type"] for c in new_graph["components"]
                               if c["type"].startswith("pkg:")}
    # First check every persisted immutable package for cycles; then check
    # only the prospective new definition for self-dependencies. An unrelated
    # already-issued latch may legally use an older version of the symbol that
    # is being reissued now.
    def dfs(node, depth, self_guard, visiting, done):
        if node in visiting:
            raise engine.CircuitError("PACKAGE_CYCLE",
                                      "元件封装存在直接或间接递归引用")
        if depth > engine.MAX_PACKAGE_DEPTH:
            raise engine.CircuitError("PACKAGE_DEPTH","元件封装层级超过限制")
        if node in done:
            return
        visiting.add(node)
        for dep in dependencies.get(node, []):
            if dep not in dependencies:
                raise engine.CircuitError("PACKAGE_LOCKED",
                                          "封装依赖的元件不属于当前账号")
            if self_guard and prospective_symbol is not None:
                match = engine.PACKAGE_NAME.fullmatch(dep)
                if match and match.group(1) == prospective_symbol:
                    raise engine.CircuitError("PACKAGE_CYCLE",
                                              "新元件不能直接或间接包含自身旧版本")
            dfs(dep, depth+1, self_guard, visiting, done)
        visiting.remove(node)
        done.add(node)
    completed = set()
    for key in dependencies:
        if key != "new":
            dfs(key, 0, False, set(), completed)
    if prospective_symbol is not None:
        dfs("new", 0, True, set(), set())


def validate_circuit_save(con,user_id,chapter_id,state):
    if not isinstance(state,dict):
        raise engine.CircuitError("INVALID_SAVE","章节存档必须是JSON对象")
    if type(state.get("schemaVersion")) is not int or state["schemaVersion"] != CHAPTER_STATE_VERSION:
        raise engine.CircuitError("CHAPTER_SCHEMA_MISMATCH",
                  f"章节存档结构版本必须为{CHAPTER_STATE_VERSION}，绝不自动重置存档",409)
    circuits=state.get("circuitLevels",{})
    if not isinstance(circuits,dict) or len(circuits)>30:
        raise engine.CircuitError("INVALID_SAVE","circuitLevels必须是有限对象")
    # 保存新进度时保留已有电路关卡键，避免遗漏字段导致图结构丢失。
    old=con.execute(
        "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
        (user_id,chapter_id)).fetchone()
    if old:
        try:
            previous=json.loads(old["state_json"])
            previous_circuits=previous.get("circuitLevels",{})
        except (TypeError,ValueError,AttributeError):
            previous_circuits={}
        if isinstance(previous_circuits,dict) and set(previous_circuits)-set(circuits):
            raise engine.CircuitError("CIRCUIT_SAVE_PROTECTED",
                     "新存档缺少原有电路关卡，拒绝覆盖以防学生进度丢失",409)
    defs = owned(con,user_id) if circuits else {}
    if defs:validate_package_dag(defs)
    for lid,data in circuits.items():
        if not isinstance(lid,str) or not lid.startswith(chapter_id+"_"):
            raise engine.CircuitError("INVALID_SAVE","电路关卡不属于当前章节")
        if not isinstance(data,dict) or set(data)-{"levelVersion","graph","simulationState"}:
            raise engine.CircuitError("INVALID_SAVE","电路存档字段不合法")
        spec=level_for(con,user_id,lid,enroll=False)
        if type(data.get("levelVersion")) is not int or data["levelVersion"]!=spec["version"]:
            raise engine.CircuitError("LEVEL_VERSION_MISMATCH",
                              "保存的关卡版本与首次开始版本不同，旧存档不会被覆盖",409)
        if not con.execute(
            "SELECT 1 FROM circuit_enrollments WHERE user_id=? AND level_id=?",
            (user_id,lid)).fetchone():
            raise engine.CircuitError("LEVEL_NOT_OPENED","请先打开该正式关卡再保存")
        engine.validate_graph(
            data.get("graph"), defs,
            allowed={"types":list(dict.fromkeys([*spec["allowedTypes"], "junction"])),
                     "packages":spec["allowedPackages"]},
            interface=spec["interface"])
        simstate=data.get("simulationState",{})
        engine._read_state(simstate)
