# -*- coding: utf-8 -*-
"""构建主程序 + Setup，并准备 GitHub Releases 资源。"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

from version_info import APP_NAME, GITHUB_OWNER, GITHUB_REPO, VERSION


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
RELEASE = ROOT / "release"
PAYLOAD = ROOT / "build_payload"

SETUP_ASSET = f"patch-text-editor-setup-v{VERSION}.exe"
APP_ASSET = f"patch-text-editor-v{VERSION}.exe"


def run(cmd: list[str]) -> None:
    print(">", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def build_main_exe() -> Path:
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--windowed",
            "--onefile",
            f"--name={APP_NAME}",
            "--add-data",
            "index.html;.",
            "--add-data",
            "styles.css;.",
            "--add-data",
            "app.js;.",
            "--add-data",
            "update_config.json;.",
            "--hidden-import=clr",
            "--hidden-import=webview",
            "--hidden-import=updater",
            "--hidden-import=version_info",
            "--hidden-import=setup_installer",
            "desktop_app.py",
        ]
    )
    exe = DIST / f"{APP_NAME}.exe"
    if not exe.exists():
        raise FileNotFoundError(exe)
    return exe


def build_setup_exe(app_exe: Path) -> Path:
    if PAYLOAD.exists():
        shutil.rmtree(PAYLOAD)
    PAYLOAD.mkdir(parents=True)
    shutil.copy2(app_exe, PAYLOAD / app_exe.name)
    shutil.copy2(ROOT / "update_config.json", PAYLOAD / "update_config.json")

    setup_name = f"{APP_NAME}_Setup_{VERSION}"
    run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--windowed",
            "--onefile",
            f"--name={setup_name}",
            "--add-data",
            f"{PAYLOAD / app_exe.name};payload",
            "--add-data",
            f"{PAYLOAD / 'update_config.json'};payload",
            "--hidden-import=version_info",
            "setup_installer.py",
        ]
    )
    setup = DIST / f"{setup_name}.exe"
    if not setup.exists():
        candidates = sorted(
            DIST.glob("*Setup*.exe"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        if not candidates:
            raise FileNotFoundError(setup)
        setup = candidates[0]
    return setup


def stage_release(app_exe: Path, setup: Path) -> tuple[Path, Path]:
    RELEASE.mkdir(parents=True, exist_ok=True)
    setup_out = RELEASE / SETUP_ASSET
    app_out = RELEASE / APP_ASSET
    shutil.copy2(setup, setup_out)
    shutil.copy2(app_exe, app_out)

    digest = sha256_file(setup_out)
    manifest = {
        "version": VERSION,
        "name": APP_NAME,
        "notes": f"{APP_NAME} v{VERSION}",
        "setupUrl": (
            f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/"
            f"v{VERSION}/{SETUP_ASSET}"
        ),
        "sha256": digest,
        "force": False,
        "publishedAt": str(date.today()),
        "github": f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}",
    }
    (RELEASE / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (RELEASE / "上传到云端说明.txt").write_text(
        f"""已对接 GitHub Releases 云端更新（同蔬菜汇总方案）。

仓库: https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}
检查接口: https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest

发版:
  1) python build_release.py
  2) python publish_github.py
""",
        encoding="utf-8",
    )
    return setup_out, app_out


def main() -> int:
    print(f"开始构建 {APP_NAME} v{VERSION}")
    app_exe = build_main_exe()
    print("主程序完成:", app_exe)
    setup = build_setup_exe(app_exe)
    print("安装包完成:", setup)
    setup_out, app_out = stage_release(app_exe, setup)
    print("GitHub 资源:", setup_out.name, app_out.name)
    print("输出目录:", RELEASE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
