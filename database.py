"""SQLite 数据访问：账号、班级、会话、进度、成绩与审计记录。"""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from contextlib import closing
from chapters import BY_ID
from quest_model import validate_quest_state, TRANSITIONS
from datetime import datetime, timezone, timedelta
from pathlib import Path

ITERATIONS = 240_000
SESSION_SECONDS = 7 * 24 * 3600
SETUP_SECONDS = 10 * 60
PENDING_PASSWORD = "PENDING"
BEIJING_TIME = timezone(timedelta(hours=8))


def display_time(value):
    """数据库仍存UTC，API/CSV使用统一北京时间 YYYY-MM-DD HH:mm:ss。"""
    try:
        stamp = datetime.fromisoformat(value)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.astimezone(BEIJING_TIME).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return value
LOGIN_NAME = re.compile(r"^[A-Za-z0-9_]{3,32}$")
STUDENT_NO = re.compile(r"^[0-9]{10}$")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path):
    con = sqlite3.connect(str(path), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=30000")
    return con


def init(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(path)) as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript("""
            CREATE TABLE IF NOT EXISTS classes(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              archived INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS users(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('student','teacher')),
              created_at TEXT NOT NULL,
              student_no TEXT,
              class_id INTEGER REFERENCES classes(id),
              must_change_password INTEGER NOT NULL DEFAULT 0,
              is_admin INTEGER NOT NULL DEFAULT 0,
              active INTEGER NOT NULL DEFAULT 1,
              ever_password_set INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS teacher_classes(
              teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
              PRIMARY KEY(teacher_id,class_id)
            );
            CREATE TABLE IF NOT EXISTS sessions(
              token_hash TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS setup_sessions(
              token_hash TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_setup_user ON setup_sessions(user_id);
            CREATE TABLE IF NOT EXISTS attempts(
              attempt_id TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              chapter_id TEXT NOT NULL,
              started_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_attempt_user ON attempts(user_id,chapter_id);
            CREATE TABLE IF NOT EXISTS progress(
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              chapter_id TEXT NOT NULL,
              checkpoint TEXT NOT NULL,
              state_json TEXT NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(user_id,chapter_id)
            );
            CREATE TABLE IF NOT EXISTS game_wallets(
              user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
              balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
            );
            CREATE TABLE IF NOT EXISTS game_rewards(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              chapter_id TEXT NOT NULL,
              reward_key TEXT NOT NULL,
              amount INTEGER NOT NULL,
              item_id TEXT,
              item_name TEXT,
              item_note TEXT,
              created_at TEXT NOT NULL,
              UNIQUE(user_id, reward_key)
            );
            CREATE TABLE IF NOT EXISTS scores(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              chapter_id TEXT NOT NULL,
              score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
              completed INTEGER NOT NULL CHECK(completed IN (0,1)),
              details_json TEXT NOT NULL,
              attempt_id TEXT NOT NULL,
              submitted_at TEXT NOT NULL,
              UNIQUE(user_id,attempt_id)
            );
            CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
            CREATE INDEX IF NOT EXISTS idx_scores_chapter ON scores(chapter_id);
            CREATE TABLE IF NOT EXISTS audit_logs(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              actor_id INTEGER,
              actor_username TEXT NOT NULL,
              actor_role TEXT NOT NULL,
              action TEXT NOT NULL,
              target_type TEXT,
              target_id TEXT,
              before_json TEXT NOT NULL DEFAULT '{}',
              after_json TEXT NOT NULL DEFAULT '{}',
              result TEXT NOT NULL CHECK(result IN ('success','failed')),
              message TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log_classes(
              log_id INTEGER NOT NULL REFERENCES audit_logs(id) ON DELETE CASCADE,
              class_id INTEGER NOT NULL,
              class_name TEXT NOT NULL,
              PRIMARY KEY(log_id,class_id)
            );
            CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_logs(actor_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_audit_log_classes_id ON audit_log_classes(class_id);
        """)
        # 启动时补齐缺失的表字段，同时保留已有数据。
        class_columns = {row["name"] for row in con.execute("PRAGMA table_info(classes)")}
        if "archived" not in class_columns:
            con.execute("ALTER TABLE classes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
        columns = {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        for col, clause in [
            ("student_no", "TEXT"),
            ("class_id", "INTEGER REFERENCES classes(id)"),
            ("must_change_password", "INTEGER NOT NULL DEFAULT 0"),
            ("is_admin", "INTEGER NOT NULL DEFAULT 0"),
            ("active", "INTEGER NOT NULL DEFAULT 1"),
            ("ever_password_set", "INTEGER NOT NULL DEFAULT 1"),
        ]:
            if col not in columns:
                con.execute(f"ALTER TABLE users ADD COLUMN {col} {clause}")
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_no ON users(student_no)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_id)")
        # 教师账号由管理员直接设置密码，不使用学生首次设密流程。
        con.execute("UPDATE users SET must_change_password=0 WHERE role='teacher'")
        # 待设密学生的旧会话不应继续访问教学接口。
        con.execute("""DELETE FROM sessions WHERE user_id IN
                       (SELECT id FROM users WHERE role='student' AND must_change_password=1)""")
        con.commit()


def hash_password(password):
    salt = secrets.token_bytes(16)
    raw = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"{ITERATIONS}${salt.hex()}${raw.hex()}"


def verify_password(password, saved):
    try:
        rounds, salt, digest = saved.split("$")
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds)
        )
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


def user_public(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "role": "admin" if row["is_admin"] else row["role"],
        "studentNo": row["student_no"],
        "classId": row["class_id"],
        "needsPasswordSetup": bool(row["must_change_password"]) and row["role"] == "student",
    }


def valid_account(username, password, display_name, is_import=False):
    if not isinstance(username, str) or not (
        STUDENT_NO.fullmatch(username) if is_import else LOGIN_NAME.fullmatch(username)
    ):
        raise ValueError(
            "学号必须是10位数字" if is_import else "账号必须是3-32位英文字母、数字或下划线"
        )
    if not is_import and STUDENT_NO.fullmatch(username):
        raise ValueError("10位纯数字学号为班级导入保留，不能自行注册")
    if is_import:
        if password is not None:
            raise ValueError("班级学生导入时不能设置初始密码")
    elif not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ValueError("密码必须为8-128位")
    if not isinstance(display_name, str) or not 1 <= len(display_name.strip()) <= 40:
        raise ValueError("姓名/显示名必须为1-40位")
    if any(ch in display_name for ch in "\r\n\x00"):
        raise ValueError("姓名不能包含换行或空字符")


def create_user(path, username, password, display_name, role="student",
                is_admin=False, student_no=None, class_id=None, must_change=False):
    valid_account(username, password, display_name, is_import=student_no is not None)
    if role not in ("student", "teacher"):
        raise ValueError("不支持此身份")
    if student_no is not None and student_no != username:
        raise ValueError("导入账号必须等于学号")
    with closing(connect(path)) as con:
        try:
            cur = con.execute(
                """INSERT INTO users(username,display_name,password_hash,role,created_at,
                   student_no,class_id,must_change_password,is_admin)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (username.lower() if student_no is None else username,
                 display_name.strip(), PENDING_PASSWORD if student_no is not None else hash_password(password),
                 role, now_iso(), student_no, class_id,
                 int(must_change or student_no is not None), int(is_admin))
            )
            con.commit()
            return user_public(con.execute(
                "SELECT * FROM users WHERE id=?", (cur.lastrowid,)
            ).fetchone())
        except sqlite3.IntegrityError as error:
            raise ValueError("账号或学号已存在") from error



def issue_session(con, user_id):
    token = secrets.token_urlsafe(32)
    expiration = int(time.time()) + SESSION_SECONDS
    con.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
        (hashlib.sha256(token.encode()).hexdigest(), user_id, expiration)
    )
    return token, expiration


def login(path, username, password=None):
    if not isinstance(username, str) or (
        password is not None and not isinstance(password, str)
    ):
        return None
    with closing(connect(path)) as con:
        row = con.execute(
            "SELECT * FROM users WHERE username=?", (username.strip().lower(),)
        ).fetchone()
        if row is None or not row["active"]:
            return None
        if row["role"] == "student" and row["must_change_password"]:
            # 班级账号没有初始密码：仅学号可申请一次性“设密”权限。
            # 这意味着已知学号的人可能抢先设置密码，学校须承担该限制。
            setup_token = secrets.token_urlsafe(32)
            expiration = int(time.time()) + SETUP_SECONDS
            con.execute(
                "DELETE FROM setup_sessions WHERE user_id=?", (row["id"],)
            )
            con.execute(
                "INSERT INTO setup_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                (hashlib.sha256(setup_token.encode()).hexdigest(), row["id"], expiration)
            )
            con.commit()
            return {
                "setupRequired": True,
                "setupToken": setup_token,
                "expiresAt": expiration,
                "username": row["username"],
            }
        if not isinstance(password, str) or not verify_password(password, row["password_hash"]):
            return None
        token, expiration = issue_session(con, row["id"])
        con.commit()
        return {
            "token": token, "expiresAt": expiration, "user": user_public(row),
        }


def setup_password(path, setup_token, new_password):
    """短时一次性设密凭证。无旧密码，不提供常规修改密码入口。"""
    if not isinstance(setup_token, str) or not 1 <= len(setup_token) <= 512:
        raise ValueError("设密凭证无效")
    if not isinstance(new_password, str) or not 8 <= len(new_password) <= 128:
        raise ValueError("新密码必须为8-128位")
    with closing(connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        token_hash = hashlib.sha256(setup_token.encode()).hexdigest()
        row = con.execute(
            """SELECT u.* FROM setup_sessions t JOIN users u ON u.id=t.user_id
               WHERE t.token_hash=? AND t.expires_at>? AND u.active=1
                 AND u.role='student' AND u.must_change_password=1""",
            (token_hash, int(time.time()))
        ).fetchone()
        if row is None:
            con.rollback()
            raise ValueError("设密请求过期，请重新输入学号")
        con.execute(
             "UPDATE users SET password_hash=?,must_change_password=0,ever_password_set=1 WHERE id=?",
            (hash_password(new_password), row["id"])
        )
        con.execute("DELETE FROM setup_sessions WHERE user_id=?", (row["id"],))
        con.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
        token, expiration = issue_session(con, row["id"])
        updated = con.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
        con.commit()
        return {"token": token, "expiresAt": expiration, "user": user_public(updated)}


def get_user(path, token):
    if not isinstance(token, str) or not 1 <= len(token) <= 512:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    with closing(connect(path)) as con:
        row = con.execute(
            """SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id
               WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1""",
            (digest, int(time.time()))
        ).fetchone()
        return user_public(row) if row is not None else None


def logout(path, token):
    with closing(connect(path)) as con:
        con.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            (hashlib.sha256(token.encode()).hexdigest(),)
        )
        con.commit()


def list_classes(path, current):
    with closing(connect(path)) as con:
        if current["role"] == "admin":
            rows = con.execute(
                "SELECT id,name FROM classes ORDER BY id"
            ).fetchall()
        elif current["role"] == "teacher":
            rows = con.execute(
                """SELECT c.id,c.name FROM classes c JOIN teacher_classes tc
                   ON tc.class_id=c.id WHERE tc.teacher_id=? AND c.archived=0 ORDER BY c.id""",
                (current["id"],)
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT id,name FROM classes WHERE id=?", (current["classId"],)
            ).fetchall()
        return [dict(row) for row in rows]


def unpack_progress(row):
    return {
        "chapterId": row["chapter_id"],
        "checkpoint": row["checkpoint"],
        "state": json.loads(row["state_json"]),
        "revision": row["revision"],
        "updatedAt": display_time(row["updated_at"]),
    }


def list_progress(path, user_id):
    with closing(connect(path)) as con:
        return [unpack_progress(row) for row in con.execute(
            "SELECT * FROM progress WHERE user_id=? ORDER BY chapter_id", (user_id,)
        ).fetchall()]


def save_progress(path, user_id, chapter_id, checkpoint, state, expected_revision):
    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    with closing(connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        old = con.execute(
            "SELECT revision FROM progress WHERE user_id=? AND chapter_id=?",
            (user_id, chapter_id)
        ).fetchone()
        version = old["revision"] if old else 0
        if version != expected_revision:
            con.rollback()
            return None, version
        revision = version + 1
        now = now_iso()
        old_state = {}
        if old:
            old_row = con.execute(
                "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
                (user_id, chapter_id)
            ).fetchone()
            try: old_state = json.loads(old_row["state_json"])
            except (TypeError, ValueError): old_state = {}
        _validate_task_transition(con, user_id, chapter_id, old_state, state)
        _award_progress_rewards(con, user_id, chapter_id, old_state, state, now)
        con.execute(
            """INSERT INTO progress(user_id,chapter_id,checkpoint,state_json,revision,updated_at)
               VALUES(?,?,?,?,?,?)
               ON CONFLICT(user_id,chapter_id) DO UPDATE SET
               checkpoint=excluded.checkpoint,state_json=excluded.state_json,
               revision=excluded.revision,updated_at=excluded.updated_at""",
            (user_id, chapter_id, checkpoint, payload, revision, now)
        )
        con.commit()
        return {
            "chapterId": chapter_id, "checkpoint": checkpoint, "state": state,
            "revision": revision, "updatedAt": display_time(now),
        }, revision




def _award_once(con, user_id, chapter_id, reward_key, amount, item=None, now=None):
    now = now or now_iso()
    item = item or {}
    cur = con.execute(
        "INSERT OR IGNORE INTO game_rewards(user_id,chapter_id,reward_key,amount,item_id,item_name,item_note,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (user_id, chapter_id, reward_key, amount, item.get("id"), item.get("name"), item.get("note"), now)
    )
    if cur.rowcount:
        con.execute("INSERT INTO game_wallets(user_id,balance) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=balance+excluded.balance", (user_id, amount))
        return True
    return False


def _task_status(state, category, quest_id=None):
    tasks = state.get("tasks", {}) if isinstance(state, dict) else {}
    if not isinstance(tasks, dict):
        return "not-accepted", {}
    if category == "main":
        task = tasks.get("main")
    else:
        side = tasks.get("side")
        task = side.get(quest_id) if isinstance(side, dict) else None
    if not isinstance(task, dict):
        return "not-accepted", {}
    return task.get("status", "not-accepted"), task


def _has_formal_pass(con, user_id, level_ids):
    if not level_ids:
        return False
    placeholders = ",".join("?" for _ in level_ids)
    try:
        result = con.execute(
            f"""SELECT 1 FROM circuit_level_attempts a
                 JOIN scores s ON s.id=a.score_id AND s.user_id=a.user_id
                 WHERE a.user_id=? AND a.level_id IN ({placeholders})
                   AND s.completed=1 LIMIT 1""",
            (user_id, *level_ids),
        ).fetchone()
    except sqlite3.OperationalError:
        # Unit tests and unfinished databases may not have the circuit
        # extension yet; absent proof is never treated as success.
        return False
    return result is not None


def _validate_task_transition(con, user_id, chapter_id, before, after):
    """Enforce forward-only state changes and official completion proof atomically."""
    chapter = BY_ID.get(chapter_id)
    if not chapter:
        return
    validate_quest_state(chapter, after)
    quests = chapter.get("quests") or {}
    entries = ([('main', None, quests['main'])] if quests.get('main') else []) + [
        ('side', q['id'], q) for q in quests.get('side') or []
    ]
    for category, quest_id, definition in entries:
        previous, previous_data = _task_status(before, category, quest_id)
        current, current_data = _task_status(after, category, quest_id)
        if current != previous and current not in TRANSITIONS.get(previous, ()):
            raise ValueError(f"任务状态跳转不合法：{previous} → {current}")
        old_steps = previous_data.get('steps', {}) if isinstance(previous_data.get('steps'), dict) else {}
        new_steps = current_data.get('steps', {}) if isinstance(current_data.get('steps'), dict) else {}
        for step_id, old in old_steps.items():
            if isinstance(old, dict) and old.get('status') == 'done':
                new = new_steps.get(step_id)
                if not isinstance(new, dict) or new.get('status') != 'done':
                    raise ValueError('已完成的任务步骤不得退回未完成')
        if current == 'completed' and previous != 'completed':
            mode = definition.get('completion', {}).get('mode')
            if mode == 'official-circuit':
                if not _has_formal_pass(con, user_id, definition['completion']['levelIds']):
                    raise ValueError('主线任务须通过真实电路评测方可完成')
            elif mode == 'test-only':
                steps = definition.get('steps') or []
                if not steps or any(new_steps.get(step['id'], {}).get('status') != 'done' for step in steps):
                    raise ValueError('测试任务须先完成所有测试步骤')
            else:
                raise ValueError('未开发任务不可标记完成')


def _award_progress_rewards(con, user_id, chapter_id, before, after, now):
    """Reward only explicitly configured and verified content, never placeholder tasks."""
    chapter = BY_ID.get(chapter_id, {})
    quests = chapter.get('quests') or {}
    defined = ([('main', None, quests['main'])] if quests.get('main') else []) + [
        ('side', q['id'], q) for q in quests.get('side') or []
    ]
    for category, quest_id, definition in defined:
        previous, _ = _task_status(before, category, quest_id)
        current, _ = _task_status(after, category, quest_id)
        if previous != 'completed' or current != 'submitted':
            continue
        for index, reward in enumerate(definition.get('rewards') or []):
            if reward.get('type') != 'currency':
                continue  # non-currency rewards need their own server-side implementation
            amount = reward.get('amount')
            if type(amount) is int and amount > 0:
                key = f"quest:{chapter_id}:{category}:{quest_id or 'main'}:{index}"
                _award_once(con, user_id, chapter_id, key, amount, None, now)


def award_level_reward(path, user_id, chapter_id, level_id):
    """The four implemented circuit lessons grant coins, no fabricated items."""
    with closing(connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        awarded = _award_once(con, user_id, chapter_id, f"level:{level_id}", 30,
                              None, now_iso())
        con.commit()
        return awarded


def game_profile(path, user_id):
    with closing(connect(path)) as con:
        wallet = con.execute("SELECT balance FROM game_wallets WHERE user_id=?", (user_id,)).fetchone()
        rewards = con.execute("SELECT chapter_id,reward_key,amount,item_id,item_name,item_note,created_at FROM game_rewards WHERE user_id=? ORDER BY id", (user_id,)).fetchall()
    inventory = {}
    for row in rewards:
        if row["item_id"]:
            inventory.setdefault(row["chapter_id"], []).append({"id":row["item_id"], "name":row["item_name"], "note":row["item_note"]})
    return {"balance": wallet["balance"] if wallet else 0, "inventory": inventory,
            "rewards": [{"chapterId":r["chapter_id"],"key":r["reward_key"],"amount":r["amount"],"itemName":r["item_name"],"createdAt":display_time(r["created_at"])} for r in rewards]}

def start_attempt(path, user_id, chapter_id):
    """仅在已有章节进度且已接取主线时签发尝试ID。"""
    with closing(connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
            (user_id, chapter_id)
        ).fetchone()
        if row is None:
            con.rollback()
            raise ValueError("尚未进入本章，没有可开始的关卡")
        try:
            state = json.loads(row["state_json"])
            main_status = state.get("tasks", {}).get("main", {}).get("status")
        except (TypeError, ValueError, AttributeError):
            main_status = None
        if main_status not in ("accepted", "completed", "submitted"):
            con.rollback()
            raise ValueError("请先与NPC交互并接取主线任务")
        attempt_id = secrets.token_urlsafe(24)
        con.execute(
            "INSERT INTO attempts(attempt_id,user_id,chapter_id,started_at) VALUES(?,?,?,?)",
            (attempt_id, user_id, chapter_id, now_iso())
        )
        con.commit()
        return {"attemptId": attempt_id, "chapterId": chapter_id}


def unpack_score(row):
    return {
        "id": row["id"],
        "chapterId": row["chapter_id"],
        "score": row["score"],
        "completed": bool(row["completed"]),
        "details": json.loads(row["details_json"]),
        "attemptId": row["attempt_id"],
        "submittedAt": display_time(row["submitted_at"]),
    }


def add_score(path, user_id, chapter_id, score, completed, details, attempt_id):
    with closing(connect(path)) as con:
        con.execute("BEGIN IMMEDIATE")
        old = con.execute(
            "SELECT * FROM scores WHERE user_id=? AND attempt_id=?",
            (user_id, attempt_id)
        ).fetchone()
        if old:
            con.rollback()
            # 重试应完全相同，避免幂等键复用后悄悄接受不同的详情。
            if (old["chapter_id"] != chapter_id or old["score"] != score
                or bool(old["completed"]) != completed
                or json.loads(old["details_json"]) != details):
                return None, False
            return unpack_score(old), False
        issued = con.execute(
            "SELECT 1 FROM attempts WHERE user_id=? AND chapter_id=? AND attempt_id=?",
            (user_id, chapter_id, attempt_id)
        ).fetchone()
        if issued is None:
            con.rollback()
            raise ValueError("尝试编号不是由服务器签发的，不能提交成绩")
        progress = con.execute(
            "SELECT state_json FROM progress WHERE user_id=? AND chapter_id=?",
            (user_id, chapter_id)
        ).fetchone()
        try:
            main_status = json.loads(progress["state_json"])["tasks"]["main"]["status"]
        except (TypeError, ValueError, KeyError):
            main_status = None
        if main_status not in ("accepted", "completed", "submitted"):
            con.rollback()
            raise ValueError("没有有效的主线任务进度，不能提交成绩")
        cur = con.execute(
            """INSERT INTO scores(user_id,chapter_id,score,completed,details_json,
               attempt_id,submitted_at) VALUES(?,?,?,?,?,?,?)""",
            (user_id, chapter_id, score, int(completed),
             json.dumps(details, ensure_ascii=False), attempt_id, now_iso())
        )
        con.commit()
        row = con.execute("SELECT * FROM scores WHERE id=?", (cur.lastrowid,)).fetchone()
        return unpack_score(row), True


def score_status(path, user_id):
    with closing(connect(path)) as con:
        rows = con.execute(
            """SELECT chapter_id,MAX(score) best_score,MAX(completed) completed
               FROM scores WHERE user_id=? GROUP BY chapter_id""", (user_id,)
        ).fetchall()
        return {
            r["chapter_id"]: {
                "completed": bool(r["completed"]), "bestScore": r["best_score"]
            } for r in rows
        }


def my_scores(path, user_id):
    with closing(connect(path)) as con:
        return [unpack_score(r) for r in con.execute(
            "SELECT * FROM scores WHERE user_id=? ORDER BY id DESC", (user_id,)
        ).fetchall()]


def literal_like_contains(search):
    """Keep %, _, and backslash literal in a parameterized SQLite LIKE pattern."""
    value = (search.replace("\\", "\\\\").replace("%", "\\%")
             .replace("_", "\\_"))
    return f"%{value}%"


def scoped_sql(user, class_id=None, search="", kind="scores"):
    """构建供教师端和管理员端共用的只读过滤器，所有外部值均绑定参数。"""
    params = []
    clauses = ["u.role='student'", "u.active=1"]
    if user["role"] == "teacher":
        clauses.append(
            "EXISTS(SELECT 1 FROM teacher_classes tc JOIN classes c2 ON c2.id=tc.class_id "
            "WHERE tc.teacher_id=? AND tc.class_id=u.class_id AND c2.archived=0)"
        )
        params.append(user["id"])
    if class_id is not None:
        clauses.append("u.class_id=?")
        params.append(class_id)
    if search:
        pattern = literal_like_contains(search)
        clauses.append(
            "(u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"
        )
        params += [pattern, pattern]
    return " AND ".join(clauses), params


def scoped_records(path, user, kind, class_id=None, search="", page=1, page_size=20,
                   all_rows=False):
    if kind not in ("scores", "progress", "students"):
        raise ValueError("不支持的列表")
    table = "scores s" if kind == "scores" else ("progress p" if kind == "progress" else "")
    join = f" JOIN {table} ON {('s' if kind == 'scores' else 'p')}.user_id=u.id" if table else ""
    where, params = scoped_sql(user, class_id, search, kind)
    base = (f"FROM users u LEFT JOIN classes c ON c.id=u.class_id{join} "
            f"WHERE {where}")
    with closing(connect(path)) as con:
        total = con.execute("SELECT COUNT(*) " + base, params).fetchone()[0]
        if kind == "scores":
            order = "ORDER BY s.id DESC"
            cols = "s.*,u.username,u.display_name,u.student_no,u.class_id,c.name class_name"
        elif kind == "progress":
            order = "ORDER BY p.updated_at DESC,p.chapter_id"
            cols = "p.*,u.username,u.display_name,u.student_no,u.class_id,c.name class_name"
        else:
            order = "ORDER BY u.student_no,u.id"
            cols = ("u.id,u.username,u.display_name,u.student_no,u.class_id,"
                    "u.must_change_password,c.name class_name")
        query = f"SELECT {cols} {base} {order}"
        arguments = list(params)
        if not all_rows:
            query += " LIMIT ? OFFSET ?"
            arguments.extend((page_size, (page - 1) * page_size))
        else:
            query += " LIMIT 10001"
        rows = con.execute(query, arguments).fetchall()
        items = []
        for r in rows:
            student = {
                "id": r["user_id"] if kind != "students" else r["id"],
                "studentNo": r["student_no"],
                "username": r["username"],
                "displayName": r["display_name"],
                "classId": r["class_id"],
                "className": r["class_name"],
            }
            if kind == "scores":
                item = {**unpack_score(r), "student": student}
            elif kind == "progress":
                item = {**unpack_progress(r), "student": student}
                item.pop("state", None)  # 教师不读取学生私有章节存档 JSON
            else:
                item = {
                    "student": student,
                     "needsPasswordSetup": bool(r["must_change_password"]),
                }
            items.append(item)
        return {
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": (total + page_size - 1) // page_size,
            "items": items,
        }
