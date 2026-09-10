@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo 未检测到 Python，请先安装 Python 3: https://www.python.org/downloads/
    echo 安装时请勾选 Add Python to PATH
    pause
    exit /b 1
  )
  set PY=python
) else (
  set PY=py
)

echo 正在检查桌面窗口组件...
%PY% -c "import webview" 1>nul 2>nul
if errorlevel 1 (
  echo 首次运行，正在安装 pywebview...
  %PY% -m pip install pywebview -i https://pypi.tuna.tsinghua.edu.cn/simple
  if errorlevel 1 (
    echo 安装失败，将尝试用浏览器打开本地工具。
  )
)

echo 正在启动贴片文字修改工具...
%PY% desktop_app.py
if errorlevel 1 (
  echo 启动失败。
  pause
)
