# -*- coding: utf-8 -*-
"""把 release 里的 Setup 发布到 GitHub Releases（同蔬菜汇总流程）。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from version_info import APP_NAME, GITHUB_OWNER, GITHUB_REPO, VERSION

ROOT = Path(__file__).resolve().parent
RELEASE = ROOT / "release"
SETUP_ASSET = f"patch-text-editor-setup-v{VERSION}.exe"
TAG = f"v{VERSION}"
REPO = f"{GITHUB_OWNER}/{GITHUB_REPO}"


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(">", " ".join(cmd))
    return subprocess.run(cmd, cwd=str(ROOT), check=check)


def repo_exists() -> bool:
    r = subprocess.run(
        ["gh", "repo", "view", REPO, "--json", "name"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def ensure_git_and_remote() -> None:
    if not (ROOT / ".git").exists():
        run(["git", "init"])
        run(["git", "checkout", "-B", "main"])

    remotes = (
        subprocess.run(
            ["git", "remote"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        ).stdout
        or ""
    ).split()

    url = f"https://github.com/{REPO}.git"
    if "origin" not in remotes:
        run(["git", "remote", "add", "origin", url])
    else:
        run(["git", "remote", "set-url", "origin", url])


def commit_all() -> None:
    run(["git", "add", "-A"])
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not status:
        print("无新的代码变更需要提交")
        return
    # 不使用 HEREDOC；Windows 下用 -m 即可
    run(["git", "commit", "-m", f"release: {APP_NAME} {TAG}"])


def ensure_repo_and_push() -> None:
    ensure_git_and_remote()
    commit_all()
    run(["git", "branch", "-M", "main"], check=False)

    if not repo_exists():
        print("创建公开仓库…")
        # origin 可能已存在
        remotes = (
            subprocess.run(
                ["git", "remote"],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
            ).stdout
            or ""
        ).split()
        create_cmd = [
            "gh",
            "repo",
            "create",
            REPO,
            "--public",
            "--description",
            f"{APP_NAME} desktop app with GitHub Releases auto-update",
        ]
        if "origin" in remotes:
            create_cmd += ["--source", ".", "--push"]
        else:
            create_cmd += ["--source", ".", "--remote", "origin", "--push"]
        created = run(create_cmd, check=False)
        if created.returncode != 0:
            # 仓库可能刚创建成功但 remote 冲突：改为直接 push
            run(["git", "push", "-u", "origin", "main"], check=False)
        return

    print("仓库已存在，推送 main…")
    push = run(["git", "push", "-u", "origin", "main"], check=False)
    if push.returncode != 0:
        print("警告: git push 未完全成功，继续发布 Release")


def publish_release(setup_path: Path) -> None:
    view = subprocess.run(
        ["gh", "release", "view", TAG, "-R", REPO],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if view.returncode == 0:
        print(f"删除已有 Release {TAG} …")
        run(
            [
                "gh",
                "release",
                "delete",
                TAG,
                "-R",
                REPO,
                "--yes",
                "--cleanup-tag",
            ]
        )

    notes = (
        f"## {APP_NAME} {TAG}\n\n"
        f"### 安装\n"
        f"下载 `{SETUP_ASSET}` 双击安装（默认 `%LOCALAPPDATA%\\{APP_NAME}`）。\n\n"
        f"### 云端更新\n"
        f"应用内「检查更新」读取本仓库 GitHub Releases latest（带国内镜像加速）。\n"
    )
    run(
        [
            "gh",
            "release",
            "create",
            TAG,
            str(setup_path),
            "-R",
            REPO,
            "--title",
            f"{APP_NAME} {TAG}",
            "--notes",
            notes,
            "--latest",
        ]
    )
    print("发布成功:", f"https://github.com/{REPO}/releases/tag/{TAG}")


def main() -> int:
    setup_path = RELEASE / SETUP_ASSET
    if not setup_path.exists():
        print("缺少安装包，请先执行: python build_release.py")
        print("期望文件:", setup_path)
        return 1

    ensure_repo_and_push()
    publish_release(setup_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
