import { alertDialog, confirmDialog, promptDialog } from "./dialog.js";
/* 教务界面：班级、师生账号、名单导入、成绩统计与操作日志。 */
function node(tag, text, host) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (tag === "div" && host?.className?.includes("page--management"))
    item.className = "management-group";
  if (host) host.append(item);
  return item;
}
function btn(label, parent, handler, disabled = false) {
  const button = node("button", label, parent);
  button.type = "button";
  if (/^(删除|停用|归档|移出|退出带班)/.test(label))
    button.className = "button--danger";
  if (/^(创建班级|创建教师|导入学生|预览校验名单|导出)/.test(label))
    button.className = "button--primary";
  // 异步操作结束后按当前条件恢复按钮状态。
  const isDisabled = typeof disabled === "function" ? disabled : () => disabled;
  button.disabled = Boolean(isDisabled());
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await handler(); } catch (error) {
      await alertDialog(error.message || "操作失败");
    }
    finally { button.disabled = Boolean(isDisabled()); }
  });
  return button;
}
function labelInput(parent, label, type = "text", placeholder = "") {
  const wrap = node("label", `${label}：`, parent);
  const field = node("input", undefined, wrap);
  field.type = type;
  field.placeholder = placeholder;
  return field;
}
function selectOf(parent, label, options, current = "") {
  const wrap = node("label", `${label}：`, parent);
  const select = node("select", undefined, wrap);
  for (const opt of options) {
    const child = node("option", opt.label, select);
    child.value = String(opt.value);
  }
  // Empty/default selection is explicit. A list without "全部" must also
  // have a meaningful selection instead of silently ending up on an invalid "".
  if (options.some((opt) => String(opt.value) === String(current))) {
    select.value = String(current);
  } else if (options.length) {
    select.value = String(options[0].value);
  }
  return select;
}
function table(parent, headers, rows) {
  if (!rows.length) {
    node("p", "暂无记录", parent);
    return;
  }
  const t = node("table", undefined, parent);
  t.className = "data-table";
  const thead = node("thead", undefined, t);
  const tr = node("tr", undefined, thead);
  for (const title of headers) node("th", title, tr);
  const body = node("tbody", undefined, t);
  for (const values of rows) {
    const r = node("tr", undefined, body);
    for (const value of values) {
      const cell = node("td", undefined, r);
      if (value && typeof value === "object" && value.tagName) cell.append(value);
      else cell.textContent = String(value ?? "");
      if (typeof value === "number") cell.className = "number-cell";
    }
  }
}
function gradeCountLabel(result) {
  if (!Number.isInteger(result.bestPassedCount) ||
      !Number.isInteger(result.totalCount)) {
    return "旧版演示未记录组数";
  }
  return `${result.bestPassedCount}/${result.totalCount} ${result.unit}`;
}
function gradeRateLabel(result) {
  return typeof result.completionRate === "number"
    ? `${result.completionRate}%` : "不适用（旧演示）";
}
function fragment() { return document.createElement("span"); }
function pages(host, pagination, goto) {
  if (!pagination) return;
  const bar = node("div", undefined, host);
  bar.className = "pagination";
  const current = pagination.page;
  btn("上一页", bar, () => goto(current-1), current <= 1);
  node("span", ` ${current} / ${Math.max(1, pagination.totalPages)} 页；共${pagination.total}条 `, bar);
  btn("下一页", bar, () => goto(current+1),
      current >= pagination.totalPages);
}
function queryString(values) {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      url.set(key, String(value));
    }
  }
  return "?" + url.toString();
}
// Submit the current text but leave an empty input for the next search.
function submitSearch(field, go) {
  const query = field.value.trim();
  field.value = "";
  return go(query);
}
let activeNotice = null;
let noticeTimer = null;

function showSuccessNotice() {
  // One short in-page line. Never open an alert for successful operations.
  if (!activeNotice) return;
  clearTimeout(noticeTimer);
  const target = activeNotice;
  target.textContent = "操作成功";
  target.hidden = false;
  noticeTimer = setTimeout(() => {
    if (activeNotice === target) {
      target.textContent = "";
      target.hidden = true;
    }
  }, 1000);
}

function toolbar(ctx, kind, title, currentView) {
  const host = ctx.page(title, "management");
  host.className += ` page--${kind} page--${kind}-${currentView}`;
  const nav = node("div", undefined, host);
  nav.className = "management-nav";
  if (kind === "admin") {
    for (const [name, view] of [
      ["总览","overview"],["班级","classes"],["教师","teachers"],
      ["学生","students"],["操作日志","logs"],
    ]) {
      const item = btn(name, nav, () => renderAdmin(ctx, view));
      if (view === currentView || (currentView === "classDetail" && view === "classes") ||
        (currentView === "studentDetail" && view === "students"))
        item.setAttribute("aria-current", "page");
    }
  } else {
    for (const [name, view] of [
      ["学生","students"],["成绩","scores"],["进度","progress"],["操作日志","logs"],
    ]) {
      const item = btn(name, nav, () => renderTeacher(ctx, view));
      if (view === currentView || (currentView === "detail" && view === "students"))
        item.setAttribute("aria-current", "page");
    }
    btn("返回主界面", nav, ctx.home);
  }
  clearTimeout(noticeTimer);
  activeNotice = node("p", "", host);
  activeNotice.setAttribute("role", "status");
  activeNotice.setAttribute("aria-live", "polite");
  activeNotice.hidden = true;
  activeNotice.className = "notice notice--success";
  return host;
}
async function mutate(ctx, path, data, next, confirmText = null) {
  // Confirm disruptive operations: disabling, archiving, and teacher removal
  // of a student from a class. All writes remain audited.
  if (confirmText && !(await confirmDialog(confirmText))) return false;
  const payload = confirmText ? { ...data, confirm: true } : data;
  const result = await ctx.api("POST", path, payload);
  if (next) {
    try {
      await next(result);
    } catch (error) {
      await alertDialog(`操作已生效，但刷新失败：${error.message || "请手动刷新"}`);
      showSuccessNotice();
      return true;
    }
  }
  showSuccessNotice();
  return true;
}
function auditResult(log) {
  if (log.result === "success") return "成功";
  if (log.failureType === "forbidden") return "越权";
  if (log.failureType === "validation") return "校验失败";
  return "失败"; // Older, uncategorized database records remain readable.
}
function classSelection(list, withAll=true) {
  const values = withAll ? [{label:"全部班级",value:""}] : [];
  return values.concat(list.map((c) => ({label:c.name,value:c.id})));
}
export async function renderAdmin(ctx, view="overview", options={}) {
  const host = toolbar(ctx, "admin", {
    overview:"管理员总览", classes:"班级管理", classDetail:"班级详情",
    teachers:"教师账号管理", students:"学生账号管理",
    studentDetail:"学生详情", logs:"操作日志",
  }[view] || "管理员总览", view);
  if (view === "overview") {
    const {overview} = await ctx.api("GET", "/api/admin/overview");
    node("p", `正常班级：${overview.classes}  ｜  启用教师账号：${overview.teachers}  ｜  启用学生账号：${overview.students}`, host).className = "overview-metrics overview-metrics--active";
    node("p", `已归档班级：${overview.archivedClasses}  ｜  已停用教师账号：${overview.disabledTeachers}  ｜  已停用学生账号：${overview.disabledStudents}`, host).className = "overview-metrics overview-metrics--archived";
    btn("退出登录", host, ctx.logout);
    return;
  }

  if (view === "classes") {
    const archived = options.archived === true;
    const {classes} = await ctx.api("GET", `/api/admin/classes?archived=${archived ? 1 : 0}`);
    const create = node("div", undefined, host);
    if (!archived) {
      const field = labelInput(create, "班级名称");
      field.maxLength = 60;
      btn("创建班级", create, async () => {
        const value = field.value.trim();
        if (!value || value.length > 60) throw new Error("班级名称须为1-60字符");
        await mutate(ctx, "/api/admin/classes", {name:value},
          () => renderAdmin(ctx,"classes",{archived:false}));
      });
    }
    table(host, ["班级","教师","学生数","未设密数","管理"], classes.map((c) => {
      const operations = fragment();
      btn("详情", operations, () =>
        renderAdmin(ctx,"classDetail",{classId:c.id}));
      return [
        c.name,
        c.teachers.map((t) => t.displayName + (t.active ? "" : "（停用）")).join("、") || "无",
        c.studentCount, c.unsetPasswordCount, operations,
      ];
    }));
    btn(archived ? "查看正常班级" : "查看已归档班级", host,
      () => renderAdmin(ctx,"classes",{archived:!archived}));
    return;
  }

  if (view === "classDetail") {
    const classId = options.classId;
    const page = options.page || 1;
    const teacherPage = options.teacherPage || 1;
    const teacherQ = options.teacherQ || "";
    const reload = () => renderAdmin(ctx,"classDetail",{...options,classId});
    const data = await ctx.api("GET",
      `/api/admin/classes/${classId}` + queryString({page,pageSize:20}));
    node("h3", `${data.class.name}${data.class.archived ? "（已归档）" : ""}`, host);
    // Keep all class mutations under the class name, not in the overview rows.
    const classActions = node("div",undefined,host);
    btn("改名", classActions, async () => {
      const value = await promptDialog("输入班级新名称",data.class.name);
      if (value === null) return;
      const name = value.trim();
      if (!name || name.length > 60) throw new Error("班级名称不能为空或超过60字");
      await mutate(ctx,`/api/admin/classes/${classId}/rename`,{name},reload);
    });
    if (data.class.archived) {
      btn("恢复",classActions,()=>mutate(ctx,
        `/api/admin/classes/${classId}/restore`,{},reload));
    } else {
      btn("归档",classActions,()=>mutate(ctx,
        `/api/admin/classes/${classId}/archive`,{},reload,
        `归档“${data.class.name}”？该班有${data.pagination.total}名学生、${data.teachers.length}名教师。归档后教师暂时无法查看该班，原有学生、存档、成绩与教师分配均保留。`));
    }
    if (data.pagination.total === 0) {
      btn("删除",classActions,()=>mutate(ctx,
        `/api/admin/classes/${classId}/delete-empty`,{},
        ()=>renderAdmin(ctx,"classes",{archived:data.class.archived})));
    }
    node("h4","已分配教师",host);
    table(host,["账号","姓名","状态","取消分配"],data.teachers.map((t) => {
      const actions = fragment();
      btn("移除",actions,()=>mutate(ctx,
        `/api/admin/classes/${classId}/teachers/${t.id}/remove`,{},reload));
      return [t.username,t.displayName,t.active?"启用":"停用",actions];
    }));
    node("h4","教师名单",host);
    const teacherFilters = node("div",undefined,host);
    const search = labelInput(teacherFilters,"账号/姓名");
    btn("搜索",teacherFilters,()=>submitSearch(search,(q)=>
      renderAdmin(ctx,"classDetail",{
        ...options,classId,teacherQ:q,teacherPage:1,
      })));
    // Include active, disabled and already assigned teachers; each row has
    // an independent action with UI + server-side eligibility enforcement.
    const directory = await ctx.api("GET",
      `/api/admin/classes/${classId}/teacher-directory` +
        queryString({q:teacherQ,page:teacherPage,pageSize:100}));
    table(host,["账号","姓名","状态","分配"],directory.teachers.map((t)=>{
      const action = fragment();
      btn("分配",action,()=>mutate(ctx,
        `/api/admin/classes/${classId}/teachers`,{teacherId:t.id},reload),
        data.class.archived || !t.active || t.assigned);
      return [t.username,t.displayName,
        (t.active?"启用":"停用")+(t.assigned?"（已分配）":""),action];
    }));
    pages(host,directory.pagination,(n)=>renderAdmin(ctx,"classDetail",{
      ...options,classId,teacherQ,teacherPage:n,
    }));
    node("h4","学生名单",host);
    table(host, ["学号","姓名","状态","密码设置"],
      data.students.map((x)=>[
        x.username,x.displayName,x.active?"启用":"停用",
        x.needsPasswordSetup?"未设密":"已设密",
      ]));
    pages(host,data.pagination,(n)=>renderAdmin(ctx,"classDetail",{
      ...options,classId,page:n,
    }));
    btn("返回班级列表",host,()=>renderAdmin(ctx,"classes",
      {archived:data.class.archived}));
    return;
  }

  if (view === "teachers") {
    const page = options.page || 1;
    const active = options.active !== false;
    const search = options.q || "";
    const result = await ctx.api("GET","/api/admin/teachers" +
      queryString({page,pageSize:20,active:active?1:0,q:search}));
    const inputs = node("div",undefined,host);
    const input = labelInput(inputs,"账号/姓名");
    btn("搜索",inputs,()=>submitSearch(input,(q)=>
      renderAdmin(ctx,"teachers",{active,q,page:1})));
    if (active) {
      const create = node("div",undefined,host);
      node("h3","创建教师",create);
      const username=labelInput(create,"账号");
      const display=labelInput(create,"姓名");
      const password=labelInput(create,"密码","password");
      btn("创建教师",create,()=>mutate(ctx, "/api/admin/teachers",
        {username:username.value.trim(),displayName:display.value.trim(),password:password.value},
        ()=>renderAdmin(ctx,"teachers")));
    }
    table(host,["账号","教师姓名","带班","状态","操作"],
      result.items.map((teacher)=>{
        const actions=fragment();
        const rolePath=`/api/admin/teachers/${teacher.id}`;
        btn(active?"停用":"启用",actions,()=>mutate(ctx,
          rolePath+(active?"/disable":"/enable"),{},
          ()=>renderAdmin(ctx,"teachers",{active,q:search,page}),
          active ? `停用教师“${teacher.displayName}”？当前登录会话将失效，带班关系保留。` : null));
        btn("重置密码",actions,async()=>{
          const pass=await promptDialog(
            `请为教师“${teacher.displayName}”输入新密码（至少8位）`,
            "",{inputType:"password"});
          if(pass===null)return;
          if(pass.length<8||pass.length>128)throw new Error("密码长度须为8-128位");
          await mutate(ctx, rolePath+"/reset-password",{newPassword:pass},
            ()=>renderAdmin(ctx,"teachers",{active,q:search,page}));
        });
        return [teacher.username,teacher.displayName,
          teacher.classes.map((c)=>c.name).join("、")||"无",
          active?"启用":"停用",actions];
      }));
    pages(host,result.pagination,(n)=>renderAdmin(ctx,"teachers",{active,q:search,page:n}));
    btn(active?"查看停用账号":"查看启用账号",host,
      ()=>renderAdmin(ctx,"teachers",{active:!active,q:search,page:1}));
    return;
  }

  if(view==="students") {
    const page=options.page||1;
    const active=options.active!==false;
    const q=options.q||"";
    const result=await ctx.api("GET","/api/admin/students"+
      queryString({page,pageSize:20,active:active?1:0,q}));
    const filters=node("div",undefined,host);
    const field=labelInput(filters,"账号/姓名");
    btn("搜索",filters,()=>submitSearch(field,(value)=>
      renderAdmin(ctx,"students",{active,q:value,page:1})));
    // List is read-only; all editing/assignment/disable/delete actions
    // live exclusively on the separate student details view.
    table(host,["学号","姓名","详情","所属班级","状态"],result.items.map((student)=>{
      const detail=fragment();
      btn("详情",detail,()=>renderAdmin(ctx,"studentDetail",{
        studentId:student.id,returnOptions:{active,q,page},
      }));
      return [
        student.studentNo||student.username,
        student.displayName,detail,
        student.className,student.active?"启用":"停用",
      ];
    }));
    pages(host,result.pagination,(n)=>renderAdmin(ctx,"students",{active,q,page:n}));
    btn(active?"查看停用账号":"查看启用账号",host,
      ()=>renderAdmin(ctx,"students",{active:!active,q,page:1}));
    return;
  }

  if (view==="studentDetail") {
    const studentId=options.studentId;
    const back=()=>renderAdmin(ctx,"students",options.returnOptions||{});
    const refresh=()=>renderAdmin(ctx,"studentDetail",options);
    const [{student:s},{classes:activeClasses}]=await Promise.all([
      ctx.api("GET",`/api/admin/students/${studentId}`),
      ctx.api("GET","/api/admin/classes?archived=0"),
    ]);
    node("h3",`${s.displayName}（${s.studentNo||s.username}）`,host);
    node("p",`班级：${s.className}；状态：${s.active?"启用":"停用"}；密码状态：${s.needsPasswordSetup?"未设置":"已设置"}`,host);
    node("h4","管理操作",host);
    const actions=node("div",undefined,host);
    if (s.active) {
      const possible=activeClasses.filter((c)=>c.id!==s.classId);
      const target=selectOf(actions,"移至班级",classSelection(possible,false));
      btn("分配",actions,()=>{
        if(!target.value)throw new Error("请选择有效目标班级");
        return mutate(ctx,`/api/admin/students/${studentId}/move`,
          {toClassId:Number(target.value)},refresh);
      },possible.length===0);
      btn("修改学号",actions,async()=>{
        const value=await promptDialog(
          `修改${s.username}的学号（10位）`,s.studentNo||s.username);
        if(value===null)return;
        const studentNo=value.trim();
        if(!/^[0-9]{10}$/.test(studentNo))
          throw new Error("学号必须是10位数字");
        await mutate(ctx,`/api/admin/students/${studentId}/update-no`,
          {studentNo},refresh);
      });
      btn("修改姓名",actions,async()=>{
        const value=await promptDialog("修改学生姓名",s.displayName);
        if(value===null)return;
        const displayName=value.trim();
        if(!displayName||displayName.length>40)
          throw new Error("学生姓名必须为1-40字");
        await mutate(ctx,`/api/admin/students/${studentId}/update-name`,
          {displayName},refresh);
      });
    }
    btn(s.active?"停用":"启用",actions,()=>mutate(ctx,
      `/api/admin/students/${studentId}/${s.active?"disable":"enable"}`,{},
      refresh,s.active ?
      `确定停用${s.username}吗？停用期间学生的成绩和进度将不可见。` : null));
    if(s.needsPasswordSetup && !s.everPasswordSet) {
      btn("删除账号",actions,()=>mutate(ctx,
        `/api/admin/students/${studentId}/delete-error`,{},back));
    }
    btn("返回学生名单",host,back);
    return;
  }

  if(view==="progress") {
    const classId=options.classId||"";
    const q=options.q||"";
    const page=options.page||1;
    const filters=node("div",undefined,host);
    const select=selectOf(filters,"班级",classSelection(classes),classId);
    const search=labelInput(filters,"学号/姓名");
    search.value=q;
    btn("查询",filters,()=>renderTeacher(ctx,"progress",{
      classId:select.value,q:search.value.trim(),page:1,
    }));
    const reply=await ctx.api("GET","/api/teacher/progress"+
      queryString({classId,q,page,pageSize:20}));
    table(host,["姓名","学号","班级","章节","存档点","版本","保存时间"],
      reply.progress.map((record)=>{
        const studentLink=fragment();
        btn(record.student.displayName,studentLink,()=>renderTeacher(
          ctx,"detail",{studentId:record.student.id}));
        return [
          studentLink,record.student.studentNo||record.student.username,
          record.student.className,record.chapterTitle,
          record.checkpoint,record.revision,record.updatedAt,
        ];
      }));
    pages(host,reply.pagination,(n)=>renderTeacher(
      ctx,"progress",{...options,page:n}));
    return;
  }

  if(view==="logs") {
    const page=options.page||1;
    const {classes:normal}=await ctx.api("GET","/api/admin/classes?archived=0");
    const {classes:archived}=await ctx.api("GET","/api/admin/classes?archived=1");
    const actor=options.actor||"";
    const classId=options.classId||"";
    const start=options.from||"";
    const end=options.to||"";
    const filters=node("div",undefined,host);
    const who=labelInput(filters,"操作人账号");who.value=actor;
    const select=selectOf(filters,"班级",classSelection([...normal,...archived]),classId);
    const from=labelInput(filters,"起始日期","date");from.value=start;
    const to=labelInput(filters,"结束日期","date");to.value=end;
    btn("筛选日志",filters,()=>renderAdmin(ctx,"logs",{
      actor:who.value.trim(),classId:select.value,
      from:from.value,to:to.value,page:1,
    }));
    const response=await ctx.api("GET","/api/admin/logs"+
      queryString({page,pageSize:20,actor,classId,from:start,to:end}));
    table(host,["时间(北京时间)","操作人","动作","关联班级","对象","结果","说明"],
      response.logs.map((l)=>[
        l.createdAt,l.actor,l.action,
        l.classes.map((c)=>c.name).join("、")||"-",
        `${l.targetType||""} ${l.targetId||""}`,
        auditResult(l),l.message,
      ]));
    pages(host,response.pagination,(n)=>renderAdmin(ctx,"logs",{...options,page:n}));
    return;
  }
}

function teacherStudentActions(ctx, host, student, classes, returnOptions={}) {
  const box=host||fragment();
  const sid=student.id;
  const base=`/api/teacher/students/${sid}`;
  const stay=()=>renderTeacher(ctx,"detail",{studentId:sid,returnOptions});
  const back=()=>renderTeacher(ctx,"students",{...returnOptions,page:1});
  // Teachers no longer have a name editing action, including through the API.
  btn("移出本班",box,()=>mutate(ctx,base+"/remove",{},back,
    `确定将学生${student.studentNo||student.username}移出“${student.className}”吗？学生账号及历史成绩、进度将保留。`));
  const other=classes.filter((c)=>c.id!==student.classId);
  const select=selectOf(box,"转班",classSelection(other,false));
  btn("转班",box,()=>{
    if(!select.value)throw new Error("没有其他同时带的班；请联系管理员办理跨教师转班");
    return mutate(ctx,base+"/transfer",{toClassId:Number(select.value)},stay);
  },other.length===0);
  btn("重置密码",box,()=>mutate(ctx,base+"/reset-password",{},stay));
  return box;
}

export async function renderTeacher(ctx, view="students", options={}) {
  const host=toolbar(ctx,"teacher",{
    students:"学生",scores:"成绩",
    progress:"进度",detail:"学生详情",logs:"操作日志",
  }[view] || "教学管理", view);
  const {classes}=await ctx.api("GET","/api/classes");

  if(view==="students") {
    const mode=options.mode==="search"?"search":"filter";
    const q=mode==="search"?(options.q||""):"";
    const classId=options.classId||"";
    const status=mode==="filter"?(options.status||"all"):"all";
    const chapterId=options.chapterId||"ch1";
    const page=options.page||1;

    // Row 1: school class, search by number/name, and class unassignment.
    const searchRow=node("div",undefined,host);
    const filterClass=selectOf(searchRow,"班级",classSelection(classes),classId);
    const leave=btn("退出带班",searchRow,()=>mutate(ctx,
      `/api/teacher/classes/${filterClass.value}/leave`,{},
      ()=>renderTeacher(ctx,"students",{page:1})),!classId);
    const filterName=labelInput(searchRow,"学号/姓名");
    btn("搜索",searchRow,()=>submitSearch(filterName,(value)=>
      renderTeacher(ctx,"students",{
        classId:filterClass.value,q:value,mode:"search",page:1,
      })));
    filterClass.addEventListener("change",()=>{
      leave.disabled=!filterClass.value;
      renderTeacher(ctx,"students",{
        ...options,classId:filterClass.value,page:1,
      }).catch((error)=>alertDialog(error.message||"无法切换班级"));
    });

    // Row 2: independent chapter/status filters and CSV export. Search text
    // is deliberately never included in the export query.
    const filterRow=node("div",undefined,host);
    const filterStatus=selectOf(filterRow,"状态",[
      {label:"全部",value:"all"},{label:"未设置密码",value:"unset"},
      {label:"某章未开始",value:"not_started"},
      {label:"某章未完成",value:"not_completed"},
    ],status);
    const chapterSelect=selectOf(filterRow,"章节",
      ctx.chapters.map((c)=>({label:c.title,value:c.id})),chapterId);
    const statusOnly=()=>({
      classId:filterClass.value,status:filterStatus.value,
      chapterId:chapterSelect.value,
    });
    btn("筛选",filterRow,()=>renderTeacher(ctx,"students",{
      ...statusOnly(),mode:"filter",page:1,
    }));
    btn("导出筛选",filterRow,()=>ctx.downloadCsv(
      "/api/teacher/students.csv"+queryString(statusOnly())));

    const query=mode==="search"
      ? {classId,q,status:"all"}
      : {classId,q:"",status,chapterId};
    const result=await ctx.api("GET","/api/teacher/students"+
      queryString({...query,page,pageSize:20}));
    table(host,["学号","姓名","班级","密码状态"],result.students.map((student)=>{
      const nameBox=fragment();
      node("span",student.displayName,nameBox);
      btn("详情",nameBox,()=>renderTeacher(ctx,"detail",{
        studentId:student.id,returnOptions:{...options,page},
      }));
      return [
        student.studentNo,nameBox,student.className,
        student.needsPasswordSetup?"未设密":"已设密",
      ];
    }));
    pages(host,result.pagination,(n)=>renderTeacher(
      ctx,"students",{...options,page:n}));
    node("h3","导入学生",host);
    const importer=node("div",undefined,host);
    const classChoice=selectOf(importer,"目标班级",classSelection(classes,false));
    const file=labelInput(importer,"名单文件","file");
    file.accept=".csv,.tsv,.xlsx";
    node("p","支持CSV/TSV/XLSX。",importer);
    const info=node("p","",importer);
    const preview=node("div",undefined,importer);
    let approved=null;
    const commit=btn("导入学生",importer,async()=>{
      if(!approved)throw new Error("请先预览名单");
      const selection=approved;
      const warning=`确认导入${selection.filename}吗？导入后的学生信息如需修改请联系管理员。`;
      if(!(await confirmDialog(warning))) return;
      // If the target class or file changed while the dialog was open,
      // require a fresh preview instead of importing a stale snapshot.
      if(approved!==selection) throw new Error("名单或目标班级已更改，请重新预览");
      await mutate(ctx, `/api/classes/${selection.classId}/students/import`,
        {filename:selection.filename,contentBase64:selection.data,dryRun:false},
        ()=>renderTeacher(ctx,"students",{...options,page:1}));
    },()=>!approved);
    function clearApproval() {approved=null;commit.disabled=true;info.textContent="";preview.replaceChildren();}
    file.addEventListener("change",clearApproval);
    classChoice.addEventListener("change",clearApproval);
    btn("预览校验名单",importer,async()=>{
      clearApproval();
      if(!classChoice.value||!file.files?.[0])throw new Error("请选择班级与名单文件");
      const data=await ctx.asBase64(file.files[0]);
      const fname=file.files[0].name;
      try {
        const check=await ctx.api("POST",`/api/classes/${classChoice.value}/students/import`,
          {filename:fname,contentBase64:data,dryRun:true});
        info.textContent=`预览通过：${check.count}人。`;
        table(preview,["学号","姓名"],check.preview.map((x)=>[x.studentNo,x.name]));
        approved={classId:classChoice.value,
          className:classes.find((x)=>String(x.id)===classChoice.value)?.name||"",
          data,filename:fname,count:check.count};
        commit.disabled=false;
      }catch(error){
        info.textContent="";
        for(const issue of error.body?.errors||[])
          node("p",`第${issue.row}行：${issue.message}`,preview);
        await alertDialog(error.message || "名单校验失败");
      }
    });
    return;
  }

  if(view==="detail") {
    const studentId=options.studentId;
    const info=await ctx.api("GET",`/api/teacher/students/${studentId}`);
    const s=info.student;
    node("h3",`${s.displayName}（${s.studentNo}）`,host);
    node("p",`班级：${s.className}；密码状态：${s.needsPasswordSetup?"未设置":"已设置"}`,host);
    node("h4","管理操作",host);
    teacherStudentActions(ctx,node("div",undefined,host),s,classes,
      options.returnOptions||{classId:s.classId});
    node("h4","各章节存档",host);
    for(const ch of info.chapters) {
      node("h4",ch.chapterTitle,host);
      node("p",`存档点：${ch.checkpoint||"无"}；是否开始：${ch.started?"是":"否"}；`+
        `是否完成：${ch.completed?"是":"否"}；最近存档：${ch.updatedAt||"-"}`,host);
    }
    node("h4","已提交的关卡成绩（含单独标识的演示记录）",host);
    table(host,
      ["章节","关卡","状态","最佳通过组数/步数","提交次数","完成时间","成绩"],
      (info.levelResults||[]).map((r)=>[
        r.chapterTitle,r.levelTitle,r.status,
        gradeCountLabel(r),
        r.submissionCount,r.completedAt||"—",gradeRateLabel(r),
      ]));
    btn("返回学生名单",host,()=>renderTeacher(ctx,"students",
      options.returnOptions||{classId:s.classId}));
    return;
  }

  if(view==="scores") {
    const classId=options.classId||"";
    const q=options.q||"";
    const page=options.page||1;
    const filters=node("div",undefined,host);
    const select=selectOf(filters,"班级",classSelection(classes),classId);
    // Keep CSV next to class choice and before student-name search.
    btn("导出成绩",filters,()=>ctx.downloadCsv(
      "/api/teacher/circuit-results.csv"+queryString({
        classId:select.value,q:search.value.trim(),
      })));
    const search=labelInput(filters,"学号/姓名");search.value=q;
    btn("查询",filters,()=>renderTeacher(ctx,"scores",{
      classId:select.value,q:search.value.trim(),page:1,
    }));
    const reply=await ctx.api("GET","/api/teacher/circuit-results"+
      queryString({classId,q,page,pageSize:20}));
    table(host,["学生","学号","班级","章节","关卡","状态",
      "最佳通过组数/步数","提交次数","完成时间","成绩"],
      reply.results.map((r)=>{
        const studentLink=fragment();
        btn(r.student.displayName,studentLink,()=>renderTeacher(ctx,"detail",{
          studentId:r.student.id,
        }));
        return [studentLink,r.student.studentNo||"",r.student.className,
          r.chapterTitle,r.levelTitle,r.status,
          gradeCountLabel(r),
          r.submissionCount,r.completedAt||"—",gradeRateLabel(r)];
      }));
    pages(host,reply.pagination,(n)=>renderTeacher(ctx,"scores",{...options,page:n}));
    return;
  }

  if(view==="logs") {
    const page=options.page||1;
    const result=await ctx.api("GET","/api/teacher/logs"+queryString({page,pageSize:20}));
    table(host,["时间","操作人","操作","关联班级","结果","说明"],
      result.logs.map((log)=>[
        log.createdAt,log.actor,log.action,
        log.classes.map((c)=>c.name).join("、")||"-",
        auditResult(log),log.message,
      ]));
    pages(host,result.pagination,(n)=>renderTeacher(ctx,"logs",{page:n}));
    return;
  }
}
