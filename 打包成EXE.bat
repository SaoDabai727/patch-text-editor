@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  set PY=python
) else (
  set PY=py
)

echo 正在安装打包依赖...
%PY% -m pip install pywebview pyinstaller -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
  echo 依赖安装失败
  pause
  exit /b 1
)

echo 正在打包成独立 exe...
%PY% -m PyInstaller --noconfirm --clean --windowed --onefile --name "贴片文字修改工具" --add-data "index.html;." --add-data "styles.css;." --add-data "app.js;." desktop_app.py

if errorlevel 1 (
  echo 打包失败
  pause
  exit /b 1
)

echo.
echo 完成！请到 dist 文件夹运行：贴片文字修改工具.exe
explorer dist
pause
