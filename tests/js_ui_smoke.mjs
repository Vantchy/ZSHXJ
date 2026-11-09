/*
 * 无第三方DOM包的主框架交互烟测：登录→首次设密→菜单→地图→关卡，
 * 再验证教师名单中的重置入口。
 * node tests/js_ui_smoke.mjs
 */
import assert from "node:assert/strict";

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.handlers = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.files = [];
    this.parentNode = null;
    this.style = {cssText:"", setProperty(key,value) {this[key]=value;}};
    this.attributes = {};
    this.id = "";
  }
  append(...items) {
    this.children.push(...items);
    for (const item of items) {
      item.parentNode = this;
      if (this === globalThis.document?.body &&
          item.attributes?.["data-app-dialog"]) {
        queueMicrotask(() => respondToPageDialog(item));
      }
    }
    if (this.tagName === "SELECT" && items.some((x) => x.tagName === "OPTION")) {
      if (!this.value) this.value = items[0].value;
    }
  }
  replaceChildren(...items) {
    for (const item of this.children) item.parentNode = null;
    this.children = [...items];
    for (const item of items) item.parentNode = this;
    if (this.tagName === "SELECT") this.value = items[0]?.value || "";
  }
  addEventListener(event, fn) { (this.handlers[event] ??= []).push(fn); }
  removeEventListener(event, fn) {
    this.handlers[event] = (this.handlers[event] || []).filter((x) => x !== fn);
  }
  setAttribute(name,value) { this.attributes[name]=String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() {
    if (this.parentNode) {
      const children=this.parentNode.children;
      const index=children.indexOf(this);
      if (index>=0) children.splice(index,1);
      this.parentNode=null;
    }
  }
  get isConnected() {
    return Boolean(this.parentNode || this === root);
  }
  focus() { globalThis.document.activeElement=this; }
  getContext() {
    return {
      clearRect() {}, strokeRect() {}, beginPath() {}, moveTo() {},
      lineTo() {}, stroke() {}, fillRect() {}, fillText() {},
    };
  }
  querySelectorAll(tag) {
    const found = [];
    const selector = tag.toUpperCase();
    for (const child of this.children) {
      if (child.tagName === selector) found.push(child);
      found.push(...child.querySelectorAll(tag));
    }
    return found;
  }
  querySelector(selector) {
    if (selector.startsWith(".")) {
      return this.descendants().find(el => String(el.className||"").split(/\s+/).includes(selector.slice(1))) || null;
    }
    return this.querySelectorAll(selector)[0] || null;
  }
  descendants() { return this.children.flatMap(el=>[el,...el.descendants()]); }
  async click() {
    assert.ok(!this.disabled, `Clicked disabled button: ${this.textContent}`);
    if (this.tagName==="A") downloadedFiles.push(this.download);
    for (const fn of [...(this.handlers.click || [])]) await fn();
  }
  async keydown(key,options={}) {
    const event={key,shiftKey:false,isComposing:false,defaultPrevented:false,
      preventDefault(){this.defaultPrevented=true;},...options};
    for(const listener of [...(this.handlers.keydown||[])]) await listener(event);
    return event;
  }
  async submit() {
    const event = { preventDefault() {} };
    for (const fn of this.handlers.submit || []) await fn(event);
  }
}
const root = new Element("div");
const storage = new Map();
globalThis.document = {
  getElementById: (id) => id === "app" ? root : null,
  createElement: (tag) => new Element(tag),
  activeElement: null,
  body: new Element("body"),
};
const messages = [];
const promptReplies = [];
const dialogKinds = [];
const passwordPromptTypes = [];
let autoDialogs = true;
function dialogBody() {
  return document.body.children.filter(
    (x)=>x.attributes?.["data-app-dialog"]
  );
}
function respondToPageDialog(overlay) {
  const kind=overlay.getAttribute("data-app-dialog");
  assert.ok(kind && ["alert","prompt","confirm"].includes(kind),
    "All dialogs must be rendered in-page");
  const paragraph=overlay.querySelectorAll("p")[0];
  const message=paragraph?.textContent||"";
  dialogKinds.push(kind);
  const buttons=overlay.querySelectorAll("button");
  const ok=buttons.find((x)=>x.textContent==="确定");
  const cancel=buttons.find((x)=>x.textContent==="取消");
  assert.ok(ok,"Page dialogs need a confirm button");
  assert.equal(overlay.className,"dialog-overlay",
    "Dialog backdrop must use the CSP-safe stylesheet");
  const panel=overlay.querySelectorAll("div").find((x)=>
    x.getAttribute("role")==="dialog" || x.getAttribute("role")==="alertdialog");
  assert.ok(panel,"Dialog must have an accessible panel");
  if (!autoDialogs) return;
  if (kind==="alert") {
    messages.push(message);
    void ok.click();
    return;
  }
  if (kind==="prompt") {
    const entry=overlay.querySelectorAll("input")[0];
    assert.ok(entry,"Input dialog needs an input");
    passwordPromptTypes.push([message,entry.type]);
    const value=promptReplies.length ? promptReplies.shift() : null;
    if (value === null) void cancel.click();
    else {
      entry.value=String(value);
      void ok.click();
    }
    return;
  }
  confirmedCount++;
  confirmationTexts.push(message);
  if (denyNext) {
    denyNext=false;
    void cancel.click();
  } else {
    void ok.click();
  }
}
function blockedNativeDialog(name) {
  return () => {throw new Error(`Forbidden browser-native ${name}`);};
}
globalThis.alert=blockedNativeDialog("alert");
globalThis.confirm=blockedNativeDialog("confirm");
globalThis.prompt=blockedNativeDialog("prompt");
globalThis.window = {
  alert:blockedNativeDialog("alert"),
  prompt:blockedNativeDialog("prompt"),
  confirm:blockedNativeDialog("confirm"),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
// Simulate file read in a browser without adding any npm dependencies.
globalThis.FileReader = class {
  readAsDataURL(file) {
    this.result = `data:${file.type || "text/csv"};base64,${file.base64}`;
    this.onload?.();
  }
};
const downloadedFiles = [];
globalThis.URL.createObjectURL = () => "blob:smoke";
globalThis.URL.revokeObjectURL = () => {};

const quest = {
  main: { id: "main", title: "主线" },
  side: [{ id: "side1", title: "支线1" }],
};
let token = "";
let studentSet = false;
let revisions = 0;
let saves = null;
let scoreRows = [];
let simulateOldNumericDemo = false;
let ownProgressReads = 0;
let resetCount = 0;
let studentRemoved = false;
let studentDisabled = false;
let studentNumber = "9000000001";
let studentName = "测试学生";
let noUpdates = 0;
let nameUpdates = 0;
const studentQueries = [];
let rosterCsvQueries = [];
let importPreviewCalls = 0;
let importWriteCalls = 0;
let lastImportPayload = null;
const fixtureImportFile = "2026秋季名单_测试.xlsx";
const fixtureImportBase64 = "UEsDBBQAAAAIAAAA"; // Stand-in for validated XLSX bytes
let issued = false;
let confirmedCount = 0;
let archivedClass = false;
let className = "一班";
let denyNext = false;
let failNextArchive = false;
let teacherAssigned = false;
let teacherCreated = false;
let teacherDisabled = false;
let teacherPasswordResets = 0;
const confirmationTexts = [];
const chapter = {
  id: "ch1", title: "演示关卡", order: 1, region: "夏",
  room: "夏工坊", npc: "工匠",
  entry: new URL("./fixtures/legacy-demo.mjs", import.meta.url).href,
  locations:[{id:"gate-road",name:"地图",roomTitle:"地图",npc:"人物",npcLine:"",background:"/assets/scenes/workshop-background.png"}],
  quests: quest, implemented: true, canEnter: true,
  completed: false, bestScore: null,
};
function response(status, payload) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => payload,
    blob: async () => new Blob(["test"], {type:"text/csv"}),
  };
}
globalThis.fetch = async (path, options = {}) => {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === "/api/auth/login" && method === "POST") {
    if (body.username === "9000000001" && !studentSet) {
      return response(200, {
        setupRequired: true, setupToken: "setup-token", username: "9000000001",
      });
    }
    if (body.username === "9000000001") {
      return response(200, { token: "student-token", user: {
        id: 1, displayName: "测试学生", role: "student", needsPasswordSetup: false,
      } });
    }
    if (body.username === "school_admin") {
      return response(200, { token:"admin-token", user: {
        id:3, displayName:"管理员", username:"school_admin",
        role:"admin",needsPasswordSetup:false,
      } });
    }
    return response(200, { token: "teacher-token", user: {
      id: 2, displayName: "测试老师", role: "teacher", needsPasswordSetup: false,
    } });
  }
  if (path === "/api/auth/setup-password") {
    assert.equal(body.setupToken, "setup-token");
    assert.ok(body.newPassword.length >= 8);
    studentSet = true;
    token = "student-token";
    return response(200, { token, user: {
      id: 1, displayName: "测试学生", role: "student", needsPasswordSetup: false,
    } });
  }
  if (path === "/api/auth/logout") return response(200, { ok: true });
  if (path === "/api/chapters") return response(200, { chapters: [chapter] });
  if (path === "/api/circuit/results/mine") {
    const results = scoreRows.length ? [{
      levelId:"demo:ch1",assessmentType:"legacy_demo",
      chapterTitle:"从逻辑门到存算器件",
      levelTitle:"演示关卡（非正式电路评测）",
      status:"已完成",
      bestPassedCount:simulateOldNumericDemo
        ? null : scoreRows.at(-1).details.passedCount,
      totalCount:simulateOldNumericDemo
        ? null : scoreRows.at(-1).details.totalCount,
      unit:"组",submissionCount:scoreRows.length,
      completedAt:"2026-10-29 10:30:00",
    }] : [];
    return response(200,{results});
  }
  if (path === "/api/progress" && method === "GET") {
    ownProgressReads++;
    return response(200, { progress: saves ? [saves] : [] });
  }
  if (path === "/api/progress/ch1" && method === "PUT") {
    assert.equal(body.expectedRevision, revisions);
    revisions++;
    saves = {
      chapterId: "ch1", revision: revisions,
      state: structuredClone(body.state), checkpoint: body.checkpoint,
    };
    return response(200, { progress: saves });
  }
  if (path === "/api/chapters/ch1/attempts/start") {
    assert.equal(saves.state.tasks.main.status, "accepted");
    issued = true;
    return response(201, { attemptId: "server-issued-test" });
  }
  if (path === "/api/scores" && method === "POST") {
    assert.ok(issued);
    assert.equal(body.attemptId, "server-issued-test");
    scoreRows.push(body);
    return response(201, { created: true, score: { score: body.score } });
  }
  if (path.startsWith("/api/teacher/students.csv?") && method === "GET") {
    rosterCsvQueries.push(path);
    return response(200,{});
  }
  if (path === "/api/classes") {
    return response(200, { classes: [{ id: 1, name: "一班" }] });
  }
  if (path === "/api/classes/1/students/import" && method === "POST") {
    assert.equal(body.filename, fixtureImportFile, "Use the previewed original filename");
    assert.equal(body.contentBase64, fixtureImportBase64);
    assert.equal(body.confirm, undefined, "No additional server confirm flag for roster import");
    if (body.dryRun === true) {
      importPreviewCalls++;
      return response(200,{
        valid:true,count:2,created:0,
        preview:[
          {studentNo:"8800000001",name:"测试导入一"},
          {studentNo:"8800000002",name:"测试导入二"},
        ],
      });
    }
    assert.equal(body.dryRun,false);
    importWriteCalls++;
    lastImportPayload = body;
    return response(200,{created:2,imported:2});
  }
  if (path.startsWith("/api/teacher/scores?")) {
    return response(200, { scores: [], pagination: { total: 0, page: 1, totalPages: 0 } });
  }
  if (path.startsWith("/api/teacher/circuit-results?")) {
    const results=scoreRows.length?[{
      student:{id:1,studentNo:studentNumber,displayName:studentName,
        className:"一班"},chapterTitle:"从逻辑门到存算器件",
      levelId:"demo:ch1",assessmentType:"legacy_demo",
      levelTitle:"演示关卡（非正式电路评测）",
      status:"已完成",
      bestPassedCount:simulateOldNumericDemo?null:4,
      totalCount:simulateOldNumericDemo?null:4,
      unit:"组",submissionCount:scoreRows.length,
      completedAt:"2026-10-29 10:30:00",
      completionRate:simulateOldNumericDemo?null:100,
    }]:[];
    return response(200,{results,
      pagination:{total:results.length,page:1,pageSize:20,
        totalPages:results.length?1:0}});
  }
  if (path.startsWith("/api/teacher/circuit-results.csv?")) {
    return response(200,{});
  }
  if (path.startsWith("/api/teacher/progress?")) {
    return response(200, { progress: [], pagination: { total: 0, page: 1, totalPages: 0 } });
  }
  if (path.startsWith("/api/teacher/students?")) {
    studentQueries.push(path);
    const students = studentRemoved ? [] : [{
      id:1, studentNo:studentNumber, username:studentNumber,
      displayName:studentName,classId:1,className:"一班",
      needsPasswordSetup:false,
    }];
    return response(200, { students, pagination: {
      total:students.length,page:1,totalPages:students.length?1:0
    } });
  }
  if (path === "/api/teacher/students/1" && method === "GET") {
    return response(200,{student:{
      id:1,studentNo:studentNumber,username:studentNumber,
      displayName:studentName,classId:1,className:"一班",needsPasswordSetup:false,
    }, chapters:[{
      chapterId:"ch1",chapterTitle:"演示关卡",checkpoint:"main_accepted",
      started:true,completed:false,updatedAt:"2026-10-28",
      scores:[],
    }],levelResults:scoreRows.length?[{
      levelId:"demo:ch1",chapterTitle:"从逻辑门到存算器件",
      levelTitle:"演示关卡（非正式电路评测）",
      status:"已完成",bestPassedCount:4,totalCount:4,unit:"组",
      submissionCount:scoreRows.length,completedAt:"2026-10-29 10:30:00",
      completionRate:100,
    }]:[]});
  }
  if (path === "/api/teacher/students/1/reset-password") {
    assert.equal(body.confirm, undefined, "Teacher reset should not require a confirm flag");
    resetCount++;
    return response(200, { result: { studentId:1,needsPasswordSetup:true } });
  }
  if (path === "/api/teacher/students/1/remove" && method === "POST") {
    assert.equal(body.confirm,true,"Removing a student must be confirmed");
    studentRemoved = true;
    return response(200,{result:{studentId:1,classId:null}});
  }
  if (path === "/api/admin/students/1/disable" && method === "POST") {
    assert.equal(body.confirm,true,"Disabling a student must be confirmed");
    studentDisabled = true;
    return response(200,{result:{studentId:1,active:false}});
  }
  if (path.startsWith("/api/admin/teachers?") && method === "GET") {
    const active = !path.includes("active=0");
    const items = active && !teacherDisabled ? [{
      id:2,username:"teacher_demo",displayName:"测试老师",
      active:true,classes:[{id:1,name:"一班"}],
    }] : [];
    return response(200,{items,pagination:{
      page:1,pageSize:20,total:items.length,totalPages:items.length?1:0,
    }});
  }
  if (path === "/api/admin/teachers" && method === "POST") {
    assert.equal(body.confirm,undefined);
    teacherCreated = true;
    return response(201,{result:{id:11,username:body.username,
      displayName:body.displayName}});
  }
  if (path === "/api/admin/teachers/2/reset-password" && method === "POST") {
    assert.equal(body.confirm,undefined,"Password resets need no confirmation");
    assert.equal(body.newPassword,"ChangeTeacherPass987");
    teacherPasswordResets++;
    return response(200,{result:{teacherId:2,reset:true}});
  }
  if (path === "/api/admin/teachers/2/disable" && method === "POST") {
    assert.equal(body.confirm,true,"Disable must have a server confirm flag");
    teacherDisabled = true;
    return response(200,{result:{teacherId:2,active:false}});
  }
  if (path.startsWith("/api/admin/students?") && method === "GET") {
    const active = !path.includes("active=0");
    const items = active && !studentDisabled ? [{
      id:1,username:studentNumber,studentNo:studentNumber,
      displayName:studentName,classId:1,className:"一班",active:true,
      needsPasswordSetup:true,everPasswordSet:false,
    }] : [];
    return response(200,{items,pagination:{
      page:1,pageSize:20,total:items.length,totalPages:items.length?1:0,
    }});
  }
  if (path === "/api/admin/students/1" && method === "GET") {
    return response(200,{student:{
      id:1,username:studentNumber,studentNo:studentNumber,
      displayName:studentName,classId:1,className:"一班",
      active:!studentDisabled,needsPasswordSetup:true,everPasswordSet:false,
    }});
  }
  if (path === "/api/admin/students/1/update-no" && method === "POST") {
    assert.deepEqual(Object.keys(body),["studentNo"]);
    studentNumber=body.studentNo;
    noUpdates++;
    return response(200,{result:{studentId:1,studentNo:studentNumber}});
  }
  if (path === "/api/admin/students/1/update-name" && method === "POST") {
    assert.deepEqual(Object.keys(body),["displayName"]);
    studentName=body.displayName;
    nameUpdates++;
    return response(200,{result:{studentId:1,displayName:studentName}});
  }
  if (path.startsWith("/api/admin/logs?") && method === "GET") {
    return response(200,{logs:[
      {id:901,createdAt:"2026-10-28 10:00:00",
        actor:"teacher_example",action:"access.denied",
        classes:[],targetType:null,targetId:null,result:"failed",
        failureType:"forbidden",message:"越权：仅管理员可以访问"},
      {id:902,createdAt:"2026-10-28 10:01:00",
        actor:"school_admin",action:"classes.create",
        classes:[],targetType:"class",targetId:"1",result:"failed",
        failureType:"validation",message:"校验失败：同名班级已存在"},
    ],pagination:{page:1,pageSize:20,total:2,totalPages:1}});
  }
  if (path === "/api/admin/overview")
    return response(200,{overview:{
      classes: archivedClass?0:1,archivedClasses:archivedClass?1:0,
      teachers:teacherDisabled?0:1,disabledTeachers:teacherDisabled?1:0,
      students:studentDisabled?0:1,disabledStudents:studentDisabled?1:0,
    }});
  if (path === "/api/admin/classes?archived=0")
    return response(200,{classes: archivedClass ? [] : [{
      id:1,name:className,archived:false,
      studentCount:1,unsetPasswordCount:0,teachers:[{
        id:2,displayName:"测试老师",active:true,
      },...(teacherAssigned?[{id:4,displayName:"新教师",active:true}]:[])],
    }]});
  if (path === "/api/admin/classes?archived=1")
    return response(200,{classes: archivedClass ? [{
      id:1,name:className,archived:true,studentCount:1,
      unsetPasswordCount:0,teachers:[],
    }] : []});
  if (path.startsWith("/api/admin/classes/1/teacher-directory?") &&
      method === "GET") {
    const q=new URL(path,"http://school.local").searchParams.get("q")||"";
    const teachers=[
      {id:2,username:"teacher_demo",displayName:"测试老师",
        active:true,assigned:true},
      {id:4,username:"teacher_new",displayName:"新教师",
        active:true,assigned:teacherAssigned},
      {id:5,username:"teacher_disabled",displayName:"停用老师",
        active:false,assigned:false},
    ].filter((t)=>t.username.includes(q)||t.displayName.includes(q));
    return response(200,{
      teachers,pagination:{page:1,pageSize:100,total:teachers.length,
        totalPages:teachers.length?1:0},
    });
  }
  if (path.startsWith("/api/admin/classes/1?") && method === "GET") {
    return response(200,{
      class:{id:1,name:className,archived:archivedClass},
      teachers:[
        {id:2,username:"teacher_demo",displayName:"测试老师",active:true},
        ...(teacherAssigned ? [{
          id:4,username:"teacher_new",displayName:"新教师",active:true,
        }] : []),
      ],
      students:[{id:1,username:"9000000001",displayName:"测试学生",
        active:true,needsPasswordSetup:false}],
      pagination:{page:1,pageSize:20,total:1,totalPages:1},
    });
  }
  if (path === "/api/admin/classes/1/teachers" && method === "POST") {
    assert.equal(body.confirm,undefined, "Assignment no longer requires confirmation");
    assert.equal(body.teacherId,4);
    teacherAssigned=true;
    return response(200,{result:{classId:1,teacherId:4,assigned:true}});
  }
  if (path === "/api/admin/classes/1/rename" && method === "POST") {
    assert.equal(body.confirm,undefined);
    className=body.name;
    return response(200,{result:{id:1,name:className}});
  }
  if (path === "/api/admin/classes/1/archive") {
    assert.equal(body.confirm,true);
    if(failNextArchive) {
      failNextArchive=false;
      return response(409,{error:"已归档或状态冲突",code:"CLASS_CONFLICT"});
    }
    archivedClass=true;
    return response(200,{result:{id:1,archived:true}});
  }
  return response(404, { error: `Not mocked: ${method} ${path}` });
};

function b(text) {
  const found = root.querySelectorAll("button").find((item) => item.textContent === text);
  assert.ok(found, `Button ${text} absent; top: ${root.children.map((x) => x.textContent).join("|")}`);
  return found;
}
function form() {
  const found = root.querySelectorAll("form")[0];
  assert.ok(found, "Form not present");
  return found;
}
function fields() { return root.querySelectorAll("input"); }

await import("../public/app.js");
assert.equal(root.children[0].textContent, "铸算 · 华夏纪", "New visitors see scenic landing first");
assert.ok(!root.children[0].children.some(x => x.className === "brand-link"),
  "Landing must not inject a second, small brown brand on the left of the title");
assert.equal(root.querySelectorAll("input").length, 0, "Landing must not reveal inputs before enter");
await b("点击进入游戏").click();
assert.equal(root.children[0].textContent, "登录");
b("注册");
assert.ok(root.querySelectorAll("label").some((x)=>x.textContent==="账号："));
assert.ok(root.querySelectorAll("label").some((x)=>x.textContent==="密码："));
await b("注册").click();
assert.equal(root.children[0].textContent,"注册");
await b("返回登录").click();
assert.equal(root.children[0].textContent,"登录");
fields()[0].value = "9000000001";
fields()[1].value = "";
await form().submit();
assert.equal(root.children[0].textContent, "学生设置登录密码");
fields()[0].value = "MyPassword123";
fields()[1].value = "MyPassword123";
await form().submit();
assert.equal(root.children[0].textContent, "主界面");
assert.equal(confirmedCount,0,"First-time password setup must not use a confirm dialog");
for (const choice of ["开始", "排行榜", "成就", "成绩", "设置"]) b(choice);

// 排行榜只使用用户新提供的古纸展示页；没有接口时不得编造排名。
await b("排行榜").click();
assert.equal(root.className, "page page--leaderboard");
assert.ok(root.querySelector(".leaderboard-board"),
  "The new phoenix-ornament leaderboard panel must be present");
assert.equal(root.querySelector(".results-page-title")?.textContent, "排行");
assert.equal(root.descendants().filter((e)=>e.className==="results-header-button").length,2);
assert.equal(root.querySelector(".page-title"), null,
  "Old page heading and right-side ranking label must not exist");
assert.ok(root.querySelector(".leaderboard-table"), "Semantic ranking table missing");
assert.deepEqual(
  root.descendants().filter((e)=>e.tagName==="TH").map(e=>e.textContent),
  ["名次","玩家","已完成关卡","提交次数","最后完成"]);
assert.equal(root.querySelectorAll("tr").length,1,
  "The table must have a header row but no invented ranking entries");
assert.equal(root.querySelector(".leaderboard-empty-title")?.textContent,"静候揭榜");
assert.equal(root.querySelector(".leaderboard-empty-copy")?.textContent,"排行榜功能尚未开放。");
assert.equal(root.querySelector(".paper-demo-sheet"),null,
  "Old parchment demo panel must not remain in the DOM");
assert.equal(root.querySelector(".achievement-paper-sheet"), null,
  "Ranking must not reuse achievements styling");
await b("返回").click();

// 成就维持原 V2 的占位页和交互，不能被这次外部 public 的演示素材替换。
await b("成就").click();
assert.equal(root.className, "page page--placeholder");
assert.ok(root.querySelectorAll("p").some((x)=>x.textContent==="待开发"));
assert.equal(root.querySelector(".achievement-paper-sheet"), null);
await b("返回主界面").click();

await b("成绩").click();
assert.equal(root.querySelector(".results-page-title")?.textContent,"成绩");
assert.equal(root.querySelector(".page-title"), null);
assert.equal(root.querySelector(".scores-paper-heading"), null);
assert.equal(root.querySelector(".scores-paper-footer"), null);
assert.equal(root.querySelector(".scores-paper-sheet"),null,
  "Scores must not render any parchment board");
assert.ok(root.querySelector(".scores-content"),
  "Score records must render directly over the background");
assert.ok(root.querySelector(".scores-scroll"), "Grade list should be scrollable");
assert.equal(root.querySelector(".scores-scroll")?.getAttribute("aria-label"),
  "关卡成绩记录（可滚动查看）");
assert.ok(!root.querySelectorAll("p").some((x)=>
  x.textContent.includes("首次成功提交并保存关卡结果后")),
  "The score page should not add explanatory copy above the grade table");
assert.ok(root.querySelectorAll("p").some((x)=>
  x.textContent==="暂无已提交成绩。"));
assert.equal(root.querySelectorAll("tr").length,0,
  "Brand new student should not have empty rows for unsubmitted lessons");
await b("菜单").click();
await b("开始").click();
assert.ok(root.querySelector(".map-viewport"), "The world map must own the whole viewport");
assert.equal(root.querySelector(".map-frame"), null, "Old framed map UI must be removed");
assert.equal(root.querySelector(".page-title"), null, "Generic page heading is removed on the map");
assert.ok(root.querySelector(".room-topbar"), "Map must reuse the room's header component");
assert.deepEqual(root.descendants().filter((e)=>String(e.className||"").includes("room-path-segment")).map(e=>e.textContent),
  ["大地图"]);
assert.ok(root.querySelector(".room-wallet"), "Map header includes the room-style wallet");
await b("进入地图").click();
assert.ok(root.querySelector(".map-viewport"), "Chapter map must be full-screen and pannable");
assert.equal(root.querySelector(".map-frame"), null, "No legacy map card in the chapter map");
assert.deepEqual(root.descendants().filter((e)=>String(e.className||"").includes("room-path-segment")).map(e=>e.textContent),
  ["大地图","小地图"]);
await b("进入房间").click();
assert.ok(root.querySelector(".room-world"), "Room scene should open from chapter map");
assert.deepEqual(root.descendants().filter((e)=>String(e.className||"").includes("room-path-segment")).map(e=>e.textContent),
  ["大地图","小地图","房间"]);
// Bag is a compact independent modal; it cannot create the former dropdown.
await root.querySelector(".room-shortcut--bag").click();
const bag = root.querySelector(".room-bag-panel");
assert.ok(bag && !bag.hidden, "Inventory modal should be open");
assert.equal(root.descendants().filter(x=>String(x.className||"").split(/\s+/).includes("room-bag-slot")).length,12);
assert.equal(root.descendants().filter(x=>String(x.className||"").split(/\s+/).includes("room-bag-tab")).length,4);
const bagTabs = root.querySelector(".room-bag-tabs");
const bagInner = root.querySelector(".room-bag-content");
assert.ok(bagTabs && bagInner && bagTabs.parentNode === bagInner.parentNode,
  "Tabs and inset parchment must use the same outer-board layout anchor");
assert.notEqual(bagTabs.parentNode,bagInner,
  "Tabs must not overlap or be clipped inside the item's panel");

assert.equal(root.querySelector(".room-inventory"),null,"Old inventory UI must be removed");
await root.querySelector(".room-bag-close").click();
assert.equal(bag.hidden,true);

// “返回”恢复进入排行榜之前的房间，“菜单”才返回首页。
await root.querySelector(".room-shortcut--ranking").click();
assert.equal(root.className,"page page--leaderboard");
assert.equal(root.querySelector(".results-page-title")?.textContent,"排行");
assert.equal(root.querySelectorAll("tr").length,1);
await b("返回").click();
assert.equal(root.className,"page page--room");
assert.ok(root.querySelector(".room-navigation-path"));
assert.deepEqual(root.descendants().filter((e)=>String(e.className||"").includes("room-path-segment")).map(e=>e.textContent),
  ["大地图","小地图","房间"]);

// Navigation stage is actionable, not merely decorative text. World-map return
// saves the room before replacing it, and the full path is restored on re-entry.
const worldBreadcrumb=root.descendants().find((e)=>
  e.className==="room-path-segment" && e.textContent==="大地图");
assert.ok(worldBreadcrumb);
await worldBreadcrumb.click();
assert.equal(root.className,"page page--map map--world");
assert.deepEqual(root.descendants().filter((e)=>String(e.className||"").includes("room-path-segment")).map(e=>e.textContent),
  ["大地图"]);
await b("进入地图").click();
await b("进入房间").click();
assert.equal(root.className,"page page--room");

for (let i = 0; i < 8; i++) await b("向右").click();
await b("与 NPC 交互").click();
await b("接取任务").click();
chapter.levels = [
  {id:"ch1_cmos_not", title:"CMOS 晶体管搭建非门", lineage:"寅·非门"},
  {id:"ch1_cmos_nand", title:"四晶体管 CMOS 与非门", lineage:"丑·与非"},
  {id:"ch1_half_adder", title:"利用逻辑门搭建半加器", lineage:"卯·半加器"},
  {id:"ch1_sr_latch", title:"用与非门搭建 SR 锁存器", lineage:"卯·锁存"},
];
await b("进入电路关卡").click();
assert.equal(root.children[0].textContent,"正式电路关卡");
assert.equal(root.querySelectorAll("button").filter(x=>x.textContent==="进入关卡").length,4,
  "工匠“进入电路关卡”必须先显示四个实际电路关卡");
assert.ok(root.querySelectorAll("h3").some(x=>x.textContent.includes("CMOS 晶体管搭建非门")));
assert.ok(!root.querySelectorAll("button").some(x=>x.textContent==="生成随机演示结果"),
  "不能再直接进入模拟成绩占位页");
await b("返回房间").click();

// 以下测试保留旧版空章节对占位插件的兜底能力；并不代表第一章正常教学流程。
chapter.levels = [];
await b("与 NPC 交互").click();
await b("进入电路关卡").click();
assert.equal(root.children[0].textContent,"正式电路关卡");
await b("打开插件").click();
assert.equal(root.children[0].textContent, "章节关卡 · 第1章");
assert.ok(!root.querySelectorAll("p").some((x)=>
  x.textContent.includes("本次进入关卡：")), "Student chapter has no live timer");

// Opening a level without starting any work must allow either exit immediately.
const beforeCleanExit = confirmedCount;
await b("返回小地图").click();
assert.equal(root.children[0].textContent,"演示关卡 · 地图");
assert.equal(confirmedCount,beforeCleanExit,
  "Untouched level must return to the chapter room without confirmation");

await b("与 NPC 交互").click();
await b("进入电路关卡").click();
await b("打开插件").click();

assert.equal(root.children[0].textContent,"章节关卡 · 第1章");
const beforeCleanHome = confirmedCount;
await b("返回主界面").click();
assert.equal(root.children[0].textContent,"主界面");
assert.equal(confirmedCount,beforeCleanHome,
  "Untouched level must return to the main menu without confirmation");

await b("开始").click();
await b("进入地图").click();
await b("进入房间").click();
await b("与 NPC 交互").click();
await b("进入电路关卡").click();
await b("打开插件").click();

await b("生成随机演示结果").click();
await b("重试（重新生成）").click();
assert.equal(scoreRows.length, 0);
// Both exits share the same exact warning; cancel preserves the unsaved draft.
const exitWarning = "确认退出吗？未保存的进度将会丢失。";
denyNext = true;
await b("返回小地图").click();
assert.equal(root.children[0].textContent,"章节关卡 · 第1章",
  "Cancel small-map exit must keep the level");
assert.equal(scoreRows.length,0);
assert.ok(root.querySelectorAll("p").some((el)=>
  el.textContent.includes("模拟成绩：")), "Cancelled exit preserves unsaved result");
assert.equal(confirmationTexts.at(-1),exitWarning);

denyNext = true;
await b("返回主界面").click();
assert.equal(root.children[0].textContent,"章节关卡 · 第1章",
  "Cancel home exit must keep the level");
assert.equal(scoreRows.length,0);
assert.equal(confirmationTexts.at(-1),exitWarning);

await b("保存结果").click();
assert.equal(scoreRows.length,1);
assert.ok(issued);
// 关键合并路径：Demo 入库后可直接进入原有正式关卡列表。
const beforeSavedExit = confirmedCount;
await b("继续正式电路实验").click();
assert.equal(confirmedCount,beforeSavedExit,
  "Saved demo must continue into formal level list without unsaved warning");
assert.equal(root.children[0].textContent,"正式电路关卡");
await b("返回房间").click();
assert.equal(root.children[0].textContent,"演示关卡 · 地图");
await b("与 NPC 交互").click();
b("进入电路关卡");
await b("进入电路关卡").click();
assert.equal(root.children[0].textContent,"正式电路关卡",
  "Craftsman must offer formal experiment after the Demo is saved");
await b("返回房间").click();
await b("小地图").click();
assert.ok(root.querySelector(".map-viewport"), "Chapter map must replace the old map UI");
await b("返回大地图").click();
assert.ok(root.querySelector(".map-viewport"), "World map must be a full-screen scene");

// New unsaved draft: confirmed home exit goes directly to the student's main
// menu, not the chapter map; scores and already-saved progress remain intact.
await b("进入地图").click();
await b("进入房间").click();
await b("与 NPC 交互").click();
await b("进入电路关卡").click();
await b("打开插件").click();

assert.equal(root.children[0].textContent,"章节关卡 · 第1章");
await b("生成随机演示结果").click();
const scoresBeforeDiscard = scoreRows.length;
const revisionBeforeDiscard = revisions;
await b("返回主界面").click();
assert.equal(confirmationTexts.at(-1),exitWarning);
assert.equal(root.children[0].textContent,"主界面",
  "Confirmed home exit must show the login role's main menu");
assert.equal(scoreRows.length,scoresBeforeDiscard,
  "Unsubmitted draft must not create a score");
assert.equal(revisions,revisionBeforeDiscard,
  "Discarding an unsaved draft must not write game progress");
for (const studentButton of ["开始","成就","成绩","设置"])
  b(studentButton);
await b("成绩").click();
assert.equal(root.querySelector(".results-page-title")?.textContent,"成绩");
const savedGradeRows=root.querySelectorAll("tr");
assert.equal(root.querySelector(".scores-paper-sheet"),null);
assert.ok(root.querySelector(".scores-content"));
assert.ok(root.querySelector(".scores-scroll"));
assert.equal(savedGradeRows.length,2,
  "Header and only the saved demo grade, not 4 unsubmitted circuit rows");
assert.ok(root.querySelectorAll("td").some((x)=>
  x.textContent==="演示关卡（非正式电路评测）"));
assert.ok(root.querySelectorAll("td").some((x)=>x.textContent==="4/4 组"));
assert.ok(root.querySelectorAll("td").some((x)=>x.textContent==="1"));
assert.ok(!root.querySelectorAll("th").some((x)=>
  x.textContent==="分数" || x.textContent.includes("用时")));
await b("返回").click();
simulateOldNumericDemo=true;
await b("成绩").click();
assert.ok(root.querySelectorAll("td").some((x)=>
  x.textContent==="旧版演示未记录组数"));
assert.ok(!root.querySelectorAll("td").some((x)=>
  x.textContent.includes("null/") || x.textContent==="82"));
await b("菜单").click();
simulateOldNumericDemo=false;

// A generic circuit chapter may mutate ctx.state without explicitly marking
// its data dirty. The shell must still warn on exit, and clear the warning
// once that exact JSON state is successfully saved.
chapter.entry = new URL("./js_state_dirty_fixture.mjs", import.meta.url).href;
await b("开始").click();
await b("进入地图").click();
await b("进入房间").click();
await b("与 NPC 交互").click();
await b("进入电路关卡").click();
await b("打开插件").click();

assert.equal(root.children[0].textContent,"章节关卡 · 第1章");
const beforeFixtureEdit = confirmedCount;
await b("修改电路").click();
denyNext = true;
await b("返回小地图").click();
assert.equal(root.children[0].textContent,"章节关卡 · 第1章");
assert.equal(confirmedCount,beforeFixtureEdit+1,
  "Unsaved JSON state alone must trigger confirmation");
await b("保存电路").click();
assert.equal(saves.state.circuits.fixtureCount,1);
const beforeSavedFixtureExit = confirmedCount;
await b("返回主界面").click();
assert.equal(root.children[0].textContent,"主界面");
assert.equal(confirmedCount,beforeSavedFixtureExit,
  "Saving JSON progress must clear the unsaved-state warning");

await b("开始").click();
await b("进入地图").click();
await b("进入房间").click();
await b("与 NPC 交互").click();
await b("进入电路关卡").click();
await b("打开插件").click();

await b("修改电路").click();
const storedFixtureCount = saves.state.circuits.fixtureCount;
const beforeDirtyHome = confirmedCount;
await b("返回主界面").click();
assert.equal(confirmedCount,beforeDirtyHome+1,
  "Leaving with a new unsaved JSON edit must warn");
assert.equal(root.children[0].textContent,"主界面");
assert.equal(saves.state.circuits.fixtureCount,storedFixtureCount,
  "Confirmed discard must preserve the last server-saved circuit");

await b("退出登录").click();
assert.equal(root.children[0].textContent, "铸算 · 华夏纪");
await b("点击进入游戏").click();
assert.equal(root.children[0].textContent, "登录");
fields()[0].value = "teacher_demo";
fields()[1].value = "TeacherPassword123";
const progressReadsBeforeTeacherLogin = ownProgressReads;
await form().submit();
assert.equal(root.children[0].textContent, "主界面");
for (const hidden of ["开始", "成就", "成绩"]) {
  assert.ok(!root.querySelectorAll("button").some((x)=>x.textContent===hidden),
    `Teacher main menu must not contain ${hidden}`);
}
assert.equal(ownProgressReads,progressReadsBeforeTeacherLogin,
  "Teacher login must not read a personal game save");
await b("教学管理").click();
assert.equal(root.children[0].textContent, "学生");
await b("成绩").click();
assert.equal(root.children[0].textContent, "成绩");
const scoreHeaders=root.querySelectorAll("th").map((el)=>el.textContent);
assert.ok(scoreHeaders.includes("成绩"));
assert.ok(scoreHeaders.includes("最佳通过组数/步数"));
assert.ok(scoreHeaders.includes("完成时间"));
assert.ok(!scoreHeaders.includes("用时(秒)"));
assert.ok(root.querySelectorAll("td").some((el)=>el.textContent==="100%"));
assert.ok(root.querySelectorAll("td").some((el)=>
  el.textContent==="演示关卡（非正式电路评测）"));
const scoreFilters=root.children.find((item)=>
  item.tagName==="DIV" &&
  item.children.some((child)=>child.textContent==="导出成绩"));
assert.ok(scoreFilters,"Teacher score filters should exist");
const exportAt=scoreFilters.children.findIndex((x)=>x.textContent==="导出成绩");
const classAt=scoreFilters.children.findIndex((x)=>x.tagName==="LABEL"
  && x.textContent.startsWith("班级"));
const searchAt=scoreFilters.children.findIndex((x)=>x.tagName==="LABEL"
  && x.textContent.startsWith("学号/姓名"));
assert.ok(classAt>=0 && classAt<exportAt && exportAt<searchAt,
  "Export grades must be immediately after class choice and before search");
await b("导出成绩").click();
assert.ok(downloadedFiles.includes("scores.csv"));
simulateOldNumericDemo=true;
await b("成绩").click();
assert.ok(root.querySelectorAll("td").some((x)=>
  x.textContent==="旧版演示未记录组数"));
assert.ok(root.querySelectorAll("td").some((x)=>
  x.textContent==="不适用（旧演示）"));
simulateOldNumericDemo=false;
await b("进度").click();
assert.equal(root.children[0].textContent, "进度");
await b("学生").click();
assert.equal(root.children[0].textContent, "学生");
// The preview remains mandatory, but successful preview is not itself a
// final import authorization. The new confirmation must identify the file.
const fixtureFileElement = root.querySelectorAll("input").find(
  (field)=>field.type==="file"
);
assert.ok(fixtureFileElement,"Teacher student page must expose roster upload");
assert.ok(b("导入学生").disabled,"Import must be disabled before preview");
const beforeImportConfirm=confirmedCount;
fixtureFileElement.files = [{
  name:fixtureImportFile,size:180,base64:fixtureImportBase64,
  type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}];
for(const listener of fixtureFileElement.handlers.change||[]) await listener();
assert.ok(b("导入学生").disabled);
await b("预览校验名单").click();
assert.equal(importPreviewCalls,1,"Dry run must be sent before final submission");
assert.equal(importWriteCalls,0,"Preview must not write student accounts");
assert.equal(confirmedCount,beforeImportConfirm,"Preview must not open final confirmation");
assert.equal(b("导入学生").disabled,false,"Valid preview enables import button");
assert.ok(root.querySelectorAll("p").some((node)=>node.textContent==="预览通过：2人。"));
const expectedImportWarning =
  `确认导入${fixtureImportFile}吗？导入后的学生信息如需修改请联系管理员。`;
denyNext = true;
await b("导入学生").click();
assert.equal(confirmedCount,beforeImportConfirm+1);
assert.equal(confirmationTexts.at(-1),expectedImportWarning,
  "Import confirmation must use the exact supplied wording and filename");
assert.equal(importWriteCalls,0,"Cancel must not trigger the write request");
assert.equal(importPreviewCalls,1,"Cancel should not force an additional preview");
assert.equal(b("导入学生").disabled,false,
  "After cancel, the reviewed upload must remain ready to confirm again");
assert.ok(root.querySelectorAll("p").some((node)=>node.textContent==="预览通过：2人。"),
  "Cancel should keep the successful preview visible");
await b("导入学生").click();
assert.equal(confirmedCount,beforeImportConfirm+2);
assert.equal(confirmationTexts.at(-1),expectedImportWarning);
assert.equal(importWriteCalls,1,"Confirm should make exactly one final POST");
assert.deepEqual(lastImportPayload,{
  filename:fixtureImportFile,contentBase64:fixtureImportBase64,dryRun:false,
});
assert.equal(root.children[0].textContent,"学生",
  "Confirmed import should refresh the student list");

assert.ok(!root.querySelectorAll("button").some((x)=>
  x.textContent==="查看本教师操作日志"),"No duplicate logs button below import");
assert.ok(root.querySelectorAll("p").some((x)=>x.textContent==="支持CSV/TSV/XLSX。"));
assert.ok(b("退出带班").disabled,"All classes should disable leave");
assert.ok(!root.querySelectorAll("button").some((x)=>
  ["修改姓名","重置密码","移出本班","转班"].includes(x.textContent)),
  "Teacher list must not include row-level mutations");

// Search and status/CSV filtering are separate. Export does not inherit q.
const searchInput=root.querySelectorAll("input")[0];
searchInput.value="9000000001";
await b("搜索").click();
assert.ok(studentQueries.at(-1).includes("q=9000000001"));
assert.equal(root.querySelectorAll("input")[0].value,"",
  "Teacher search input should clear after submission");
root.querySelectorAll("input")[0].value="9000000010";
await b("搜索").click();
assert.ok(studentQueries.at(-1).includes("q=9000000010"),
  "Next teacher search should use the fresh input, not the previous query");
assert.equal(root.querySelectorAll("input")[0].value,"");
await b("导出筛选").click();
assert.equal(rosterCsvQueries.length,1);
assert.ok(!rosterCsvQueries.at(-1).includes("q="),
  "Filtered student CSV must not inherit search terms");
assert.ok(downloadedFiles.includes("students.csv"),
  "The roster export must have a students.csv filename");

const classChoice=root.querySelectorAll("select")[0];
classChoice.value="1";
for(const callback of classChoice.handlers.change||[]) await callback();
await new Promise((resolve)=>setImmediate(resolve));
assert.equal(b("退出带班").disabled,false,
  "Selecting a concrete class should enable Leave Class");

const filterSelectors=root.querySelectorAll("select");
filterSelectors[1].value="unset";
await b("筛选").click();
assert.ok(studentQueries.at(-1).includes("status=unset"),
  "Status button must activate a status filter");
assert.ok(!studentQueries.at(-1).includes("q="),
  "Status filter must not inherit name search");
await b("导出筛选").click();
assert.ok(rosterCsvQueries.at(-1).includes("status=unset"));
assert.ok(!rosterCsvQueries.at(-1).includes("q="));

// The detail button follows the student's name, separate from the name text.
await b("详情").click();
assert.equal(root.children[0].textContent,"学生详情");
assert.ok(!root.querySelectorAll("button").some((el)=>el.textContent==="修改姓名"),
  "Teacher must have no name-edit action even in details");
const confirmationsBeforeReset=confirmedCount;
await b("重置密码").click();
assert.equal(resetCount,1);
assert.equal(confirmedCount,confirmationsBeforeReset,
  "Resetting student setup should not prompt for confirmation");
denyNext=true;
await b("移出本班").click();
assert.equal(studentRemoved,false,"Cancelled removal keeps student in class");
assert.ok(confirmationTexts.at(-1).includes("移出“"));
await b("移出本班").click();
assert.equal(studentRemoved,true,"Confirmed removal is submitted");
await b("返回主界面").click();
await b("退出登录").click();
assert.equal(root.children[0].textContent, "铸算 · 华夏纪");
await b("点击进入游戏").click();
fields()[0].value = "school_admin";
fields()[1].value = "AdminPass123";
await form().submit();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(root.children[0].textContent, "管理员总览");
// Totals are plain text and do not duplicate the navigation buttons.
const overviewText = root.querySelectorAll("p").map((x)=>x.textContent).join(" ");
assert.ok(overviewText.includes("正常班级：1"));
assert.ok(overviewText.includes("启用教师账号：1"));
assert.ok(overviewText.includes("启用学生账号：1"));
assert.ok(overviewText.includes("已归档班级：0"));
assert.ok(overviewText.includes("已停用教师账号：0"));
assert.ok(overviewText.includes("已停用学生账号：0"));
assert.equal(root.querySelectorAll("button").filter((x)=>
  ["班级","教师","学生"].includes(x.textContent)).length,3);
assert.ok(!root.querySelectorAll("button").some((x)=>x.textContent==="班级：1"));

await b("学生").click();
assert.equal(root.children[0].textContent,"学生账号管理");
root.querySelectorAll("input")[0].value="9000000001";
await b("搜索").click();
assert.equal(root.querySelectorAll("input")[0].value,"",
  "Admin student search must reset input without clearing matching results");
assert.ok(!root.querySelectorAll("button").some((el)=>
  ["修改学号","修改姓名","删除账号","停用","分配"].includes(el.textContent)),
  "Admin student overview should only link to details");
await b("详情").click();
assert.equal(root.children[0].textContent,"学生详情");
assert.ok(b("修改学号"));
assert.ok(b("修改姓名"));
assert.ok(b("分配"));
assert.ok(b("删除账号"));
promptReplies.push(null);
await b("修改学号").click();
assert.equal(noUpdates,0,"Cancelling the in-page student-number prompt must not save");
promptReplies.push("9000000202");
await b("修改学号").click();
assert.equal(studentNumber,"9000000202");
assert.equal(studentName,"测试学生","Number change must leave name intact");
promptReplies.push("改过姓名的学生");
await b("修改姓名").click();
assert.equal(studentName,"改过姓名的学生");
assert.equal(studentNumber,"9000000202","Name change must leave number intact");
assert.equal(noUpdates,1);
assert.equal(nameUpdates,1);
denyNext=true;
await b("停用").click();
assert.equal(studentDisabled,false,"Cancelled student disable does nothing");
await b("停用").click();
assert.equal(studentDisabled,true);
assert.equal(confirmationTexts.at(-1),
  "确定停用9000000202吗？停用期间学生的成绩和进度将不可见。");
await b("返回学生名单").click();
assert.equal(root.children[0].textContent,"学生账号管理");

await b("班级").click();
assert.equal(root.children[0].textContent, "班级管理");
await b("详情").click();
assert.equal(root.children[0].textContent, "班级详情");
assert.ok(b("改名"),"Rename must move under class name");
assert.ok(b("归档"),"Archive must move under class name");
promptReplies.push(null);
await b("改名").click();
assert.equal(className,"一班","Cancelling the in-page class rename must not write");
promptReplies.push("改名后的班级");
await b("改名").click();
assert.equal(className,"改名后的班级");
assert.equal(root.children[0].textContent,"班级详情");
assert.ok(root.querySelectorAll("h3").some((x)=>x.textContent==="改名后的班级"),
  "Class name and actions must refresh in details after renaming");
assert.ok(!root.querySelectorAll("button").some((el)=>
  el.textContent==="删除"),"Nonempty class should not show Delete");

const teacherRows=root.querySelectorAll("tr").map((r)=>r.querySelectorAll("td").map((c)=>c.textContent));
assert.ok(teacherRows.some((row)=>row.includes("teacher_disabled")),
  "Teacher list must include disabled teachers");
assert.ok(teacherRows.some((row)=>row.includes("teacher_demo")),
  "Teacher list must include assigned teachers");
const teacherSearch=root.querySelectorAll("input")[0];
teacherSearch.value="teacher_disabled";
await b("搜索").click();
assert.equal(root.querySelectorAll("input")[0].value,"",
  "Teacher directory search should clear input after updating results");
assert.equal(root.querySelectorAll("button").filter((x)=>x.textContent==="分配").length,1);
assert.ok(root.querySelectorAll("button").filter((x)=>x.textContent==="分配")
  .every((x)=>x.disabled),"Disabled teacher stays visible but cannot be assigned");
await b("搜索").click(); // Blank input after the first search shows everyone again.
assert.equal(root.querySelectorAll("input")[0].value,"");
const allAssignments=root.querySelectorAll("button").filter((el)=>el.textContent==="分配");
assert.equal(allAssignments.length,3);
assert.equal(allAssignments.filter((el)=>el.disabled).length,2,
  "Disabled and assigned accounts must not be assignable");
const eligible=allAssignments.find((el)=>!el.disabled);
assert.ok(eligible,"Eligible teacher row needs a separate button");
assert.equal(messages.length,0,"No success alert before assignment");
await eligible.click();
assert.ok(teacherAssigned);
assert.equal(root.children[0].textContent,"班级详情");
const disabledAfter=root.querySelectorAll("button").filter((el)=>el.textContent==="分配");
assert.ok(disabledAfter.every((el)=>el.disabled),
  "After assignment the only eligible teacher should become disabled");
assert.equal(messages.length,0,"Successful assignment must not pop alert");
const notice=root.querySelectorAll("p").find((el)=>el.textContent==="操作成功");
assert.ok(notice && notice.hidden===false,"Inline success message");
await new Promise((resolve)=>setTimeout(resolve,1100));
assert.ok(notice.hidden,"Success message should be hidden after ~1 second");

denyNext=true;
await b("归档").click();
assert.equal(archivedClass,false,"Cancelled archive does not mutate");
failNextArchive=true;
await b("归档").click();
assert.equal(archivedClass,false);
assert.ok(messages.some((x)=>x.includes("状态冲突")));
const oldAlertCount=messages.length;
await b("归档").click();
assert.equal(archivedClass,true);
assert.equal(messages.length,oldAlertCount);
assert.equal(root.children[0].textContent,"班级详情");
assert.ok(b("恢复"),"Restore is located on archived class details");
assert.ok(root.querySelectorAll("button").filter((x)=>x.textContent==="分配")
  .every((x)=>x.disabled),"Archived class cannot assign anyone");
await b("返回班级列表").click();
assert.equal(root.children[0].textContent,"班级管理");
assert.ok(!root.querySelectorAll("button").some((x)=>x.textContent==="恢复"),
  "Class list should not have restore controls");
await b("详情").click();
assert.ok(b("恢复"));

// Creating a teacher has no secondary confirmation, disabling does.
await b("教师").click();
assert.equal(root.children[0].textContent,"教师账号管理");
root.querySelectorAll("input")[0].value="teacher_demo";
await b("搜索").click();
assert.equal(root.querySelectorAll("input")[0].value,"",
  "Admin teacher search input must clear, while the search remains applied");
await b("搜索").click(); // New blank search replaces the previous one.
const adminInputs = root.querySelectorAll("input");
assert.equal(adminInputs.length,4);
adminInputs[1].value = "new_teacher_42";
adminInputs[2].value = "新增教师";
adminInputs[3].value = "NewTeacherPass123";
const beforeCreateConfirmations = confirmedCount;
await b("创建教师").click();
assert.ok(teacherCreated);
assert.equal(confirmedCount,beforeCreateConfirmations,
  "Creating a teacher must not display a confirmation dialog");
promptReplies.push(null);
await b("重置密码").click();
assert.equal(teacherPasswordResets,0,"Cancelled password edit does not write");
promptReplies.push("ChangeTeacherPass987");
await b("重置密码").click();
assert.equal(teacherPasswordResets,1);
assert.equal(passwordPromptTypes.at(-1)[1],"password",
  "Resetting a teacher password must mask the in-page input");
await b("停用").click();
assert.ok(teacherDisabled);
assert.equal(confirmedCount,beforeCreateConfirmations+1,
  "Disabling a teacher must display a confirmation dialog");
assert.ok(confirmationTexts.some((text)=>text.includes("停用教师")));
await b("总览").click();
const updatedCounts = root.querySelectorAll("p").map((x)=>x.textContent).join(" ");
for (const expected of ["正常班级：0","已归档班级：1",
  "启用教师账号：0","已停用教师账号：1",
  "启用学生账号：0","已停用学生账号：1"]) {
  assert.ok(updatedCounts.includes(expected),`Missing summary ${expected}`);
}
await b("操作日志").click();
const auditCellValues = root.querySelectorAll("td").map((cell)=>cell.textContent);
assert.ok(auditCellValues.includes("越权"),
  "Admin audit table must distinguish unauthorized operations");
assert.ok(auditCellValues.includes("校验失败"),
  "Admin audit table must distinguish business validation failures");

// Direct dialog behavior: real DOM controls, Promise results and keyboard
// support. Native browser prompts are explicitly forbidden in this sandbox.
const {confirmDialog,promptDialog,alertDialog} =
  await import("../public/dialog.js");
async function pendingOverlay() {
  for(let i=0;i<15;i++) {
    const open=dialogBody();
    if(open.length) return open[0];
    await new Promise((resolve)=>setImmediate(resolve));
  }
  assert.fail("Expected the in-page modal to be rendered");
}
autoDialogs=false;
const preceding= b("操作日志");
preceding.focus();
const manualConfirm=confirmDialog("现在要取消一个敏感操作吗？");
let overlay=await pendingOverlay();
assert.equal(overlay.getAttribute("data-app-dialog"),"confirm");
assert.equal(overlay.querySelectorAll("button").length,2);
assert.equal(overlay.className,"dialog-overlay");
const escape=await overlay.keydown("Escape");
assert.ok(escape.defaultPrevented,"Escape should be consumed by the modal");
assert.equal(await manualConfirm,false,
  "Escape must act like cancelling and not perform the server request");
assert.equal(dialogBody().length,0,"Modal overlay must always be removed");
assert.equal(document.activeElement,preceding,"Focus must restore after dialog");

const manualPrompt=promptDialog("请输入新的学号","9000000001");
overlay=await pendingOverlay();
const entry=overlay.querySelectorAll("input")[0];
assert.equal(entry.value,"9000000001","Input prompt should show supplied default");
assert.equal(document.activeElement,entry,"Prompt input receives keyboard focus");
entry.value="9000000888";
const enter=await overlay.keydown("Enter");
assert.equal(enter.defaultPrevented,true);
assert.equal(await manualPrompt,"9000000888","Enter confirms typed value");
assert.equal(dialogBody().length,0);

const cancelledPrompt=promptDialog("请输入学生姓名","初始值");
overlay=await pendingOverlay();
await overlay.querySelectorAll("button").find((x)=>x.textContent==="取消").click();
assert.equal(await cancelledPrompt,null,"Prompt cancellation returns null");
const twoAlerts=[
  alertDialog("第一条错误"),
  alertDialog("第二条错误"),
];
overlay=await pendingOverlay();
assert.ok(overlay.querySelectorAll("p").some((x)=>x.textContent==="第一条错误"),
  "First queued alert must be visible");
assert.equal(dialogBody().length,1,"Dialogs must not stack");
await overlay.querySelectorAll("button").find((x)=>x.textContent==="确定").click();
assert.equal(await twoAlerts[0],true);
overlay=await pendingOverlay();
assert.ok(overlay.querySelectorAll("p").some((x)=>x.textContent==="第二条错误"),
  "Second queued alert must appear after the first");
await overlay.querySelectorAll("button").find((x)=>x.textContent==="确定").click();
assert.equal(await twoAlerts[1],true);
assert.equal(dialogBody().length,0);
autoDialogs=true;
assert.deepEqual(
  [...new Set(dialogKinds)].sort(),["alert","confirm","prompt"],
  "All 3 native-dialog types must have in-page replacements"
);
assert.ok(messages.some((x)=>x.includes("状态冲突")),
  "A server error should be visible in the in-page alert");

console.log("UI smoke: roster preview/cancel/retry/confirm, exact filename warning, 4 search resets, modal keyboard and role regressions PASS.");
