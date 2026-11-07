#!/usr/bin/env python3
"""应用入口：静态资源、身份认证、教学管理与数字电路 HTTP API。"""
import argparse
import base64
import binascii
import csv
import getpass
import io
import json
import os
import re
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import closing
from urllib.parse import parse_qs, unquote, urlsplit

from chapters import BY_ID, CHAPTERS
import database as db
import management as m
from roster import make_csv, parse_roster
import circuit_engine as ce
import circuit_service as circuits
import circuit_results as cr
import level_content as lc
from quest_model import validate_quest_state

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DEFAULT_DB = ROOT / "game.sqlite3"
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_SAVE_BYTES = 4 * 1024 * 1024
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain; charset=utf-8",
}
ATTEMPT_ID = re.compile(r"^[a-zA-Z0-9._:-]{8,80}$")


class ApiError(Exception):
    def __init__(self, status, code, message, extra=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


def require_chapter(chapter_id):
    if chapter_id not in BY_ID:
        raise ApiError(404, "NOT_FOUND", "章节不存在")
    return BY_ID[chapter_id]


def int_arg(text, name, minimum, maximum, default=None):
    if text is None:
        if default is not None:
            return default
        raise ApiError(400, "INVALID_INPUT", f"{name}不能为空")
    if isinstance(text, bool):
        raise ApiError(400, "INVALID_INPUT", f"{name}应为整数")
    try:
        value = int(text)
    except (TypeError, ValueError):
        raise ApiError(400, "INVALID_INPUT", f"{name}应为整数")
    if isinstance(text, str) and str(value) != text.strip():
        raise ApiError(400, "INVALID_INPUT", f"{name}格式错误")
    if not minimum <= value <= maximum:
        raise ApiError(400, "INVALID_INPUT", f"{name}必须在{minimum}-{maximum}之间")
    return value


def safe_csv_score_item(item):
    details = item["details"]
    student = item["student"]
    return [
        student["displayName"], student["studentNo"] or student["username"],
        student["className"] or "", item["chapterId"],
        BY_ID.get(item["chapterId"], {}).get("title", ""),
        item["score"], 1 if item["completed"] else 0,
        details.get("attempts", ""), details.get("durationSeconds", ""),
        details.get("retries", ""), item["submittedAt"],
    ]


def make_handler(db_path):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Huaxia/1.2"

        def log_message(self, fmt, *args):
            if os.getenv("GAME_VERBOSE") == "1":
                super().log_message(fmt, *args)

        def do_GET(self):
            self.dispatch("GET")

        def do_HEAD(self):
            self.dispatch("HEAD")

        def do_POST(self):
            self.dispatch("POST")

        def do_PUT(self):
            self.dispatch("PUT")

        def dispatch(self, method):
            try:
                url = urlsplit(self.path)
                path = unquote(url.path)
                if path.startswith("/api/"):
                    if method == "HEAD":
                        raise ApiError(405, "METHOD_NOT_ALLOWED", "API不支持HEAD")
                    self.api(method, path, parse_qs(url.query, keep_blank_values=True))
                elif method in ("GET", "HEAD"):
                    self.static(path, head_only=(method == "HEAD"))
                else:
                    raise ApiError(405, "METHOD_NOT_ALLOWED", "不支持此请求方法")
            except (ApiError, m.ManagementError, ce.CircuitError) as error:
                self.reply_json(error.status, {
                    "code": error.code, "error": error.message,
                    **getattr(error, "extra", {}),
                })
            except (ConnectionResetError, BrokenPipeError):
                return
            except Exception:
                traceback.print_exc()
                self.reply_json(500, {
                    "code": "INTERNAL_ERROR",
                    "error": "服务器内部错误",
                })

        def bytes(self, status, value, mime, head_only=False, more=None):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(value)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; connect-src 'self'; "
                 "style-src 'self'; img-src 'self' data:; font-src 'self'; "
                "object-src 'none'; base-uri 'none'"
            )
            if more:
                for key, item in more.items():
                    self.send_header(key, item)
            self.end_headers()
            if not head_only:
                self.wfile.write(value)

        def reply_json(self, status, payload):
            self.bytes(
                status, json.dumps(payload, ensure_ascii=False,
                                   separators=(",", ":")).encode("utf-8"),
                "application/json; charset=utf-8"
            )

        def json_input(self):
            ctype = self.headers.get("Content-Type", "")
            if not ctype.lower().startswith("application/json"):
                raise ApiError(415, "UNSUPPORTED_MEDIA", "需要application/json")
            try:
                size = int(self.headers.get("Content-Length", ""))
            except ValueError:
                raise ApiError(411, "LENGTH_REQUIRED", "缺少Content-Length")
            if not 0 <= size <= MAX_BODY_BYTES:
                raise ApiError(413, "BODY_TOO_LARGE", "请求体不能超过8MiB")
            try:
                value = json.loads(self.rfile.read(size).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ApiError(400, "INVALID_JSON", "无效JSON")
            if not isinstance(value, dict):
                raise ApiError(400, "INVALID_INPUT", "请求必须是JSON对象")
            return value

        def access_token(self):
            value = self.headers.get("Authorization", "")
            if not value.startswith("Bearer "):
                raise ApiError(401, "UNAUTHORIZED", "请先登录")
            return value[7:].strip()

        def current_user(self):
            user = db.get_user(db_path, self.access_token())
            if user is None:
                raise ApiError(401, "UNAUTHORIZED", "登录过期，请重新登录")
            return user

        def staff(self, user):
            if user["role"] not in ("teacher", "admin"):
                raise ApiError(403, "FORBIDDEN", "需要教师或管理员权限")

        def student(self, user):
            if user["role"] != "student":
                raise ApiError(403, "FORBIDDEN", "仅学生账号可以体验关卡")

        def admin(self, user):
            if user["role"] != "admin":
                raise ApiError(403, "FORBIDDEN", "仅管理员可操作")

        def api(self, method, path, query):
            if method == "GET" and path == "/api/health":
                return self.reply_json(200, {"status": "ok", "version": "1.2"})

            if method == "POST" and path == "/api/auth/register":
                body = self.json_input()
                try:
                    db.create_user(
                        db_path, body.get("username"), body.get("password"),
                        body.get("displayName"), role="student"
                    )
                except ValueError as error:
                    code = "USERNAME_EXISTS" if "已存在" in str(error) else "INVALID_INPUT"
                    raise ApiError(409 if code == "USERNAME_EXISTS" else 400, code, str(error))
                return self.reply_json(201, db.login(
                    db_path, body["username"], body["password"]
                ))

            if method == "POST" and path == "/api/auth/login":
                body = self.json_input()
                data = db.login(db_path, body.get("username"), body.get("password"))
                if data is None:
                    raise ApiError(401, "BAD_CREDENTIALS", "账号或密码错误")
                return self.reply_json(200, data)

            if method == "POST" and path == "/api/auth/setup-password":
                body = self.json_input()
                try:
                    result = db.setup_password(
                        db_path, body.get("setupToken"), body.get("newPassword")
                    )
                except ValueError as error:
                    raise ApiError(400, "INVALID_SETUP", str(error))
                return self.reply_json(200, result)

            user = self.current_user()

            if method == "GET" and path == "/api/auth/me":
                return self.reply_json(200, {"user": user})
            if method == "POST" and path == "/api/auth/logout":
                db.logout(db_path, self.access_token())
                return self.reply_json(200, {"ok": True})
            if user["needsPasswordSetup"]:
                raise ApiError(403, "PASSWORD_SETUP_REQUIRED", "学生需要先设置登录密码")

            # Official circuit lessons: hidden tests are never serialized.
            if method == "GET" and path == "/api/levels":
                self.student(user)
                return self.reply_json(200, circuits.get_levels(db_path,user["id"]))

            match = re.fullmatch(r"/api/levels/(ch[1-4]_[a-z0-9_]+)",path)
            if method == "GET" and match:
                self.student(user)
                return self.reply_json(200,
                    circuits.get_level(db_path,user["id"],match.group(1)))

            if method == "GET" and path == "/api/circuit/results/mine":
                self.student(user)
                return self.reply_json(200, cr.mine(db_path,user["id"]))

            if method == "GET" and path == "/api/circuit/components":
                self.student(user)
                return self.reply_json(200,
                    circuits.get_registry(db_path,user["id"]))

            match=re.fullmatch(
                r"/api/circuit/components/([a-z][a-z0-9_]{1,39})/([1-9][0-9]{0,6})",
                path)
            if method == "GET" and match:
                self.student(user)
                return self.reply_json(200,circuits.get_component(
                    db_path,user["id"],match.group(1),int(match.group(2))))

            match=re.fullmatch(
                r"/api/levels/(ch[1-4]_[a-z0-9_]+)/(simulate|submit|attempts/start)",
                path)
            if method == "POST" and match:
                self.student(user)
                level_id,action=match.group(1),match.group(2)
                body=self.json_input()
                if action == "simulate":
                    return self.reply_json(200,circuits.simulate_live(
                        db_path,user["id"],level_id,body))
                if action == "attempts/start":
                    return self.reply_json(201,circuits.start_attempt(
                        db_path,user["id"],level_id,body.get("levelVersion")))
                graded=circuits.submit(db_path,user["id"],level_id,body)
                if graded.get("completed"):
                    db.award_level_reward(db_path,user["id"],level_id.split("_")[0],level_id)
                return self.reply_json(201 if graded["created"] else 200,graded)

            if method == "GET" and path == "/api/game/profile":
                self.student(user)
                return self.reply_json(200, db.game_profile(db_path, user["id"]))

            if method == "GET" and path == "/api/chapters":
                # Teachers may read chapter names for their student filters,
                # but cannot enter chapters or create personal game results.
                student_account = user["role"] == "student"
                status = db.score_status(db_path, user["id"]) if student_account else {}
                return self.reply_json(200, {"chapters": [
                    {
                        **chapter,
                        "canEnter": student_account and chapter["implemented"],
                        "completed": status.get(chapter["id"], {}).get("completed", False),
                        "bestScore": status.get(chapter["id"], {}).get("bestScore"),
                    }
                    for chapter in CHAPTERS
                ]})

            if method == "GET" and path == "/api/progress":
                self.student(user)
                saved=db.list_progress(db_path,user["id"])
                with closing(db.connect(db_path)) as con:
                    for record in saved:
                        lc.validate_circuit_save(
                            con,user["id"],record["chapterId"],record["state"])
                return self.reply_json(200, {"progress":saved})

            if method == "PUT" and path.startswith("/api/progress/"):
                self.student(user)
                chapter_id = path.removeprefix("/api/progress/")
                require_chapter(chapter_id)
                body = self.json_input()
                checkpoint = body.get("checkpoint")
                state = body.get("state")
                expected = body.get("expectedRevision")
                if not isinstance(checkpoint, str) or not 1 <= len(checkpoint) <= 100:
                    raise ApiError(400, "INVALID_INPUT", "checkpoint需为1-100位字符串")
                if not isinstance(state, dict):
                    raise ApiError(400, "INVALID_INPUT", "state必须是JSON对象")
                if type(expected) is not int or not 0 <= expected <= 1000000000:
                    raise ApiError(400, "INVALID_INPUT", "expectedRevision需为非负整数")
                if len(json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_SAVE_BYTES:
                    raise ApiError(413, "SAVE_TOO_LARGE", "单章存档最大4MiB")
                try:
                    validate_quest_state(require_chapter(chapter_id), state)
                except ValueError as error:
                    raise ApiError(400, "INVALID_TASK_STATE", str(error)) from error
                with closing(db.connect(db_path)) as con:
                    lc.validate_circuit_save(con,user["id"],chapter_id,state)
                try:
                    record, revision = db.save_progress(
                        db_path, user["id"], chapter_id, checkpoint, state, expected
                    )
                except ValueError as error:
                    raise ApiError(409, "INVALID_TASK_TRANSITION", str(error)) from error
                if record is None:
                    raise ApiError(409, "REVISION_CONFLICT", "存档已在另一页面更新", {
                        "currentRevision": revision
                    })
                return self.reply_json(200, {"progress": record})

            if method == "POST" and re.fullmatch(r"/api/chapters/[^/]+/attempts/start", path):
                self.student(user)
                chapter_id = path.split("/")[3]
                chapter = require_chapter(chapter_id)
                if not chapter["implemented"]:
                    raise ApiError(409, "CHAPTER_NOT_IMPLEMENTED", "本章尚未开发，不能开始正式关卡")
                self.json_input()  # 要求JSON对象，可为{}
                try:
                    attempt = db.start_attempt(db_path, user["id"], chapter_id)
                except ValueError as error:
                    raise ApiError(409, "LEVEL_NOT_READY", str(error))
                return self.reply_json(201, attempt)

            if method == "POST" and path == "/api/scores":
                self.student(user)
                body = self.json_input()
                chapter_id = body.get("chapterId")
                chapter = require_chapter(chapter_id)
                if not chapter["implemented"]:
                    raise ApiError(409, "CHAPTER_NOT_IMPLEMENTED", "尚未开发章节不允许提交成绩")
                score = body.get("score")
                completed = body.get("completed")
                details = body.get("details", {})
                attempt_id = body.get("attemptId")
                if type(score) is not int or not 0 <= score <= 100:
                    raise ApiError(400, "INVALID_INPUT", "score需为0-100整数")
                if type(completed) is not bool:
                    raise ApiError(400, "INVALID_INPUT", "completed必须是布尔值")
                if not isinstance(details, dict):
                    raise ApiError(400, "INVALID_INPUT", "details必须是JSON对象")
                if not isinstance(attempt_id, str) or not ATTEMPT_ID.fullmatch(attempt_id):
                    raise ApiError(400, "INVALID_INPUT", "attemptId格式不合法")
                # 演示成绩和正式电路提交独立，正式尝试只能由服务端判题结算。
                with closing(db.connect(db_path)) as con:
                    official=con.execute(
                        "SELECT 1 FROM circuit_level_attempts WHERE attempt_id=?",
                        (attempt_id,)).fetchone()
                if official:
                    raise ApiError(403,"CLIENT_SCORE_FORBIDDEN",
                        "正式电路关卡成绩由后端计算，不接受客户端自报分数")
                reserved={"assessmentType","levelId","levelVersion",
                          "awardedPackage","graphDigest","passedCount",
                          "totalCount","unit","weightedPassRate","efficient"}
                raw_details=details
                details={k:v for k,v in raw_details.items() if k not in reserved}
                details["assessmentType"]="legacy_demo"
                # 仅保留符合演示协议的测试组字段，不允许伪造正式评测成绩。
                passed=raw_details.get("passedCount")
                total=raw_details.get("totalCount")
                unit=raw_details.get("unit")
                is_demo_metric=(chapter_id=="ch1" and score==0
                                and raw_details.get("mock") is True
                                and ("passedCount" in raw_details
                                     or "totalCount" in raw_details))
                if is_demo_metric:
                    if (type(passed) is not int or type(total) is not int
                        or not 0<=passed<=total<=64 or total==0
                        or unit not in ("组","步")
                        or completed!=(passed==total)):
                        raise ApiError(400,"INVALID_DEMO_GROUPS",
                                       "演示成绩通过组数、总组数或完成状态不一致")
                    details.update({"passedCount":passed,"totalCount":total,
                                    "unit":unit})
                elif raw_details.get("unit") in ("组","步"):
                    # 无完整组数字段时，仅保留可展示的单位信息。
                    details["unit"]=raw_details["unit"]
                # 已入库的相同尝试沿用原始详情，保证重复提交幂等。
                with closing(db.connect(db_path)) as con:
                    previous=con.execute(
                        """SELECT details_json FROM scores
                           WHERE user_id=? AND attempt_id=?""",
                        (user["id"],attempt_id)).fetchone()
                if previous and "passedCount" in details:
                    old_details=json.loads(previous["details_json"])
                    without_counts={k:v for k,v in details.items()
                                    if k not in ("passedCount","totalCount")}
                    if (old_details.get("assessmentType")=="legacy_demo"
                        and "passedCount" not in old_details
                        and without_counts==old_details):
                        details=old_details
                try:
                    record, inserted = db.add_score(
                        db_path, user["id"], chapter_id, score, completed, details, attempt_id
                    )
                except ValueError as error:
                    raise ApiError(409, "ATTEMPT_NOT_STARTED", str(error))
                if record is None:
                    raise ApiError(409, "ATTEMPT_CONFLICT", "重复attemptId的数据不一致")
                return self.reply_json(201 if inserted else 200, {
                    "score": record, "created": inserted
                })

            if method == "GET" and path == "/api/scores/mine":
                self.student(user)
                return self.reply_json(200, {
                    "scores": db.my_scores(db_path, user["id"])
                })

            if (path.startswith("/api/admin/") or
                path.startswith("/api/teacher/") or
                path.startswith("/api/classes/") or path == "/api/classes"):
                return self.management(method, path, query, user)

            raise ApiError(404, "NOT_FOUND", "接口不存在")


        def management(self, method, path, query, actor):
            """管理读写接口：仅停用及班级归档强制额外确认；所有写入审计。"""
            def query_val(key, default=""):
                return query.get(key, [default])[0]

            def page_args():
                return (
                    int_arg(query_val("page", "1"), "page", 1, 100000),
                    int_arg(query_val("pageSize", "20"), "pageSize", 1, 100),
                )

            def optional_class():
                raw = query_val("classId", "")
                return int_arg(raw, "classId", 1, 100000000) if raw else None

            def is_admin():
                if actor["role"] != "admin":
                    if method == "POST":
                        m.record_management_failure(
                            db_path, actor, "access.denied", "forbidden",
                            "仅管理员可以访问"
                        )
                    raise m.ManagementError(403, "FORBIDDEN", "仅管理员可以访问")

            def is_teacher():
                if actor["role"] != "teacher":
                    if method == "POST":
                        m.record_management_failure(
                            db_path, actor, "access.denied", "forbidden",
                            "仅教师可以访问"
                        )
                    raise m.ManagementError(403, "FORBIDDEN", "仅教师可以访问")

            def management_input(confirm_required=False):
                body = self.json_input()
                if confirm_required and body.get("confirm") is not True:
                    raise ApiError(428, "CONFIRM_REQUIRED", "请先确认停用或归档操作")
                return body

            def execute(action, payload, status=200):
                return self.reply_json(status, {
                    "result": m.mutate(db_path, actor, action, payload)
                })

            if method == "GET" and path == "/api/classes":
                return self.reply_json(200, {"classes": db.list_classes(db_path, actor)})

            # 管理员总览只返回六类数量，无学生个人成绩。
            if method == "GET" and path == "/api/admin/overview":
                is_admin()
                return self.reply_json(200, {"overview": m.overview(db_path)})

            if method == "GET" and path == "/api/admin/classes":
                is_admin()
                archive = query_val("archived", "0") == "1"
                return self.reply_json(200, {"classes": m.admin_classes(db_path, archive)})

            if method == "GET" and path == "/api/admin/teachers":
                is_admin()
                page, size = page_args()
                active = query_val("active", "1") != "0"
                return self.reply_json(200, m.admin_users(
                    db_path, "teachers", active, query_val("q"), page, size
                ))

            if method == "GET" and path == "/api/admin/students":
                is_admin()
                page, size = page_args()
                active = query_val("active", "1") != "0"
                return self.reply_json(200, m.admin_users(
                    db_path, "students", active, query_val("q"), page, size
                ))

            match = re.fullmatch(r"/api/admin/classes/([0-9]+)/available-teachers", path)
            if method == "GET" and match:
                # 可选的未分配在职教师查询接口。
                is_admin()
                page, size = page_args()
                return self.reply_json(200, m.available_teachers(
                    db_path, int_arg(match.group(1), "classId", 1, 100000000),
                    query_val("q"), page, size
                ))

            match = re.fullmatch(r"/api/admin/classes/([0-9]+)/teacher-directory", path)
            if method == "GET" and match:
                is_admin()
                page, size = page_args()
                return self.reply_json(200, m.teacher_directory(
                    db_path, int_arg(match.group(1), "classId", 1, 100000000),
                    query_val("q"), page, size
                ))

            match = re.fullmatch(r"/api/admin/students/([0-9]+)", path)
            if method == "GET" and match:
                is_admin()
                return self.reply_json(200, m.admin_student_detail(
                    db_path, int_arg(match.group(1), "studentId", 1, 100000000)
                ))

            match = re.fullmatch(r"/api/admin/classes/([0-9]+)", path)
            if method == "GET" and match:
                is_admin()
                page, size = page_args()
                return self.reply_json(200, m.admin_class_detail(
                    db_path, int_arg(match.group(1), "classId", 1, 100000000), page, size
                ))

            if method == "GET" and path in ("/api/admin/logs", "/api/teacher/logs"):
                is_admin() if path.startswith("/api/admin") else is_teacher()
                page, size = page_args()
                start, end = query_val("from"), query_val("to")
                for raw, label in ((start, "起始日期"), (end, "结束日期")):
                    if raw:
                        try:
                            from datetime import date
                            date.fromisoformat(raw)
                        except ValueError:
                            raise ApiError(400, "INVALID_DATE", label + "格式需为YYYY-MM-DD")
                if start and end and start > end:
                    raise ApiError(400, "INVALID_DATE", "起始日期不能晚于结束日期")
                return self.reply_json(200, m.audit_list(
                    db_path, actor, page, size, query_val("actor"),
                    optional_class(), start or None, end or None
                ))

            if method == "GET" and path == "/api/teacher/students":
                is_teacher()
                page, size = page_args()
                return self.reply_json(200, m.teacher_students(
                    db_path, actor, optional_class(), query_val("q"),
                    status=query_val("status", "all"),
                    chapter_id=query_val("chapterId") or None,
                    page=page, page_size=size
                ))

            if method == "GET" and path == "/api/teacher/students.csv":
                is_teacher()
                page, size = page_args()
                output = m.export_teacher_student_csv(
                    db_path, actor, class_id=optional_class(),
                    # Student name/number search affects the on-screen list
                    # only. CSV always exports class + chapter/status filters.
                    query="", status=query_val("status", "all"),
                    chapter_id=query_val("chapterId") or None,
                    page=page, page_size=size
                )
                return self.bytes(
                    200, output, "text/csv; charset=utf-8",
                    more={"Content-Disposition": 'attachment; filename="students.csv"'}
                )

            match = re.fullmatch(r"/api/teacher/students/([0-9]+)", path)
            if method == "GET" and match:
                is_teacher()
                return self.reply_json(200, m.teacher_student_detail(
                    db_path, actor, int_arg(match.group(1), "studentId", 1, 100000000)
                ))

            if method == "GET" and path == "/api/teacher/circuit-results":
                is_teacher()
                page,size=page_args()
                target=optional_class()
                if target is not None:
                    with closing(db.connect(db_path)) as con:
                        m.scoped_teacher(con,actor,target)
                return self.reply_json(200,cr.teacher(
                    db_path,actor,target,query_val("q"),page,size))

            if method == "GET" and path == "/api/teacher/circuit-results.csv":
                is_teacher()
                target=optional_class()
                if target is not None:
                    with closing(db.connect(db_path)) as con:
                        m.scoped_teacher(con,actor,target)
                page_args()
                data=cr.teacher(db_path,actor,target,query_val("q"),all_rows=True)
                if data["pagination"]["total"]>10000:
                    raise ApiError(413,"EXPORT_LIMIT","一次最多导出10000条")
                rows=[]
                for item in data["results"]:
                    student=item["student"]
                    rows.append([
                        student["displayName"],student["studentNo"] or student["username"],
                        student["className"] or "",item["chapterId"],item["levelTitle"],
                        item["status"],
                        (item["bestPassedCount"] if item["bestPassedCount"] is not None
                         else "旧版演示未记录组数"),
                        (item["totalCount"] if item["totalCount"] is not None
                         else "旧版演示未记录组数"),
                        item["unit"],item["submissionCount"],item["completedAt"] or "",
                        (f'{item["completionRate"]:g}%'
                         if item["completionRate"] is not None else "不适用（旧演示）"),
                    ])
                return self.bytes(
                    200,make_csv([
                        "student_name","student_no","class_name","chapter_id",
                        "level_title","status","best_passed","total_groups",
                        "unit","submissions","completed_at","completion_rate",
                    ],rows,text_cols={0,1,2,3,4}),
                    "text/csv; charset=utf-8",
                    more={"Content-Disposition":'attachment; filename="scores.csv"'})

            if method == "GET" and path == "/api/teacher/scores":
                is_teacher()
                page, size = page_args()
                return self.reply_json(200, m.teacher_scores(
                    db_path, actor, optional_class(), query_val("q"), page, size
                ))

            if method == "GET" and path == "/api/teacher/progress":
                is_teacher()
                page, size = page_args()
                if optional_class() is not None:
                    # Explicit unauthorized class filter must be rejected, not silently empty.
                    with closing(db.connect(db_path)) as con:
                        m.scoped_teacher(con, actor, optional_class())
                response = db.scoped_records(
                    db_path, actor, "progress", optional_class(),
                    query_val("q"), page, size
                )
                for item in response["items"]:
                    item["chapterTitle"] = BY_ID.get(item["chapterId"], {}).get("title", "")
                return self.reply_json(200, {
                    "progress": response["items"],
                    "pagination": {key: response[key] for key in
                                   ("total", "page", "pageSize", "totalPages")}
                })

            if method == "GET" and path == "/api/teacher/scores.csv":
                is_teacher()
                _, _ = page_args()
                if optional_class() is not None:
                    with closing(db.connect(db_path)) as con:
                        m.scoped_teacher(con, actor, optional_class())
                response = db.scoped_records(
                    db_path, actor, "scores", optional_class(), query_val("q"),
                    all_rows=True
                )
                if len(response["items"]) > 10000:
                    raise ApiError(413, "EXPORT_LIMIT", "一次最多导出10000条")
                rows = [safe_csv_score_item(item) for item in response["items"]]
                return self.bytes(
                    200, make_csv(
                        ["student_name","student_no","class_name","chapter_id",
                         "chapter_title","score","completed","attempts",
                         "duration_seconds","retries","submitted_at"], rows),
                    "text/csv; charset=utf-8",
                    more={"Content-Disposition": 'attachment; filename="scores.csv"'}
                )

            # 不改变数据的名单预览可以在确认前执行。
            match = re.fullmatch(r"/api/classes/([0-9]+)/students/import", path)
            if method == "POST" and match:
                class_id = int_arg(match.group(1), "classId", 1, 100000000)
                body = self.json_input()
                if actor["role"] not in ("admin", "teacher") and body.get("dryRun") is False:
                    m.record_management_failure(
                        db_path, actor, "access.denied", "forbidden",
                        "无导入学生的管理权限"
                    )
                self.staff(actor)
                with closing(db.connect(db_path)) as con:
                    if actor["role"] == "teacher":
                        m.scoped_teacher(con, actor, class_id)
                    else:
                        m.row_class(con, class_id)
                encoded = body.get("contentBase64")
                if not isinstance(encoded, str):
                    raise ApiError(400, "INVALID_INPUT", "缺少contentBase64")
                try:
                    raw = base64.b64decode(encoded, validate=True)
                    rows = parse_roster(body.get("filename"), raw)
                except (binascii.Error, ValueError) as error:
                    raise ApiError(400, "INVALID_INPUT", str(error))
                if body.get("dryRun", True) is True:
                    preview = m.preview_import(db_path, actor, class_id, rows)
                    if not preview["valid"]:
                        return self.reply_json(422, preview)
                    return self.reply_json(200, preview)
                if body.get("dryRun") is not False:
                    raise ApiError(400, "INVALID_INPUT", "dryRun必须为布尔值")
                result = m.mutate(
                    db_path, actor, "students.import", {"classId": class_id, "rows": rows}
                )
                return self.reply_json(201, result)

            if method == "POST" and path == "/api/admin/classes":
                is_admin()
                return execute("classes.create", management_input(), 201)
            if method == "POST" and path == "/api/admin/teachers":
                is_admin()
                return execute("teachers.create", management_input(), 201)

            match = re.fullmatch(
                r"/api/admin/classes/([0-9]+)/(rename|archive|restore|delete-empty)", path
            )
            if method == "POST" and match:
                is_admin()
                payload = management_input(match.group(2) == "archive")
                payload["classId"] = int(match.group(1))
                return execute("classes." + match.group(2).replace("-", "_"), payload)

            match = re.fullmatch(r"/api/admin/classes/([0-9]+)/teachers", path)
            if method == "POST" and match:
                is_admin()
                payload = management_input()
                payload["classId"] = int(match.group(1))
                return execute("teacher_classes.assign", payload)

            match = re.fullmatch(
                r"/api/admin/classes/([0-9]+)/teachers/([0-9]+)/remove", path
            )
            if method == "POST" and match:
                is_admin()
                payload = management_input()
                payload["classId"] = int(match.group(1))
                payload["teacherId"] = int(match.group(2))
                return execute("teacher_classes.remove", payload)

            match = re.fullmatch(
                r"/api/admin/teachers/([0-9]+)/(disable|enable|reset-password)", path
            )
            if method == "POST" and match:
                is_admin()
                payload = management_input(match.group(2) == "disable")
                payload["teacherId"] = int(match.group(1))
                verb = "password_reset" if match.group(2) == "reset-password" else match.group(2)
                return execute("teachers." + verb, payload)

            match = re.fullmatch(
                r"/api/admin/students/([0-9]+)/(move|correct|update-no|update-name|disable|enable|delete-error)", path
            )
            if method == "POST" and match:
                is_admin()
                payload = management_input(match.group(2) == "disable")
                payload["studentId"] = int(match.group(1))
                action = {
                    "move": "students.admin_move",
                    "correct": "students.admin_correct",
                    "update-no": "students.admin_update_no",
                    "update-name": "students.admin_update_name",
                    "disable": "students.disable",
                    "enable": "students.enable",
                    "delete-error": "students.delete_error",
                }[match.group(2)]
                return execute(action, payload)

            match = re.fullmatch(
                r"/api/teacher/students/([0-9]+)/(remove|transfer|reset-password)", path
            )
            if method == "POST" and match:
                is_teacher()
                payload = management_input()
                payload["studentId"] = int(match.group(1))
                action = {
                    "remove": "students.teacher_remove",
                    "transfer": "students.teacher_transfer",
                    "reset-password": "students.password_reset",
                }[match.group(2)]
                return execute(action, payload)

            match = re.fullmatch(r"/api/teacher/classes/([0-9]+)/leave", path)
            if method == "POST" and match:
                is_teacher()
                payload = management_input()
                payload["classId"] = int(match.group(1))
                return execute("teacher_classes.leave", payload)

            raise ApiError(404, "NOT_FOUND", "管理接口不存在")
        def static(self, path, head_only=False):
            if "\x00" in path or "\\" in path:
                raise ApiError(404, "NOT_FOUND", "资源不存在")
            relative = path.lstrip("/") or "index.html"
            target = (PUBLIC / relative).resolve()
            if not target.is_relative_to(PUBLIC.resolve()) or not target.is_file():
                raise ApiError(404, "NOT_FOUND", "资源不存在")
            mime = MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")
            return self.bytes(200, target.read_bytes(), mime, head_only)

    return Handler


class GameHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
    allow_reuse_address = True


def create_server(host="127.0.0.1", port=8765, db_path=None):
    db_path = Path(db_path or os.getenv("GAME_DB", DEFAULT_DB)).resolve()
    db.init(db_path)
    lc.publish(db_path)  # Freeze versioned hidden tests before accepting traffic.
    return GameHTTPServer((host, port), make_handler(db_path))


def main():
    parser = argparse.ArgumentParser(description="铸算·华夏纪 · 教学游戏与数字电路服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", default=os.getenv("GAME_DB", str(DEFAULT_DB)))
    parser.add_argument("--init-admin", action="store_true", help="创建管理员账号")
    parser.add_argument("--init-teacher", action="store_true", help="本地命令创建教师账号")
    args = parser.parse_args()
    if args.init_admin or args.init_teacher:
        db.init(args.db)
        kind = "管理员" if args.init_admin else "教师"
        print(f"创建{kind}账号：密码输入不可见是正常现象。")
        username = input("账号：").strip()
        display = input("姓名/显示名：").strip()
        password = getpass.getpass("密码（至少8位）：")
        repeat = getpass.getpass("再次输入密码：")
        if password != repeat:
            sys.exit("两次密码不一致")
        try:
            result = db.create_user(
                args.db, username, password, display,
                role="teacher", is_admin=args.init_admin
            )
        except ValueError as error:
            sys.exit(str(error))
        print(f"{kind}账号已创建：{result['username']}")
        return

    server = create_server(args.host, args.port, args.db)
    print(f"打开 http://{args.host}:{server.server_address[1]}/")
    print(f"数据库：{Path(args.db).resolve()}")
    print("仅供本地开发；勿直接对公网开放。按 Ctrl+C 退出。")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
