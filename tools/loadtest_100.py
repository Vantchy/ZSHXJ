# -*- coding: utf-8 -*-
"""铸算·华夏纪 100 人同时在线压测脚本（只用 Python 标准库）。

用法：把本文件放在仓库的 tools 文件夹里，在仓库根目录运行：
    python tools/loadtest_100.py
可选参数：
    --users 100     虚拟学生人数（默认 100）
    --port  8899    测试服务端口（默认 8899，避开日常的 8765）
    --keep          结束后保留临时数据库，方便排查

流程：脚本自建临时数据库和账号，自行启动服务，100 名学生同时执行
登录 -> 打开关卡 -> 保存电路 10 次 -> 试算 10 次 -> 正式提交 1 次，
最后打印总请求数、错误数、总耗时和登录/提交的延迟分布。
判定标准：错误数为 0 即通过；登录延迟高只说明密码校验在排队
（PBKDF2 按设计如此），不是功能错误，脚本会单独提示。
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # 本文件位于 tools/，仓库根目录是上一级
sys.path.insert(0, str(ROOT))
import database as db  # noqa: E402

PASSWORD = "LoadTest123"
LEVEL = "ch1_cmos_not"


def call(port, method, path, body=None, token=None):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": "Bearer " + token} if token else {})})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read() or b"{}"), time.perf_counter() - started
    except urllib.error.HTTPError as e:
        return e.code, {}, time.perf_counter() - started


def student_flow(port, idx, graph, results, lock):
    user = f"load_student_{idx:03d}"
    errs = []

    def check(step, code, want):
        if code != want:
            errs.append(f"{user} {step} -> HTTP {code}（期望 {want}）")

    code, reply, login_s = call(port, "POST", "/api/auth/login",
                                {"username": user, "password": PASSWORD})
    check("登录", code, 200)
    if code != 200:
        with lock:
            results["errors"].extend(errs)
        return
    token = reply["token"]
    with lock:
        results["login_s"].append(login_s)

    code, _, _ = call(port, "GET", f"/api/levels/{LEVEL}", token=token)
    check("打开关卡", code, 200)

    code, prog, _ = call(port, "GET", "/api/progress", token=token)
    check("读取进度", code, 200)
    record = next((x for x in prog.get("progress", []) if x["chapterId"] == "ch1"), None)
    revision = record["revision"] if record else 0
    state = record["state"] if record else {
        "schemaVersion": 2, "tasks": {"main": {"status": "accepted"}},
        "circuitLevels": {}}
    state.setdefault("circuitLevels", {})[LEVEL] = {
        "levelVersion": 1, "graph": graph, "simulationState": {}}

    for i in range(10):
        code, saved, _ = call(port, "PUT", "/api/progress/ch1",
                              {"checkpoint": "circuit_draft",
                               "expectedRevision": revision, "state": state},
                              token=token)
        check(f"保存#{i + 1}", code, 200)
        if code == 200:
            revision = saved["progress"]["revision"]
        code, _, _ = call(port, "POST", f"/api/levels/{LEVEL}/simulate",
                          {"levelVersion": 1, "graph": graph,
                           "inputs": {"A": i % 2}}, token=token)
        check(f"试算#{i + 1}", code, 200)

    code, att, _ = call(port, "POST", f"/api/levels/{LEVEL}/attempts/start",
                        {"levelVersion": 1}, token=token)
    check("发起尝试", code, 201)
    if code == 201:
        code, _, submit_s = call(port, "POST", f"/api/levels/{LEVEL}/submit",
                                 {"levelVersion": 1, "attemptId": att["attemptId"],
                                  "graph": graph}, token=token)
        check("正式提交", code, 201)
        with lock:
            results["submit_s"].append(submit_s)
    with lock:
        results["errors"].extend(errs)
        results["done"] += 1


def pct(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    fixture = ROOT / "tests" / "circuit_fixtures" / "cmos_not.json"
    graph = json.loads(fixture.read_text(encoding="utf-8"))

    tmp = tempfile.mkdtemp(prefix="zshxj_load_")
    db_path = os.path.join(tmp, "load.sqlite3")
    db.init(db_path)
    for i in range(args.users):
        db.create_user(db_path, f"load_student_{i:03d}", PASSWORD, f"压测学生{i:03d}")
    print(f"已创建 {args.users} 个压测账号，数据库：{db_path}")

    server = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py"), "--port", str(args.port),
         "--db", db_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                code, _, _ = call(args.port, "GET", "/api/chapters")
                break
            except Exception:
                time.sleep(0.5)
        else:
            print("服务未能启动，压测中止。")
            return 1
        print(f"服务已启动（端口 {args.port}），开始压测……")

        results = {"errors": [], "login_s": [], "submit_s": [], "done": 0}
        lock = threading.Lock()
        threads = [threading.Thread(target=student_flow,
                                    args=(args.port, i, graph, results, lock))
                   for i in range(args.users)]
        started = time.perf_counter()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        wall = time.perf_counter() - started

        total = args.users * 25
        print("=" * 56)
        print(f"完成学生数：{results['done']}/{args.users}")
        print(f"总请求数：{total}（每人 25 个：登录1+打开关卡1+读进度1+保存10+试算10+发起尝试1+提交1）")
        print(f"错误数：{len(results['errors'])}")
        for e in results["errors"][:10]:
            print("  错误示例：", e)
        print(f"总耗时：{wall:.1f} 秒")
        if results["login_s"]:
            print(f"登录延迟：中位 {statistics.median(results['login_s']):.2f}s，"
                  f"95分位 {pct(results['login_s'], 0.95):.2f}s，"
                  f"最慢 {max(results['login_s']):.2f}s")
        if results["submit_s"]:
            print(f"提交延迟：中位 {statistics.median(results['submit_s']):.2f}s，"
                  f"最慢 {max(results['submit_s']):.2f}s")
        print("判定：", "通过（零错误）" if not results["errors"] else "未通过（有错误，见上）")
        if results["login_s"] and pct(results["login_s"], 0.95) > 5:
            print("提示：登录 95 分位超过 5 秒，是全员同一秒登录时密码校验"
                  "（PBKDF2）在 CPU 上排队，已知现象；验收讲解时说明"
                  "“同秒登录会排队、错峰或四核机器可缓解”即可。")
        return 0 if not results["errors"] else 2
    finally:
        server.terminate()
        if not args.keep:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            print("已保留临时数据库：", db_path)


if __name__ == "__main__":
    raise SystemExit(main())
