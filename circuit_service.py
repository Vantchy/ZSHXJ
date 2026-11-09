"""正式电路关卡业务：实时模拟、尝试签发、分组判题及个人元件封装。

成绩与通关解锁的元件快照在同一SQLite事务中持久化。
"""
import json
import secrets
from contextlib import closing
from datetime import datetime, timezone

import circuit_engine as engine
import database as db
import level_content as content
import circuit_results as results


def _utc_now():
    """带微秒的服务端 UTC 时间，关卡计时不接受浏览器传来的时间。"""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _ensure_level_timer_table(con):
    """就地、非破坏性建表；无需删除或重建任何现有数据库。"""
    con.execute("""
        CREATE TABLE IF NOT EXISTS circuit_level_run_timers (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            level_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            PRIMARY KEY (user_id, level_id)
        )
    """)


def _finished_seconds(started_at, finished_at):
    """仅对服务器签发且能解析的开始时间计算耗时。"""
    if not isinstance(started_at, str) or not started_at:
        return None
    try:
        start = datetime.fromisoformat(started_at)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        elapsed = (finished_at - start).total_seconds()
        if elapsed < 0:  # Server clock moved backwards; never fake 0 seconds.
            return None
        return round(elapsed, 2)
    except (TypeError, ValueError, OverflowError):
        return None


def check_version(value, version):
    if type(value) is not int or value != version:
        raise engine.CircuitError(
            "LEVEL_VERSION_MISMATCH",
            "提交的关卡版本与已开始版本不一致；既有存档不会被覆盖",409)


def _allowed(spec):
    # Junctions are non-computational wiring helpers in every lesson.
    return {"types":list(dict.fromkeys([*spec["allowedTypes"], "junction"])),
            "packages":spec["allowedPackages"]}


def get_levels(path,user_id):
    with closing(db.connect(path)) as con:
        return {"levels":content.levels_public(con,user_id)}


def get_level(path,user_id,level_id):
    with closing(db.connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        level = content.level_for(con,user_id,level_id)
        _ensure_level_timer_table(con)
        # GET /api/levels/:id is called by the existing UI on each actual
        # entry to a formal level. It becomes the authoritative start event.
        con.execute(
            """INSERT INTO circuit_level_run_timers(user_id,level_id,started_at)
               VALUES(?,?,?)
               ON CONFLICT(user_id,level_id)
               DO UPDATE SET started_at=excluded.started_at""",
            (user_id,level_id,_utc_now()))
        con.commit()
    return {"level":content.public_spec(level)}


def get_registry(path,user_id):
    with closing(db.connect(path)) as con:
        assets=content.owned(con,user_id)
        if assets: content.validate_package_dag(assets)
    return {"types":engine.COMPONENTS, "circuitSchemaVersion":engine.SCHEMA_VERSION,
            "packages":[{
                "type":key,"symbol":d["symbol"],"name":d["name"],
                "version":d["version"],"interface":d["interface"],
                "pins":engine.make_pins(d["interface"]),
                "isCurrent":d["version"]==max(
                    k["version"] for k in assets.values()
                    if k["symbol"]==d["symbol"]),
                "levelId":d["levelId"],
            } for key,d in sorted(assets.items())]}


def get_component(path,user_id,symbol,version):
    key=f"pkg:{symbol}@{version}"
    with closing(db.connect(path)) as con:
        defs=content.owned(con,user_id)
        if key not in defs:
            raise engine.CircuitError("PACKAGE_LOCKED",
                "该元件未解锁或不属于当前账号",404)
        content.validate_package_dag(defs)
    d=defs[key]
    return {"component":{
        "type":key,"name":d["name"],"symbol":d["symbol"],
        "version":d["version"],"interface":d["interface"],
        "pins":engine.make_pins(d["interface"]),
        "graph":d["graph"],"readOnly":True,
        "digest":d["digest"],"sourceLevelId":d["levelId"],
        "sourceLevelVersion":d["levelVersion"],
    }}


def _check_graph(spec,graph,defs):
    if defs: content.validate_package_dag(defs)
    return engine.validate_graph(graph,defs,_allowed(spec),spec["interface"])


def simulate_live(path,user_id,level_id,body):
    with closing(db.connect(path)) as con:
        spec=content.level_for(con,user_id,level_id,enroll=False)
        defs=content.owned(con,user_id)
        if not con.execute(
                "SELECT 1 FROM circuit_enrollments WHERE user_id=? AND level_id=?",
                (user_id,level_id)).fetchone():
            raise engine.CircuitError("LEVEL_NOT_OPENED",
                                      "请先GET关卡定义再开始模拟",409)
    check_version(body.get("levelVersion"),spec["version"])
    graph=_check_graph(spec,body.get("graph"),defs)
    result=engine.simulate(graph,body.get("inputs",{}),body.get("state",{}),
                           body.get("cycles",0),defs,_validated=True)
    return {"levelId":level_id,"levelVersion":spec["version"],
            "circuitSchemaVersion":engine.SCHEMA_VERSION,**result}


def start_attempt(path,user_id,level_id,version):
    with closing(db.connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        spec=content.level_for(con,user_id,level_id,enroll=False)
        check_version(version,spec["version"])
        row=con.execute(
            "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
            (user_id,spec["chapterId"])).fetchone()
        if row is None:
            raise engine.CircuitError("LEVEL_NOT_READY",
                "请先保存章节进度并接取主线任务",409)
        try:
            state=json.loads(row["state_json"])
        except (TypeError,ValueError):
            raise engine.CircuitError("CHAPTER_SCHEMA_MISMATCH",
                                      "章节存档格式无法识别，绝不自动重置",409)
        content.validate_circuit_save(con,user_id,spec["chapterId"],state)
        if state.get("tasks",{}).get("main",{}).get("status") not in (
                "accepted","completed","submitted"):
            raise engine.CircuitError("LEVEL_NOT_READY",
                                      "请先与NPC交互并接取主线任务",409)
        saved=(state.get("circuitLevels") or {}).get(level_id)
        if not saved:
            raise engine.CircuitError("LEVEL_NOT_READY",
                                      "请先把当前正式关卡的电路保存到章节进度",409)
        attempt=secrets.token_urlsafe(24)
        _ensure_level_timer_table(con)
        timer=con.execute(
            """SELECT started_at FROM circuit_level_run_timers
               WHERE user_id=? AND level_id=?""",
            (user_id,level_id)).fetchone()
        # Snapshot the *entry* time into the server-signed attempt row.
        # A later entry or a second tab cannot change this attempt's clock.
        # If a legacy caller bypassed GET, still persist a server-issued clock.
        # The normal game always calls GET first, so it starts upon level entry.
        if timer is None:
            raise engine.CircuitError(
                "LEVEL_TIMER_NOT_STARTED",
                "关卡计时尚未开始，请退出后重新进入关卡", 409)
        started_at=timer["started_at"]
        con.execute(
            "INSERT INTO attempts(attempt_id,user_id,chapter_id,started_at) VALUES(?,?,?,?)",
            (attempt,user_id,spec["chapterId"],started_at))
        con.execute(
            """INSERT INTO circuit_level_attempts(attempt_id,user_id,level_id,level_version)
               VALUES(?,?,?,?)""",(attempt,user_id,level_id,spec["version"]))
        con.commit()
    return {"attemptId":attempt,"levelId":level_id,
            "levelVersion":spec["version"]}


def _grade(spec,graph,defs):
    """A test group passes iff every output matches and the graph is stable.

    Combinational group = one truth-table row; sequential group = one script
    step. Unit counts, not weighted marks, are authoritative.
    """
    passed=total=0
    first_failure=None
    floating=set()
    warnings=set()
    def evaluate(inputs, expect, state, cycles, location):
        nonlocal passed, total, first_failure
        total+=1
        result=None
        error_code=None
        try:
            result=engine.simulate(graph,inputs,state,cycles,defs,_validated=True)
        except engine.CircuitError as error:
            if error.code != "INVALID_LATCH_INPUT":
                raise
            error_code=error.code
            warnings.add(error_code)
        if result is not None:
            for warning in result["warnings"]:
                code=warning["code"]
                if code=="FLOATING_PIN":
                    floating.add((warning["component"],warning["pin"]))
                elif code!="MISSING_EXTERNAL_INPUT":
                    warnings.add(code)
        ok=(result is not None and not result["unstable"]
            and result["outputs"]==expect)
        if ok:
            passed+=1
        elif first_failure is None:
            first_failure={
                **location,
                "inputs":dict(inputs),
                "expectedOutputs":dict(expect),
                "actualOutputs":dict(result["outputs"]) if result else None,
                "unstable":result["unstable"] if result else True,
            }
            if error_code:
                first_failure["errorCode"]=error_code
        return result["state"] if result is not None else state
    # Each row is evaluated independently. A wrong Sum or Carry rejects the
    # entire row, rather than counting individual correct output bits.
    for group,vector in enumerate(spec["hiddenVectors"],start=1):
        evaluate(vector["inputs"],vector["expect"],None,0,
                 {"kind":"truth","groupNumber":group})
    # Each script starts from fresh state, its successive steps share memory.
    for number,script in enumerate(spec["sequentialScripts"],start=1):
        state=None
        for step_index,step in enumerate(script["steps"],start=1):
            state=evaluate(step["inputs"],step["expect"],state,
                           step.get("cycles",1),
                           {"kind":"step","scriptNumber":number,
                            "scriptName":script.get("name",""),
                            "stepNumber":step_index})
    unit=results.unit_for(spec)
    count=sum(c["type"] not in ("input","output","vdd","gnd","junction")
              for c in graph["components"])
    notice=[]
    if floating:
        notice.append({"code":"FLOATING_PIN","count":len(floating),
                       "message":f"有 {len(floating)} 个输入引脚没有接线；悬空不会自动当作0"})
    if "SHORT_CIRCUIT" in warnings:
        notice.append({"code":"SHORT_CIRCUIT","message":"电路存在高低电平短路"})
    if "MULTIPLE_OUTPUT_DRIVERS" in warnings:
        notice.append({"code":"MULTIPLE_OUTPUT_DRIVERS",
                       "message":"同一网络连接了多个主动输出，可能发生驱动冲突"})
    if "UNKNOWN_TRANSISTOR_GATE" in warnings:
        notice.append({"code":"UNKNOWN_TRANSISTOR_GATE",
                       "message":"晶体管栅极信号不确定，请检查供电与接线"})
    if "UNDRIVEN_OUTPUT" in warnings:
        notice.append({"code":"UNDRIVEN_OUTPUT",
                       "message":"某些测试下输出悬空（Z），需要有效的上拉或下拉路径"})
    if "UNKNOWN_OUTPUT" in warnings:
        notice.append({"code":"UNKNOWN_OUTPUT",
                       "message":"某些测试下输出不确定（X），请检查输入与冲突"})
    if ("UNSTABLE" in warnings or "UNSUPPORTED_FEEDBACK" in warnings):
        notice.append({"code":"UNSTABLE","message":"电路输出无法稳定"})
    if "INVALID_LATCH_INPUT" in warnings:
        notice.append({"code":"INVALID_LATCH_INPUT",
                       "message":"锁存器同时置位和复位，输入无效"})
    return {
        "completed":passed==total,
        "passedCount":passed,"totalCount":total,"unit":unit,
        "firstFailure":first_failure,"warnings":notice,
        "componentCount":count,
        "minimalComponentCount":results.minimal_count(spec),
    }


def _unlocked(con,user_id,spec,graph,defs):
    award=spec["award"]
    symbol=award["symbol"]
    content.validate_package_dag(defs,symbol,graph)
    hashval=content.digest({"interface":spec["interface"],"graph":graph})
    latest=con.execute(
        """SELECT version,digest FROM circuit_components
           WHERE user_id=? AND symbol=? ORDER BY version DESC LIMIT 1""",
        (user_id,symbol)).fetchone()
    if latest is not None and latest["digest"]==hashval:
        version=latest["version"]
        fresh=False
    else:
        version=(latest["version"] if latest else 0)+1
        con.execute(
            """INSERT INTO circuit_components
               (user_id,symbol,version,level_id,level_version,name,
                interface_json,graph_json,digest,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (user_id,symbol,version,spec["id"],spec["version"],award["name"],
             content.canonical(spec["interface"]),content.canonical(graph),
             hashval,db.now_iso()))
        fresh=True
    return {"type":f"pkg:{symbol}@{version}","name":award["name"],
            "symbol":symbol,"version":version,"fresh":fresh}


def _submission_payload(con, user_id, spec, score_row, created):
    """No numeric 0–100 marks escape the official assessment endpoint."""
    stored=db.unpack_score(score_row)
    details=stored["details"]
    submission={
        "attemptId":stored["attemptId"],
        "completed":stored["completed"],
        "completionStatus":"已完成" if stored["completed"] else "未完成",
        "passedCount":details.get("passedCount",0),
        "totalCount":details.get("totalCount",results.group_total(spec)),
        "unit":details.get("unit",results.unit_for(spec)),
        "firstFailure":details.get("firstFailure"),
        "warnings":details.get("warnings",[]),
        "componentCount":details.get("componentCount",0),
        "minimalComponentCount":details.get(
            "minimalComponentCount",results.minimal_count(spec)),
        "submittedAt":stored["submittedAt"],
        "durationSeconds":details.get("durationSeconds"),
    }
    user_row=con.execute(
        """SELECT u.id,u.username,u.student_no,u.display_name,u.class_id,
                  c.name class_name
           FROM users u LEFT JOIN classes c ON c.id=u.class_id WHERE u.id=?""",
        (user_id,)).fetchone()
    target={
        "id":user_row["id"],"username":user_row["username"],
        "studentNo":user_row["student_no"],
        "displayName":user_row["display_name"],
        "classId":user_row["class_id"],"className":user_row["class_name"],
        "levelId":spec["id"],
    }
    best=results.summaries(con,[target])[0]
    best={k:v for k,v in best.items() if k not in ("student","bestAttemptId")}
    return {
        "created":created,
        "status":best["status"],"completed":best["completed"],
        "completionStatus":"已完成" if best["completed"] else "未完成",
        "passedCount":submission["passedCount"],
        "totalCount":submission["totalCount"],"unit":submission["unit"],
        "submission":submission,"record":best,
        "package":details.get("awardedPackage"),
    }


def submit(path,user_id,level_id,body):
    # Capture the arrival time, not the end of circuit evaluation. A slow
    # server must not inflate the student's working time.
    request_arrived = datetime.now(timezone.utc)
    if not isinstance(body,dict):
        raise engine.CircuitError("INVALID_INPUT","提交必须是JSON对象")
    # Client cannot supply any score, completion, asset or hidden test output.
    if set(body)-{"attemptId","levelVersion","graph"}:
        raise engine.CircuitError("CLIENT_SCORE_FORBIDDEN",
                                   "正式关卡通过组数和道具只能由后端判定",422)
    attempt_id=body.get("attemptId")
    if not isinstance(attempt_id,str) or not 8<=len(attempt_id)<=100:
        raise engine.CircuitError("INVALID_ATTEMPT","缺少有效的尝试编号")
    with closing(db.connect(path)) as con:
        attempt=con.execute(
            """SELECT la.level_id,la.level_version,la.graph_digest,la.score_id,
                      la.user_id,s.chapter_id
               FROM circuit_level_attempts la
               JOIN attempts a ON a.attempt_id=la.attempt_id
               LEFT JOIN scores s ON s.id=la.score_id
               WHERE la.attempt_id=? AND la.user_id=?""",
            (attempt_id,user_id)).fetchone()
        if attempt is None or attempt["level_id"]!=level_id:
            raise engine.CircuitError("INVALID_ATTEMPT",
                                      "尝试编号非此学生/关卡签发",409)
        spec=content.level_for(con,user_id,level_id,enroll=False)
        defs=content.owned(con,user_id)
    check_version(body.get("levelVersion"),attempt["level_version"])
    if spec["version"]!=attempt["level_version"]:
        raise engine.CircuitError("LEVEL_VERSION_MISMATCH",
                                  "本关在开始后发生版本变化，原尝试继续使用旧版",409)
    graph=_check_graph(spec,body.get("graph"),defs)
    graph_hash=content.digest(graph)
    if attempt["score_id"] is not None:
        if attempt["graph_digest"]!=graph_hash:
            raise engine.CircuitError("ATTEMPT_CONFLICT",
                                      "同一尝试编号不可提交另一份电路",409)
        with closing(db.connect(path)) as con:
            row=con.execute("SELECT * FROM scores WHERE id=?",
                            (attempt["score_id"],)).fetchone()
            return _submission_payload(con,user_id,spec,row,False)
    result=_grade(spec,graph,defs)
    # An impossible recursive package must not persist a completed score.
    if result["completed"]:
        content.validate_package_dag(defs,spec["award"]["symbol"],graph)
    with closing(db.connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        row=con.execute(
            """SELECT la.*,a.chapter_id,a.started_at AS run_started_at
               FROM circuit_level_attempts la
               JOIN attempts a ON a.attempt_id=la.attempt_id
               WHERE la.attempt_id=? AND la.user_id=?""",
            (attempt_id,user_id)).fetchone()
        if row is None or row["level_id"] != level_id:
            raise engine.CircuitError("INVALID_ATTEMPT",
                                      "尝试编号不匹配",409)
        if row["score_id"] is not None:
            # A simultaneous duplicate submission must be idempotent when
            # its topology is identical; differing payloads remain rejected.
            if row["graph_digest"] != graph_hash:
                raise engine.CircuitError("ATTEMPT_CONFLICT",
                                          "同一尝试编号不可提交另一份电路",409)
            completed_score=con.execute(
                "SELECT * FROM scores WHERE id=?", (row["score_id"],)).fetchone()
            if completed_score is None:
                raise engine.CircuitError("ATTEMPT_CONFLICT",
                                          "已结算尝试缺少成绩记录",409)
            con.commit()
            return _submission_payload(con,user_id,spec,completed_score,False)
        if row["level_version"] != spec["version"]:
            raise engine.CircuitError("LEVEL_VERSION_MISMATCH",
                                      "尝试关卡版本不一致",409)
        save=con.execute(
            "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
            (user_id,spec["chapterId"])).fetchone()
        if save is None:
            raise engine.CircuitError("LEVEL_NOT_READY","当前章节进度不存在",409)
        st=json.loads(save["state_json"])
        content.validate_circuit_save(con,user_id,spec["chapterId"],st)
        if not st.get("circuitLevels",{}).get(level_id):
            raise engine.CircuitError("LEVEL_NOT_READY","正式关卡尚未保存",409)
        pkg=None
        if result["completed"]:
            pkg=_unlocked(con,user_id,spec,graph,defs)
        duration=_finished_seconds(row["run_started_at"],request_arrived) if result["completed"] else None
        # Never silently save a *completed* score without elapsed time.
        if result["completed"] and duration is None:
            raise engine.CircuitError(
                "LEVEL_TIMER_INVALID",
                "本次关卡计时异常，未保存成绩，请重新进入关卡", 409)
        details={**result,"assessmentType":"circuit_server",
                 "levelId":level_id,"levelVersion":spec["version"],
                 "graphDigest":graph_hash,"awardedPackage":pkg}
        if duration is not None:
            details["durationSeconds"]=duration
        cursor=con.execute(
            """INSERT INTO scores(user_id,chapter_id,score,completed,
                  details_json,attempt_id,submitted_at) VALUES(?,?,?,?,?,?,?)""",
            (user_id,spec["chapterId"],0,int(result["completed"]),
             content.canonical(details),attempt_id,
             request_arrived.isoformat(timespec="seconds")))
        con.execute(
            """UPDATE circuit_level_attempts SET score_id=?,graph_digest=?
               WHERE attempt_id=?""",(cursor.lastrowid,graph_hash,attempt_id))
        con.commit()
        stored=con.execute(
            "SELECT * FROM scores WHERE id=?",(cursor.lastrowid,)).fetchone()
        return _submission_payload(con,user_id,spec,stored,True)
