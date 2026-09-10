# -*- coding: utf-8 -*-
"""GitHub Releases 云端更新：查版本、经镜像下载 Setup、启动安装。"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from version_info import (
    ASSET_SETUP_PREFIX,
    ASSET_SETUP_PREFIX_EN,
    GITHUB_OWNER,
    GITHUB_REPO,
    VERSION,
)

API_LATEST = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
)
USER_AGENT = f"patch-text-editor-updater/{VERSION}"

# 国内直连 GitHub 不稳定时，先走镜像再回退官方
_MIRROR_PREFIXES = (
    "https://ghfast.top/",
    "https://gh-proxy.com/",
    "https://ghproxy.net/",
    "https://mirror.ghproxy.com/",
    "",
)

DOWNLOAD_TIMEOUT = 1800.0
DOWNLOAD_CHUNK = 256 * 1024


def parse_version(v: str) -> tuple[int, ...]:
    parts = []
    for chunk in str(v).strip().lstrip("vV").split("."):
        num = ""
        for ch in chunk:
            if ch.isdigit():
                num += ch
            else:
                break
        parts.append(int(num or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:4])


def is_newer(remote: str, local: str = VERSION) -> bool:
    return parse_version(remote) > parse_version(local)


def normalize_version(tag_or_version: str) -> str:
    s = (tag_or_version or "").strip()
    if s.lower().startswith("v"):
        s = s[1:]
    return s


def _urlopen(req: urllib.request.Request, timeout: float, *, use_proxy: bool = True):
    if use_proxy:
        return urllib.request.urlopen(req, timeout=timeout)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(req, timeout=timeout)


def _request_json(url: str, timeout: float = 15.0) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with _urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        with _urlopen(req, timeout=timeout, use_proxy=False) as resp:
            return json.loads(resp.read().decode("utf-8"))


def _pick_setup_asset(assets: list[dict]) -> tuple[str, str]:
    """返回 (asset_name, browser_download_url)。"""
    preferred: list[tuple[str, str]] = []
    fallback: list[tuple[str, str]] = []
    for asset in assets or []:
        name = str(asset.get("name") or "")
        url = str(asset.get("browser_download_url") or "")
        if not name or not url:
            continue
        lower = name.lower()
        if not lower.endswith(".exe"):
            continue
        if (
            name.startswith(ASSET_SETUP_PREFIX)
            or name.startswith(ASSET_SETUP_PREFIX_EN)
            or "setup" in lower
        ):
            preferred.append((name, url))
        else:
            fallback.append((name, url))
    if preferred:
        return preferred[0]
    if fallback:
        return fallback[0]
    return "", ""


def fetch_latest_release(timeout: float = 15.0) -> dict[str, Any] | None:
    try:
        data = _request_json(API_LATEST, timeout=timeout)
    except (
        urllib.error.URLError,
        urllib.error.HTTPError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
    ):
        return None

    tag = str(data.get("tag_name") or "")
    version = normalize_version(tag)
    if not version:
        return None

    asset_name, download_url = _pick_setup_asset(data.get("assets") or [])
    if not download_url:
        return None

    return {
        "version": version,
        "tag": tag,
        "notes": str(data.get("body") or "").strip(),
        "setupUrl": download_url,
        "assetName": asset_name,
        "sha256": "",
        "force": False,
        "publishedAt": str(data.get("published_at") or ""),
    }


def load_update_config() -> dict[str, Any]:
    """保留本地开关；更新源固定为 GitHub Releases。"""
    from pathlib import Path
    import sys

    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent / "update_config.json")
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass) / "update_config.json")
    candidates.append(Path(__file__).resolve().parent / "update_config.json")

    cfg: dict[str, Any] = {"checkOnStartup": True, "autoDownload": False}
    for path in candidates:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    cfg.update(data)
                    break
            except Exception:
                pass
    return cfg


def check_for_update(manual: bool = False) -> dict[str, Any]:
    cfg = load_update_config()
    if not manual and not cfg.get("checkOnStartup", True):
        return {"ok": True, "hasUpdate": False, "skipped": True, "localVersion": VERSION}

    remote = fetch_latest_release()
    if remote is None:
        return {
            "ok": False,
            "hasUpdate": False,
            "localVersion": VERSION,
            "error": "无法连接 GitHub 更新服务，请稍后重试或检查网络",
        }

    has_update = is_newer(remote["version"], VERSION)
    return {
        "ok": True,
        "hasUpdate": has_update,
        "localVersion": VERSION,
        "remoteVersion": remote["version"],
        "notes": remote.get("notes") or "",
        "setupUrl": remote.get("setupUrl") or "",
        "sha256": "",
        "force": False,
        "publishedAt": remote.get("publishedAt") or "",
        "updateUrl": API_LATEST,
        "autoDownload": bool(cfg.get("autoDownload")),
        "assetName": remote.get("assetName") or "",
    }


def mirror_download_urls(url: str) -> list[str]:
    url = (url or "").strip()
    if not url:
        return []
    out: list[str] = []
    for prefix in _MIRROR_PREFIXES:
        cand = f"{prefix}{url}" if prefix else url
        if cand not in out:
            out.append(cand)
    return out


def download_file(
    url: str,
    dest: Path,
    progress_cb: Callable[[int, int | None], None] | None = None,
    timeout: float = DOWNLOAD_TIMEOUT,
    *,
    use_proxy: bool = True,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _urlopen(req, timeout=timeout, use_proxy=use_proxy) as resp:
        total_hdr = resp.headers.get("Content-Length")
        total = int(total_hdr) if total_hdr and total_hdr.isdigit() else None
        done = 0
        with dest.open("wb") as out:
            while True:
                chunk = resp.read(DOWNLOAD_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if progress_cb:
                    progress_cb(done, total)


def download_update(
    setup_url: str,
    expected_sha256: str = "",
    progress_cb=None,
) -> dict[str, Any]:
    if not setup_url:
        return {"ok": False, "error": "缺少安装包下载地址"}

    tmp_dir = Path(tempfile.gettempdir()) / "PatchTextEditorUpdate"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    file_name = setup_url.rstrip("/").split("/")[-1] or "update_setup.exe"
    # 去掉镜像前缀残留的路径段
    if "?" in file_name:
        file_name = file_name.split("?", 1)[0]
    if not file_name.lower().endswith(".exe"):
        file_name += ".exe"
    target = tmp_dir / file_name

    errors: list[str] = []
    for cand in mirror_download_urls(setup_url):
        for use_proxy in (True, False):
            try:
                if target.exists():
                    target.unlink()
                download_file(
                    cand,
                    target,
                    progress_cb=progress_cb,
                    timeout=DOWNLOAD_TIMEOUT if cand == setup_url else min(600.0, DOWNLOAD_TIMEOUT),
                    use_proxy=use_proxy,
                )
                if target.stat().st_size < 1024:
                    raise OSError("下载文件过小，可能不是完整安装包")
                return {"ok": True, "path": str(target), "bytes": target.stat().st_size}
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{cand}: {exc}")
                try:
                    if target.exists():
                        target.unlink()
                except OSError:
                    pass

    detail = "；".join(errors[-3:]) if errors else "未知错误"
    return {
        "ok": False,
        "error": f"下载失败（已尝试 GitHub 镜像）。可到仓库 Releases 手动下载。{detail}",
    }


def launch_installer_and_exit(setup_path: str) -> dict[str, Any]:
    path = Path(setup_path)
    if not path.exists():
        return {"ok": False, "error": "安装包不存在"}

    try:
        subprocess.Popen(
            [str(path), "/SILENT", "/UPDATE"],
            close_fds=True,
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
    except Exception as exc:
        return {"ok": False, "error": f"启动安装程序失败：{exc}"}

    def _quit():
        time.sleep(0.8)
        os._exit(0)

    import threading

    threading.Thread(target=_quit, daemon=True).start()
    return {"ok": True}
