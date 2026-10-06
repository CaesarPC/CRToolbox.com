# -*- coding: utf-8 -*-
"""同步远程控制公网地址到 GitHub Pages (固定入口 remote.html 读取)
用法: 每次启动公网服务后运行一次, 或让 public_tunnel.py 自动调用
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CFG = HERE / "云同步配置.json"
REMOTE_TXT = HERE / "公网链接.txt"      # 网站查找器目录里的公网地址记录
STATUS_FILE = HERE / "remote_status.json"
REMOTE_DIR = Path(r"D:\remote_control")
RC_URL_FILE = REMOTE_DIR / "公网地址.txt"
RC_DIRECT_URL = REMOTE_DIR / "公网直连地址.txt"
RC_CONFIG = REMOTE_DIR / "config.json"


def read_cfg():
    with open(CFG, encoding="utf-8") as f:
        return json.load(f)


def gh_get(repo, path, token):
    url = "https://api.github.com/repos/%s/contents/%s" % (repo, path)
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer %s" % token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "website-finder"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def gh_put(repo, path, token, content_b64, message, sha=None):
    url = "https://api.github.com/repos/%s/contents/%s" % (repo, path)
    body = {"message": message, "content": content_b64, "branch": "main"}
    if sha:
        body["sha"] = sha
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT", headers={
        "Authorization": "Bearer %s" % token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "website-finder"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def extract_url(text):
    import re
    m = re.search(r"https?://[a-zA-Z0-9\-\.:]+(?:\.[a-zA-Z]{2,})?(?:/[^\s]*)?", text or "")
    return m.group(0) if m else ""


def extract_pin(text):
    import re
    m = re.search(r"密码[:：]?\s*(\d{4,})", text or "")
    return m.group(1) if m else ""


def main():
    cfg = read_cfg()
    token = cfg.get("github_token", "")
    repo = cfg.get("repo", "CaesarPC/website-finder")
    if not token:
        print("[错误] 未配置 GitHub Token")
        sys.exit(1)
    # 1. 收集地址(优先公网直连, 其次 cloudflare 隧道)
    url = ""
    pin = ""
    try:
        direct_txt = RC_DIRECT_URL.read_text(encoding="utf-8", errors="ignore")
        url = extract_url(direct_txt)
        pin = extract_pin(direct_txt)
        # 直连地址需要本机在线检测: 8082 端口
        import socket
        s = socket.socket(); s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", 8082)); port_ok = True
        except Exception:
            port_ok = False
        finally:
            s.close()
        if not port_ok:
            url = ""
    except Exception:
        pass
    if not url:
        try:
            cf_txt = RC_URL_FILE.read_text(encoding="utf-8", errors="ignore")
            url = extract_url(cf_txt)
            pin = extract_pin(cf_txt)
        except Exception:
            pass
    if not url:
        # 兜底: 读网站查找器目录里的公网链接.txt
        try:
            url = REMOTE_TXT.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            pass
    online = bool(url)
    status = {"online": online, "url": url, "pin": pin or "", "updated_at": ""}
    import datetime
    status["updated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # 2. 写本地
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False)
    # 3. 推 GitHub
    try:
        remote = gh_get(repo, "remote_status.json", token)
        sha = remote.get("sha", "")
        content = base64.b64encode(json.dumps(status, ensure_ascii=False).encode("utf-8")).decode("ascii")
        gh_put(repo, "remote_status.json", token, content, "update: 远程控制地址同步", sha=sha)
        print("[OK] 已同步到 GitHub")
        print("     online=%s url=%s pin=%s" % (online, url, pin))
    except Exception as e:
        print("[失败] GitHub 同步出错: %r" % e)
        print("本地状态已更新, 可稍后重试")
        sys.exit(2)


if __name__ == "__main__":
    main()