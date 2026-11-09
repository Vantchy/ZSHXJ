"""学生与教师的关卡成绩汇总。

成绩列表只包含已结算的提交。正式电路成绩按关卡聚合，
场景演示结果单独标记；最佳记录选择通过组数最多的提交，
组数相同取最后一次，完成状态及首次完成时间保持不变。
"""

import json
import math
from contextlib import closing

import database as db
from chapters import BY_ID

# 已发布首批关卡的最简元件数。后续关卡在配置中定义 minimalComponentCount。
BUILTIN_MINIMAL_COUNTS = {
    ("ch1_cmos_not", 1): 2,
    ("ch1_cmos_nand", 1): 4,
    ("ch1_half_adder", 1): 2,
    ("ch1_sr_latch", 1): 2,
}

STUDENT_FIELDS = {
    "id": "id",
    "username": "username",
    "student_no": "studentNo",
    "display_name": "displayName",
    "class_id": "classId",
    "class_name": "className",
}


def unit_for(spec):
    return "步" if spec["sequentialScripts"] else "组"


def group_total(spec):
    return len(spec["hiddenVectors"]) + sum(
        len(script["steps"]) for script in spec["sequentialScripts"]
    )


def minimal_count(spec):
    return spec.get(
        "minimalComponentCount",
        BUILTIN_MINIMAL_COUNTS.get(
            (spec["id"], spec["version"]), spec["efficientAtMost"]
        ),
    )


def snapshots(con):
    """读取已发布的关卡快照和各关最新版本。"""
    by_key, latest = {}, {}
    for row in con.execute(
        """SELECT level_id, version, spec_json
           FROM circuit_level_snapshots
           ORDER BY level_id, version"""
    ):
        spec = json.loads(row["spec_json"])
        by_key[(row["level_id"], row["version"])] = spec
        latest[row["level_id"]] = row["version"]
    return by_key, latest


def _enrollments(con, user_ids):
    """返回学生首次进入关卡时绑定的版本。"""
    enrolled = {}
    for start in range(0, len(user_ids), 400):
        subset = user_ids[start : start + 400]
        placeholders = ",".join("?" for _ in subset)
        for row in con.execute(
            """SELECT user_id, level_id, version
               FROM circuit_enrollments
               WHERE user_id IN (""" + placeholders + ")",
            subset,
        ):
            enrolled[(row["user_id"], row["level_id"])] = row["version"]
    return enrolled


def _assessments(con, user_ids):
    """按学生和关卡分组读取已结算的正式成绩与演示成绩。"""
    assessments = {}
    for start in range(0, len(user_ids), 400):
        subset = user_ids[start : start + 400]
        placeholders = ",".join("?" for _ in subset)
        # 正式成绩的归属以服务器签发的电路尝试关联表为准。
        for row in con.execute(
            """SELECT ca.user_id, ca.level_id, s.id, s.completed,
                      s.submitted_at, s.details_json
               FROM circuit_level_attempts ca
               JOIN scores s ON s.id = ca.score_id
               WHERE ca.user_id IN (""" + placeholders + """
               )
               ORDER BY s.id""",
            subset,
        ):
            assessments.setdefault(
                (row["user_id"], row["level_id"]), []
            ).append(row)
        # 无正式电路关联的成绩来自章节演示，按章节单独归组。
        for row in con.execute(
            """SELECT s.user_id, ('demo:' || s.chapter_id) AS level_id,
                      s.id, s.score, s.completed, s.submitted_at,
                      s.details_json
               FROM scores s
               WHERE s.user_id IN (""" + placeholders + """
               )
               AND NOT EXISTS (
                   SELECT 1 FROM circuit_level_attempts ca
                   WHERE ca.score_id = s.id
               )
               ORDER BY s.id""",
            subset,
        ):
            assessments.setdefault(
                (row["user_id"], row["level_id"]), []
            ).append(row)
    return assessments


def _duration_number(details):
    """兼容旧成绩：只有明确的、非负的真实计时值才显示耗时。"""
    if not isinstance(details, dict):
        return None
    value = details.get("durationSeconds")
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        return None
    return value


def duration_text(seconds):
    """成绩页面展示：整数秒，分钟和小时按需出现。"""
    if seconds is None:
        return None
    whole = int(math.floor(seconds + 0.5))
    h, remain = divmod(whole, 3600)
    m, s = divmod(remain, 60)
    if h:
        return f"{h}时{m}分{s}秒"
    if m:
        return f"{m}分{s}秒"
    return f"{s}秒"


def _circuit_record(spec, level_id, records):
    """计算正式电路关卡最佳通过组数及累计完成状态。"""
    total = group_total(spec)
    best = None
    first_complete = None
    latest_timed = None

    for row in records:
        details = json.loads(row["details_json"])
        if row["completed"]:
            seconds = _duration_number(details)
            if seconds is not None:
                latest_timed = (row, seconds)
        passed = details.get("passedCount", 0)
        if type(passed) is not int or not 0 <= passed <= total:
            passed = 0
        # SQLite自增成绩ID严格区分同秒内的并列提交。
        if best is None or (passed, row["id"]) > (best[0], best[1]["id"]):
            best = (passed, row)

        if row["completed"] and (
            first_complete is None or row["id"] < first_complete["id"]
        ):
            first_complete = row

    best_passed = best[0]
    completed = first_complete is not None
    original_date = (
        db.display_time(first_complete["submitted_at"])
        if first_complete else None
    )
    first_duration = (
        _duration_number(json.loads(first_complete["details_json"]))
        if first_complete else None
    )
    duration = latest_timed[1] if latest_timed else None
    elapsed = duration_text(duration)
    # Preserve the original completedAt date format for every existing user.
    # The duration is a separate native results field, not pasted into the
    # date string or projected through a runtime monkeypatch.
    display = original_date
    return {
        "levelId": level_id,
        "levelTitle": spec["title"],
        "levelVersion": spec["version"],
        "chapterId": spec["chapterId"],
        "chapterTitle": BY_ID.get(spec["chapterId"], {}).get("title", ""),
        "assessmentType": "circuit_server",
        "status": "已完成" if completed else "进行中",
        "completed": completed,
        "bestPassedCount": best_passed,
        "totalCount": total,
        "unit": unit_for(spec),
        "submissionCount": len(records),
        "completedAt": display,
        "completedDate": original_date,
        "firstCompletionDurationSeconds": first_duration,
        "completionDurationSeconds": duration,
        "completionDurationText": elapsed,
        "bestAttemptId": best[1]["id"],
        "completionRate": round(best_passed / total * 100, 2) if total else 0,
    }


def _demo_record(chapter_id, records):
    """汇总演示关卡，只对有明确组数含义的记录计算完成率。"""
    first_complete = next(
        (row for row in records if row["completed"]), None
    )
    best = None

    for row in records:
        try:
            details = json.loads(row["details_json"])
        except (TypeError, ValueError):
            details = {}

        passed = details.get("passedCount")
        total = details.get("totalCount")
        # 固定4/4的演示记录存在不带组数字段的存储格式。
        # 仅识别它的完整标记，不从其他百分制成绩推断测试组数。
        if (
            passed is None
            and total is None
            and details.get("mock") is True
            and row["score"] == 0
            and row["completed"]
        ):
            passed, total = 4, 4
        if (
            type(passed) is not int
            or type(total) is not int
            or not 0 <= passed <= total <= 10000
            or details.get("unit", "组") not in ("组", "步")
        ):
            continue

        if best is None or (passed, row["id"]) > (best[0], best[1]["id"]):
            best = (passed, row, total, details.get("unit", "组"))
    best_passed = best[0] if best else None
    best_total = best[2] if best else None
    return {
        "levelId": f"demo:{chapter_id}",
        "levelTitle": "演示关卡（非正式电路评测）",
        "levelVersion": None,
        "chapterId": chapter_id,
        "chapterTitle": BY_ID.get(chapter_id, {}).get("title", chapter_id),
        "assessmentType": "legacy_demo",
        "status": "已完成" if first_complete else "进行中",
        "completed": first_complete is not None,
        "bestPassedCount": best_passed,
        "totalCount": best_total,
        "unit": best[3] if best else "组",
        "submissionCount": len(records),
        "completedAt": (
            db.display_time(first_complete["submitted_at"])
            if first_complete else None
        ),
        # Demo scores were never timed by the official level timer.
        # Keep the native /results/mine schema consistent for every row.
        "completedDate": (
            db.display_time(first_complete["submitted_at"])
            if first_complete else None
        ),
        "firstCompletionDurationSeconds": None,
        "completionDurationSeconds": None,
        "completionDurationText": None,
        "bestAttemptId": best[1]["id"] if best else records[-1]["id"],
        "completionRate": (
            round(best_passed / best_total * 100, 2)
            if best_total else None
        ),
    }


def summaries(con, users, only_levels=None):
    """汇总指定学生已提交的关卡，供教师查询和成绩提交后更新使用。

    ``users`` 可为同一学生的多个关卡行，行内 ``levelId`` 可限定结果。
    """
    if not users:
        return []

    ids = list(dict.fromkeys(user["id"] for user in users))
    specs, latest = snapshots(con)
    enrolled = _enrollments(con, ids)
    submitted = _assessments(con, ids)
    result = []
    for user in users:
        user_id = user["id"]
        level_ids = sorted(
            level_id for uid, level_id in submitted if uid == user_id
        )
        if "levelId" in user:
            level_ids = [
                user["levelId"]
            ] if (user_id, user["levelId"]) in submitted else []
        elif only_levels is not None:
            level_ids = [
                level_id for level_id in level_ids if level_id in only_levels
            ]
        for level_id in level_ids:
            attempts = submitted[(user_id, level_id)]
            if level_id.startswith("demo:"):
                record = _demo_record(level_id.removeprefix("demo:"), attempts)
            else:
                version = enrolled.get(
                    (user_id, level_id), latest.get(level_id)
                )
                spec = specs.get((level_id, version))
                if spec is None:
                    raise ValueError("关卡版本快照缺失，无法计算该关成绩")
                record = _circuit_record(spec, level_id, attempts)
            result.append({
                **record,
                "student": {
                    "id": user_id,
                    "username": user["username"],
                    "studentNo": user["studentNo"],
                    "displayName": user["displayName"],
                    "classId": user["classId"],
                    "className": user["className"],
                },
            })
    return result


def _student_row(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "studentNo": row["student_no"],
        "displayName": row["display_name"],
        "classId": row["class_id"],
        "className": row["class_name"],
    }


def _student_query(con, student_id):
    return con.execute(
        """SELECT u.id, u.username, u.student_no, u.display_name,
                  u.class_id, c.name AS class_name
           FROM users u
           LEFT JOIN classes c ON c.id = u.class_id
           WHERE u.id = ?""",
        (student_id,),
    ).fetchone()


def mine(path, user_id):
    """学生：只返回本人至少提交过一次的关卡成绩。"""
    with closing(db.connect(path)) as con:
        row = _student_query(con, user_id)
        if row is None:
            return {"results": []}
        records = summaries(con, [_student_row(row)])
        return {
            "results": [
                {
                    key: value for key, value in record.items()
                    if key not in ("student", "completionRate", "bestAttemptId")
                }
                for record in records
            ]
        }


def for_student(con, student_id):
    """教师学生详情页：返回该学生可展示的成绩摘要。"""
    row = _student_query(con, student_id)
    if row is None:
        return []
    return [
        {
            key: value for key, value in record.items()
            if key != "student"
        }
        for record in summaries(con, [_student_row(row)])
    ]


def teacher(path, actor, class_id=None, search="", page=1,
            page_size=20, all_rows=False):
    """教师：班级权限内已结算的成绩、分页及CSV共享同一数据来源。"""
    where, args = db.scoped_sql(
        actor, class_id, search, kind="students"
    )
    submitted_levels = """(
        SELECT user_id, level_id
        FROM circuit_level_attempts
        WHERE score_id IS NOT NULL
        GROUP BY user_id, level_id

        UNION
        SELECT s.user_id, ('demo:' || s.chapter_id) AS level_id
        FROM scores s
        WHERE NOT EXISTS (
            SELECT 1 FROM circuit_level_attempts ca
            WHERE ca.score_id = s.id
        )
        GROUP BY s.user_id, s.chapter_id
    )"""
    relation = f"""FROM users u
        LEFT JOIN classes c ON c.id = u.class_id
        JOIN {submitted_levels} submitted ON submitted.user_id = u.id
        WHERE {where}"""
    with closing(db.connect(path)) as con:
        total = con.execute(
            "SELECT COUNT(*) " + relation, args
        ).fetchone()[0]
        if all_rows and total > 10000:
            from circuit_engine import CircuitError

            raise CircuitError("EXPORT_LIMIT", "一次最多导出10000条", 413)
        query = f"""SELECT u.id, u.username, u.student_no,
                           u.display_name, u.class_id,
                           c.name AS class_name, submitted.level_id
                    {relation}
                    ORDER BY u.student_no, u.id, submitted.level_id"""
        params = list(args)
        if all_rows:
            query += " LIMIT 10001"
        else:
            query += " LIMIT ? OFFSET ?"
            params.extend((page_size, (page - 1) * page_size))
        students = []
        for row in con.execute(query, params):
            student = _student_row(row)
            student["levelId"] = row["level_id"]
            students.append(student)

        data = summaries(con, students)

    return {
        "results": data,
        "pagination": {
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": (total + page_size - 1) // page_size,
        },
    }
