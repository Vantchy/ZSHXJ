"""教学管理业务层：服务端权限、软删除、操作日志与数据查询。

停用教师、停用学生和归档班级由 API 要求额外确认；教师移出学生需确认。
成功管理写入与日志同一SQLite事务；失败仅记录重要类型（越权/业务校验），
简单表单格式错误不记；同一人连续同类型失败只留第一条。
本层不返回学生个人成绩给管理员。
"""
import json
import secrets
import sqlite3
from contextlib import closing

import database as db
from chapters import CHAPTERS, BY_ID
from roster import make_csv
import circuit_results as circuit_record


class ManagementError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def bad(message, status=400, code="INVALID_INPUT"):
    raise ManagementError(status, code, message)


def role(actor, required):
    allowed = [required] if isinstance(required, str) else required
    if actor["role"] not in allowed:
        bad("无此管理权限", 403, "FORBIDDEN")


def num(value, name="编号"):
    if isinstance(value, bool):
        bad(name + "格式错误")
    try:
        result = int(value)
    except (TypeError, ValueError):
        bad(name + "必须为整数")
    if not 1 <= result <= 1000000000:
        bad(name + "格式错误")
    return result


def name(value, what, max_len=40):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= max_len:
        bad(f"{what}不能为空或超过{max_len}字符")
    if any(ch in value for ch in "\r\n\x00"):
        bad(f"{what}不能包含换行")
    return value.strip()


def school_no(value):
    if not isinstance(value, str) or not db.STUDENT_NO.fullmatch(value):
        bad("学号必须是10位数字")
    return value


def row_class(con, class_id, allow_archive=False):
    record = con.execute("SELECT * FROM classes WHERE id=?", (num(class_id, "班级ID"),)).fetchone()
    if record is None:
        bad("班级不存在", 404, "NOT_FOUND")
    if record["archived"] and not allow_archive:
        bad("此班级已归档，请先恢复", 409, "ARCHIVED_CLASS")
    return record


def scoped_teacher(con, actor, class_id):
    role(actor, "teacher")
    record = row_class(con, class_id)
    exists = con.execute(
        "SELECT 1 FROM teacher_classes WHERE teacher_id=? AND class_id=?",
        (actor["id"], class_id)
    ).fetchone()
    if exists is None:
        bad("此班级不在当前教师管理范围", 403, "FORBIDDEN")
    return record


def row_student(con, student_id):
    record = con.execute(
        "SELECT * FROM users WHERE id=? AND role='student'",
        (num(student_id, "学生ID"),)
    ).fetchone()
    if record is None:
        bad("学生账号不存在", 404, "NOT_FOUND")
    return record


def row_teacher(con, teacher_id):
    record = con.execute(
        "SELECT * FROM users WHERE id=? AND role='teacher' AND is_admin=0",
        (num(teacher_id, "教师ID"),)
    ).fetchone()
    if record is None:
        bad("教师账号不存在", 404, "NOT_FOUND")
    return record


def teacher_student(con, actor, student_id):
    student = row_student(con, student_id)
    if student["class_id"] is None:
        bad("学生已不属于任何班级", 403, "FORBIDDEN")
    scoped_teacher(con, actor, student["class_id"])
    if not student["active"]:
        bad("停用学生须联系管理员处理", 409, "ACCOUNT_DISABLED")
    return student


def class_snapshots(con, classes):
    values = []
    already = set()
    for entry in classes or []:
        class_id = entry if not isinstance(entry, dict) else entry["id"]
        class_id = num(class_id, "班级ID")
        if class_id in already:
            continue
        already.add(class_id)
        if isinstance(entry, dict):
            cname = entry.get("name", "")
        else:
            record = con.execute("SELECT name FROM classes WHERE id=?", (class_id,)).fetchone()
            cname = record["name"] if record is not None else f"已删除班级#{class_id}"
        values.append({"id": class_id, "name": cname})
    return values


def audit_insert(con, actor, action, result, message, meta=None):
    meta = meta or {}
    before = json.dumps(meta.get("before", {}), ensure_ascii=False)
    after = json.dumps(meta.get("after", {}), ensure_ascii=False)
    target_id = meta.get("target_id")
    cur = con.execute(
        """INSERT INTO audit_logs(actor_id,actor_username,actor_role,action,
           target_type,target_id,before_json,after_json,result,message,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        (actor["id"], actor["username"], actor["role"], action,
         meta.get("target_type"), str(target_id) if target_id is not None else None,
         before, after, result, message, db.now_iso())
    )
    for class_info in class_snapshots(con, meta.get("classes", [])):
        con.execute(
            "INSERT INTO audit_log_classes(log_id,class_id,class_name) VALUES(?,?,?)",
            (cur.lastrowid, class_info["id"], class_info["name"])
        )


FAILURE_LABELS = {"forbidden": "越权", "validation": "校验失败"}


def failure_category(error):
    """Only actionable permission and business-conflict failures merit an audit."""
    if error.status == 403:
        return "forbidden"
    if error.status in (409, 422):
        return "validation"
    # 400 invalid form fields, 404 missing IDs, 413/428 request issues:
    # return the error to the caller without flooding the permanent audit.
    return None


def record_management_failure(path, actor, action, category, message, data=None):
    """Keep only the first of consecutive failures in the same category per actor.

    The latest *recorded* action for this actor defines continuity; successes
    and a different failure category break the run, but unlogged 400s do not.
    BEGIN IMMEDIATE makes dedup + insertion atomic for concurrent requests.
    """
    if category not in FAILURE_LABELS:
        return False
    data = data or {}
    meta = {
        "after": {"failureType": category},
        "target_type": data.get("targetType"),
        "target_id": data.get("targetId"),
    }
    # Preserve scoped class associations; never expose unrelated classes.
    if data:
        meta.update(failed_class_metadata(path, actor, data))
    with closing(db.connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        last = con.execute(
            """SELECT result,after_json FROM audit_logs
               WHERE actor_id=? ORDER BY id DESC LIMIT 1""",
            (actor["id"],)
        ).fetchone()
        if last is not None and last["result"] == "failed":
            try:
                last_type = json.loads(last["after_json"]).get("failureType")
            except (ValueError, AttributeError):
                last_type = None
            if last_type == category:
                con.rollback()
                return False
        audit_insert(con, actor, action, "failed",
                     f"{FAILURE_LABELS[category]}：{message}", meta)
        con.commit()
    return True


def failed_class_metadata(path, actor, data):
    """Failure logs only associate classes actually visible to this actor."""
    possible = set()
    for key in ("classId", "toClassId"):
        if data.get(key) is not None:
            try:
                possible.add(num(data[key], key))
            except ManagementError:
                pass
    with closing(db.connect(path)) as con:
        if data.get("studentId") is not None:
            try:
                student = row_student(con, data["studentId"])
                if student["class_id"] is not None:
                    possible.add(student["class_id"])
            except ManagementError:
                pass
        if data.get("teacherId") is not None and actor["role"] == "admin":
            try:
                tid = num(data["teacherId"], "教师ID")
                possible.update(x[0] for x in con.execute(
                    "SELECT class_id FROM teacher_classes WHERE teacher_id=?", (tid,)
                ))
            except ManagementError:
                pass
        authorized = []
        for cid in possible:
            cls = con.execute("SELECT id,archived FROM classes WHERE id=?", (cid,)).fetchone()
            if cls is None:
                continue
            if actor["role"] == "admin":
                authorized.append(cid)
            elif actor["role"] == "teacher" and not cls["archived"] and con.execute(
                "SELECT 1 FROM teacher_classes WHERE class_id=? AND teacher_id=?",
                (cid, actor["id"])
            ).fetchone():
                authorized.append(cid)
        return {"classes": authorized}


def validate_roster(con, rows):
    """预览和最终提交共用验证，避免两条导入通路规则不一致。"""
    issues = []
    checked = []
    if not isinstance(rows, list) or not rows:
        return [], [{"row": 1, "message": "文件中没有学生记录"}]
    if len(rows) > 300:
        issues.append({"row": 1, "message": "每批最多300人"})
    seen = set()
    for item in rows[:300]:
        number, display, line = item.get("studentNo"), item.get("name"), item.get("row", 0)
        try:
            db.valid_account(number, None, display, is_import=True)
        except ValueError as error:
            issues.append({"row": line, "message": str(error)})
            continue
        if number in seen:
            issues.append({"row": line, "message": "文件内学号重复"})
        seen.add(number)
        if con.execute("SELECT 1 FROM users WHERE username=?", (number,)).fetchone():
            issues.append({"row": line, "message": "学号已存在，不会覆盖旧账号"})
        checked.append({"row": line, "studentNo": number, "name": display.strip()})
    return checked, issues


def preview_import(path, actor, class_id, rows):
    """只验证无写入；提交时再次在原子事务内验证。"""
    role(actor, ("teacher", "admin"))
    with closing(db.connect(path)) as con:
        if actor["role"] == "teacher":
            scoped_teacher(con, actor, class_id)
        else:
            row_class(con, class_id)
        checked, issues = validate_roster(con, rows)
    return {
        "count": len(rows), "created": 0, "dryRun": True,
        "valid": not issues, "errors": issues[:50],
        "preview": [
            {"studentNo": x["studentNo"], "name": x["name"]}
            for x in checked[:10]
        ],
    }


def mutate(path, actor, action, data):
    """统一执行一次管理写入（是否需要额外确认，由HTTP层决定）。"""
    try:
        with closing(db.connect(path)) as con:
            con.execute("BEGIN IMMEDIATE")
            payload, metadata = _dispatch(con, actor, action, data)
            audit_insert(con, actor, action, "success", metadata.get("message", "操作成功"), metadata)
            con.commit()
            return payload
    except ManagementError as error:
        category = failure_category(error)
        if category:
            record_management_failure(
                path, actor, action, category, error.message, data
            )
        raise
    except sqlite3.IntegrityError as error:
        message = "数据约束冲突，操作未执行"
        record_management_failure(path, actor, action, "validation", message, data)
        raise ManagementError(409, "CONFLICT", message) from error


def _dispatch(con, actor, action, data):
    if action == "classes.create":
        role(actor, "admin")
        display = name(data.get("name"), "班级名称", 60)
        if con.execute("SELECT 1 FROM classes WHERE name=?", (display,)).fetchone():
            bad("同名班级已存在", 409, "DUPLICATE")
        cur = con.execute(
            "INSERT INTO classes(name,created_at) VALUES(?,?)",
            (display, db.now_iso())
        )
        cid = cur.lastrowid
        return {"id": cid, "name": display}, {
            "target_type": "class", "target_id": cid,
            "classes": [{"id": cid, "name": display}],
            "after": {"name": display}, "message": "创建班级成功"
        }

    if action in ("classes.rename", "classes.archive", "classes.restore", "classes.delete_empty"):
        role(actor, "admin")
        cid = num(data.get("classId"), "班级ID")
        cls = row_class(con, cid, allow_archive=True)
        count = con.execute(
            "SELECT COUNT(*) FROM users WHERE role='student' AND class_id=?", (cid,)
        ).fetchone()[0]
        tcount = con.execute(
            "SELECT COUNT(*) FROM teacher_classes WHERE class_id=?", (cid,)
        ).fetchone()[0]
        before = {"name": cls["name"], "archived": bool(cls["archived"]),
                  "students": count, "teachers": tcount}
        meta = {"target_type": "class", "target_id": cid,
                "classes": [{"id": cid, "name": cls["name"]}], "before": before}
        if action == "classes.rename":
            new_name = name(data.get("name"), "新班级名称", 60)
            if new_name == cls["name"]:
                bad("新旧班级名称相同")
            con.execute("UPDATE classes SET name=? WHERE id=?", (new_name, cid))
            meta["classes"] = [{"id": cid, "name": new_name}]
            meta.update(after={"name": new_name}, message="班级改名成功")
            return {"id": cid, "name": new_name}, meta
        if action == "classes.archive":
            if cls["archived"]:
                bad("班级已归档", 409)
            con.execute("UPDATE classes SET archived=1 WHERE id=?", (cid,))
            meta.update(after={"archived": True}, message=f"归档班级：学生{count}人，教师{tcount}人；账号数据保留")
            return {"id": cid, "archived": True}, meta
        if action == "classes.restore":
            if not cls["archived"]:
                bad("班级当前未归档", 409)
            con.execute("UPDATE classes SET archived=0 WHERE id=?", (cid,))
            meta.update(after={"archived": False}, message="恢复班级及其原有教师关系")
            return {"id": cid, "archived": False}, meta
        if count != 0:
            bad(f"班级仍有{count}名学生，不允许删除", 409, "CLASS_NOT_EMPTY")
        # Explicit exception: only empty class may be actually deleted.
        con.execute("DELETE FROM teacher_classes WHERE class_id=?", (cid,))
        con.execute("DELETE FROM classes WHERE id=?", (cid,))
        meta.update(after={"deleted": True}, message=f"彻底删除空班级（原教师关系{tcount}条）")
        return {"id": cid, "deleted": True}, meta

    if action == "teachers.create":
        role(actor, "admin")
        login = name(data.get("username"), "教师登录账号", 32)
        password = data.get("password")
        display = name(data.get("displayName"), "教师姓名")
        db.valid_account(login, password, display)
        if con.execute("SELECT 1 FROM users WHERE username=?", (login.lower(),)).fetchone():
            bad("登录账号已存在", 409, "DUPLICATE")
        cur = con.execute(
            """INSERT INTO users(username,display_name,password_hash,role,created_at,
               must_change_password,is_admin,active,ever_password_set)
               VALUES(?,?,?,'teacher',?,0,0,1,1)""",
            (login.lower(), display, db.hash_password(password), db.now_iso())
        )
        uid = cur.lastrowid
        return {"id": uid, "username": login.lower(), "displayName": display}, {
            "target_type": "teacher", "target_id": uid,
            "after": {"username": login.lower(), "name": display},
            "message": "创建教师账号成功"
        }

    if action in ("teachers.disable", "teachers.enable", "teachers.password_reset"):
        role(actor, "admin")
        tid = num(data.get("teacherId"), "教师ID")
        teacher = row_teacher(con, tid)
        cid = [x[0] for x in con.execute(
            "SELECT class_id FROM teacher_classes WHERE teacher_id=?", (tid,)
        ).fetchall()]
        meta = {"target_type": "teacher", "target_id": tid, "classes": cid,
                "before": {"username": teacher["username"], "active": bool(teacher["active"])}}
        if action == "teachers.password_reset":
            pwd = data.get("newPassword")
            if not isinstance(pwd, str) or not 8 <= len(pwd) <= 128:
                bad("新密码长度需为8-128位")
            con.execute("UPDATE users SET password_hash=? WHERE id=?",
                        (db.hash_password(pwd), tid))
            con.execute("DELETE FROM sessions WHERE user_id=?", (tid,))
            meta.update(after={"sessionsRevoked": True}, message="管理员重置教师密码并撤销原会话")
            return {"teacherId": tid, "reset": True}, meta
        enabled = action.endswith("enable")
        if bool(teacher["active"]) == enabled:
            bad("教师当前已是目标状态", 409)
        con.execute("UPDATE users SET active=? WHERE id=?", (int(enabled), tid))
        if not enabled:
            con.execute("DELETE FROM sessions WHERE user_id=?", (tid,))
        meta.update(after={"active": enabled},
                    message="启用教师账号（原班级关系保留）" if enabled else
                    "停用教师账号（会话失效，班级关系保留）")
        return {"teacherId": tid, "active": enabled}, meta

    if action in ("teacher_classes.assign", "teacher_classes.remove", "teacher_classes.leave"):
        cid = num(data.get("classId"), "班级ID")
        if action == "teacher_classes.leave":
            role(actor, "teacher")
            tid = actor["id"]
            cls = scoped_teacher(con, actor, cid)
        else:
            role(actor, "admin")
            tid = num(data.get("teacherId"), "教师ID")
            teacher = row_teacher(con, tid)
            cls = row_class(con, cid, allow_archive=True)
            if action == "teacher_classes.assign" and not teacher["active"]:
                bad("教师账号已停用，须先启用后再分配", 409, "TEACHER_DISABLED")
        relationship = con.execute(
            "SELECT 1 FROM teacher_classes WHERE class_id=? AND teacher_id=?",
            (cid, tid)
        ).fetchone()
        if action == "teacher_classes.assign":
            if relationship:
                bad("该教师已经带此班", 409)
            if cls["archived"]:
                bad("归档班不能新增教师，须先恢复", 409)
            con.execute(
                "INSERT INTO teacher_classes(class_id,teacher_id) VALUES(?,?)",
                (cid, tid)
            )
            verb = "分配"
        else:
            if relationship is None:
                bad("该教师当前未带此班", 409)
            if action == "teacher_classes.leave":
                active_count = con.execute(
                    """SELECT COUNT(*) FROM teacher_classes tc JOIN users u
                       ON u.id=tc.teacher_id WHERE tc.class_id=? AND u.active=1""",
                    (cid,)
                ).fetchone()[0]
                if active_count <= 1:
                    bad("当前是班级唯一在职教师，请先联系管理员确认和分配其他教师", 409,
                        "LAST_ACTIVE_TEACHER")
            con.execute(
                "DELETE FROM teacher_classes WHERE class_id=? AND teacher_id=?",
                (cid, tid)
            )
            verb = "教师主动退出" if action == "teacher_classes.leave" else "取消分配"
        return {"classId": cid, "teacherId": tid, "assigned": verb == "分配"}, {
            "target_type": "teacher_class", "target_id": f"{tid}:{cid}",
            "classes": [{"id": cid, "name": cls["name"]}],
            "before": {"assigned": relationship is not None},
            "after": {"assigned": verb == "分配"},
            "message": f"{verb}教师与班级关系；教师账号未删除"
        }

    if action in (
        "students.teacher_remove", "students.teacher_transfer",
        "students.password_reset", "students.admin_move", "students.admin_correct",
        "students.admin_update_no", "students.admin_update_name",
        "students.disable", "students.enable", "students.delete_error"
    ):
        sid = num(data.get("studentId"), "学生ID")
        if action.startswith("students.teacher_") or action == "students.password_reset":
            role(actor, "teacher")
            student = teacher_student(con, actor, sid)
        else:
            role(actor, "admin")
            student = row_student(con, sid)
        old_class = student["class_id"]
        classes = [old_class] if old_class is not None else []
        meta = {
            "target_type": "student", "target_id": sid, "classes": classes,
            "before": {
                "username": student["username"],
                "name": student["display_name"],
                "classId": old_class,
                "active": bool(student["active"]),
            },
        }
        if action in ("students.admin_correct", "students.admin_update_no",
                      "students.admin_update_name"):
            # 管理员可分别修改学号或姓名；也保留合并更正接口。
            if action in ("students.admin_correct", "students.admin_update_no"):
                number = school_no(data.get("studentNo"))
                if number != student["username"] and con.execute(
                    "SELECT 1 FROM users WHERE username=?", (number,)
                ).fetchone():
                    bad("新学号已被占用", 409, "STUDENT_NO_EXISTS")
            if action in ("students.admin_correct", "students.admin_update_name"):
                display = name(data.get("displayName"), "学生姓名")
            if action == "students.admin_update_no":
                con.execute("UPDATE users SET username=?,student_no=? WHERE id=?",
                            (number, number, sid))
                meta.update(after={"studentNo": number},
                            message="管理员修改学生学号；原账号的历史成绩和存档保留")
                return {"studentId": sid, "studentNo": number}, meta
            if action == "students.admin_update_name":
                con.execute("UPDATE users SET display_name=? WHERE id=?",
                            (display, sid))
                meta.update(after={"displayName": display},
                            message="管理员修改学生姓名；学号和历史成绩、存档不变")
                return {"studentId": sid, "displayName": display}, meta
            con.execute(
                "UPDATE users SET username=?,student_no=?,display_name=? WHERE id=?",
                (number, number, display, sid)
            )
            meta.update(after={"studentNo": number, "displayName": display},
                        message="管理员修正学生学号与姓名；历史成绩/存档仍归同一账号")
            return {"studentId": sid, "studentNo": number, "displayName": display}, meta

        if action in ("students.teacher_remove", "students.teacher_transfer", "students.admin_move"):
            if action == "students.teacher_remove":
                if old_class is None:
                    bad("学生已不属于任何班级", 409)
                dest_id = None
            else:
                dest_id = num(data.get("toClassId"), "目标班级ID")
                row_class(con, dest_id)
                if dest_id == old_class:
                    bad("目标班级与当前班级相同", 409)
                if action == "students.teacher_transfer":
                    scoped_teacher(con, actor, dest_id)
                classes.append(dest_id)
            con.execute("UPDATE users SET class_id=? WHERE id=?", (dest_id, sid))
            meta.update(after={"classId": dest_id}, message=(
                "学生被移出原班：账号、成绩和存档均保留" if dest_id is None else
                "学生转班/分配：账号、成绩和存档跟随学生账号，未复制记录"
            ))
            return {"studentId": sid, "classId": dest_id}, meta

        if action == "students.password_reset":
            con.execute(
                "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
                (db.PENDING_PASSWORD, sid)
            )
            con.execute("DELETE FROM sessions WHERE user_id=?", (sid,))
            con.execute("DELETE FROM setup_sessions WHERE user_id=?", (sid,))
            meta.update(after={"needsPasswordSetup": True},
                        message="教师重置学生设密状态；成绩和存档保留，原会话失效")
            return {"studentId": sid, "needsPasswordSetup": True}, meta

        if action in ("students.disable", "students.enable"):
            enabled = action == "students.enable"
            if bool(student["active"]) == enabled:
                bad("学生当前已是目标状态", 409)
            con.execute("UPDATE users SET active=? WHERE id=?", (int(enabled), sid))
            if not enabled:
                con.execute("DELETE FROM sessions WHERE user_id=?", (sid,))
                con.execute("DELETE FROM setup_sessions WHERE user_id=?", (sid,))
            meta.update(after={"active": enabled},
                        message="启用学生账号（原班级关系保留）" if enabled else
                        "停用学生账号（历史数据和班级关系保留）")
            return {"studentId": sid, "active": enabled}, meta

        # Explicit narrow exception: delete unused erroneous imported account only.
        if student["ever_password_set"] or not student["must_change_password"]:
            bad("学生曾成功设置密码，不能彻底删除，请使用停用", 409,
                "STUDENT_EVER_SETUP")
        scores = con.execute(
            "SELECT 1 FROM scores WHERE user_id=? LIMIT 1", (sid,)
        ).fetchone()
        progress = con.execute(
            "SELECT 1 FROM progress WHERE user_id=? LIMIT 1", (sid,)
        ).fetchone()
        if scores or progress:
            bad("该学生已有进度或成绩，不能彻底删除", 409,
                "STUDENT_HAS_DATA")
        con.execute("DELETE FROM users WHERE id=?", (sid,))
        meta.update(after={"deleted": True},
                    message="彻底删除从未设密且无成绩/进度的错误学生账号")
        return {"studentId": sid, "deleted": True}, meta

    if action == "students.import":
        role(actor, ("teacher", "admin"))
        cid = num(data.get("classId"), "班级ID")
        if actor["role"] == "teacher":
            cls = scoped_teacher(con, actor, cid)
        else:
            cls = row_class(con, cid)
        items = data.get("rows")
        checked, issues = validate_roster(con, items)
        if issues:
            bad("名单校验失败：" + "; ".join(
                f"第{x['row']}行 {x['message']}" for x in issues[:6]), 422,
                "INVALID_ROSTER")
        for item in checked:
            con.execute(
                """INSERT INTO users(username,display_name,password_hash,role,created_at,
                   student_no,class_id,must_change_password,is_admin,active,ever_password_set)
                   VALUES(?,?,?,'student',?,?,?,1,0,1,0)""",
                (item["studentNo"], item["name"], db.PENDING_PASSWORD,
                 db.now_iso(), item["studentNo"], cid)
            )
        return {"created": len(checked), "count": len(checked), "valid": True}, {
            "target_type": "class", "target_id": cid,
            "classes": [{"id": cid, "name": cls["name"]}],
            "after": {"imported": len(items)}, "message": f"导入学生{len(items)}人"
        }

    bad("不支持此管理操作", 404, "NOT_FOUND")


def params_page(page=1, page_size=20):
    page, page_size = num(page, "页码"), num(page_size, "每页条数")
    if page_size > 100:
        bad("每页最多100条")
    return page, page_size


def paged(con, select_sql, count_sql, arguments, page=1, page_size=20, all_rows=False):
    page, page_size = params_page(page, page_size)
    total = con.execute(count_sql, arguments).fetchone()[0]
    args = list(arguments)
    if all_rows:
        if total > 10000:
            bad("一次最多导出10000条数据", 413, "EXPORT_LIMIT")
        rows = con.execute(select_sql, args).fetchall()
    else:
        rows = con.execute(select_sql + " LIMIT ? OFFSET ?",
                           args + [page_size, (page-1)*page_size]).fetchall()
    return {
        "items": rows,
        "pagination": {
            "page": page, "pageSize": page_size,
            "total": total, "totalPages": (total + page_size - 1) // page_size
        },
    }


def overview(path):
    """Six mutually exclusive role/status counts; archived classes are separate."""
    with closing(db.connect(path)) as con:
        return {
            "classes": con.execute(
                "SELECT COUNT(*) FROM classes WHERE archived=0"
            ).fetchone()[0],
            "archivedClasses": con.execute(
                "SELECT COUNT(*) FROM classes WHERE archived=1"
            ).fetchone()[0],
            "teachers": con.execute(
                "SELECT COUNT(*) FROM users WHERE role='teacher' AND is_admin=0 AND active=1"
            ).fetchone()[0],
            "disabledTeachers": con.execute(
                "SELECT COUNT(*) FROM users WHERE role='teacher' AND is_admin=0 AND active=0"
            ).fetchone()[0],
            "students": con.execute(
                "SELECT COUNT(*) FROM users WHERE role='student' AND active=1"
            ).fetchone()[0],
            "disabledStudents": con.execute(
                "SELECT COUNT(*) FROM users WHERE role='student' AND active=0"
            ).fetchone()[0],
        }


def admin_classes(path, archived=False):
    with closing(db.connect(path)) as con:
        classes = con.execute(
            "SELECT id,name,archived FROM classes WHERE archived=? ORDER BY id",
            (int(archived),)
        ).fetchall()
        results = []
        for cls in classes:
            cid = cls["id"]
            teachers = con.execute(
                """SELECT u.id,u.display_name,u.active FROM teacher_classes tc
                   JOIN users u ON u.id=tc.teacher_id WHERE tc.class_id=?
                   ORDER BY u.id""", (cid,)
            ).fetchall()
            counts = con.execute(
                """SELECT COUNT(*) total,
                   COALESCE(SUM(CASE WHEN must_change_password=1 THEN 1 ELSE 0 END),0) pending
                   FROM users WHERE role='student' AND class_id=?""",
                (cid,)
            ).fetchone()
            results.append({
                "id": cid, "name": cls["name"], "archived": bool(cls["archived"]),
                "teachers": [{"id": t["id"], "displayName": t["display_name"],
                              "active": bool(t["active"])} for t in teachers],
                "studentCount": counts["total"],
                "unsetPasswordCount": counts["pending"],
            })
        return results


def admin_class_detail(path, class_id, page=1, page_size=20):
    with closing(db.connect(path)) as con:
        cls = row_class(con, class_id, allow_archive=True)
        teachers = con.execute(
            """SELECT u.id,u.username,u.display_name,u.active FROM teacher_classes tc
               JOIN users u ON u.id=tc.teacher_id WHERE tc.class_id=? ORDER BY u.id""",
            (cls["id"],)
        ).fetchall()
        base = "FROM users u WHERE u.role='student' AND u.class_id=?"
        records = paged(
            con,
            "SELECT u.id,u.username,u.display_name,u.active,u.must_change_password "
            + base + " ORDER BY u.student_no,u.id",
            "SELECT COUNT(*) " + base, [cls["id"]], page, page_size
        )
        return {
            "class": {"id": cls["id"], "name": cls["name"],
                      "archived": bool(cls["archived"])},
            "teachers": [
                {"id": r["id"], "username": r["username"],
                 "displayName": r["display_name"], "active": bool(r["active"])}
                for r in teachers
            ],
            "students": [
                {"id": r["id"], "username": r["username"],
                 "displayName": r["display_name"], "active": bool(r["active"]),
                 "needsPasswordSetup": bool(r["must_change_password"])}
                for r in records["items"]
            ],
            "pagination": records["pagination"],
        }



def available_teachers(path, class_id, query="", page=1, page_size=20):
    """可分配教师：只列启用且尚未被分配到此班的教师，支持检索和分页。"""
    if not isinstance(query, str) or len(query) > 60:
        bad("搜索长度不能超过60字")
    with closing(db.connect(path)) as con:
        cls = row_class(con, class_id, allow_archive=True)
        # 归档班只能展示以前的教师关联；新分配应先恢复班级。
        if cls["archived"]:
            bad("该班已归档，请先恢复再分配教师", 409, "ARCHIVED_CLASS")
        base = (
            "FROM users u WHERE u.role='teacher' AND u.is_admin=0 "
            "AND u.active=1 AND NOT EXISTS "
            "(SELECT 1 FROM teacher_classes tc "
            "WHERE tc.class_id=? AND tc.teacher_id=u.id)"
        )
        args = [cls["id"]]
        if query.strip():
            base += " AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"
            pattern = db.literal_like_contains(query.strip())
            args.extend([pattern, pattern])
        result = paged(
            con, "SELECT u.id,u.username,u.display_name " + base + " ORDER BY u.id",
            "SELECT COUNT(*) " + base, args, page, page_size,
        )
        return {
            "teachers": [{
                "id": row["id"], "username": row["username"],
                "displayName": row["display_name"],
            } for row in result["items"]],
            "pagination": result["pagination"],
        }



def admin_student_detail(path, student_id):
    """Admin-only identity/status view; never include individual scores or saves."""
    with closing(db.connect(path)) as con:
        student = row_student(con, student_id)
        cls = con.execute(
            "SELECT name FROM classes WHERE id=?", (student["class_id"],)
        ).fetchone() if student["class_id"] is not None else None
        return {"student": {
            "id": student["id"], "username": student["username"],
            "studentNo": student["student_no"],
            "displayName": student["display_name"],
            "classId": student["class_id"],
            "className": cls["name"] if cls else "未分班",
            "active": bool(student["active"]),
            "needsPasswordSetup": bool(student["must_change_password"]),
            "everPasswordSet": bool(student["ever_password_set"]),
        }}


def teacher_directory(path, class_id, query="", page=1, page_size=20):
    """All non-admin teachers, including disabled and already assigned accounts.

    A disabled or already assigned teacher remains visible to administrators,
    but the UI cannot offer a second assignment. The writer independently
    enforces both restrictions, so direct API calls cannot bypass the buttons.
    """
    if not isinstance(query, str) or len(query) > 60:
        bad("搜索长度不能超过60字")
    with closing(db.connect(path)) as con:
        cls = row_class(con, class_id, allow_archive=True)
        base = (
            "FROM users u LEFT JOIN teacher_classes tc ON "
            "tc.teacher_id=u.id AND tc.class_id=? "
            "WHERE u.role='teacher' AND u.is_admin=0"
        )
        arguments = [cls["id"]]
        if query.strip():
            base += " AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"
            pattern = db.literal_like_contains(query.strip())
            arguments.extend([pattern, pattern])
        result = paged(
            con,
            "SELECT u.id,u.username,u.display_name,u.active,"
            "CASE WHEN tc.teacher_id IS NULL THEN 0 ELSE 1 END AS assigned "
            + base + " ORDER BY u.active DESC,u.id",
            "SELECT COUNT(*) " + base, arguments, page, page_size,
        )
        return {
            "teachers": [
                {"id": row["id"], "username": row["username"],
                 "displayName": row["display_name"], "active": bool(row["active"]),
                 "assigned": bool(row["assigned"])}
                for row in result["items"]
            ],
            "pagination": result["pagination"],
        }


def admin_users(path, kind, active=True, query="", page=1, page_size=20):
    if kind not in ("teachers", "students"):
        bad("列表类型无效")
    if len(query) > 60:
        bad("搜索长度不能超过60字")
    with closing(db.connect(path)) as con:
        where = "u.role=? AND u.is_admin=0 AND u.active=?"
        args = ["teacher" if kind == "teachers" else "student", int(active)]
        if query.strip():
            where += " AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"
            find = db.literal_like_contains(query.strip())
            args += [find, find]
        base = "FROM users u LEFT JOIN classes c ON c.id=u.class_id WHERE " + where
        result = paged(
            con,
            "SELECT u.id,u.username,u.display_name,u.student_no,u.class_id,"
            "u.active,u.must_change_password,u.ever_password_set,c.name class_name "
            + base + " ORDER BY u.id DESC",
            "SELECT COUNT(*) " + base, args, page, page_size
        )
        items = []
        for r in result["items"]:
            data = {
                "id": r["id"], "username": r["username"],
                "displayName": r["display_name"], "active": bool(r["active"]),
            }
            if kind == "students":
                data.update({
                    "classId": r["class_id"], "className": r["class_name"] or "未分班",
                    "studentNo": r["student_no"],
                    "needsPasswordSetup": bool(r["must_change_password"]),
                    "everPasswordSet": bool(r["ever_password_set"]),
                })
            else:
                classes = con.execute(
                    """SELECT c.id,c.name FROM teacher_classes tc JOIN classes c
                       ON c.id=tc.class_id WHERE tc.teacher_id=? ORDER BY c.id""",
                    (r["id"],)
                ).fetchall()
                data["classes"] = [{"id": x["id"], "name": x["name"]} for x in classes]
            items.append(data)
        return {"items": items, "pagination": result["pagination"]}


def teacher_students(path, actor, class_id=None, query="", active=True,
                     status="all", chapter_id=None, page=1, page_size=20, all_rows=False):
    role(actor, "teacher")
    if len(query) > 60:
        bad("搜索不能超过60字")
    if status not in ("all", "unset", "not_started", "not_completed"):
        bad("状态筛选项不合法")
    if status in ("not_started", "not_completed") and chapter_id not in BY_ID:
        bad("请选择有效章节")
    with closing(db.connect(path)) as con:
        if class_id is not None:
            scoped_teacher(con, actor, class_id)
        where = [
            "u.role='student'", "u.active=?", "c.archived=0",
            "EXISTS(SELECT 1 FROM teacher_classes tc "
            "WHERE tc.class_id=u.class_id AND tc.teacher_id=?)",
        ]
        args = [int(active), actor["id"]]
        if class_id is not None:
            where.append("u.class_id=?")
            args.append(class_id)
        if query.strip():
            where.append("(u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')")
            search = db.literal_like_contains(query.strip())
            args += [search, search]
        if status == "unset":
            where.append("u.must_change_password=1")
        if status == "not_started":
            where.append(
                "NOT EXISTS(SELECT 1 FROM progress p WHERE p.user_id=u.id AND p.chapter_id=?)"
            )
            args.append(chapter_id)
        if status == "not_completed":
            where.append(
                "NOT EXISTS(SELECT 1 FROM scores s WHERE s.user_id=u.id "
                "AND s.chapter_id=? AND s.completed=1)"
            )
            args.append(chapter_id)
        base = ("FROM users u JOIN classes c ON c.id=u.class_id WHERE " + " AND ".join(where))
        result = paged(
            con,
            "SELECT u.id,u.username,u.display_name,u.student_no,u.class_id,"
            "u.must_change_password,c.name class_name " + base +
            " ORDER BY u.student_no,u.id",
            "SELECT COUNT(*) " + base, args, page, page_size, all_rows
        )
        return {
            "students": [{
                "id": r["id"], "username": r["username"],
                "displayName": r["display_name"],
                "studentNo": r["student_no"], "classId": r["class_id"],
                "className": r["class_name"],
                "needsPasswordSetup": bool(r["must_change_password"]),
            } for r in result["items"]],
            "pagination": result["pagination"],
        }


def teacher_student_detail(path, actor, student_id):
    role(actor, "teacher")
    with closing(db.connect(path)) as con:
        student = teacher_student(con, actor, student_id)
        c = con.execute("SELECT name FROM classes WHERE id=?", (student["class_id"],)).fetchone()
        progress_rows = con.execute(
            "SELECT * FROM progress WHERE user_id=?", (student["id"],)
        ).fetchall()
        progress = {r["chapter_id"]: r for r in progress_rows}
        scores_rows = con.execute(
            "SELECT * FROM scores WHERE user_id=? ORDER BY id DESC", (student["id"],)
        ).fetchall()
        by_chapter = {}
        for row in scores_rows:
            by_chapter.setdefault(row["chapter_id"], []).append(db.unpack_score(row))
        chapters = []
        for chapter in CHAPTERS:
            cid = chapter["id"]
            p = progress.get(cid)
            attempts = by_chapter.get(cid, [])
            chapters.append({
                "chapterId": cid, "chapterTitle": chapter["title"],
                "checkpoint": p["checkpoint"] if p else None,
                "updatedAt": db.display_time(p["updated_at"]) if p else None,
                "started": bool(p),
                "completed": any(r["completed"] for r in attempts),
                "scores": attempts,
            })
        return {
            "student": {
                "id": student["id"], "studentNo": student["student_no"],
                "username": student["username"],
                "displayName": student["display_name"],
                "classId": student["class_id"],
                "className": c["name"] if c else "未分班",
                "needsPasswordSetup": bool(student["must_change_password"]),
            },
            "chapters": chapters,
            "levelResults": circuit_record.for_student(con,student["id"]),
        }


def teacher_scores(path, actor, class_id=None, query="", page=1, page_size=20):
    role(actor, "teacher")
    if class_id is not None:
        with closing(db.connect(path)) as con:
            scoped_teacher(con, actor, class_id)
    data = db.scoped_records(
        path, actor, "scores",
        class_id=class_id, search=query,
        page=page, page_size=page_size
    )
    for item in data["items"]:
        item["chapterTitle"] = BY_ID.get(item["chapterId"], {}).get("title", "")
    return {"scores": data["items"],
            "pagination": {x: data[x] for x in ("page","pageSize","total","totalPages")}}


def export_teacher_student_csv(path, actor, **kwargs):
    result = teacher_students(path, actor, all_rows=True, **kwargs)
    rows = [
        [x["displayName"], x["studentNo"] or x["username"],
         x["className"], "未设置" if x["needsPasswordSetup"] else "已设置"]
        for x in result["students"]
    ]
    return make_csv(["姓名", "学号", "班级", "密码状态"], rows)


def audit_list(path, actor, page=1, page_size=20, actor_search="",
               class_id=None, start=None, end=None):
    role(actor, ("teacher", "admin"))
    if len(actor_search) > 60:
        bad("操作人搜索过长")
    with closing(db.connect(path)) as con:
        clauses = []
        args = []
        if actor["role"] == "teacher":
            clauses.append(
                """EXISTS(SELECT 1 FROM audit_log_classes ac
                   JOIN teacher_classes tc ON tc.class_id=ac.class_id
                   JOIN classes c ON c.id=tc.class_id
                   WHERE ac.log_id=l.id AND tc.teacher_id=? AND c.archived=0)"""
            )
            args.append(actor["id"])
        if actor_search.strip() and actor["role"] == "admin":
            clauses.append("l.actor_username LIKE ? ESCAPE '\\'")
            args.append(db.literal_like_contains(actor_search.strip()))
        if class_id is not None and actor["role"] == "admin":
            clauses.append(
                "EXISTS(SELECT 1 FROM audit_log_classes ac WHERE ac.log_id=l.id AND ac.class_id=?)"
            )
            args.append(class_id)
        # User enters calendar days in Beijing local time; stored audit timestamps are UTC.
        from datetime import date, datetime, time as dt_time, timedelta, timezone
        def beijing_boundary(day):
            try:
                local = datetime.combine(date.fromisoformat(day), dt_time.min,
                                         tzinfo=db.BEIJING_TIME)
            except ValueError:
                bad("日期不合法，须为YYYY-MM-DD")
            return local.astimezone(timezone.utc).isoformat(timespec="seconds")
        if start:
            clauses.append("l.created_at >= ?")
            args.append(beijing_boundary(start))
        if end:
            try:
                next_day = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
            except ValueError:
                bad("结束日期不合法")
            clauses.append("l.created_at < ?")
            args.append(beijing_boundary(next_day))
        base = "FROM audit_logs l"
        if clauses:
            base += " WHERE " + " AND ".join(clauses)
        response = paged(
            con,
            "SELECT l.* " + base + " ORDER BY l.id DESC",
            "SELECT COUNT(*) " + base, args, page, page_size
        )
        results = []
        for row in response["items"]:
            if actor["role"] == "teacher":
                # Hide other classes attached to the same multi-class operation.
                related = con.execute(
                    """SELECT ac.class_id,ac.class_name FROM audit_log_classes ac
                       JOIN teacher_classes tc ON tc.class_id=ac.class_id
                       JOIN classes c ON c.id=tc.class_id
                       WHERE ac.log_id=? AND tc.teacher_id=? AND c.archived=0
                       ORDER BY ac.class_id""", (row["id"], actor["id"])
                ).fetchall()
            else:
                related = con.execute(
                    "SELECT class_id,class_name FROM audit_log_classes WHERE log_id=? ORDER BY class_id",
                    (row["id"],)
                ).fetchall()
            results.append({
                "id": row["id"], "actor": row["actor_username"],
                "actorRole": row["actor_role"], "action": row["action"],
                "targetType": row["target_type"], "targetId": row["target_id"],
                "classes": [{"id": r["class_id"], "name": r["class_name"]} for r in related],
                "before": json.loads(row["before_json"]),
                "after": json.loads(row["after_json"]),
                "result": row["result"], "message": row["message"],
                "failureType": (
                    json.loads(row["after_json"]).get("failureType")
                    if row["result"] == "failed" else None
                ),
                "createdAt": db.display_time(row["created_at"]),
            })
        return {"logs": results, "pagination": response["pagination"]}
