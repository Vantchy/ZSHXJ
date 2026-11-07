#!/usr/bin/env python3
"""离线CSV检查：按班级统计提交记录数和完成次数，不计算平均成绩或平均用时。"""
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path


def count_records(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError("找不到CSV")
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("文件超过10MB，请先分批导出")
    counts = defaultdict(Counter)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"class_name", "student_no", "chapter_id", "completed"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("不是本游戏导出的成绩CSV结构")
        for row in reader:
            klass = (row["class_name"] or "").lstrip("\t") or "未分班"
            raw = (row["completed"] or "").strip()
            if raw not in ("0", "1"):
                raise ValueError(f"CSV第{reader.line_num}行的完成状态不合法")
            counts[klass]["records"] += 1
            counts[klass]["completed"] += int(raw)
    return counts


def main():
    if len(sys.argv) != 2:
        sys.exit("用法：python tools/analyze_scores.py scores.csv")
    try:
        stats = count_records(sys.argv[1])
    except ValueError as error:
        sys.exit(str(error))
    if not stats:
        print("暂无成绩记录")
    for klass in sorted(stats):
        record = stats[klass]
        print(f"{klass}：提交记录{record['records']}条；完成记录{record['completed']}条")


if __name__ == "__main__":
    main()
