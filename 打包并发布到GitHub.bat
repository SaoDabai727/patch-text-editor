@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (set PY=python) else (set PY=py)

echo ========================================
echo  构建 + 发布到 GitHub Releases
echo ========================================

%PY% -m pip install pywebview pyinstaller pywin32 packaging -i https://pypi.tuna.tsinghua.edu.cn/simple
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

%PY% publish_github.py
if errorlevel 1 (
  echo 发布失败
  pause
  exit /b 1
)

echo.
echo 完成！仓库 Releases 已更新。
pause
