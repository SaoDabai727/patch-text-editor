@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  set PY=python
) else (
  set PY=py
)

echo ========================================
echo  构建 Setup 安装包 + 云端更新清单
echo ========================================
echo.

%PY% -m pip install pywebview pyinstaller pywin32 -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
  echo 依赖安装失败
  pause
  exit /b 1
)

%PY% build_release.py
if errorlevel 1 (
  echo 构建失败
  pause
  exit /b 1
)

echo.
echo 完成！请查看 release 文件夹：
echo   - 贴片文字修改工具_Setup_x.x.x.exe  （发给用户安装）
echo   - latest.json                       （上传到云端）
echo   - 上传到云端说明.txt
explorer release
pause
