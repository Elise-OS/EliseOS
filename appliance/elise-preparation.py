#!/usr/bin/env python3
import ipaddress
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATUS = "/run/elise-preparation/status.json"
AUTH_FILE = os.environ.get("ELISE_GITHUB_AUTH_FILE", "/etc/elise/github-auth")
REPOSITORY = os.environ.get("ELISE_REPOSITORY", "Elise-OS/EliseOS")
GITHUB_API = os.environ.get("ELISE_GITHUB_API", "https://api.github.com").rstrip("/")
USERNAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
TOKEN = re.compile(r"[A-Za-z0-9_]{20,255}")
HTML = """<!doctype html><html lang=fr><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Préparation d’Élise</title><style>body{margin:0;background:#f4f0e8;color:#20352e;font:18px system-ui;display:grid;place-items:center;min-height:100vh}.c{width:min(620px,86vw);background:white;padding:42px;border-radius:28px;box-shadow:0 20px 60px #28463a1a}i{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:#e3f2ec;font-style:normal;font-size:28px}h1{font-size:34px;margin:22px 0 10px}p{color:#617069;line-height:1.6}.bar{height:9px;background:#e8ece9;border-radius:9px;overflow:hidden}.bar:after{content:'';display:block;width:35%;height:100%;background:#5e927e;border-radius:9px;animation:m 1.5s infinite alternate}@keyframes m{to{transform:translateX(185%)}}small{display:block;margin-top:16px;color:#78847f}form{display:none;margin:22px 0 6px}form.on{display:grid;gap:12px}input{font:inherit;padding:12px 14px;border:1px solid #cfd8d3;border-radius:12px}button{font:inherit;padding:12px;border:0;border-radius:12px;background:#5e927e;color:white;cursor:pointer}button:disabled{opacity:.6}#e{color:#a5432f;margin:0}</style><main class=c><i>É</i><h1>Préparation d’Élise</h1><p id=m>Connexion et préparation des services…</p><form id=f><input id=u placeholder='Nom du compte bot GitHub' autocomplete=off required><input id=t type=password placeholder='Jeton (ghp_…)' autocomplete=off required><button id=b>Enregistrer et continuer</button><p id=e></p></form><div class=bar></div><small>Vous pouvez laisser cet écran ouvert. Élise apparaîtra automatiquement dès qu’elle sera prête.</small></main><script>async function u_(){try{let r=await fetch('/status.json',{cache:'no-store'}),j=await r.json();m.textContent=j.message||m.textContent;f.classList.toggle('on',!!j.needsGithubAuth)}catch{}setTimeout(u_,2000)}u_();setInterval(()=>fetch('/api/v1/system/health',{cache:'no-store'}).then(r=>{if(r.ok)location.reload()}).catch(()=>{}),3000);f.onsubmit=async ev=>{ev.preventDefault();b.disabled=true;e.textContent='Vérification auprès de GitHub…';try{let r=await fetch('/github-auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u.value.trim(),token:t.value.trim()})}),j=await r.json();e.textContent=j.message||'';if(r.ok){t.value='';f.classList.remove('on')}}catch{e.textContent='Élise ne répond pas, réessayez.'}b.disabled=false}</script></html>"""


def is_local(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # Tailscale's CGNAT range is remote access, not the home network.
    return (ip.is_private or ip.is_loopback or ip.is_link_local) and ip not in ipaddress.ip_network("100.64.0.0/10")


def verify_token(username: str, token: str) -> str | None:
    request = urllib.request.Request(
        f"{GITHUB_API}/repos/{REPOSITORY}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "elise-os-preparation",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            scopes = response.headers.get("X-OAuth-Scopes")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 404):
            return "GitHub refuse ce jeton ou il n’a pas accès au dépôt Élise."
        return f"GitHub a répondu {error.code}, réessayez dans un instant."
    except (urllib.error.URLError, TimeoutError):
        return "GitHub est injoignable, vérifiez la connexion Internet."
    # Classic tokens list their scopes; ghcr.io needs read:packages to pull the images.
    if scopes is not None:
        granted = {scope.strip() for scope in scopes.split(",")}
        if not granted & {"read:packages", "write:packages"}:
            return "Le jeton doit aussi avoir la permission read:packages."
    return None


def save_auth(username: str, token: str) -> None:
    os.makedirs(os.path.dirname(AUTH_FILE), mode=0o755, exist_ok=True)
    temporary = f"{AUTH_FILE}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(f"username={username}\ntoken={token}\n")
    os.replace(temporary, AUTH_FILE)
    # Resume the installation now instead of waiting for the next retry.
    subprocess.run(["systemctl", "--no-block", "restart", "elise-firstboot.service"], check=False)


class Handler(BaseHTTPRequestHandler):
    def send(self, status: int, data: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status: int, value: dict) -> None:
        self.send(status, json.dumps(value).encode(), "application/json")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/status.json":
            try:
                data = open(STATUS, "rb").read()
            except OSError:
                data = json.dumps({"message": "Démarrage de la préparation…"}).encode()
            self.send(200, data, "application/json")
        elif path.startswith("/api/"):
            # The page reloads as soon as the real API answers; never pretend to be it.
            self.send_json(503, {"message": "Élise est en préparation."})
        else:
            self.send(200, HTML.encode(), "text/html; charset=utf-8")

    def do_POST(self):
        if self.path != "/github-auth":
            return self.send_json(404, {"message": "Introuvable."})
        if not is_local(self.client_address[0]):
            return self.send_json(403, {"message": "Disponible uniquement depuis le réseau local."})
        if self.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            return self.send_json(415, {"message": "Format non pris en charge."})
        length = int(self.headers.get("content-length") or 0)
        if not 0 < length <= 4096:
            return self.send_json(400, {"message": "Requête non valide."})
        try:
            body = json.loads(self.rfile.read(length))
            username, token = str(body.get("username", "")).strip(), str(body.get("token", "")).strip()
        except (ValueError, AttributeError):
            return self.send_json(400, {"message": "Requête non valide."})
        if not USERNAME.fullmatch(username) or not TOKEN.fullmatch(token):
            return self.send_json(400, {"message": "Nom de compte ou jeton non valide."})
        problem = verify_token(username, token)
        if problem:
            return self.send_json(400, {"message": problem})
        save_auth(username, token)
        return self.send_json(200, {"message": "Compte bot enregistré, la préparation reprend."})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("ELISE_PREPARATION_PORT", "80"))), Handler).serve_forever()
