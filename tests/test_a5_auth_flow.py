"""A5 auth skin regression: exercise unchanged real HTTP authentication flows.
Run: python -m pytest -q tests/test_a5_auth_flow.py
"""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import database as db
from server import create_server


class A5AuthFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "a5-auth.sqlite3"
        cls.server = create_server("127.0.0.1", 0, cls.db)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        db.create_user(cls.db, "a5teacher", "TeacherPass123", "教师", role="teacher")
        db.create_user(cls.db, "a5admin", "AdminPass123", "管理员",
                       role="teacher", is_admin=True)
        db.create_user(cls.db, "9090909090", None, "班级首登测试",
                       role="student", student_no="9090909090")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=5)
        cls.tmp.cleanup()

    @classmethod
    def request(cls, method, uri, body=None, token=None):
        headers = {}
        payload = None
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(cls.base + uri, data=payload,
                                     headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as err:
            response = err
        with response:
            raw = response.read()
            return response.status, (json.loads(raw.decode("utf-8")) if
                                     response.headers.get("Content-Type", "").startswith("application/json")
                                     else raw)

    def test_a5_static_resource_is_served(self):
        status, raw = self.request("GET", "/assets/scenes/login-paper.png")
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"))
        status, raw = self.request("GET", "/assets/scenes/landing-landscape.png")
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_self_registration_login_logout(self):
        status, reply = self.request("POST", "/api/auth/register", {
            "username": "a5reg_user", "password": "ValidPass123",
            "displayName": "自主练习用户",
        })
        self.assertEqual(status, 201)
        self.assertEqual(reply["user"]["role"], "student")
        token = reply["token"]
        status, me = self.request("GET", "/api/auth/me", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(me["user"]["username"], "a5reg_user")
        status, out = self.request("POST", "/api/auth/logout", {}, token=token)
        self.assertEqual(status, 200)
        status, err = self.request("GET", "/api/auth/me", token=token)
        self.assertEqual(status, 401)
        status, logged = self.request("POST", "/api/auth/login", {
            "username": "a5reg_user", "password": "ValidPass123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(logged["user"]["role"], "student")

    def test_first_login_no_password_then_setup(self):
        status, issued = self.request("POST", "/api/auth/login", {
            "username": "9090909090", "password": "",
        })
        self.assertEqual(status, 200)
        self.assertTrue(issued["setupRequired"])
        status, confirmed = self.request("POST", "/api/auth/setup-password", {
            "setupToken": issued["setupToken"], "newPassword": "NewStudentPass123",
        })
        self.assertEqual(status, 200)
        self.assertFalse(confirmed["user"]["needsPasswordSetup"])
        status, logged = self.request("POST", "/api/auth/login", {
            "username": "9090909090", "password": "NewStudentPass123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(logged["user"]["role"], "student")

    def test_teacher_and_admin_permissions_unchanged(self):
        for username,password,expected_role in (
            ("a5teacher", "TeacherPass123", "teacher"),
            ("a5admin", "AdminPass123", "admin"),
        ):
            status, reply = self.request("POST", "/api/auth/login", {
                "username": username, "password": password,
            })
            self.assertEqual(status, 200)
            self.assertEqual(reply["user"]["role"], expected_role)
            status, me = self.request("GET", "/api/auth/me", token=reply["token"])
            self.assertEqual(status, 200)
            self.assertEqual(me["user"]["role"], expected_role)

    def test_invalid_password_keeps_error_response(self):
        status, err = self.request("POST", "/api/auth/login", {
            "username": "a5teacher", "password": "NotThePassword!",
        })
        self.assertEqual(status, 401)
        self.assertEqual(err["code"], "BAD_CREDENTIALS")

if __name__ == "__main__":
    unittest.main()
