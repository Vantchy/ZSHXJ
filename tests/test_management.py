"""教学管理HTTP集成测试：班级、账号、权限、名单、成绩及审计日志。"""
import base64
import csv
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database as db
from server import create_server


class ManagementIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.tmp.name) / "school.sqlite3"
        cls.server = create_server("127.0.0.1", 0, cls.path)
        cls.port = cls.server.server_address[1]
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        admin = db.create_user(cls.path, "school_admin", "AdminPass123",
                               "管理员", role="teacher", is_admin=True)
        cls.tokens = {}
        cls.tokens["admin"] = cls.login("school_admin", "AdminPass123")
        cls.admin_id = admin["id"]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=5)
        cls.tmp.cleanup()

    @classmethod
    def call(cls, method, path, body=None, as_user="admin", binary=False):
        url = f"http://127.0.0.1:{cls.port}{path}"
        headers = {}
        if as_user is not None:
            token = cls.tokens.get(as_user, as_user)
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            if binary:
                return response.status, raw, dict(response.headers)
            try:
                return response.status, json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return response.status, {"raw": raw.decode("utf-8", errors="replace")}

    @classmethod
    def login(cls, username, password):
        status, reply = cls.call("POST", "/api/auth/login",
                                 {"username": username, "password": password}, as_user=None)
        assert status == 200, (status, reply)
        return reply["token"]

    @classmethod
    def op(cls, path, data=None, user="admin", confirm=True):
        payload = dict(data or {})
        if confirm:
            payload["confirm"] = True
        return cls.call("POST", path, payload, as_user=user)

    def test_01_admin_overview_and_staff_setup(self):
        status, initial = self.call("GET", "/api/admin/overview")
        self.assertEqual(status, 200)
        self.assertEqual(initial["overview"], {
            "classes": 0, "archivedClasses": 0,
            "teachers": 0, "disabledTeachers": 0,
            "students": 0, "disabledStudents": 0,
        })
        # Creating a class no longer requires a secondary confirmation flag.
        status, made = self.op("/api/admin/classes", {"name": "教学一班"}, confirm=False)
        self.assertEqual(status, 201)
        self.__class__.class_a = made["result"]["id"]
        status, made = self.op("/api/admin/classes", {"name": "教学二班"})
        self.__class__.class_b = made["result"]["id"]
        status, made = self.op("/api/admin/classes", {"name": "预备空班"})
        self.__class__.class_empty = made["result"]["id"]
        for username, display in [("v4teacher1", "老师甲"), ("v4teacher2", "老师乙")]:
            status, made = self.op("/api/admin/teachers", {
                "username": username, "displayName": display, "password": "TeacherPass123"
            })
            self.assertEqual(status, 201)
            setattr(self.__class__, username, made["result"]["id"])
            self.tokens[username] = self.login(username, "TeacherPass123")
        for class_id, tid in [
            (self.class_a, self.v4teacher1),
            (self.class_b, self.v4teacher1),
            (self.class_b, self.v4teacher2),
        ]:
            status, link = self.op(f"/api/admin/classes/{class_id}/teachers",
                                    {"teacherId": tid})
            self.assertEqual(status, 200)
        status, overview = self.call("GET", "/api/admin/overview")
        self.assertEqual(overview["overview"]["teachers"], 2)
        self.assertEqual(overview["overview"]["classes"], 3)
        status, classes = self.call("GET", "/api/admin/classes")
        first = next(x for x in classes["classes"] if x["id"] == self.class_a)
        self.assertEqual(len(first["teachers"]), 1)
        status, no_grades = self.call("GET", "/api/teacher/scores")
        self.assertEqual(status, 403, "Admin must not see individual teacher grade endpoint")
        status, unauthorized = self.op(
            "/api/admin/classes", {"name":"窃权"}, user="v4teacher1"
        )
        self.assertEqual(status, 403)

    def test_01b_admin_assign_teacher_recovered(self):
        base = f"/api/admin/classes/{self.class_a}"
        status, teachers = self.call(
            "GET", base + "/available-teachers?page=1&pageSize=10"
        )
        self.assertEqual(status, 200)
        self.assertEqual([x["id"] for x in teachers["teachers"]], [self.v4teacher2])
        status, unauthorized = self.call(
            "GET", base + "/available-teachers", as_user="v4teacher1"
        )
        self.assertEqual(status, 403)

        status, made = self.op("/api/admin/teachers", {
            "username": "candidate_v4", "displayName": "候选教师",
            "password": "CandidatePass123"
        })
        self.assertEqual(status, 201)
        candidate_id = made["result"]["id"]

        status, first_page = self.call(
            "GET", base + "/available-teachers?page=1&pageSize=1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(first_page["pagination"]["total"], 2)
        self.assertEqual(first_page["pagination"]["totalPages"], 2)
        self.assertEqual(first_page["teachers"][0]["id"], self.v4teacher2)
        status, second_page = self.call(
            "GET", base + "/available-teachers?page=2&pageSize=1"
        )
        self.assertEqual(second_page["teachers"][0]["id"], candidate_id)
        status, searched = self.call(
            "GET", base + "/available-teachers?q=candidate"
        )
        self.assertEqual([x["id"] for x in searched["teachers"]], [candidate_id])
        status, assigned = self.op(
            base + "/teachers", {"teacherId": candidate_id}, confirm=False
        )
        self.assertEqual(status, 200)
        status, detail = self.call("GET", base)
        self.assertEqual(len(detail["teachers"]), 2)
        status, available = self.call("GET", base + "/available-teachers")
        self.assertNotIn(candidate_id, [x["id"] for x in available["teachers"]])
        status, duplicate = self.op(
            base + "/teachers", {"teacherId": candidate_id}
        )
        self.assertEqual(status, 409)
        status, removed = self.op(
            base + f"/teachers/{candidate_id}/remove"
        )
        self.assertEqual(status, 200)
        status, detail = self.call("GET", base)
        self.assertEqual(len(detail["teachers"]), 1)
        status, again = self.call("GET", base + "/available-teachers")
        self.assertIn(candidate_id, [x["id"] for x in again["teachers"]])
        status, logs = self.call("GET", "/api/admin/logs?pageSize=100")
        self.assertTrue(any(x["action"] == "teacher_classes.assign" and
                            x["targetId"] == f"{candidate_id}:{self.class_a}"
                            for x in logs["logs"]))

    def test_01c_teachers_only_use_chapter_metadata(self):
        """Teachers can filter by chapter, but cannot play or write game saves."""
        status, meta = self.call("GET", "/api/chapters", as_user="v4teacher1")
        self.assertEqual(status, 200)
        self.assertTrue(meta["chapters"])
        self.assertTrue(all(not ch["canEnter"] for ch in meta["chapters"]))
        self.assertTrue(all(ch["bestScore"] is None for ch in meta["chapters"]))
        status, admin_meta = self.call("GET", "/api/chapters", as_user="admin")
        self.assertEqual(status, 200)
        self.assertTrue(all(not ch["canEnter"] for ch in admin_meta["chapters"]))

        endpoints = [
            ("GET", "/api/progress", None),
            ("PUT", "/api/progress/ch1", {
                "checkpoint": "teacher_attempt", "state": {},
                "expectedRevision": 0,
            }),
            ("POST", "/api/chapters/ch1/attempts/start", {}),
            ("POST", "/api/scores", {
                "chapterId": "ch1", "score": 100,
                "completed": True, "attemptId": "made-up-attempt",
            }),
            ("GET", "/api/scores/mine", None),
        ]
        for method, url, body in endpoints:
            with self.subTest(method=method, endpoint=url):
                status, reply = self.call(
                    method, url, body, as_user="v4teacher1"
                )
                self.assertEqual(status, 403)
                self.assertEqual(reply["code"], "FORBIDDEN")

        status, classes = self.call("GET", "/api/classes", as_user="v4teacher1")
        self.assertEqual(status, 200)
        self.assertEqual(len(classes["classes"]), 2)
        status, students = self.call(
            "GET", "/api/teacher/students?status=not_started&chapterId=ch1",
            as_user="v4teacher1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(students["pagination"]["total"], 0)

    def test_01d_management_search_keeps_literal_wildcards(self):
        import urllib.parse

        # Underline belongs to the allowed teacher login alphabet.
        status, made = self.op("/api/admin/teachers", {
            "username": "teacher_search_42", "displayName": "教师_%标记",
            "password": "TeacherPass123",
        }, confirm=False)
        self.assertEqual(status, 201)
        candidate_id = made["result"]["id"]
        self.assertEqual(
            db.literal_like_contains("a_b%\\c"), "%a\\_b\\%\\\\c%"
        )

        def path(route, needle):
            return route + "?q=" + urllib.parse.quote(needle, safe="")
        status, matched = self.call("GET",
            path("/api/admin/teachers", "teacher_search_42"))
        self.assertEqual(status, 200)
        self.assertEqual([x["id"] for x in matched["items"]], [candidate_id])
        status, candidate = self.call("GET",path(
            f"/api/admin/classes/{self.class_a}/available-teachers",
            "teacher_search_42"))
        self.assertEqual(status, 200)
        self.assertEqual([x["id"] for x in candidate["teachers"]], [candidate_id])
        for needle in ("_", "%"):
            status, admin_results = self.call(
                "GET",path("/api/admin/teachers", needle))
            self.assertEqual(status, 200)
            self.assertIn(candidate_id, [x["id"] for x in admin_results["items"]])
            status, candidate_results = self.call("GET",path(
                f"/api/admin/classes/{self.class_a}/available-teachers",needle))
            self.assertEqual(status, 200)
            self.assertIn(candidate_id, [x["id"] for x in candidate_results["teachers"]])
            # A literal underscore must not match unrelated teacher accounts.
            if needle == "_":
                self.assertNotIn(self.v4teacher1,
                                 [x["id"] for x in admin_results["items"]])

    def test_01e_teacher_directory_includes_disabled_and_assigned(self):
        import urllib.parse

        # A disabled account must be visible in the class teacher directory,
        # even though the assignment writer must refuse it.
        status, made = self.op("/api/admin/teachers", {
            "username":"teacher_disabled_46", "displayName":"停用测试教师",
            "password":"TeacherPass123",
        },confirm=False)
        self.assertEqual(status,201)
        tid=made["result"]["id"]
        status, disabled = self.op(f"/api/admin/teachers/{tid}/disable")
        self.assertEqual(status,200)
        endpoint=f"/api/admin/classes/{self.class_a}/teacher-directory"
        status, listing = self.call("GET",endpoint+"?pageSize=100")
        self.assertEqual(status,200)
        rows={x["id"]:x for x in listing["teachers"]}
        self.assertIn(self.v4teacher1,rows)
        self.assertTrue(rows[self.v4teacher1]["assigned"])
        self.assertTrue(rows[self.v4teacher1]["active"])
        self.assertIn(tid,rows)
        self.assertFalse(rows[tid]["active"])
        self.assertFalse(rows[tid]["assigned"])
        status, illegal = self.op(
            f"/api/admin/classes/{self.class_a}/teachers",{"teacherId":tid}
        )
        self.assertEqual(status,409)
        self.assertEqual(illegal["code"],"TEACHER_DISABLED")
        status, duplicate = self.op(
            f"/api/admin/classes/{self.class_a}/teachers",
            {"teacherId":self.v4teacher1}
        )
        self.assertEqual(status,409)
        status, filtered = self.call(
            "GET",endpoint+"?q="+urllib.parse.quote("_disabled_",safe="")
        )
        self.assertEqual(status,200)
        self.assertEqual([x["id"] for x in filtered["teachers"]],[tid])
        status, paged = self.call("GET",endpoint+"?pageSize=1&page=1")
        self.assertEqual(status,200)
        self.assertEqual(len(paged["teachers"]),1)
        self.assertGreater(paged["pagination"]["total"],1)
        status, denied = self.call("GET",endpoint,as_user="v4teacher1")
        self.assertEqual(status,403)
        # The old candidate-only endpoint remains available to old clients.
        status, available = self.call("GET",
            f"/api/admin/classes/{self.class_a}/available-teachers")
        self.assertEqual(status,200)
        self.assertNotIn(tid,[x["id"] for x in available["teachers"]])
        status, _ = self.op(f"/api/admin/teachers/{tid}/enable")
        self.assertEqual(status,200)

    def test_02_roster_import_and_initial_setup(self):
        rows = [("90000000" + str(i).zfill(2), f"同学{i}") for i in range(1, 13)]
        self.__class__.student_ids = [x[0] for x in rows]
        source = io.StringIO(newline="")
        writer = csv.writer(source)
        writer.writerow(["学号", "姓名"])
        writer.writerows(rows)
        payload = {
            "filename": "roster.csv",
            "contentBase64": base64.b64encode(source.getvalue().encode("utf-8")).decode(),
        }
        self.__class__.roster = payload
        endpoint = f"/api/classes/{self.class_a}/students/import"
        status, preview = self.call("POST", endpoint, {**payload, "dryRun": True},
                                    as_user="v4teacher1")
        self.assertEqual(status, 200)
        self.assertEqual(preview["created"], 0)
        self.assertEqual(preview["count"], 12)
        status, commit = self.call("POST", endpoint,
            {**payload, "dryRun": False}, as_user="v4teacher1")
        self.assertEqual(status, 201)
        self.assertEqual(commit["created"], 12)
        status, duplicate = self.call("POST", endpoint,
            {**payload, "dryRun": False, "confirm": True}, as_user="v4teacher1")
        self.assertEqual(status, 422)
        status, counts = self.call("GET", "/api/admin/classes")
        first = next(x for x in counts["classes"] if x["id"] == self.class_a)
        self.assertEqual(first["studentCount"], 12)
        self.assertEqual(first["unsetPasswordCount"], 12)
        status, adminStudents = self.call("GET",
            "/api/admin/students?page=1&pageSize=5")
        self.assertEqual(adminStudents["pagination"]["total"], 12)
        self.assertEqual(len(adminStudents["items"]), 5)
        students = adminStudents["items"]
        self.__class__.student_one_dbid = next(x["id"] for x in students
            if x["username"] == self.student_ids[0]) if any(
                x["username"] == self.student_ids[0] for x in students) else None

        status, pending = self.call("POST", "/api/auth/login",
                                   {"username": self.student_ids[0]}, as_user=None)
        self.assertEqual(status, 200)
        self.assertTrue(pending["setupRequired"])
        status, setup = self.call("POST", "/api/auth/setup-password",
            {"setupToken": pending["setupToken"], "newPassword": "StudPass123"}, as_user=None)
        self.assertEqual(status, 200)
        self.tokens["student1"] = setup["token"]
        self.__class__.student_one_dbid = setup["user"]["id"]
        status, students = self.call("GET",
            f"/api/teacher/students?classId={self.class_a}&status=unset",
            as_user="v4teacher1")
        self.assertEqual(students["pagination"]["total"], 11)
        status, logs = self.call("GET", "/api/admin/logs")
        self.assertTrue(any(x["action"] == "students.import" and x["result"]=="success"
                            for x in logs["logs"]))

    def test_02b_students_search_preserves_underscore_percent_backslash(self):
        import urllib.parse

        # Temporary fixture edit: restores original student name afterwards.
        student_no = self.student_ids[-1]
        with closing(db.connect(self.path)) as con:
            row = con.execute(
                "SELECT id,display_name FROM users WHERE username=?",
                (student_no,)
            ).fetchone()
            sid, before = row["id"], row["display_name"]
            con.execute("UPDATE users SET display_name=? WHERE id=?",
                        ("学生_\\%标记", sid))
            con.commit()
        try:
            for needle in ("_", "%", "\\"):
                encoded = urllib.parse.quote(needle, safe="")
                for route, user, key in [
                    ("/api/admin/students", "admin", "items"),
                    ("/api/teacher/students", "v4teacher1", "students"),
                ]:
                    status, result = self.call(
                        "GET", f"{route}?q={encoded}", as_user=user
                    )
                    self.assertEqual(status, 200)
                    self.assertEqual([x["id"] for x in result[key]], [sid])
            status, none = self.call(
                "GET", "/api/admin/students?q=%25", as_user="admin"
            )
            self.assertEqual(none["pagination"]["total"], 1)
            status, audit = self.call(
                "GET", "/api/admin/logs?actor=%25&pageSize=100"
            )
            self.assertEqual(status, 200)
            self.assertEqual(audit["pagination"]["total"], 0)
            status, audit = self.call(
                "GET", "/api/admin/logs?actor=_&pageSize=100"
            )
            self.assertEqual(status, 200)
            self.assertTrue(audit["logs"])
            self.assertTrue(all("_" in x["actor"] for x in audit["logs"]))
        finally:
            with closing(db.connect(self.path)) as con:
                con.execute("UPDATE users SET display_name=? WHERE id=?",
                            (before, sid))
                con.commit()

    def test_02c_xlsx_scientific_student_numbers(self):
        from roster import parse_roster, normalize_excel_integer
        from zipfile import ZipFile

        self.assertEqual(normalize_excel_integer("8.100000001E+09"), "8100000001")
        self.assertEqual(normalize_excel_integer("8100000002.0"), "8100000002")
        self.assertEqual(normalize_excel_integer("8.1000000015E+09"),
                         "8.1000000015E+09")  # Fraction cannot be an ID
        self.assertEqual(normalize_excel_integer("7E99999"), "7E99999")
        self.assertEqual(normalize_excel_integer("0000000001"), "0000000001")

        xmlns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        relns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        def book(rows):
            stream = io.BytesIO()
            with ZipFile(stream, "w") as z:
                z.writestr("xl/workbook.xml", (
                    f'<workbook xmlns="{xmlns}" xmlns:r="{relns}">'
                    '<sheets><sheet name="名单" sheetId="1" r:id="rId1"/>'
                    '</sheets></workbook>'
                ))
                z.writestr("xl/_rels/workbook.xml.rels", (
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" '
                    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                    'Target="worksheets/sheet1.xml"/></Relationships>'
                ))
                header = (
                    '<row r="1"><c r="A1" t="inlineStr"><is><t>学号</t></is></c>'
                    '<c r="B1" t="inlineStr"><is><t>姓名</t></is></c></row>'
                )
                z.writestr("xl/worksheets/sheet1.xml", (
                    f'<worksheet xmlns="{xmlns}"><sheetData>'
                    + header + "".join(rows) + '</sheetData></worksheet>'
                ))
            return stream.getvalue()

        first = '<row r="2"><c r="A2"><v>8.100000001E+09</v></c><c r="B2" t="inlineStr"><is><t>甲</t></is></c></row>'
        second = '<row r="3"><c r="A3" t="n"><v>8100000002.0</v></c><c r="B3" t="inlineStr"><is><t>乙</t></is></c></row>'
        numeric = book([first, second])
        parsed = parse_roster("scientific.xlsx", numeric)
        self.assertEqual([x["studentNo"] for x in parsed],
                         ["8100000001", "8100000002"])
        status, preview = self.call(
            "POST", f"/api/classes/{self.class_a}/students/import", {
                "filename": "scientific.xlsx",
                "contentBase64": base64.b64encode(numeric).decode(),
                "dryRun": True,
            }, as_user="v4teacher1")
        self.assertEqual(status, 200)
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["count"], 2)

        noninteger = '<row r="4"><c r="A4"><v>8.1000000035E+09</v></c><c r="B4" t="inlineStr"><is><t>丙</t></is></c></row>'
        textcell = '<row r="5"><c r="A5" t="inlineStr"><is><t>8.100000004E+09</t></is></c><c r="B5" t="inlineStr"><is><t>丁</t></is></c></row>'
        formulacell = '<row r="6"><c r="A6"><f>8100000000+5</f><v>8100000005</v></c><c r="B6" t="inlineStr"><is><t>戊</t></is></c></row>'
        mixed = parse_roster("other.xlsx", book([first,second,noninteger,textcell,formulacell]))
        self.assertEqual([x["studentNo"] for x in mixed[2:]], [
            "8.1000000035E+09", "8.100000004E+09", "#FORMULA_NOT_SUPPORTED"
        ])
        status, invalid = self.call(
            "POST", f"/api/classes/{self.class_a}/students/import", {
                "filename": "other.xlsx",
                "contentBase64": base64.b64encode(
                    book([first,second,noninteger,textcell,formulacell])
                ).decode(),
                "dryRun": True,
            }, as_user="v4teacher1")
        self.assertEqual(status, 422)
        self.assertFalse(invalid["valid"])

    def test_02d_admin_student_detail_and_separate_name_number_updates(self):
        student_no=self.student_ids[-1]
        with closing(db.connect(self.path)) as con:
            before=con.execute(
                "SELECT id,username,display_name FROM users WHERE username=?",
                (student_no,)
            ).fetchone()
            sid=before["id"]
            original_name=before["display_name"]
        endpoint=f"/api/admin/students/{sid}"
        status, detail=self.call("GET",endpoint)
        self.assertEqual(status,200)
        self.assertEqual(detail["student"]["studentNo"],student_no)
        self.assertEqual(detail["student"]["displayName"],original_name)
        self.assertNotIn("scores",detail)
        self.assertNotIn("chapters",detail)
        self.assertNotIn("progress",detail)
        status,denied=self.call("GET",endpoint,as_user="v4teacher1")
        self.assertEqual(status,403)

        new_no="8900000777"
        status,number=self.op(endpoint+"/update-no",{"studentNo":new_no},confirm=False)
        self.assertEqual(status,200)
        status,updated=self.call("GET",endpoint)
        self.assertEqual(updated["student"]["studentNo"],new_no)
        self.assertEqual(updated["student"]["displayName"],original_name)
        status,renamed=self.op(endpoint+"/update-name",
            {"displayName":"管理员独立改姓名"},confirm=False)
        self.assertEqual(status,200)
        status,updated=self.call("GET",endpoint)
        self.assertEqual(updated["student"]["displayName"],"管理员独立改姓名")
        self.assertEqual(updated["student"]["studentNo"],new_no)

        status,duplicate=self.op(endpoint+"/update-no",
            {"studentNo":self.student_ids[0]},confirm=False)
        self.assertEqual(status,409)
        status,invalid=self.op(endpoint+"/update-name",
            {"displayName":"   "},confirm=False)
        self.assertEqual(status,400)
        status,blocked=self.op(endpoint+"/update-name",
            {"displayName":"越权修改"},user="v4teacher1",confirm=False)
        self.assertEqual(status,403)
        # Restore fixture identity before subsequent student tests.
        status,_=self.op(endpoint+"/update-no",
            {"studentNo":student_no},confirm=False)
        self.assertEqual(status,200)
        status,_=self.op(endpoint+"/update-name",
            {"displayName":original_name},confirm=False)
        self.assertEqual(status,200)

    def test_03_teacher_filters_student_detail_and_grades(self):
        status, no_start = self.call("GET",
            "/api/teacher/students?status=not_started&chapterId=ch1",
            as_user="v4teacher1")
        self.assertEqual(no_start["pagination"]["total"], 12)
        status, progress = self.call("PUT", "/api/progress/ch1", {
            "checkpoint": "main_accepted",
            "state": {"schemaVersion": 2, "tasks": {
                "main": {"status":"accepted"}, "side": {}
            }},
            "expectedRevision": 0
        }, as_user="student1")
        self.assertEqual(status, 200)
        status, attempt = self.call("POST",
            "/api/chapters/ch1/attempts/start", {}, as_user="student1")
        self.assertEqual(status, 201)
        status, score = self.call("POST","/api/scores",{
            "chapterId":"ch1", "score": 82, "completed": True,
            "attemptId": attempt["attemptId"], "details": {
                "attempts":3, "durationSeconds":120, "retries":1
            }
        },as_user="student1")
        self.assertEqual(status, 201)
        status, not_started = self.call("GET",
            "/api/teacher/students?status=not_started&chapterId=ch1",
            as_user="v4teacher1")
        self.assertEqual(not_started["pagination"]["total"], 11)
        status, not_complete = self.call("GET",
            "/api/teacher/students?status=not_completed&chapterId=ch1",
            as_user="v4teacher1")
        self.assertEqual(not_complete["pagination"]["total"], 11)
        status, summary = self.call("GET","/api/teacher/summary",as_user="v4teacher1")
        self.assertEqual(status, 404, "Removed averages endpoint should be gone")
        status, detail = self.call("GET",
            f"/api/teacher/students/{self.student_one_dbid}",
            as_user="v4teacher1")
        self.assertEqual(status, 200)
        chapter=detail["chapters"][0]
        self.assertTrue(chapter["started"])
        self.assertTrue(chapter["completed"])
        self.assertEqual(chapter["scores"][0]["score"],82)
        status, admin_detail = self.call("GET",
            f"/api/teacher/students/{self.student_one_dbid}")
        self.assertEqual(status, 403)
        status, export, headers = self.call("GET",
            f"/api/teacher/students.csv?classId={self.class_a}&status=not_completed&chapterId=ch1&q=unlikely_never_matches",
            as_user="v4teacher1",binary=True)
        self.assertEqual(status, 200)
        rows=list(csv.reader(io.StringIO(export.decode("utf-8-sig"))))
        self.assertEqual(len(rows),12)  # header + 11 not completed; q ignored for CSV
        status, scores = self.call("GET","/api/teacher/scores",as_user="v4teacher1")
        self.assertEqual(scores["pagination"]["total"],1)
        self.assertNotIn("averageScore",str(scores))
        status, export, headers=self.call(
            "GET","/api/teacher/scores.csv?classId="+str(self.class_a),
            as_user="v4teacher1",binary=True
        )
        self.assertEqual(status,200)
        exported=list(csv.reader(io.StringIO(export.decode("utf-8-sig"))))
        self.assertEqual(len(exported),2)
        self.assertEqual(exported[1][5],"82")

    def test_03b_old_game_progress_save_and_attempt_gates(self):
        status, registered = self.call("POST", "/api/auth/register", {
            "username": "v41_practice", "displayName": "练习学生",
            "password": "PracticePass123"
        }, as_user=None)
        self.assertEqual(status, 201)
        self.tokens["practice_v41"] = registered["token"]
        user = "practice_v41"
        status, no_progress = self.call(
            "POST", "/api/chapters/ch1/attempts/start", {}, as_user=user
        )
        self.assertEqual(status, 409)
        status, no_ch2 = self.call(
            "POST", "/api/chapters/ch2/attempts/start", {}, as_user=user
        )
        self.assertEqual(status, 409)
        status, fake_score = self.call("POST", "/api/scores", {
            "chapterId": "ch1", "score": 100, "completed": True,
            "attemptId": "not-issued-v4", "details": {}
        }, as_user=user)
        self.assertEqual(status, 409)
        status, fake_ch2 = self.call("POST", "/api/scores", {
            "chapterId": "ch2", "score": 100, "completed": True,
            "attemptId": "not-issued-ch2", "details": {}
        }, as_user=user)
        self.assertEqual(status, 409)

        state = {"schemaVersion":2,
                 "tasks":{"main":{"status":"accepted"}, "side":{}},
                 "circuits":{"data": "X" * (330 * 1024)}}
        status, saved = self.call("PUT", "/api/progress/ch1", {
            "checkpoint":"sample_big_circuit", "state":state,
            "expectedRevision":0
        }, as_user=user)
        self.assertEqual(status, 200)
        self.assertEqual(len(saved["progress"]["state"]["circuits"]["data"]),330*1024)
        status, too_large = self.call("PUT", "/api/progress/ch1", {
            "checkpoint": "too_large",
            "state":{"circuits":{"data":"Y" * (4 * 1024 * 1024 + 128)}},
            "expectedRevision":saved["progress"]["revision"],
        }, as_user=user)
        self.assertEqual(status,413)
        self.assertEqual(too_large["code"],"SAVE_TOO_LARGE")
        status, attempt = self.call(
            "POST", "/api/chapters/ch1/attempts/start", {}, as_user=user
        )
        self.assertEqual(status, 201)
        result={"chapterId":"ch1","score":77,"completed":True,
                "attemptId":attempt["attemptId"],"details":{"mock":True}}
        status, first=self.call("POST","/api/scores",result,as_user=user)
        self.assertEqual(status, 201)
        status, second=self.call("POST","/api/scores",result,as_user=user)
        self.assertEqual(status, 200)
        self.assertEqual(first["score"]["id"], second["score"]["id"])
        status, own=self.call("GET","/api/scores/mine",as_user=user)
        self.assertEqual(len(own["scores"]),1)

        # Old teacher progress endpoint must still work and omit internal state.
        status, progress=self.call("GET",
            "/api/teacher/progress?classId="+str(self.class_a),
            as_user="v4teacher1")
        self.assertEqual(status,200)
        self.assertTrue(progress["progress"])
        self.assertNotIn("state",progress["progress"][0])
        self.assertEqual(progress["progress"][0]["checkpoint"],"main_accepted")

    def test_04_teacher_student_ops_and_transfer(self):
        status, students = self.call("GET",
            f"/api/teacher/students?classId={self.class_a}&pageSize=100",
            as_user="v4teacher1")
        students = students["students"]
        s1=next(s for s in students if s["username"]==self.student_ids[0])
        s2=next(s for s in students if s["username"]==self.student_ids[1])
        self.__class__.student_two_dbid=s2["id"]
        # Teacher account has no ability to change names in V4.6.
        for actor in ("v4teacher1", "v4teacher2"):
            status, denied = self.op(
                f"/api/teacher/students/{s1['id']}/rename",
                {"displayName": "不允许教师改名"}, user=actor, confirm=False
            )
            self.assertEqual(status, 404)
        status, unchanged = self.call(
            "GET", f"/api/teacher/students/{s1['id']}", as_user="v4teacher1"
        )
        self.assertNotEqual(unchanged["student"]["displayName"], "不允许教师改名")
        status, transfer=self.op(f"/api/teacher/students/{s1['id']}/transfer",
            {"toClassId":self.class_b},user="v4teacher1")
        self.assertEqual(status,200)
        status, nowVisible=self.call("GET",
            f"/api/teacher/students/{s1['id']}",as_user="v4teacher2")
        self.assertEqual(status,200)
        self.assertTrue(nowVisible["chapters"][0]["completed"])
        status, scores=self.call("GET","/api/teacher/scores",as_user="v4teacher2")
        self.assertEqual(scores["pagination"]["total"],1)
        status, back=self.op(f"/api/teacher/students/{s1['id']}/transfer",
            {"toClassId":self.class_a},user="v4teacher1")
        self.assertEqual(status,200)
        status, gone=self.call("GET",
            f"/api/teacher/students/{s1['id']}",as_user="v4teacher2")
        self.assertEqual(status,403)
        status, removed=self.op(f"/api/teacher/students/{s2['id']}/remove",
            user="v4teacher1")
        self.assertEqual(status,200)
        status, gone=self.call("GET",
            f"/api/teacher/students/{s2['id']}",as_user="v4teacher1")
        self.assertEqual(status,403)
        status, assigned=self.op(f"/api/admin/students/{s2['id']}/move",
            {"toClassId":self.class_b})
        self.assertEqual(status,200)
        status, new=self.call("GET",
            f"/api/teacher/students/{s2['id']}",as_user="v4teacher2")
        self.assertEqual(status,200)

    def test_05_archive_restore_rename_empty_class(self):
        status, blocked=self.op(f"/api/admin/classes/{self.class_a}/archive",
            confirm=False)
        self.assertEqual(status,428)
        status, renamed=self.op(f"/api/admin/classes/{self.class_a}/rename",
            {"name":"教学一班改名"},confirm=False)
        self.assertEqual(status,200)
        status, archive=self.op(f"/api/admin/classes/{self.class_a}/archive")
        self.assertEqual(status,200)
        status, normal=self.call("GET","/api/admin/classes")
        self.assertFalse(any(c["id"]==self.class_a for c in normal["classes"]))
        status, old=self.call("GET","/api/admin/classes?archived=1")
        self.assertTrue(any(c["id"]==self.class_a for c in old["classes"]))
        status, teacherClasses=self.call("GET","/api/classes",as_user="v4teacher1")
        self.assertFalse(any(c["id"]==self.class_a for c in teacherClasses["classes"]))
        status, teacherStudents=self.call("GET","/api/teacher/students",as_user="v4teacher1")
        self.assertFalse(any(s["classId"]==self.class_a for s in teacherStudents["students"]))
        status, archivedClassFilter=self.call("GET",
            f"/api/teacher/students?classId={self.class_a}",as_user="v4teacher1")
        self.assertEqual(status,409)
        status, clsDetail=self.call("GET",f"/api/admin/classes/{self.class_a}")
        self.assertEqual(status,200)
        self.assertFalse("scores" in clsDetail)
        status, restored=self.op(f"/api/admin/classes/{self.class_a}/restore")
        self.assertEqual(status,200)
        status, teacherClasses=self.call("GET","/api/classes",as_user="v4teacher1")
        self.assertTrue(any(c["id"]==self.class_a for c in teacherClasses["classes"]))
        status, denied=self.op(f"/api/admin/classes/{self.class_a}/delete-empty")
        self.assertEqual(status,409)
        status, deleted=self.op(f"/api/admin/classes/{self.class_empty}/delete-empty",
                               confirm=False)
        self.assertEqual(status,200)
        status, clsDetail=self.call("GET",f"/api/admin/classes/{self.class_empty}")
        self.assertEqual(status,404)

    def test_06_teacher_leave_last_teacher_and_assignments(self):
        status, leave=self.op(
            f"/api/teacher/classes/{self.class_b}/leave",user="v4teacher2")
        self.assertEqual(status,200)
        status, last=self.op(
            f"/api/teacher/classes/{self.class_b}/leave",user="v4teacher1")
        self.assertEqual(status,409)
        self.assertEqual(last["code"],"LAST_ACTIVE_TEACHER")
        status, restored=self.op(f"/api/admin/classes/{self.class_b}/teachers",
                                 {"teacherId":self.v4teacher2})
        self.assertEqual(status,200)
        status, quit=self.op(
            f"/api/teacher/classes/{self.class_b}/leave",user="v4teacher1")
        self.assertEqual(status,200)
        status, still=self.call("GET",f"/api/admin/classes/{self.class_b}")
        self.assertEqual(len(still["teachers"]),1)
        status, logs=self.call("GET","/api/teacher/logs",as_user="v4teacher1")
        self.assertTrue(all(self.class_b not in [c["id"] for c in log["classes"]]
                            for log in logs["logs"]))
        status, reassign=self.op(f"/api/admin/classes/{self.class_b}/teachers",
                                {"teacherId":self.v4teacher1})
        self.assertEqual(status,200)

    def test_06b_admin_unassign_and_reassign_teacher(self):
        status, before = self.call("GET", f"/api/admin/classes/{self.class_b}")
        self.assertEqual(len(before["teachers"]), 2)
        status, removed = self.op(
            f"/api/admin/classes/{self.class_b}/teachers/{self.v4teacher2}/remove"
        )
        self.assertEqual(status, 200)
        status, after = self.call("GET", f"/api/admin/classes/{self.class_b}")
        self.assertEqual(len(after["teachers"]), 1)
        status, logged = self.call("GET", "/api/teacher/logs",
                                   as_user="v4teacher2")
        self.assertFalse(any(self.class_b in [c["id"] for c in entry["classes"]]
                             for entry in logged["logs"]))
        status, rest = self.op(
            f"/api/admin/classes/{self.class_b}/teachers",
            {"teacherId": self.v4teacher2}
        )
        self.assertEqual(status, 200)

    def test_07_teacher_account_disable_reset(self):
        status, blocked=self.op(
            f"/api/admin/teachers/{self.v4teacher2}/disable",confirm=False)
        self.assertEqual(status,428)
        status, disabled=self.op(
            f"/api/admin/teachers/{self.v4teacher2}/disable")
        self.assertEqual(status,200)
        status, denied=self.call("GET","/api/classes",as_user="v4teacher2")
        self.assertEqual(status,401)
        status, logs=self.call("GET",f"/api/admin/teachers?active=0")
        self.assertEqual(len(logs["items"]),1)
        status, candidates=self.call(
            "GET",f"/api/admin/classes/{self.class_a}/available-teachers")
        self.assertNotIn(self.v4teacher2,[x["id"] for x in candidates["teachers"]])
        status, rejected=self.op(
            f"/api/admin/classes/{self.class_a}/teachers",
            {"teacherId":self.v4teacher2})
        self.assertEqual(status,409)
        self.assertEqual(rejected["code"],"TEACHER_DISABLED")
        status, reenabled=self.op(
            f"/api/admin/teachers/{self.v4teacher2}/enable")
        self.assertEqual(status,200)
        self.tokens["v4teacher2"]=self.login("v4teacher2","TeacherPass123")
        old=self.tokens["v4teacher2"]
        status, reset=self.op(
            f"/api/admin/teachers/{self.v4teacher2}/reset-password",
            {"newPassword":"NewTeacherPass456"},confirm=False)
        self.assertEqual(status,200)
        status, oldSession=self.call("GET","/api/classes",as_user=old)
        self.assertEqual(status,401)
        status, wrong=self.call("POST","/api/auth/login",
            {"username":"v4teacher2","password":"TeacherPass123"},as_user=None)
        self.assertEqual(status,401)
        self.tokens["v4teacher2"]=self.login("v4teacher2","NewTeacherPass456")
        status, classes=self.call("GET","/api/classes",as_user="v4teacher2")
        self.assertTrue(any(c["id"]==self.class_b for c in classes["classes"]))
        status, t1_logs=self.call("GET","/api/teacher/logs",as_user="v4teacher1")
        self.assertTrue(any(log["action"]=="teachers.password_reset"
                            for log in t1_logs["logs"]), "Admin teacher reset must appear in class logs")

    def test_08_student_correction_disable_and_hard_delete(self):
        sid=self.student_one_dbid
        status, conflict=self.op(f"/api/admin/students/{sid}/correct",{
            "studentNo":self.student_ids[2],"displayName":"学号冲突"})
        self.assertEqual(status,409)
        status, ok=self.op(f"/api/admin/students/{sid}/correct",{
            "studentNo":"8000000999","displayName":"更正同学"})
        self.assertEqual(status,200)
        status, student=self.call("GET",f"/api/teacher/students/{sid}",
                                  as_user="v4teacher1")
        self.assertEqual(student["student"]["studentNo"],"8000000999")
        self.assertTrue(student["chapters"][0]["completed"])
        status, blocked=self.op(f"/api/admin/students/{sid}/disable",confirm=False)
        self.assertEqual(status,428)
        status, disable=self.op(f"/api/admin/students/{sid}/disable")
        self.assertEqual(status,200)
        status, authfail=self.call("GET","/api/chapters",as_user="student1")
        self.assertEqual(status,401)
        status, disabled=self.call("GET",
            "/api/admin/students?active=0")
        self.assertEqual(len(disabled["items"]),1)
        status, enabled=self.op(f"/api/admin/students/{sid}/enable")
        self.assertEqual(status,200)
        self.tokens["student1"]=self.login("8000000999","StudPass123")
        status, cannot_delete=self.op(f"/api/admin/students/{sid}/delete-error")
        self.assertEqual(status,409)
        status, all_students=self.call("GET",
            "/api/admin/students?pageSize=100")
        new_unused=next(x for x in all_students["items"]
                        if x["username"]==self.student_ids[3])
        status, deleted=self.op(f"/api/admin/students/{new_unused['id']}/delete-error",
            confirm=False)
        self.assertEqual(status,200)
        status, badlogin=self.call("POST","/api/auth/login",
            {"username":self.student_ids[3]},as_user=None)
        self.assertEqual(status,401)

    def test_09_teacher_name_reset_and_status_export(self):
        status, students=self.call("GET", f"/api/teacher/students?classId={self.class_a}",
                                  as_user="v4teacher1")
        s1=next(s for s in students["students"] if s["id"]==self.student_one_dbid)
        status, reset=self.op(f"/api/teacher/students/{s1['id']}/reset-password",
            user="v4teacher1",confirm=False)
        self.assertEqual(status,200)
        status, old_session=self.call("GET","/api/chapters",as_user="student1")
        self.assertEqual(status,401)
        status, pending=self.call("GET","/api/teacher/students?status=unset",
                                  as_user="v4teacher1")
        self.assertTrue(any(x["id"]==s1["id"] for x in pending["students"]))
        status, repeated_delete=self.op(f"/api/admin/students/{s1['id']}/delete-error")
        self.assertEqual(status,409,
            "Previously set-up student cannot be hard-deleted after teacher reset")
        status, pending_login=self.call("POST","/api/auth/login",
            {"username":"8000000999"},as_user=None)
        self.assertTrue(pending_login["setupRequired"])
        status, setup=self.call("POST","/api/auth/setup-password",
            {"setupToken":pending_login["setupToken"],"newPassword":"AgainPassword123"},
            as_user=None)
        self.assertEqual(status,200)
        self.tokens["student1"]=setup["token"]
        status, kept=self.call("GET","/api/scores/mine",as_user="student1")
        self.assertEqual(len(kept["scores"]),1)
        status, grades=self.call("GET","/api/teacher/scores",as_user="v4teacher1")
        self.assertEqual(grades["pagination"]["total"],1)

    def test_10_audit_filters_and_read_only(self):
        status, logs=self.call("GET","/api/admin/logs?pageSize=100")
        self.assertEqual(status,200)
        actions={l["action"] for l in logs["logs"]}
        for action in ["classes.archive","classes.restore","teachers.password_reset",
                       "students.teacher_transfer","students.teacher_remove",
                       "students.delete_error","students.import"]:
            self.assertIn(action,actions)
        self.assertTrue(any(l["result"]=="failed" for l in logs["logs"]))
        status, filtered=self.call("GET",
            f"/api/admin/logs?classId={self.class_a}&pageSize=100")
        self.assertTrue(all(self.class_a in [x["id"] for x in l["classes"]]
                            for l in filtered["logs"]))
        status, by_operator=self.call("GET",
            "/api/admin/logs?actor=v4teacher1&pageSize=100")
        self.assertTrue(all("v4teacher1" in x["actor"] for x in by_operator["logs"]))
        status, teacher_logs=self.call("GET","/api/teacher/logs",as_user="v4teacher2")
        self.assertTrue(all(any(c["id"]==self.class_b for c in x["classes"])
                            for x in teacher_logs["logs"]))
        status, unauthorized=self.call("GET","/api/admin/logs",as_user="v4teacher1")
        self.assertEqual(status,403)
        status, not_writable=self.call("POST","/api/admin/logs",
                                      {"confirm":True,"change":"erase"})
        self.assertEqual(status,404)
        status, by_time=self.call("GET",
            "/api/admin/logs?from=2099-01-01")
        self.assertEqual(by_time["pagination"]["total"],0)

    def test_10b_utc_audit_filter_converts_beijing_days(self):
        import management
        from datetime import datetime, timedelta, timezone
        # A timestamp after Beijing midnight is still the previous UTC day.
        self.assertEqual(
            db.display_time("2026-10-27T17:10:00+00:00"),
            "2026-10-28 01:10:00"
        )
        with closing(db.connect(self.path)) as con:
            con.execute(
                """INSERT INTO audit_logs(actor_id,actor_username,actor_role,
                   action,target_type,target_id,before_json,after_json,result,message,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (self.admin_id,"school_admin","admin","date_boundary_test",
                 "class","0","{}","{}","success","北京日期边界验证",
                 "2026-10-27T17:10:00+00:00")
            )
            con.commit()
        admin = db.get_user(self.path, self.tokens["admin"])
        found = management.audit_list(self.path, admin, page=1, page_size=100,
                                       start="2026-10-28", end="2026-10-28")
        self.assertTrue(any(x["action"] == "date_boundary_test"
                            for x in found["logs"]))

    def test_10c_v3_database_migration(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as td:
            old = Path(td) / "old.sqlite3"
            con = sqlite3.connect(old)
            con.executescript("""
                CREATE TABLE classes(id INTEGER PRIMARY KEY,name TEXT UNIQUE,created_at TEXT);
                CREATE TABLE users(
                  id INTEGER PRIMARY KEY,username TEXT UNIQUE,
                  display_name TEXT,password_hash TEXT,role TEXT,
                  created_at TEXT,student_no TEXT,class_id INTEGER,
                  must_change_password INTEGER DEFAULT 0,is_admin INTEGER DEFAULT 0,
                  active INTEGER DEFAULT 1);
                CREATE TABLE progress(
                  user_id INTEGER,chapter_id TEXT,checkpoint TEXT,
                  state_json TEXT,revision INTEGER,updated_at TEXT,
                  PRIMARY KEY(user_id,chapter_id));
                CREATE TABLE scores(
                  id INTEGER PRIMARY KEY,user_id INTEGER,chapter_id TEXT,
                  score INTEGER,completed INTEGER,details_json TEXT,
                  attempt_id TEXT UNIQUE,submitted_at TEXT);
            """)
            con.execute(
                "INSERT INTO classes VALUES (1,'历史班','2026-10-01')")
            con.execute(
                """INSERT INTO users VALUES(1,'1234567890','历史学生',?,'student',
                   '2026-10-01','1234567890',1,0,0,1)""",
                (db.hash_password("OldStudent123"),)
            )
            con.execute(
                "INSERT INTO progress VALUES(1,'ch1','old_room','{}',1,'2026')")
            con.execute(
                "INSERT INTO scores VALUES(1,1,'ch1',91,1,'{}','old-score','2026')")
            con.commit()
            con.close()
            db.init(old)
            with closing(db.connect(old)) as upgraded:
                migrated = upgraded.execute(
                    "SELECT ever_password_set FROM users WHERE id=1").fetchone()
                self.assertEqual(migrated[0], 1)
                archived = upgraded.execute(
                    "SELECT archived FROM classes WHERE id=1").fetchone()[0]
                self.assertEqual(archived, 0)
                self.assertEqual(upgraded.execute("SELECT COUNT(*) FROM scores").fetchone()[0], 1)
                self.assertEqual(upgraded.execute("SELECT COUNT(*) FROM progress").fetchone()[0], 1)

    def test_10d_csv_formula_guard_and_static_mime(self):
        from roster import make_csv
        injected=make_csv(
            ["student_name","student_no","attempts"],
            [["=HYPERLINK(1)", "0000000001", "@cmd"]],
        )
        row=list(csv.reader(io.StringIO(injected.decode("utf-8-sig"))))[1]
        self.assertTrue(row[0].startswith("\t="))
        self.assertEqual(row[1], "\t0000000001")
        self.assertTrue(row[2].startswith("\t@"))

        public=Path(__file__).resolve().parents[1]/"public"/"_qa_mime"
        public.mkdir(exist_ok=True)
        assets={
            "theme.css":(b"body{color:black}", "text/css"),
            "hero.png":(b"PNGtest", "image/png"),
            "photo.jpg":(b"JPGtest", "image/jpeg"),
            "icon.svg":(b"<svg></svg>", "image/svg+xml"),
            "font.woff2":(b"fontdata", "font/woff2"),
        }
        try:
            for filename,(data,_) in assets.items():
                (public/filename).write_bytes(data)
            for filename,(data,mime) in assets.items():
                url=f"http://127.0.0.1:{self.port}/_qa_mime/{filename}"
                with urllib.request.urlopen(url,timeout=10) as response:
                    self.assertTrue(response.headers["Content-Type"].startswith(mime))
                    self.assertEqual(response.read(),data)
                    self.assertEqual(
                        response.headers["X-Content-Type-Options"],"nosniff")
        finally:
            for filename in assets:
                (public/filename).unlink(missing_ok=True)
            public.rmdir()

    def test_10d2_in_page_dialog_module_is_served(self):
        """HTTP server exposes the new shared ESM file with a JS MIME type."""
        url=f"http://127.0.0.1:{self.port}/dialog.js"
        with urllib.request.urlopen(url, timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(response.headers["Content-Type"].startswith(
                "text/javascript"))
            self.assertEqual(
                response.headers["X-Content-Type-Options"], "nosniff"
            )
            body=response.read().decode("utf-8")
        self.assertIn("export function confirmDialog", body)
        self.assertIn("export function promptDialog", body)
        self.assertIn("export function alertDialog", body)
        self.assertIn('panel.setAttribute("aria-modal", "true")', body)
        self.assertNotIn("window.confirm(", body)
        self.assertNotIn("window.prompt(", body)
        self.assertNotIn("window.alert(", body)

    def test_10e_failure_audit_categories_dedup_and_form_noise(self):
        def failures(actor_id, category):
            with closing(db.connect(self.path)) as con:
                rows = con.execute(
                    """SELECT action,after_json,message FROM audit_logs
                       WHERE actor_id=? AND result='failed' ORDER BY id""",
                    (actor_id,)
                ).fetchall()
            return [row for row in rows
                    if json.loads(row["after_json"]).get("failureType") == category]

        # Success resets an actor's consecutive failure run.
        first_name = "失败日志去重一班"
        second_name = "失败日志去重二班"
        status, _ = self.op("/api/admin/classes", {"name": first_name}, confirm=False)
        self.assertEqual(status, 201)
        before = len(failures(self.admin_id, "validation"))
        for _ in range(3):
            status, error = self.op(
                "/api/admin/classes", {"name": first_name}, confirm=False
            )
            self.assertEqual(status, 409)
            self.assertEqual(error["code"], "DUPLICATE")
        self.assertEqual(len(failures(self.admin_id, "validation")), before+1)

        # Ordinary form mistakes are not written, and do not break a run.
        for _ in range(2):
            status, _ = self.op(
                "/api/admin/classes", {"name": ""}, confirm=False
            )
            self.assertEqual(status, 400)
        status, _ = self.op(
            "/api/admin/classes", {"name": first_name}, confirm=False
        )
        self.assertEqual(status, 409)
        self.assertEqual(len(failures(self.admin_id, "validation")), before+1)

        status, _ = self.op("/api/admin/classes", {"name": second_name}, confirm=False)
        self.assertEqual(status, 201)
        status, _ = self.op(
            "/api/admin/classes", {"name": second_name}, confirm=False
        )
        self.assertEqual(status, 409)
        self.assertEqual(len(failures(self.admin_id, "validation")), before+2)

        # A genuine wrong-role POST is now audited (not just denied by HTTP).
        status, students = self.call(
            "GET", "/api/teacher/students", as_user="v4teacher1"
        )
        self.assertEqual(status, 200)
        target = students["students"][0]
        status, _ = self.op(
            f"/api/teacher/students/{target['id']}/reset-password",
            user="v4teacher1", confirm=False
        )
        self.assertEqual(status, 200)
        before_forbidden = len(failures(self.v4teacher1, "forbidden"))
        before_validation = len(failures(self.v4teacher1, "validation"))
        for _ in range(3):
            status, blocked = self.op(
                "/api/admin/classes", {"name": "越权创建"},
                user="v4teacher1", confirm=False
            )
            self.assertEqual(status, 403)
            self.assertEqual(blocked["code"], "FORBIDDEN")
        self.assertEqual(len(failures(self.v4teacher1, "forbidden")),
                         before_forbidden+1)
        self.assertIn("越权", failures(self.v4teacher1, "forbidden")[-1]["message"])

        # Different meaningful failure category is retained and resets the run.
        status, rejected = self.op(
            f"/api/teacher/students/{target['id']}/transfer",
            {"toClassId": target["classId"]},
            user="v4teacher1", confirm=False
        )
        self.assertEqual(status, 409)
        self.assertEqual(len(failures(self.v4teacher1, "validation")),
                         before_validation+1)
        status, _ = self.op(
            "/api/admin/classes", {"name": "越权创建"},
            user="v4teacher1", confirm=False
        )
        self.assertEqual(status, 403)
        self.assertEqual(len(failures(self.v4teacher1, "forbidden")),
                         before_forbidden+2)

        status, logs = self.call("GET", "/api/admin/logs?pageSize=100")
        self.assertEqual(status, 200)
        self.assertTrue(any(
            item["failureType"] == "forbidden" and item["result"] == "failed"
            for item in logs["logs"]
        ))
        self.assertTrue(any(
            item["failureType"] == "validation" and item["result"] == "failed"
            for item in logs["logs"]
        ))

    def test_10f_six_exclusive_overview_counts(self):
        def get_summary():
            status, data = self.call("GET", "/api/admin/overview")
            self.assertEqual(status, 200)
            return data["overview"]

        before = get_summary()
        with closing(db.connect(self.path)) as con:
            total_classes = con.execute("SELECT COUNT(*) FROM classes").fetchone()[0]
            total_teachers = con.execute(
                "SELECT COUNT(*) FROM users WHERE role='teacher' AND is_admin=0"
            ).fetchone()[0]
            total_students = con.execute(
                "SELECT COUNT(*) FROM users WHERE role='student'"
            ).fetchone()[0]
        self.assertEqual(before["classes"]+before["archivedClasses"],total_classes)
        self.assertEqual(before["teachers"]+before["disabledTeachers"],total_teachers)
        self.assertEqual(before["students"]+before["disabledStudents"],total_students)

        status, _ = self.op(f"/api/admin/classes/{self.class_a}/archive")
        self.assertEqual(status, 200)
        status, _ = self.op(f"/api/admin/teachers/{self.v4teacher2}/disable")
        self.assertEqual(status, 200)
        status, _ = self.op(
            f"/api/admin/students/{self.student_one_dbid}/disable"
        )
        self.assertEqual(status, 200)
        changed = get_summary()
        for main, separate in [
            ("classes","archivedClasses"),
            ("teachers","disabledTeachers"),
            ("students","disabledStudents"),
        ]:
            self.assertEqual(changed[main],before[main]-1)
            self.assertEqual(changed[separate],before[separate]+1)
            self.assertEqual(changed[main]+changed[separate],
                             before[main]+before[separate])

        status, _ = self.op(f"/api/admin/students/{self.student_one_dbid}/enable")
        self.assertEqual(status, 200)
        status, _ = self.op(f"/api/admin/teachers/{self.v4teacher2}/enable")
        self.assertEqual(status, 200)
        status, _ = self.op(f"/api/admin/classes/{self.class_a}/restore")
        self.assertEqual(status, 200)
        self.assertEqual(get_summary(),before)

    def test_10g_concurrent_duplicate_failures_log_once(self):
        """Atomic per-actor dedup also works for simultaneous duplicate writes."""
        name = "并发校验去重班"
        status, _ = self.op("/api/admin/classes", {"name": name}, confirm=False)
        self.assertEqual(status, 201)

        def categorized_count():
            with closing(db.connect(self.path)) as con:
                rows = con.execute(
                    """SELECT after_json FROM audit_logs
                       WHERE actor_id=? AND result='failed'""",
                    (self.admin_id,)
                ).fetchall()
            return sum(
                json.loads(row["after_json"]).get("failureType") == "validation"
                for row in rows
            )

        previous = categorized_count()
        barrier = threading.Barrier(8, timeout=15)
        def duplicate(_):
            barrier.wait()
            return self.op("/api/admin/classes", {"name": name}, confirm=False)
        with ThreadPoolExecutor(max_workers=8) as executor:
            responses = list(executor.map(duplicate, range(8)))
        self.assertTrue(all(status == 409 for status, _ in responses))
        self.assertEqual(categorized_count(), previous + 1)

    def test_11_concurrent_http_and_mime(self):
        barrier=threading.Barrier(100,timeout=20)
        def run_once(_):
            barrier.wait()
            status, res=self.call("GET","/api/health",as_user=None)
            return status==200 and res["status"]=="ok"
        with ThreadPoolExecutor(max_workers=100) as executor:
            results=list(executor.map(run_once,range(100)))
        self.assertTrue(all(results))
        status, css, headers=self.call("GET","/management.js",as_user=None,binary=True)
        self.assertEqual(status,200)
        self.assertIn("text/javascript",headers["Content-Type"])
        self.assertNotIn(b"averageScore",css)
        status, entry, headers=self.call("GET","/",as_user=None,binary=True)
        self.assertEqual(status,200)
        self.assertIn(b'<link rel="stylesheet" href="/style.css">',entry)
        self.assertNotIn(b'<style',entry)
        status, css, css_headers=self.call("GET","/style.css",as_user=None,binary=True)
        self.assertEqual(status,200)
        self.assertIn("text/css",css_headers["Content-Type"])
        self.assertIn(b"--paper",css)
        self.assertIn("style-src 'self'",css_headers["Content-Security-Policy"])
        self.assertIn("img-src 'self' data:",css_headers["Content-Security-Policy"])
