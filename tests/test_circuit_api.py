"""Official circuit HTTP contract, server grading and transaction regression."""
import copy
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import database as db
import level_content as content
import circuit_engine as ce
from server import create_server


def fixture(name):
    return json.loads((ROOT/"tests/circuit_fixtures"/f"{name}.json").read_text())

def circuit_save(level_id, graph, version=1):
    return {"schemaVersion":2,
            "tasks":{"main":{"status":"accepted"}},
            "circuits":{},
            "circuitLevels":{level_id:{
                "levelVersion":version,"graph":graph,"simulationState":{}}}}

class CircuitHttpFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.tmp.name)/"v1.sqlite3"
        cls.server=create_server("127.0.0.1",0,cls.path)
        cls.port=cls.server.server_address[1]
        cls.worker=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.worker.start()
        cls.teacher=db.create_user(cls.path,"v1_teacher","TeacherPassword123",
                                   "课堂老师",role="teacher")
        cls.student=db.create_user(cls.path,"v1_student","StudentPassword123",
                                   "甲同学",role="student")
        cls.other=db.create_user(cls.path,"v1_other","StudentPassword123",
                                  "乙同学",role="student")
        with closing(db.connect(cls.path)) as con:
            now=db.now_iso()
            cl=con.execute("INSERT INTO classes(name,created_at) VALUES(?,?)",
                           ("后端电路测试班",now)).lastrowid
            cls.class_id=cl
            con.execute("UPDATE users SET class_id=? WHERE id IN (?,?)",
                        (cl,cls.student["id"],cls.other["id"]))
            con.execute("INSERT INTO teacher_classes(teacher_id,class_id) VALUES(?,?)",
                        (cls.teacher["id"],cl))
            con.commit()
        cls.tokens={}
        cls.tokens["teacher"]=cls.auth("v1_teacher","TeacherPassword123")
        cls.tokens["student"]=cls.auth("v1_student","StudentPassword123")
        cls.tokens["other"]=cls.auth("v1_other","StudentPassword123")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=5)
        cls.tmp.cleanup()

    @classmethod
    def request(cls,method,path,body=None,actor="student"):
        data=None
        headers={}
        if actor in cls.tokens:
            headers["Authorization"]="Bearer "+cls.tokens[actor]
        if body is not None:
            data=json.dumps(body,ensure_ascii=False).encode("utf-8")
            headers["Content-Type"]="application/json"
        req=urllib.request.Request(
            f"http://127.0.0.1:{cls.port}{path}",
            method=method,data=data,headers=headers)
        try:
            response=urllib.request.urlopen(req,timeout=25)
        except urllib.error.HTTPError as error:
            response=error
        with response:
            data=response.read()
            return response.status,json.loads(data.decode("utf-8"))

    @classmethod
    def auth(cls,username,password):
        code,data=cls.request("POST","/api/auth/login",
                             {"username":username,"password":password},actor=None)
        assert code==200,(code,data)
        return data["token"]

    @classmethod
    def open_level(cls,level_id,actor="student"):
        status,data=cls.request("GET",f"/api/levels/{level_id}",actor=actor)
        assert status==200,(status,data)
        return data["level"]

    @classmethod
    def save_level(cls,level_id,g,actor="student",version=1):
        code, progress=cls.request("GET","/api/progress",actor=actor)
        assert code==200,(code,progress)
        record=next((x for x in progress["progress"] if x["chapterId"]=="ch1"),None)
        old_state=copy.deepcopy(record["state"]) if record else {
            "schemaVersion":2,"tasks":{"main":{"status":"accepted"}},"circuitLevels":{}}
        old_state["circuitLevels"][level_id]={
            "levelVersion":version,"graph":g,"simulationState":{}}
        return cls.request("PUT","/api/progress/ch1",{
            "checkpoint":"circuit_draft","expectedRevision":
                record["revision"] if record else 0,
            "state":old_state,
        },actor=actor)

    @classmethod
    def begin(cls,level_id,actor="student",version=1):
        code,data=cls.request("POST",f"/api/levels/{level_id}/attempts/start",
                              {"levelVersion":version},actor=actor)
        assert code==201,(code,data)
        return data["attemptId"]

    @classmethod
    def grade(cls,level_id,attempt,g,actor="student",version=1,**extra):
        return cls.request("POST",f"/api/levels/{level_id}/submit",{
            "levelVersion":version,"attemptId":attempt,"graph":g,**extra
        },actor=actor)

    def test_01_login_catalog_hidden_tests_never_public(self):
        code,catalog=self.request("GET","/api/levels")
        self.assertEqual(code,200)
        self.assertEqual(len(catalog["levels"]),4)
        self.assertTrue(all("hiddenVectors" not in item for item in catalog["levels"]))
        code,public=self.request("GET","/api/levels/ch1_cmos_not")
        self.assertEqual(code,200)
        level=public["level"]
        self.assertEqual(level["levelVersion"],1)
        self.assertEqual(level["circuitSchemaVersion"],1)
        self.assertEqual(level["chapterSaveSchemaVersion"],2)
        self.assertEqual(level["interface"]["inputs"][0]["name"],"A")
        self.assertEqual(len(level["publicVectors"]),1)
        code,summaries=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200)
        self.assertEqual(summaries["results"],[],
                         "Opening a lesson must not create a blank grade")
        status,teacher_empty=self.request(
            "GET","/api/teacher/circuit-results",actor="teacher")
        self.assertEqual(status,200)
        self.assertEqual(teacher_empty["results"],[])
        self.assertEqual(teacher_empty["pagination"]["total"],0)
        self.assertNotIn("hiddenVectors",level)
        self.assertNotIn("sequentialScripts",level)
        code,denied=self.request("GET","/api/levels/ch1_cmos_not",actor="teacher")
        self.assertEqual(code,403)
        self.assertEqual(denied["code"],"FORBIDDEN")
        code,reg=self.request("GET","/api/circuit/components")
        self.assertEqual(code,200)
        self.assertIn("nmos",reg["types"])
        self.assertIn("nand",reg["types"])
        self.assertEqual(reg["packages"],[])

    def test_01b_first_official_submission_creates_only_its_own_grade(self):
        # A fresh account should see no blank grades, despite published
        # lessons; opening, saving, simulating and STARTING an attempt do not
        # create grade rows. Only a successful /submit does so.
        db.create_user(self.path,"fresh_grade_student","StudentPassword123","首次提交学生")
        self.tokens["fresh"]=self.auth("fresh_grade_student","StudentPassword123")
        status,before=self.request("GET","/api/circuit/results/mine",actor="fresh")
        self.assertEqual((status,before["results"]),(200,[]))
        code,level=self.request("GET","/api/levels/ch1_cmos_not",actor="fresh")
        self.assertEqual(code,200,level)
        code,opened=self.request("GET","/api/circuit/results/mine",actor="fresh")
        self.assertEqual((code,opened["results"]),(200,[]))
        graph=fixture("cmos_not")
        code,saved=self.save_level("ch1_cmos_not",graph,actor="fresh")
        self.assertEqual(code,200,saved)
        code,preview=self.request("POST","/api/levels/ch1_cmos_not/simulate",
            {"levelVersion":1,"graph":graph,"inputs":{"A":1}},actor="fresh")
        self.assertEqual(code,200,preview)
        attempt=self.begin("ch1_cmos_not",actor="fresh")
        code,not_yet=self.request("GET","/api/circuit/results/mine",actor="fresh")
        self.assertEqual((code,not_yet["results"]),(200,[]))
        code,graded=self.grade("ch1_cmos_not",attempt,graph,actor="fresh")
        self.assertEqual(code,201,graded)
        self.assertEqual(graded["record"]["submissionCount"],1)
        code,after=self.request("GET","/api/circuit/results/mine",actor="fresh")
        self.assertEqual(code,200,after)
        self.assertEqual(len(after["results"]),1)
        self.assertEqual(after["results"][0]["levelId"],"ch1_cmos_not")
        self.assertEqual(after["results"][0]["bestPassedCount"],2)
        self.assertEqual(after["results"][0]["status"],"已完成")

    def test_02_versioned_save_realtime_simulation_and_pin_values(self):
        g=fixture("cmos_not")
        code,saved=self.save_level("ch1_cmos_not",g)
        self.assertEqual(code,200,saved)
        self.assertEqual(saved["progress"]["revision"],1)
        for a in (0,1):
            code,result=self.request(
                "POST","/api/levels/ch1_cmos_not/simulate",
                {"levelVersion":1,"graph":g,"inputs":{"A":a},"state":{},"cycles":0})
            self.assertEqual(code,200,result)
            self.assertEqual(result["outputs"]["Y"],1-a)
            self.assertFalse(result["unstable"])
            self.assertIn("P",result["pins"])
            self.assertIn("state",result)
        code,read=self.request("GET","/api/progress")
        self.assertEqual(code,200)
        self.assertEqual(read["progress"][0]["revision"],1,
                         "Stateless live simulation must not alter saved revision")
        code,stale=self.request("PUT","/api/progress/ch1",{
            "checkpoint":"stale","expectedRevision":0,"state":saved["progress"]["state"]})
        self.assertEqual(code,409)
        self.assertEqual(stale["code"],"REVISION_CONFLICT")
        code,wrong=self.request("PUT","/api/progress/ch1",{
            "checkpoint":"bad_schema","expectedRevision":1,
            "state":{"schemaVersion":99,"circuits":{}}})
        self.assertEqual(code,409)
        self.assertEqual(wrong["code"],"CHAPTER_SCHEMA_MISMATCH")
        code,read=self.request("GET","/api/progress")
        self.assertEqual(read["progress"][0]["revision"],1,
                         "Wrong schema must never clear old save")
        code,erased=self.request("PUT","/api/progress/ch1",{
            "checkpoint":"legacy_write","expectedRevision":1,
            "state":{"schemaVersion":2,"tasks":{"main":{"status":"accepted"}}}})
        self.assertEqual(code,409)
        self.assertEqual(erased["code"],"CIRCUIT_SAVE_PROTECTED",
                         "A legacy client cannot silently wipe an existing circuit")
        bad=copy.deepcopy(g);bad["schemaVersion"]=2
        code,data=self.request("PUT","/api/progress/ch1",{
            "checkpoint":"bad","expectedRevision":1,
            "state":circuit_save("ch1_cmos_not",bad)})
        self.assertEqual(code,422)
        self.assertEqual(data["code"],"CIRCUIT_SCHEMA_MISMATCH")
        code,wrong=self.request("POST","/api/levels/ch1_cmos_not/simulate",
            {"levelVersion":2,"graph":g,"inputs":{"A":0}})
        self.assertEqual(code,409)
        self.assertEqual(wrong["code"],"LEVEL_VERSION_MISMATCH")

    def test_03_perfect_server_grade_immutable_award_and_teacher(self):
        g=fixture("cmos_not")
        attempt=self.begin("ch1_cmos_not")
        code,spoof=self.grade("ch1_cmos_not",attempt,g,score=100,completed=True)
        self.assertEqual(code,422)
        self.assertEqual(spoof["code"],"CLIENT_SCORE_FORBIDDEN")
        code,legacy=self.request("POST","/api/scores",{
            "chapterId":"ch1","score":100,"completed":True,
            "details":{},"attemptId":attempt})
        self.assertEqual(code,403)
        self.assertEqual(legacy["code"],"CLIENT_SCORE_FORBIDDEN")
        code,graded=self.grade("ch1_cmos_not",attempt,g)
        self.assertEqual(code,201,graded)
        self.assertTrue(graded["completed"])
        self.assertEqual((graded["passedCount"],graded["totalCount"]),(2,2))
        self.assertEqual(graded["submission"]["componentCount"],2)
        self.assertEqual(graded["submission"]["minimalComponentCount"],2)
        self.assertNotIn("score",graded)
        self.assertEqual(graded["submission"]["warnings"],[])
        self.assertEqual(graded["passedCount"],2)
        pkg=graded["package"]
        self.assertEqual(pkg["type"],"pkg:cmos_not@1")
        self.assertTrue(pkg["fresh"])
        code,again=self.grade("ch1_cmos_not",attempt,g)
        self.assertEqual(code,200,again)  # Duplicate identical attempt is idempotent.
        self.assertFalse(again["created"])
        self.assertEqual(again["submission"],graded["submission"])
        modified=copy.deepcopy(g);modified["components"][0]["x"]=1
        code,conflict=self.grade("ch1_cmos_not",attempt,modified)
        self.assertEqual(code,409)
        self.assertEqual(conflict["code"],"ATTEMPT_CONFLICT")
        code,listing=self.request("GET","/api/circuit/components")
        self.assertEqual(len(listing["packages"]),1)
        self.assertTrue(listing["packages"][0]["isCurrent"])
        code,read=self.request("GET","/api/circuit/components/cmos_not/1")
        self.assertEqual(code,200)
        self.assertTrue(read["component"]["readOnly"])
        self.assertEqual(read["component"]["graph"],g)
        code,hidden=self.request("GET","/api/circuit/components/cmos_not/1",actor="other")
        self.assertEqual(code,404)
        code,teacher=self.request("GET","/api/teacher/scores",actor="teacher")
        self.assertEqual(code,200)
        found=[x for x in teacher["scores"] if x["attemptId"]==attempt]
        self.assertEqual(len(found),1)
        self.assertEqual(found[0]["score"],0, "Legacy column is an unused compatibility placeholder")
        self.assertEqual(found[0]["details"]["passedCount"],2)
        self.assertEqual(found[0]["details"]["assessmentType"],"circuit_server")

    def test_03a_student_summary_only_lists_submitted_lessons(self):
        code,reply=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200,reply)
        self.assertEqual(len(reply["results"]),1,
                         "Other 3 published lessons must not become empty grade rows")
        item=reply["results"][0]
        self.assertEqual(item["levelId"],"ch1_cmos_not")
        self.assertEqual(item["assessmentType"],"circuit_server")
        self.assertEqual(item["status"],"已完成")
        self.assertEqual((item["bestPassedCount"],item["totalCount"]),(2,2))
        self.assertEqual(item["submissionCount"],1)
        self.assertTrue(item["completedAt"])
        self.assertNotIn("score",item)
        self.assertNotIn("completionRate",item)

    def test_03b_legacy_demo_cannot_forge_formal_metadata_or_awards(self):
        code,started=self.request("POST",
            "/api/chapters/ch1/attempts/start",{})
        self.assertEqual(code,201,started)
        code,legacy=self.request("POST","/api/scores",{
            "chapterId":"ch1","attemptId":started["attemptId"],
            "score":99,"completed":True,
            "details":{"assessmentType":"circuit_server",
                       "levelId":"ch1_cmos_not",
                       "awardedPackage":{"type":"pkg:fake@1"},
                       "durationSeconds":12}
        })
        self.assertEqual(code,201,legacy)
        fields=legacy["score"]["details"]
        self.assertEqual(fields["assessmentType"],"legacy_demo")
        self.assertNotIn("awardedPackage",fields)
        self.assertNotIn("levelId",fields)
        self.assertEqual(fields["durationSeconds"],12)
        code,owned=self.request("GET","/api/circuit/components")
        self.assertEqual(len(owned["packages"]),1,
                         "Legacy demo scores cannot add a new frozen component")

    def test_03bb_demo_saved_in_level_appears_after_submit(self):
        # 浏览器中的演示场景通过 /api/scores 保存，
        # 与正式电路隐藏测试判题的成绩独立展示。
        code,attempt=self.request("POST","/api/chapters/ch1/attempts/start",{})
        self.assertEqual(code,201,attempt)
        code,submission=self.request("POST","/api/scores",{
            "chapterId":"ch1","attemptId":attempt["attemptId"],
            "score":0,"completed":True,
            "details":{"passedCount":4,"totalCount":4,"unit":"组","mock":True},
        })
        self.assertEqual(code,201,submission)
        code,grades=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200,grades)
        self.assertEqual(len(grades["results"]),2,
                         "Only one formal circuit grade and one demo grade")
        demo=next(g for g in grades["results"]
                  if g["levelId"]=="demo:ch1")
        self.assertEqual(demo["assessmentType"],"legacy_demo")
        self.assertIn("演示",demo["levelTitle"])
        self.assertEqual((demo["bestPassedCount"],demo["totalCount"]),(4,4))
        self.assertEqual(demo["unit"],"组")
        self.assertEqual(demo["status"],"已完成")
        self.assertEqual(demo["submissionCount"],2,
                         "Both prior legacy and the new demo submission count")
        self.assertTrue(demo["completedAt"])
        code,tgr=self.request("GET","/api/teacher/circuit-results",actor="teacher")
        self.assertEqual(code,200,tgr)
        visible=next(g for g in tgr["results"]
                     if g["student"]["id"]==self.student["id"]
                     and g["levelId"]=="demo:ch1")
        self.assertEqual(visible["completionRate"],100)
        self.assertEqual(visible["submissionCount"],2)

    def test_03bc_preupgrade_demo_counts_and_retry_are_compatible(self):
        # 验证缺少组数字段的已结算演示记录仍可读取和幂等重试。
        db.create_user(self.path,"v1_1_demo_student","StudentPassword123","旧演示数据学生")
        self.tokens["olderdemo"]=self.auth("v1_1_demo_student","StudentPassword123")
        with closing(db.connect(self.path)) as con:
            uid=con.execute(
                "SELECT id FROM users WHERE username='v1_1_demo_student'"
            ).fetchone()["id"]
            con.execute("""INSERT INTO progress(user_id,chapter_id,checkpoint,
                state_json,revision,updated_at) VALUES(?,?,?,?,?,?)""",
                (uid,"ch1","main_accepted",
                 json.dumps({"schemaVersion":2,"tasks":{"main":{"status":"accepted"}}}),
                 1,db.now_iso()))
            con.commit()
        code,attempt=self.request("POST","/api/chapters/ch1/attempts/start",{},
                                   actor="olderdemo")
        self.assertEqual(code,201,attempt)
        body={"chapterId":"ch1","attemptId":attempt["attemptId"],
              "score":0,"completed":True,
              "details":{"passedCount":4,"totalCount":4,"unit":"组","mock":True}}
        code,graded=self.request("POST","/api/scores",body,actor="olderdemo")
        self.assertEqual(code,201,graded)
        with closing(db.connect(self.path)) as con:
            # 模拟已入库但不包含组数信息的固定演示记录。
            con.execute("""UPDATE scores SET details_json=?
                WHERE user_id=? AND attempt_id=?""",
                (json.dumps({"unit":"组","mock":True,
                             "assessmentType":"legacy_demo"}),
                 uid,attempt["attemptId"]))
            con.commit()
        code,view=self.request("GET","/api/circuit/results/mine",actor="olderdemo")
        self.assertEqual(code,200,view)
        self.assertEqual(len(view["results"]),1)
        entry=view["results"][0]
        self.assertEqual(entry["assessmentType"],"legacy_demo")
        self.assertEqual((entry["bestPassedCount"],entry["totalCount"]),(4,4))
        code,retry=self.request("POST","/api/scores",body,actor="olderdemo")
        self.assertEqual(code,200,retry)
        self.assertFalse(retry["created"])
        code,summary=self.request("GET","/api/circuit/results/mine",actor="olderdemo")
        self.assertEqual(summary["results"][0]["submissionCount"],1)
        self.assertEqual(summary["results"][0]["bestPassedCount"],4)

    def test_03bd_old_numeric_demo_is_displayed_without_fake_groups(self):
        db.create_user(self.path,"v4_numeric_demo","StudentPassword123","数值旧记录")
        self.tokens["oldnumeric"]=self.auth("v4_numeric_demo","StudentPassword123")
        with closing(db.connect(self.path)) as con:
            uid=con.execute(
                "SELECT id FROM users WHERE username='v4_numeric_demo'"
            ).fetchone()["id"]
            con.execute("""INSERT INTO progress(user_id,chapter_id,checkpoint,
                state_json,revision,updated_at) VALUES(?,?,?,?,?,?)""",
                (uid,"ch1","main_accepted",
                 json.dumps({"schemaVersion":2,"tasks":{"main":{"status":"accepted"}}}),
                 1,db.now_iso()))
            con.commit()
        code,attempt=self.request("POST","/api/chapters/ch1/attempts/start",{},
                                   actor="oldnumeric")
        self.assertEqual(code,201,attempt)
        code,legacy=self.request("POST","/api/scores",{
            "chapterId":"ch1","attemptId":attempt["attemptId"],
            "score":82,"completed":True,
            "details":{"attempts":2,"durationSeconds":60,"mock":True}},
            actor="oldnumeric")
        self.assertEqual(code,201,legacy)
        code,records=self.request("GET","/api/circuit/results/mine",actor="oldnumeric")
        self.assertEqual(code,200,records)
        self.assertEqual(len(records["results"]),1)
        row=records["results"][0]
        self.assertEqual(row["status"],"已完成")
        self.assertEqual(row["submissionCount"],1)
        self.assertIsNone(row["bestPassedCount"])
        self.assertIsNone(row["totalCount"])
        self.assertIsNone(row["completionRate"] if "completionRate" in row else None)
        self.assertNotIn("score",row)

    def test_03be_invalid_demo_groups_do_not_save_or_burn_attempt(self):
        code,issued=self.request("POST","/api/chapters/ch1/attempts/start",
                                 {},actor="olderdemo")
        self.assertEqual(code,201,issued)
        payload={"chapterId":"ch1","attemptId":issued["attemptId"],
                 "score":0,"completed":True,
                 "details":{"passedCount":5,"totalCount":4,
                            "unit":"组","mock":True}}
        code,bad=self.request("POST","/api/scores",payload,actor="olderdemo")
        self.assertEqual(code,400)
        self.assertEqual(bad["code"],"INVALID_DEMO_GROUPS")
        code,after=self.request("GET","/api/circuit/results/mine",actor="olderdemo")
        self.assertEqual(code,200)
        self.assertEqual(after["results"][0]["submissionCount"],1)
        payload["details"]["passedCount"]=4
        code,good=self.request("POST","/api/scores",payload,actor="olderdemo")
        self.assertEqual(code,201,good)
        self.assertEqual(good["score"]["details"]["passedCount"],4)
        self.assertEqual(good["score"]["details"]["totalCount"],4)
        code,final=self.request("GET","/api/circuit/results/mine",actor="olderdemo")
        self.assertEqual(final["results"][0]["submissionCount"],2)

    def test_03c_bad_resubmission_cannot_revoke_completion(self):
        code,original=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200)
        old=next(x for x in original["results"]
                 if x["levelId"]=="ch1_cmos_not")
        self.assertEqual(old["status"],"已完成")
        original_completed_at=old["completedAt"]
        partial={
            "schemaVersion":1,
            "components":[
                {"id":"A","type":"input","name":"A","x":0,"y":0},
                {"id":"G","type":"gnd","x":0,"y":0},
                {"id":"Y","type":"output","name":"Y","x":0,"y":0},
            ],
            "wires":[{"from":{"comp":"G","pin":"out"},
                      "to":{"comp":"Y","pin":"in"}}],
        }
        attempt=self.begin("ch1_cmos_not")
        code,second=self.grade("ch1_cmos_not",attempt,partial)
        self.assertEqual(code,201,second)
        self.assertFalse(second["submission"]["completed"])
        self.assertEqual(second["submission"]["completionStatus"],"未完成")
        self.assertEqual(second["completionStatus"],"已完成",
                         "One bad retry must not revoke accumulated completion")
        self.assertEqual(second["submission"]["passedCount"],1)
        self.assertEqual(second["submission"]["totalCount"],2)
        self.assertEqual(second["status"],"已完成")
        self.assertTrue(second["completed"])
        self.assertEqual(second["record"]["bestPassedCount"],2)
        self.assertEqual(second["record"]["submissionCount"],2)
        self.assertEqual(second["record"]["completedAt"],original_completed_at)
        self.assertIsNone(second["package"])
        self.assertEqual(second["submission"]["minimalComponentCount"],2)
        self.assertEqual(second["submission"]["componentCount"],0)
        self.assertEqual(second["submission"]["firstFailure"],{
            "kind":"truth","groupNumber":1,
            "inputs":{"A":0},"expectedOutputs":{"Y":1},
            "actualOutputs":{"Y":0},"unstable":False,
        })
        code,latest=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200)
        item=next(x for x in latest["results"]
                  if x["levelId"]=="ch1_cmos_not")
        self.assertEqual(item["completedAt"],original_completed_at)
        self.assertEqual(item["bestPassedCount"],2)
        self.assertEqual(item["submissionCount"],2)
        # Public chapter map also keeps completed=true (monotonic).
        code,chapter=self.request("GET","/api/chapters")
        self.assertTrue(next(x for x in chapter["chapters"]
                        if x["id"]=="ch1")["completed"])

    def test_04_partial_score_forbidden_and_non_owner(self):
        self.open_level("ch1_cmos_not",actor="other")
        zero= {"schemaVersion":1,"components":[
            {"id":"A","type":"input","name":"A","x":0,"y":0},
            {"id":"G","type":"gnd","x":0,"y":0},
            {"id":"Y","type":"output","name":"Y","x":0,"y":0}],
            "wires":[{"from":{"comp":"G","pin":"out"},
                      "to":{"comp":"Y","pin":"in"}}]}
        code,_=self.save_level("ch1_cmos_not",zero,actor="other")
        self.assertEqual(code,200)
        attempt=self.begin("ch1_cmos_not",actor="other")
        code,partial=self.grade("ch1_cmos_not",attempt,zero,actor="other")
        self.assertEqual(code,201,partial)
        self.assertEqual((partial["passedCount"],partial["totalCount"],
                          partial["completed"],partial["status"]),
                         (1,2,False,"进行中"))
        self.assertEqual(partial["completionStatus"],"未完成")
        self.assertEqual(partial["submission"]["completionStatus"],"未完成")
        self.assertEqual(partial["submission"]["firstFailure"]["inputs"],{"A":0})
        self.assertIsNone(partial["package"])
        code,packages=self.request("GET","/api/circuit/components",actor="other")
        self.assertEqual(packages["packages"],[])
        code,denied=self.grade("ch1_cmos_not",attempt,fixture("cmos_not"))
        self.assertEqual(code,409)
        self.assertEqual(denied["code"],"INVALID_ATTEMPT")
        bad=copy.deepcopy(fixture("cmos_not"))
        bad["components"].append({"id":"X","type":"nand","x":0,"y":0})
        code,invalid=self.request("POST","/api/levels/ch1_cmos_not/simulate",{
            "levelVersion":1,"graph":bad,"inputs":{"A":0}})
        self.assertEqual(code,422)
        self.assertEqual(invalid["code"],"COMPONENT_FORBIDDEN")
        code,still=self.request("GET","/api/progress",actor="other")
        self.assertEqual(still["progress"][0]["revision"],1)

    def test_04b_tied_passed_group_count_chooses_latest_submission(self):
        actor="other"
        circuit={
            "schemaVersion":1,
            "components":[
                {"id":"A","type":"input","name":"A","x":0,"y":0},
                {"id":"G","type":"gnd","x":0,"y":0},
                {"id":"Y","type":"output","name":"Y","x":0,"y":0},
            ],
            "wires":[{"from":{"comp":"G","pin":"out"},
                      "to":{"comp":"Y","pin":"in"}}],
        }
        first=self.request("GET","/api/circuit/results/mine",actor=actor)[1]
        entry=next(x for x in first["results"]
                   if x["levelId"]=="ch1_cmos_not")
        self.assertEqual(entry["submissionCount"],1)
        code,before=self.request(
            "GET","/api/teacher/circuit-results?classId="+str(self.class_id),
            actor="teacher")
        self.assertEqual(code,200)
        old=next(x for x in before["results"]
                 if x["student"]["id"]==self.other["id"]
                 and x["levelId"]=="ch1_cmos_not")
        old_best=old["bestAttemptId"]
        attempt=self.begin("ch1_cmos_not",actor=actor)
        code,reply=self.grade("ch1_cmos_not",attempt,circuit,actor=actor)
        self.assertEqual(code,201,reply)
        self.assertEqual(reply["record"]["bestPassedCount"],1)
        self.assertEqual(reply["record"]["submissionCount"],2)
        code,after=self.request("GET",
            "/api/teacher/circuit-results?classId="+str(self.class_id),
            actor="teacher")
        newest=next(x for x in after["results"]
                   if x["student"]["id"]==self.other["id"]
                   and x["levelId"]=="ch1_cmos_not")
        self.assertGreater(newest["bestAttemptId"],old_best,
                           "Best tie must choose the newest successful submission")
        self.assertEqual((newest["bestPassedCount"],newest["totalCount"]),(1,2))
        self.assertEqual(newest["completionRate"],50)
        self.assertEqual(newest["status"],"进行中")

    def test_04c_teacher_student_summary_rate_and_export(self):
        import csv
        import io
        code,view=self.request("GET",f"/api/teacher/circuit-results"
            f"?classId={self.class_id}&pageSize=100",actor="teacher")
        self.assertEqual(code,200,view)
        self.assertEqual(view["pagination"]["total"],3,
                         "Only submitted lessons: own circuit+demo, other circuit")
        self.assertEqual(len(view["results"]),3)
        finished=next(x for x in view["results"]
                      if x["student"]["id"]==self.student["id"]
                      and x["levelId"]=="ch1_cmos_not")
        self.assertEqual(finished["status"],"已完成")
        self.assertEqual(finished["completionRate"],100)
        self.assertTrue(finished["completedAt"])
        self.assertEqual(finished["submissionCount"],2)
        self.assertEqual(finished["bestPassedCount"],2)
        other=next(x for x in view["results"]
                   if x["student"]["id"]==self.other["id"]
                   and x["levelId"]=="ch1_cmos_not")
        self.assertEqual(other["completionRate"],50)
        code,no_access=self.request("GET",
            "/api/teacher/circuit-results?classId=987654",actor="teacher")
        self.assertIn(code,(403,404))
        self.assertIn(no_access["code"],("FORBIDDEN","CLASS_NOT_FOUND","NOT_FOUND"))
        code,denied=self.request("GET","/api/teacher/circuit-results")
        self.assertEqual(code,403,"Student cannot query class results")

        url=f"http://127.0.0.1:{self.port}/api/teacher/circuit-results.csv?classId={self.class_id}"
        req=urllib.request.Request(url,headers={
            "Authorization":"Bearer "+self.tokens["teacher"],
        })
        with urllib.request.urlopen(req,timeout=10) as response:
            self.assertEqual(response.status,200)
            csvtext=response.read().decode("utf-8-sig")
        records=list(csv.reader(io.StringIO(csvtext)))
        self.assertEqual(len(records),4, "Header plus exactly 3 submitted grade rows")
        header=records[0]
        for column in ("best_passed","total_groups","submissions",
                       "completed_at","completion_rate"):
            self.assertIn(column,header)
        self.assertNotIn("score",header)
        self.assertNotIn("duration_seconds",header)
        self.assertTrue(any(row[-1]=="100%" for row in records[1:]))
        self.assertTrue(any(row[-1]=="50%" for row in records[1:]))
        code,detail=self.request("GET",
            f"/api/teacher/students/{self.student['id']}",actor="teacher")
        self.assertEqual(code,200)
        grade=next(x for x in detail["levelResults"]
                   if x["levelId"]=="ch1_cmos_not")
        self.assertEqual(grade["status"],"已完成")
        self.assertEqual(grade["completionRate"],100)
        self.assertEqual(grade["submissionCount"],2)

    def test_05_cmos_nand_unlock_SR_and_sequential_state(self):
        level=self.open_level("ch1_cmos_nand")
        nand=fixture("cmos_nand")
        code,_=self.save_level("ch1_cmos_nand",nand)
        self.assertEqual(code,200)
        attempt=self.begin("ch1_cmos_nand")
        code,graded=self.grade("ch1_cmos_nand",attempt,nand)
        self.assertEqual(code,201,graded)
        self.assertEqual((graded["passedCount"],graded["totalCount"]),(4,4))
        self.assertEqual(graded["package"]["type"],"pkg:cmos_nand@1")
        sr_level=self.open_level("ch1_sr_latch")
        self.assertEqual(len(sr_level["publicVectors"]),0)
        self.assertNotIn("sequentialScripts",sr_level)
        sr=fixture("sr_latch")
        code,_=self.save_level("ch1_sr_latch",sr)
        self.assertEqual(code,200)
        s=None
        for (a,b),expect in [
            ((0,1),(1,0)),((1,1),(1,0)),
            ((1,0),(0,1)),((1,1),(0,1))]:
            code,sim=self.request("POST","/api/levels/ch1_sr_latch/simulate",{
                "levelVersion":1,"graph":sr,"inputs":{"Sbar":a,"Rbar":b},
                "state":s,"cycles":1})
            self.assertEqual(code,200,sim)
            self.assertEqual((sim["outputs"]["Q"],sim["outputs"]["Qbar"]),expect)
            s=sim["state"]
        attempt=self.begin("ch1_sr_latch")
        code,score=self.grade("ch1_sr_latch",attempt,sr)
        self.assertEqual(code,201,score)
        self.assertEqual((score["passedCount"],score["totalCount"],
                          score["unit"]),(4,4,"步"))
        self.assertTrue(score["completed"])
        self.assertEqual(score["package"]["type"],"pkg:sr_latch@1")
        # Replaying a solved NAND level produces a new immutable version.
        replay=copy.deepcopy(nand)
        replay["components"][0]["x"]=34
        attempt=self.begin("ch1_cmos_nand")
        code,new=self.grade("ch1_cmos_nand",attempt,replay)
        self.assertEqual(code,201,new)
        self.assertEqual(new["package"]["type"],"pkg:cmos_nand@2")
        code,reg=self.request("GET","/api/circuit/components")
        nand_pkgs=[x for x in reg["packages"] if x["symbol"]=="cmos_nand"]
        self.assertEqual(len(nand_pkgs),2)
        self.assertEqual([x["isCurrent"] for x in nand_pkgs],[False,True])
        code,old=self.request("GET","/api/circuit/components/cmos_nand/1")
        self.assertEqual(code,200)
        self.assertEqual(old["component"]["graph"],nand)
        code,old_sr=self.request("POST","/api/levels/ch1_sr_latch/simulate",{
            "levelVersion":1,"graph":sr,"inputs":{"Sbar":0,"Rbar":1},
            "cycles":1})
        self.assertEqual(code,200,old_sr)
        self.assertEqual(old_sr["outputs"]["Q"],1)

    def test_05b_multiple_outputs_fail_as_one_group_in_http(self):
        g=fixture("half_adder")
        # Sum is correct, Carry uses OR instead of AND: just 2/4 rows pass.
        g["components"][3]["type"]="or"
        self.open_level("ch1_half_adder")
        code,saved=self.save_level("ch1_half_adder",g)
        self.assertEqual(code,200,saved)
        attempt=self.begin("ch1_half_adder")
        code,reply=self.grade("ch1_half_adder",attempt,g)
        self.assertEqual(code,201,reply)
        feedback=reply["submission"]
        self.assertEqual(feedback["unit"],"组")
        self.assertEqual((feedback["passedCount"],feedback["totalCount"]),(2,4))
        self.assertEqual(feedback["minimalComponentCount"],2)
        self.assertEqual(feedback["componentCount"],2)
        self.assertFalse(feedback["completed"])
        self.assertEqual(feedback["firstFailure"]["groupNumber"],2)
        self.assertEqual(feedback["firstFailure"]["inputs"],{"A":0,"B":1})
        self.assertEqual(feedback["firstFailure"]["expectedOutputs"],
                         {"Sum":1,"Carry":0})
        self.assertEqual(feedback["firstFailure"]["actualOutputs"],
                         {"Sum":1,"Carry":1})
        self.assertEqual(feedback["warnings"],[])
        self.assertIsNone(reply["package"])
        code,summary=self.request("GET","/api/circuit/results/mine")
        self.assertEqual(code,200)
        row=next(x for x in summary["results"]
                 if x["levelId"]=="ch1_half_adder")
        self.assertEqual(row["status"],"进行中")
        self.assertEqual((row["bestPassedCount"],row["totalCount"]),(2,4))
        self.assertEqual(row["submissionCount"],1)

    def test_06_version_binding_and_immutable_snapshots(self):
        with closing(db.connect(self.path)) as con:
            base=content.level_for(con,self.student["id"],"ch1_cmos_not")
            self.assertEqual(base["version"],1)
            # Simulate publishing a brand-new v2 without editing v1.
            fresh=copy.deepcopy(base)
            fresh["version"]=2
            fresh["title"]="CMOS非门新版本"
            con.execute("INSERT INTO circuit_level_snapshots VALUES(?,?,?,?,?)",
                        (fresh["id"],2,content.digest(fresh),
                         content.canonical(fresh),db.now_iso()))
            con.commit()
        code,still=self.request("GET","/api/levels/ch1_cmos_not")
        self.assertEqual(still["level"]["levelVersion"],1)
        code,other=self.request("GET","/api/levels/ch1_cmos_not",actor="other")
        self.assertEqual(other["level"]["levelVersion"],1,
                         "Other already-started student remains on v1")
        db.create_user(self.path,"late_student","StudentPassword123","新学生",role="student")
        token=self.auth("late_student","StudentPassword123")
        self.tokens["late"]=token
        code,later=self.request("GET","/api/levels/ch1_cmos_not",actor="late")
        self.assertEqual(later["level"]["levelVersion"],2)
        code,rejected=self.request("POST","/api/levels/ch1_cmos_not/simulate",{
            "graph":fixture("cmos_not"),"levelVersion":1,
            "inputs":{"A":0}},actor="late")
        self.assertEqual(code,409)
        self.assertEqual(rejected["code"],"LEVEL_VERSION_MISMATCH")
        with closing(db.connect(self.path)) as con:
            old=con.execute(
                "SELECT spec_json FROM circuit_level_snapshots WHERE level_id=? AND version=1",
                ("ch1_cmos_not",)).fetchone()
            self.assertEqual(json.loads(old["spec_json"])["title"],base["title"])

    def test_06b_concurrent_duplicate_attempt_is_idempotent(self):
        from concurrent.futures import ThreadPoolExecutor
        # A fresh attempt whose asset already exists may be submitted by
        # retrying tabs concurrently, but still produces only one score.
        graph=fixture("cmos_not")
        attempt=self.begin("ch1_cmos_not")
        def submit_once(_):
            return self.grade("ch1_cmos_not",attempt,graph)
        with ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(submit_once,range(6)))
        self.assertEqual(sum(1 for status,data in results
                             if status==201 and data["created"]),1,results)
        self.assertTrue(all(status in (200,201) for status,_ in results),results)
        attempts={payload["submission"]["attemptId"] for _,payload in results}
        self.assertEqual(attempts,{attempt})
        with closing(db.connect(self.path)) as con:
            self.assertEqual(con.execute(
                "SELECT COUNT(*) FROM scores WHERE attempt_id=?",(attempt,)
            ).fetchone()[0],1)

    def test_06c_incompatible_existing_save_is_not_deleted(self):
        db.create_user(self.path,"legacy_student","StudentPassword123","旧版进度测试")
        self.tokens["legacy"]=self.auth("legacy_student","StudentPassword123")
        with closing(db.connect(self.path)) as con:
            uid=con.execute(
                "SELECT id FROM users WHERE username='legacy_student'"
            ).fetchone()["id"]
            payload={"schemaVersion":999,"tasks":{"main":{"status":"accepted"}}}
            con.execute(
                """INSERT INTO progress(user_id,chapter_id,checkpoint,
                   state_json,revision,updated_at) VALUES(?,?,?,?,?,?)""",
                (uid,"ch1","legacy_save",json.dumps(payload),17,db.now_iso()))
            con.commit()
        code,error=self.request("GET","/api/progress",actor="legacy")
        self.assertEqual(code,409)
        self.assertEqual(error["code"],"CHAPTER_SCHEMA_MISMATCH")
        with closing(db.connect(self.path)) as con:
            row=con.execute("SELECT * FROM progress WHERE user_id=?",(uid,)).fetchone()
            self.assertEqual(row["revision"],17)
            self.assertEqual(json.loads(row["state_json"]),payload)

    def test_06d_historical_v1_count_records_keep_completion(self):
        # A V1 database may have a former numeric mark but its authoritative
        # passedCount and completed flag remain valid without schema migration.
        db.create_user(self.path,"history_student","StudentPassword123","历史记录者")
        self.tokens["history"]=self.auth("history_student","StudentPassword123")
        self.open_level("ch1_cmos_not",actor="history")
        # Prior version-publishing test added v2; emulate an actual student
        # already enrolled in the historical v1 snapshot before the upgrade.
        with closing(db.connect(self.path)) as con:
            uid=con.execute(
                "SELECT id FROM users WHERE username='history_student'"
            ).fetchone()["id"]
            con.execute(
                "UPDATE circuit_enrollments SET version=1 WHERE user_id=? AND level_id=?",
                (uid,"ch1_cmos_not"))
            con.commit()
        g=fixture("cmos_not")
        code,_=self.save_level("ch1_cmos_not",g,actor="history")
        self.assertEqual(code,200)
        attempt=self.begin("ch1_cmos_not",actor="history")
        code,record=self.grade("ch1_cmos_not",attempt,g,actor="history")
        self.assertEqual(code,201,record)
        with closing(db.connect(self.path)) as con:
            old_grade={
                "score":100,"weightedPassRate":1.0,"completed":True,
                "passedCount":2,"totalCount":2,"componentCount":2,
                "assessmentType":"circuit_server","levelId":"ch1_cmos_not",
                "levelVersion":1,
            }
            con.execute("UPDATE scores SET score=?,details_json=? WHERE attempt_id=?",
                        (100,json.dumps(old_grade),attempt))
            con.commit()
        code,summary=self.request("GET","/api/circuit/results/mine",actor="history")
        self.assertEqual(code,200,summary)
        item=next(x for x in summary["results"]
                  if x["levelId"]=="ch1_cmos_not")
        self.assertEqual(item["status"],"已完成")
        self.assertEqual(item["bestPassedCount"],2)
        self.assertEqual(item["submissionCount"],1)
        self.assertTrue(item["completedAt"])
        self.assertNotIn("score",item)

    def test_07_score_and_package_rollback_if_award_failed(self):
        # A new student's first level completion should not record a score if
        # the asset insert transaction fails midway.
        db.create_user(self.path,"rollback_student","StudentPassword123","回滚测试")
        self.tokens["rollback"]=self.auth("rollback_student","StudentPassword123")
        self.open_level("ch1_cmos_nand",actor="rollback")
        code,_=self.save_level("ch1_cmos_nand",fixture("cmos_nand"),actor="rollback")
        self.assertEqual(code,200)
        attempt=self.begin("ch1_cmos_nand",actor="rollback")
        from circuit_service import _unlocked as original
        def inject(con,user_id,spec,graph,defs):
            original(con,user_id,spec,graph,defs)
            raise RuntimeError("simulated crash after component insert, before score")
        with patch("circuit_service._unlocked",side_effect=inject):
            code,error=self.grade("ch1_cmos_nand",attempt,fixture("cmos_nand"),
                                  actor="rollback")
        self.assertEqual(code,500,error)
        with closing(db.connect(self.path)) as con:
            uid=con.execute("SELECT id FROM users WHERE username='rollback_student'").fetchone()["id"]
            self.assertEqual(con.execute(
                "SELECT COUNT(*) FROM circuit_components WHERE user_id=?",(uid,)
            ).fetchone()[0],0)
            self.assertEqual(con.execute(
                "SELECT COUNT(*) FROM scores WHERE user_id=?",(uid,)
            ).fetchone()[0],0)
        code,again=self.grade("ch1_cmos_nand",attempt,fixture("cmos_nand"),
                              actor="rollback")
        self.assertEqual(code,201,again)
        self.assertTrue(again["completed"])

if __name__=="__main__":
    unittest.main()
