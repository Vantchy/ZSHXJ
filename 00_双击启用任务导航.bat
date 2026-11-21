@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo [ZSHXJ] 启用统一任务导航与关卡返回功能
echo.
where python >nul 2>nul
if errorlevel 1 (
    py -3 "tools\activate_quest_navigation.py" --apply
) else (
    python "tools\activate_quest_navigation.py" --apply
)
if errorlevel 1 (
    echo.
    echo 没有覆盖已有源码，请查看上面的兼容性提示。
) else (
    echo.
    echo 完成。现在重新打开游戏或强制刷新浏览器即可。
)
echo.
pause
