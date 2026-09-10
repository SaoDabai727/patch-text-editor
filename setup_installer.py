# -*- coding: utf-8 -*-
"""
贴片文字修改工具 - Setup 安装器
可双击安装，支持 /SILENT /UPDATE /DIR=路径
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import threading
import winreg
from pathlib import Path


def resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


ROOT = resource_root()

# 延迟导入，避免打包时循环
sys.path.insert(0, str(ROOT))
from version_info import APP_ID, APP_NAME, PUBLISHER, VERSION  # noqa: E402


APP_EXE_NAME = f"{APP_NAME}.exe"
UNINSTALL_EXE_NAME = f"{APP_NAME}_卸载.exe"


def default_install_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    return base / APP_NAME


def desktop_dir() -> Path:
    return Path.home() / "Desktop"


def start_menu_dir() -> Path:
    programs = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    return programs / APP_NAME


def create_shortcut(link_path: Path, target: Path, work_dir: Path, description: str = "") -> None:
    link_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import win32com.client  # type: ignore

        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(str(link_path))
        shortcut.Targetpath = str(target)
        shortcut.WorkingDirectory = str(work_dir)
        shortcut.Description = description or APP_NAME
        shortcut.IconLocation = str(target)
        shortcut.save()
        return
    except Exception:
        pass

    # 无 pywin32 时写 URL 风格快捷方式兜底
    content = (
        "[InternetShortcut]\n"
        f"URL=file:///{target.as_posix()}\n"
        "IconIndex=0\n"
        f"IconFile={target}\n"
    )
    alt = link_path.with_suffix(".url")
    alt.write_text(content, encoding="utf-8")


def write_uninstall_registry(install_dir: Path, uninstall_path: Path) -> None:
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_ID}"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path) as key:
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
        winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, VERSION)
        winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, PUBLISHER)
        winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, str(install_dir))
        winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{uninstall_path}"')
        winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, str(install_dir / APP_EXE_NAME))
        winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)


def remove_uninstall_registry() -> None:
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_ID}"
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
    except FileNotFoundError:
        pass


def payload_files() -> list[tuple[Path, str]]:
    """返回 (源文件, 安装相对名)。"""
    mapping = []
    candidates = [
        (ROOT / "payload" / APP_EXE_NAME, APP_EXE_NAME),
        (ROOT / APP_EXE_NAME, APP_EXE_NAME),
        (Path.cwd() / "dist" / APP_EXE_NAME, APP_EXE_NAME),
    ]
    exe_src = next((p for p, _ in candidates if p.exists()), None)
    if not exe_src:
        raise FileNotFoundError(f"找不到待安装主程序：{APP_EXE_NAME}")

    mapping.append((exe_src, APP_EXE_NAME))

    for name in ("update_config.json",):
        for base in (ROOT / "payload", ROOT, Path.cwd()):
            src = base / name
            if src.exists():
                mapping.append((src, name))
                break

    uninstall_src = ROOT / "payload" / UNINSTALL_EXE_NAME
    if not uninstall_src.exists():
        uninstall_src = ROOT / UNINSTALL_EXE_NAME
    if uninstall_src.exists():
        mapping.append((uninstall_src, UNINSTALL_EXE_NAME))

    return mapping


def install_app(install_dir: Path, create_desktop: bool = True, launch_after: bool = False) -> Path:
    install_dir.mkdir(parents=True, exist_ok=True)
    files = payload_files()
    for src, rel in files:
        dst = install_dir / rel
        shutil.copy2(src, dst)

    # 版本标记
    (install_dir / "version.txt").write_text(VERSION, encoding="utf-8")

    exe_path = install_dir / APP_EXE_NAME

    uninstall_bat = install_dir / "卸载.bat"
    uninstall_bat.write_text(
        "@echo off\n"
        f'cd /d "%~dp0"\n'
        f'start "" "{APP_EXE_NAME}" --uninstall\n',
        encoding="gbk",
        errors="ignore",
    )

    sm = start_menu_dir()
    create_shortcut(sm / f"{APP_NAME}.lnk", exe_path, install_dir)
    create_shortcut(sm / f"卸载 {APP_NAME}.lnk", uninstall_bat, install_dir, f"卸载 {APP_NAME}")

    if create_desktop:
        create_shortcut(desktop_dir() / f"{APP_NAME}.lnk", exe_path, install_dir)

    write_uninstall_registry(install_dir, uninstall_bat)

    if launch_after and exe_path.exists():
        os.startfile(str(exe_path))  # noqa: S606

    return exe_path


def uninstall_app(install_dir: Path | None = None) -> None:
    install_dir = install_dir or default_install_dir()

    # 删快捷方式
    for link in [
        desktop_dir() / f"{APP_NAME}.lnk",
        desktop_dir() / f"{APP_NAME}.url",
        start_menu_dir() / f"{APP_NAME}.lnk",
        start_menu_dir() / f"卸载 {APP_NAME}.lnk",
    ]:
        try:
            link.unlink(missing_ok=True)
        except Exception:
            pass
    try:
        sm = start_menu_dir()
        if sm.exists() and not any(sm.iterdir()):
            sm.rmdir()
    except Exception:
        pass

    remove_uninstall_registry()

    if install_dir.exists():
        # 延迟删除自身目录
        bat = Path(os.environ.get("TEMP", ".")) / f"uninstall_{APP_ID}.bat"
        bat.write_text(
            "@echo off\n"
            "ping 127.0.0.1 -n 2 >nul\n"
            f'rmdir /s /q "{install_dir}"\n'
            f'del "%~f0"\n',
            encoding="gbk",
            errors="ignore",
        )
        os.startfile(str(bat))  # noqa: S606


def run_gui(silent: bool = False, update_mode: bool = False, install_dir: Path | None = None) -> int:
    install_dir = install_dir or default_install_dir()
    if silent:
        install_app(install_dir, create_desktop=not update_mode, launch_after=update_mode)
        return 0

    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title(f"{APP_NAME} 安装向导")
    root.geometry("520x360")
    root.resizable(False, False)

    dir_var = tk.StringVar(value=str(install_dir))
    desk_var = tk.BooleanVar(value=True)
    launch_var = tk.BooleanVar(value=True)
    status_var = tk.StringVar(value=f"准备安装 {APP_NAME} v{VERSION}")

    frm = ttk.Frame(root, padding=18)
    frm.pack(fill="both", expand=True)

    ttk.Label(frm, text=APP_NAME, font=("Microsoft YaHei", 16, "bold")).pack(anchor="w")
    ttk.Label(frm, text=f"版本 {VERSION}  ·  {PUBLISHER}").pack(anchor="w", pady=(4, 14))

    ttk.Label(frm, text="安装位置").pack(anchor="w")
    row = ttk.Frame(frm)
    row.pack(fill="x", pady=6)
    entry = ttk.Entry(row, textvariable=dir_var)
    entry.pack(side="left", fill="x", expand=True)

    def browse():
        from tkinter import filedialog

        chosen = filedialog.askdirectory(initialdir=dir_var.get())
        if chosen:
            dir_var.set(chosen)

    ttk.Button(row, text="浏览", command=browse, width=8).pack(side="left", padx=(8, 0))
    ttk.Checkbutton(frm, text="创建桌面快捷方式", variable=desk_var).pack(anchor="w", pady=4)
    ttk.Checkbutton(frm, text="安装完成后启动", variable=launch_var).pack(anchor="w", pady=4)
    ttk.Label(frm, textvariable=status_var, foreground="#555").pack(anchor="w", pady=(18, 8))

    btns = ttk.Frame(frm)
    btns.pack(fill="x", side="bottom")

    def do_install():
        target = Path(dir_var.get().strip() or str(default_install_dir()))
        status_var.set("正在安装，请稍候…")
        root.update_idletasks()

        def worker():
            try:
                install_app(target, create_desktop=desk_var.get(), launch_after=launch_var.get())
                root.after(0, lambda: done(True, f"安装完成：\n{target}"))
            except Exception as exc:
                root.after(0, lambda: done(False, str(exc)))

        def done(ok: bool, msg: str):
            if ok:
                messagebox.showinfo("安装成功", msg)
                root.destroy()
            else:
                status_var.set("安装失败")
                messagebox.showerror("安装失败", msg)

        threading.Thread(target=worker, daemon=True).start()

    ttk.Button(btns, text="退出", command=root.destroy).pack(side="right")
    ttk.Button(btns, text="开始安装", command=do_install).pack(side="right", padx=8)

    if update_mode:
        status_var.set(f"正在更新到 v{VERSION} …")
        root.after(200, do_install)

    root.mainloop()
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("/SILENT", "/silent", dest="silent", action="store_true")
    parser.add_argument("/UPDATE", "/update", dest="update", action="store_true")
    parser.add_argument("/DIR", "/dir", dest="dir", default="")
    # 兼容 -- 形式
    parser.add_argument("--silent", action="store_true")
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--dir", default="")
    parser.add_argument("--uninstall", action="store_true")
    args, _ = parser.parse_known_args(argv)

    # 处理 /DIR=path
    for item in argv:
        if item.upper().startswith("/DIR="):
            args.dir = item.split("=", 1)[1]
        if item.lower().startswith("--dir="):
            args.dir = item.split("=", 1)[1]
    if args.silent or args.silent is True:
        pass
    if getattr(args, "silent", False) is False and any(a.upper() == "/SILENT" for a in argv):
        args.silent = True
    if any(a.upper() == "/UPDATE" for a in argv):
        args.update = True
    return args


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    args = parse_args(argv)

    if args.uninstall:
        uninstall_app()
        return 0

    install_dir = Path(args.dir) if args.dir else default_install_dir()
    silent = bool(args.silent or args.update)
    return run_gui(silent=silent, update_mode=bool(args.update), install_dir=install_dir)


if __name__ == "__main__":
    raise SystemExit(main())
