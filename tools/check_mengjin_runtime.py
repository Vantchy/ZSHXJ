#!/usr/bin/env python3
"""Run from the SAME project root as server.py; no login or DB changes."""
import sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from chapters import CHAPTERS
by_id = {item['id']: item for item in CHAPTERS}
ch1 = by_id['ch1']
places = {place['id']: place for place in ch1['locations']}
required = ('mengjin-jade-courtyard', 'mengjin-diviner-residence', 'mengjin-school-courtyard', 'taosi-old-academy')
print('正在检查的项目根目录：', root)
print('章节文件：', (root / 'chapters.py').resolve())
for key in required:
    loc = places.get(key)
    print(('OK' if loc else 'MISSING'), key, (loc or {}).get('background', ''))
    if loc:
        asset = root / 'public' / loc['background'].removeprefix('/')
        print(' ', '图片存在' if asset.is_file() else '图片缺失', str(asset))
if not all(name in places for name in required):
    raise SystemExit('检查失败：此目录并未完整安装 V5 章节文件。')
print('本目录的章节与场景图片检查完成。注意：若运行中的 HTTP 进程来自其他目录，需先停止它再从本目录启动。')
