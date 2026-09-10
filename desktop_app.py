# -*- coding: utf-8 -*-
"""贴片文字修改工具 - 本地桌面软件（含云端更新）"""
from __future__ import annotations

import base64
import mimetypes
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 保证打包后也能找到同目录模块
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    sys.path.insert(0, str(Path(sys._MEIPASS)))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from version_info import APP_NAME, VERSION  # noqa: E402


def resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


ROOT = resource_root()
WINDOW = None


class DesktopApi:
    def get_app_info(self):
        return {"name": APP_NAME, "version": VERSION}

    def open_image(self):
        global WINDOW
        if WINDOW is None:
            return None
        import webview

        result = WINDOW.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)",),
        )
        if not result:
            return None

        file_path = Path(result[0])
        if not file_path.exists():
            return None

        data = file_path.read_bytes()
        mime = mimetypes.guess_type(str(file_path))[0] or "image/png"
        return {
            "name": file_path.name,
            "path": str(file_path),
            "mime": mime,
            "dataUrl": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}",
        }

    def save_image(self, data_url: str, suggested_name: str = ""):
        global WINDOW
        if WINDOW is None:
            return {"ok": False, "canceled": True}

        import webview

        default_name = suggested_name or f"贴片修改-{_now_stamp()}.png"
        result = WINDOW.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(Path.home() / "Desktop"),
            save_filename=default_name,
            file_types=("PNG 图片 (*.png)",),
        )
        if not result:
            return {"ok": False, "canceled": True}

        file_path = Path(result if isinstance(result, str) else result[0])
        if not str(file_path).lower().endswith(".png"):
            file_path = file_path.with_suffix(".png")

        raw = data_url.split(",", 1)[1] if "," in data_url else data_url
        file_path.write_bytes(base64.b64decode(raw))
        return {"ok": True, "path": str(file_path)}

    def check_update(self, manual: bool = True):
        from updater import check_for_update

        return check_for_update(manual=bool(manual))

    def download_and_install_update(self, setup_url: str, sha256: str = ""):
        from updater import download_update, launch_installer_and_exit

        result = download_update(setup_url, expected_sha256=sha256 or "")
        if not result.get("ok"):
            return result
        launch = launch_installer_and_exit(result["path"])
        if not launch.get("ok"):
            return launch
        return {"ok": True, "path": result["path"], "restarting": True}

    def open_external(self, url: str):
        if url:
            webbrowser.open(url)
        return {"ok": True}


def _now_stamp() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y%m%d-%H%M%S")


def start_local_server() -> tuple[ThreadingHTTPServer, int]:
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, format, *args):  # noqa: A003
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = int(server.server_address[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def start_with_webview(url: str) -> bool:
    global WINDOW
    try:
        import webview
    except Exception:
        return False

    api = DesktopApi()
    WINDOW = webview.create_window(
        f"{APP_NAME} v{VERSION}",
        url,
        js_api=api,
        width=1360,
        height=900,
        min_size=(980, 680),
    )
    webview.start()
    return True


def handle_uninstall() -> int:
    try:
        from setup_installer import uninstall_app

        uninstall_app()
        return 0
    except Exception as exc:
        print(f"卸载失败: {exc}")
        return 1


def main() -> int:
    if "--uninstall" in sys.argv:
        return handle_uninstall()

    for name in ("index.html", "styles.css", "app.js"):
        if not (ROOT / name).exists():
            print(f"缺少文件: {name}")
            try:
                input("按回车退出...")
            except EOFError:
                pass
            return 1

    server, port = start_local_server()
    url = f"http://127.0.0.1:{port}/index.html"

    try:
        if start_with_webview(url):
            return 0

        print("未安装 pywebview，将使用系统浏览器打开本地工具。")
        print("建议执行: pip install pywebview")
        print(f"本地地址: {url}")
        webbrowser.open(url)
        print("关闭本窗口将停止本地服务。按 Ctrl+C 退出。")
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        return 0
    finally:
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
