"""Create a clean local demo database. Never silently overwrite user data."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import create_server  # noqa: E402


def reset(path: Path, *, force: bool = False) -> None:
    path = path.resolve()
    if path.exists():
        if not force:
            raise FileExistsError(f'{path} 已存在。请先备份，再显式传入 --force。')
        path.unlink()
    for suffix in ('-wal', '-shm'):
        extra = Path(str(path) + suffix)
        if extra.exists():
            raise RuntimeError(f'{extra} 仍存在，可能有运行中的数据库连接；请停止服务。')
    server = create_server('127.0.0.1', 0, path)
    server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description='生成无账号、无成绩的实验数据库，只保留表结构和正式关卡快照')
    parser.add_argument('--output', type=Path, default=ROOT / 'test.sqlite3')
    parser.add_argument('--force', action='store_true', help='确认清空现有文件（执行前自行备份）')
    args = parser.parse_args()
    reset(args.output, force=args.force)
    print(f'已生成空白测试数据库：{args.output.resolve()}')


if __name__ == '__main__':
    main()
