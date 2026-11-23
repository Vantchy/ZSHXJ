#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-time ZSHXJ source cleanup: official fixed components; no live packaging.

Put this file plus official_components.py at the ZSHXJ project root, then run
    python clean_dynamic_package_once.py
It edits original source in place, makes backup ZIP, and does not modify DB/levels.
"""
from __future__ import annotations
import ast
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
EDITOR=ROOT/'public/circuit-editor.js'
SERVICE=ROOT/'circuit_service.py'
CONTENT=ROOT/'level_content.py'
INDEX=ROOT/'public/index.html'
OFFICIAL=ROOT/'official_components.py'
EXTRA=ROOT/'public/circuit-palette-drag-fix.js'
SOURCES=(EDITOR,SERVICE,CONTENT,INDEX)


def one(source, old, new, label):
    count=source.count(old)
    if count!=1:
        raise RuntimeError(f'{label} 期待1处原始代码，找到{count}处；为保护你的本地修改，本次未执行。')
    return source.replace(old,new,1)


def between(source,start,end,replacement,label):
    a=source.find(start)
    b=source.find(end,a+len(start))
    if a<0 or b<0 or b<=a:
        raise RuntimeError(f'找不到 {label} 的安全编辑范围。')
    return source[:a]+replacement+source[b:]


def edit_editor(s):
    # Merge official lesson tools into the ordinary palette: one list, no 'my packages'.
    s=between(s,'  const pkgGroup=palettePackages.length ?',
              '  const stage=$("main","ce-stage",layout);',
              '  const pkgList=paletteList;\n', '删除我的封装分组')
    s=one(s,'  const renderPaletteItem=(type,name,parent,packageItem)=>{',
        '  let paletteDragType=null;\n  const renderPaletteItem=(type,name,parent)=>{',
        '编辑器元件放置接口')
    new_drag='''    item.addEventListener("dragstart",e=>{
      if(submitting){e.preventDefault();return;}
      paletteDragType=type;
      e.dataTransfer?.setData("text/circuit-type",type);
      if(e.dataTransfer)e.dataTransfer.effectAllowed="copy";
    });
    item.addEventListener("dragend",()=>{paletteDragType=null;});
'''
    s=between(s,'    item.addEventListener("dragstart",e=>{','  };',new_drag,'封装查看按钮与拖放事件')
    s=one(s,'  palettePackages.forEach(p=>renderPaletteItem(p.type,p.name,pkgList,p));',
        '  palettePackages.forEach(p=>renderPaletteItem(p.type,p.name,pkgList));','官方元件列表')
    s=one(s,'    const type=e.dataTransfer.getData("text/circuit-type");',
        '    const type=e.dataTransfer?.getData("text/circuit-type")||paletteDragType;\n    paletteDragType=null;',
        '修复原生拖放')
    s=one(s,'    if(sub.completed){$("p","ce-success",result,"关卡完成！");if(data.package?.fresh)$("p","ce-success",result,`你封装了新元件：${data.package.name}`);}',
        '    if(sub.completed){$("p","ce-success",result,"关卡完成！");}',
        '移除自动封装结果')
    # Some repos may use six, seven or eight leading spaces; target by whole line.
    matches=re.findall(r'(?m)^\s*if\(data\.package\?\.fresh\)status\(`评测通过！你封装了新元件：\$\{data\.package\.name\}。`,"success"\);\n',s)
    if len(matches)!=1:
        raise RuntimeError('找不到自动封装成功提示。')
    s=s.replace(matches[0],'\n',1)
    s=between(s,'  function showPackage(pkg){','  function clearCanvas(){','', '封装内部预览窗口')
    if 'showPackage(' in s or 'ce-package-inspect' in s or '你封装了新元件' in s:
        raise RuntimeError('元件编辑器内仍存在旧的实时封装预览代码。')
    return s


def edit_service(s):
    s=between(s,'def _unlocked(con,user_id,spec,graph,defs):','def _submission_payload(',
              '', '提交后实时生成个人封装')
    s=one(s,'        "package":details.get("awardedPackage"),\n',
          '', '正式评测自动封装返回值')
    s=between(s,
        '    # An impossible recursive package must not persist a completed score.',
        '    with closing(db.connect(path)) as con:', '', '提交前个人封装校验')
    s=between(s,'        pkg=None','        duration=_finished_seconds(',
        '', '数据库写入新个人封装')
    s=one(s,'                  "graphDigest":graph_hash,"awardedPackage":pkg}',
        '                  "graphDigest":graph_hash}', '成绩附带个人封装')
    s=between(s,'def get_component(path,user_id,symbol,version):',
        'def _check_graph(','''
def get_component(path,user_id,symbol,version):
    # Retain the function signature for the original HTTP router, not the feature.
    raise engine.CircuitError('COMPONENT_PREVIEW_DISABLED',
                              '官方元件不提供内部电路查看',404)

'''.lstrip('\n'),'删除内部电路读取能力')
    if '_unlocked(' in s or 'awardedPackage' in s:
        raise RuntimeError('服务端仍有个人封装的生成逻辑。')
    return s


def edit_content(s):
    s=one(s,'import database as db\n',
        'import database as db\nfrom official_components import official_packages\n',
        '服务端官方元件定义')
    a=s.find('def owned(con, user_id):')
    b=s.find('def validate_package_dag(',a)
    if a<0 or b<0:raise RuntimeError('找不到旧数据兼容读取位置。')
    section=s[a:b]
    section=one(section,'    return result\n',
        '    # Keep old per-user versions for saved graphs; prefer the official version for new circuits.\n'
        '    result.update(official_packages(con,user_id))\n'
        '    return result\n', '官方元件替换个人封装')
    return s[:a]+section+s[b:]


def edit_index(s):
    s,count=re.subn(r'(?m)^[ \t]*<script[^>]*src="/circuit-palette-drag-fix\.js[^\"]*"[^>]*></script>[ \t]*\n',
                    '',s)
    if count>1:raise RuntimeError('临时拖放脚本有多个入口，需先人工确认。')
    return s


def main():
    for p in (*SOURCES,OFFICIAL):
        if not p.is_file():
            raise RuntimeError(f'缺少 {p.relative_to(ROOT)}，请在完整 ZSHXJ 项目根目录执行。')
    originals={p:p.read_text(encoding='utf-8') for p in SOURCES}
    edits={
        EDITOR:edit_editor(originals[EDITOR]),
        SERVICE:edit_service(originals[SERVICE]),
        CONTENT:edit_content(originals[CONTENT]),
        INDEX:edit_index(originals[INDEX]),
    }
    for p in (SERVICE,CONTENT,OFFICIAL):
        ast.parse(edits[p] if p in edits else p.read_text(encoding='utf-8'))
    # Check JS without creating any runtime adapter.
    temp=EDITOR.with_name('_circuit_editor_one_time_syntax_check.mjs')
    try:
        temp.write_text(edits[EDITOR],encoding='utf-8')
        try:
            js=subprocess.run(['node','--check',str(temp)],capture_output=True,text=True)
        except FileNotFoundError:
            js=None
            print('提示：未安装 Node.js，跳过额外 JS 语法检查。')
        if js is not None and js.returncode:
            raise RuntimeError(f'JS 语法检查未通过：{js.stderr}')
    finally:
        temp.unlink(missing_ok=True)
    backup=ROOT/'backup_before_official_components.zip'
    if backup.exists():
        raise RuntimeError('已有 backup_before_official_components.zip。为保护旧备份，请先自行改名。')
    with zipfile.ZipFile(backup,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for p in SOURCES:z.writestr(p.relative_to(ROOT).as_posix(),originals[p])
        if EXTRA.exists():z.write(EXTRA,arcname=EXTRA.relative_to(ROOT).as_posix())
    changed=[]
    try:
        for p,data in edits.items():
            p.write_text(data,encoding='utf-8')
            changed.append(p)
        EXTRA.unlink(missing_ok=True)
    except Exception:
        for p in changed:p.write_text(originals[p],encoding='utf-8')
        raise
    print('✅ 源码已整理：取消个人电路实时封装及内部查看。')
    print('✅ 改用通关后官方固定元件；旧个人电路只用于历史作业兼容。')
    print('✅ 无运行时补丁；临时拖放脚本与引用已删除。')
    print('✅ game.sqlite3、levels/*.json、教师端成绩均未修改。')
    print(f'修改前源码备份：{backup}')
    print('请彻底重启 python server.py 并强制刷新浏览器。')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(f'未修改或已回滚：{exc}',file=sys.stderr)
        raise SystemExit(1)
