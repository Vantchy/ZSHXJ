"""只读排查：检查大地图 27 个城池对应的小地图素材是否真正落盘。

用法：在 ZSHXJ 根目录运行 python tools/check_chapter_map_inventory_v79.py
不会修改素材、任务或存档。检查并报告路径与命名差异。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "public" / "assets"
CITIES = [
    (1,"mengjin","孟津"),(2,"taosi","陶寺"),(3,"guirui","妫汭"),
    (4,"yangcheng","阳城"),(5,"gan","甘"),(6,"zhenxun","斟鄩"),
    (7,"zhongcun","钟村"),(8,"xiwubi","西吴壁"),(9,"xingong","新宫"),
    (10,"jingbo","景亳"),(11,"mingtiao","鸣条"),(12,"bo","亳"),
    (13,"yanshishangcheng","偃师商城"),(14,"sibei","寺北"),
    (15,"yin","殷"),(16,"qiangfang","羌方"),(17,"chaoge","朝歌"),
    (18,"qizhou","岐周"),(19,"fenghao","丰镐"),(20,"muye","牧野"),
    (21,"luoyi","洛邑"),(22,"jin","晋"),(23,"qufu","曲阜"),
    (24,"linzi","临淄"),(25,"yi","彘"),(26,"taiyuan","太原"),
    (27,"lishan","骊山"),
]
EXTS={'.png','.webp','.jpg','.jpeg'}


def known_paths(number,slug,hanzi):
    pad=f"{number:02d}"
    folder=BASE / 'scenes' / 'chapter1-maps'
    return [
        folder/f'{pad}-{slug}.webp', folder/f'{pad}-{slug}.png',
        folder/f'{pad}_{slug}.webp', folder/f'{pad}_{slug}.png',
        folder/f'{pad}_{hanzi}.webp', folder/f'{pad}_{hanzi}.png',
        folder/f'{pad}-{hanzi}.png', folder/f'{pad}-{hanzi}.webp',
        BASE/'scenes'/'maps'/f'{pad}-{slug}.webp',
        BASE/'maps'/'chapter1'/f'{pad}-{slug}.webp',
        BASE/'maps'/f'{pad}-{slug}.png',
        BASE/'scenes'/f'{pad}_{hanzi}.png',
    ]


def inventory():
    images=sorted(p for p in BASE.rglob('*') if p.is_file() and p.suffix.lower() in EXTS) if BASE.is_dir() else []
    found=0
    for num,slug,name in CITIES:
        primary=(BASE/'scenes'/'chapter1-maps'/f'{num:02d}-{slug}.webp')
        candidates=known_paths(num,slug,name)
        hit=next((p for p in candidates if p.is_file()),None)
        if hit:
            found+=1
            print(f'✓ {num:02d} {name:6} {hit.relative_to(ROOT)}')
        else:
            # Suggest files that may exist under an unregistered name. Do not
            # misrepresent guesses as automatically routable paths.
            possible=[p for p in images if p.stem.startswith(f'{num:02d}_') or
                      p.stem.startswith(f'{num:02d}-') or name in p.name or
                      slug in p.stem]
            print(f'✗ {num:02d} {name:6} 未找到支持的地图路径')
            for p in possible[:4]:
                print(f'  可能的未登记文件：{p.relative_to(ROOT)}')
            if num>10:
                print(f'  可采用命名：{primary.relative_to(ROOT)}')
    print(f'\n合计：{found}/27 个城池的小地图按当前规则可找到素材。')
    print('提示：没有素材不代表没连接城池按钮；已连接按钮会明确显示素材缺失。')
    return found


if __name__ == '__main__':
    inventory()
