#!/usr/bin/env python3
import ipaddress
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import elise_language
from elise_install_state import STATUS, hostname, instance_id, read_env, read_status as install_status, version
from elise_install_texts import TEXT, page_texts

AUTH_FILE = os.environ.get("ELISE_GITHUB_AUTH_FILE", "/etc/elise/github-auth")
LOGO_FILE = os.environ.get("ELISE_PREPARATION_LOGO", "/usr/share/elise/runtime/appliance/elise-logo.png")
REPOSITORY = os.environ.get("ELISE_REPOSITORY", "Elise-OS/EliseOS")
GITHUB_API = os.environ.get("ELISE_GITHUB_API", "https://api.github.com").rstrip("/")
USERNAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
TOKEN = re.compile(r"[A-Za-z0-9_]{20,255}")
STARTED_AT = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

HTML = r"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Préparation d’Élise</title>
<style>
:root{--navy:#0b2948;--navy-2:#12385f;--blue:#376884;--cream:#f5f0e8;--paper:#fdfbf7;--card:#ffffff;
--line:#e6e0d6;--muted:#687382;--green:#4f8569;--green-soft:#e7f1eb;--amber:#d99a55;--amber-soft:#fbf0e3;
--red:#b74747;--red-soft:#f8e7e7;--shadow:0 30px 80px rgba(11,41,72,.12);}
@media (prefers-color-scheme:dark){:root{--paper:#0b1726;--card:#112236;--cream:#0e1d2f;--line:#22364d;
--navy:#e9eff6;--navy-2:#cfdbe8;--muted:#93a3b5;--green-soft:#173326;--amber-soft:#36281a;--red-soft:#3a1f22;
--shadow:0 30px 80px rgba(0,0,0,.45);}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 10% -10%,rgba(55,104,132,.18),transparent 60%),
radial-gradient(900px 500px at 110% 110%,rgba(217,154,85,.16),transparent 60%),var(--paper);color:var(--navy);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;display:grid;place-items:center;
padding:24px 16px}
main{width:min(560px,100%);background:var(--card);border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow);
padding:32px 28px 26px}
header{display:flex;align-items:center;gap:14px}
.logo{width:56px;height:56px;border-radius:16px;background:var(--cream);display:grid;place-items:center;overflow:hidden;flex:none}
.logo img{width:46px;height:46px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font:600 30px/1.15 "Source Serif 4",Georgia,serif;margin:2px 0 0}
#message{margin:22px 0 6px;font-size:17px;color:var(--navy-2);min-height:26px}
.meter{display:flex;align-items:center;gap:12px;margin:6px 0 24px}
.track{flex:1;height:10px;border-radius:99px;background:var(--cream);overflow:hidden;position:relative}
.fill{height:100%;width:3%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--green));transition:width .8s ease}
.track.busy .fill{background-size:200% 100%;background-image:linear-gradient(90deg,var(--blue),var(--green),var(--blue));
animation:flow 2.4s linear infinite}
@keyframes flow{to{background-position:-200% 0}}
#percent{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px;text-align:right}
ol{list-style:none;margin:0;padding:0;display:grid;gap:4px}
li{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:14px;color:var(--muted)}
li .dot{width:26px;height:26px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;flex:none;font-size:13px}
li.done{color:var(--navy-2)}
li.done .dot{background:var(--green);border-color:var(--green);color:#fff}
li.current{background:var(--cream);color:var(--navy);font-weight:600}
li.current .dot{border-color:var(--blue);border-top-color:transparent;animation:spin 1s linear infinite}
li.failed{background:var(--red-soft);color:var(--red);font-weight:600}
li.failed .dot{border-color:var(--red);background:var(--red);color:#fff}
li small{margin-left:auto;white-space:nowrap;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
@keyframes spin{to{transform:rotate(360deg)}}
.notice{margin-top:18px;padding:14px 16px;border-radius:16px;font-size:15px;display:none}
.notice.on{display:block}
#error{background:var(--red-soft);color:var(--red)}
form{display:none;margin-top:18px;gap:10px;padding:16px;border-radius:18px;background:var(--amber-soft)}
form.on{display:grid}
form p{margin:0 0 4px;font-size:15px}
input{font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--navy)}
button{font:inherit;font-weight:600;padding:12px;border:0;border-radius:12px;background:var(--navy-2);color:var(--paper);cursor:pointer}
button:disabled{opacity:.6}
#formMessage{margin:0;font-size:14px;color:var(--muted)}
footer{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px 16px;
font-size:13px;color:var(--muted)}
footer b{color:var(--navy-2);font-weight:600}
.app{display:flex;align-items:center;gap:8px;width:100%}
.app svg{flex:none}
@media (max-width:420px){main{padding:24px 18px 20px;border-radius:22px}h1{font-size:26px}}
</style>
</head>
<body>
<main>
  <header>
    <div class="logo"><img src="/logo.png" alt="" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'É'}))"></div>
    <div><div class="eyebrow">Élise OS</div><h1 id="title">Préparation d’Élise</h1></div>
  </header>
  <p id="message">Connexion à Élise…</p>
  <div class="meter"><div class="track busy" id="track"><div class="fill" id="fill"></div></div><span id="percent">0 %</span></div>
  <ol id="steps"></ol>
  <div class="notice" id="error"></div>
  <form id="auth">
    <p id="intro">Le dépôt Élise est privé : indiquez le compte bot GitHub pour télécharger les composants.</p>
    <input id="username" placeholder="Nom du compte bot GitHub" autocomplete="off" required>
    <input id="token" type="password" placeholder="Jeton (ghp_…)" autocomplete="off" required>
    <button id="submit">Enregistrer et continuer</button>
    <p id="formMessage"></p>
  </form>
  <footer>
    <span id="address">Adresse : <b>elise.local</b></span>
    <span id="remote">Accès à distance : à configurer depuis l’application</span>
    <span id="version"></span>
    <span class="app"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>
    <span id="note">Cette page se met à jour toute seule. L’app Élise détecte aussi ce boîtier sur le Wi-Fi de la maison.</span></span>
  </footer>
</main>
<script>
// The TV's catalogue (elise_install_texts.py), inserted by the server.
const TEXTS=__TEXTS__;
const $=id=>document.getElementById(id);
const icons={done:'✓',failed:'!'};
const fmt=(text,values)=>String(text).replace(/\{(\w+)\}/g,(all,key)=>key in values?values[key]:all);
// The visitor's own language when Élise offers it, else the box's, else English.
const browser=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language])
  .map(tag=>String(tag||'').toLowerCase().split(/[-_]/)[0]).find(code=>code in TEXTS)||null;
let lang=browser||'en',last=null,sent=false;
function applyTexts(){
  const t=TEXTS[lang];
  document.documentElement.lang=lang;document.title=t.page_title;$('title').textContent=t.page_title;
  $('intro').textContent=t.page_auth_intro;$('username').placeholder=t.page_auth_username;
  $('token').placeholder=t.page_auth_token;$('submit').textContent=t.page_auth_submit;$('note').textContent=t.page_footer;
  if(!last)$('message').textContent=t.page_connecting;
}
function labelled(element,template,value){
  const [before,after='']=template.split('{value}');const b=document.createElement('b');b.textContent=value;
  element.replaceChildren(before,b,after);
}
// Tells the box which language this browser reads, unless the Élise app already chose one.
function sendLanguage(s){
  if(sent||!browser||['app','config'].includes(s.languageSource)||(s.languageSource==='browser'&&s.language===browser))return;
  sent=true;
  fetch('/language',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({language:browser,source:'browser'})}).catch(()=>{});
}
function render(s){
  if(!browser&&s.language in TEXTS&&s.language!==lang){lang=s.language;applyTexts()}
  last=s;sendLanguage(s);
  const t=TEXTS[lang];
  // The installer writes in French: other languages read what the step does.
  $('message').textContent=lang==='fr'&&s.message?s.message:(t.leads[s.step]||t.page_connecting);
  const pct=Math.max(2,Math.min(100,Math.round(s.percent||0)));
  $('fill').style.width=pct+'%';$('percent').textContent=fmt(t.percent,{percent:pct});
  $('track').classList.toggle('busy',!s.error);
  $('steps').replaceChildren(...(s.steps||[]).map(step=>{
    const li=document.createElement('li');li.className=step.state;
    const dot=document.createElement('span');dot.className='dot';dot.textContent=icons[step.state]||'';
    const label=document.createElement('span');label.textContent=t.steps[step.id]||step.label;
    li.append(dot,label);
    if(step.detail){const d=document.createElement('small');d.textContent=step.detail;li.append(d)}
    return li;
  }));
  $('error').classList.toggle('on',!!s.error);
  $('error').textContent=s.error?(lang==='fr'?s.message:t.auto_body):'';
  if(s.error)$('message').textContent=s.step==='network'?t.problem_network:t.problem_other;
  $('auth').classList.toggle('on',!!s.needsGithubAuth);
  if(s.address)labelled($('address'),t.page_address,s.address+(s.ipAddress?' · '+s.ipAddress:''));
  $('remote').textContent=fmt(t.remote_value,{value:s.tailscaleAddress||t.remote_later});
  if(s.version)$('version').textContent=fmt(t.version,{version:s.version});
}
applyTexts();
async function poll(){
  try{const r=await fetch('/status.json',{cache:'no-store'});render(await r.json())}catch{}
  setTimeout(poll,2000);
}
poll();
setInterval(()=>fetch('/api/v1/system/health',{cache:'no-store'}).then(r=>{if(r.ok)location.reload()}).catch(()=>{}),3000);
$('auth').onsubmit=async ev=>{
  ev.preventDefault();$('submit').disabled=true;$('formMessage').textContent=TEXTS[lang].page_auth_checking;
  try{
    const r=await fetch('/github-auth',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({username:$('username').value.trim(),token:$('token').value.trim()})});
    const j=await r.json();
    $('formMessage').textContent=j.code&&TEXTS[lang][j.code]?fmt(TEXTS[lang][j.code],j.params||{}):(j.message||'');
    if(r.ok){$('token').value='';$('auth').classList.remove('on')}
  }catch{$('formMessage').textContent=TEXTS[lang].page_auth_no_answer}
  $('submit').disabled=false;
};
</script>
</body>
</html>"""


def read_status() -> dict:
    language = elise_language.current()
    return {
        **install_status(),
        "startedAt": STARTED_AT,
        # None while nothing tells the family's language (the TV takes turns in every language).
        "language": language["language"],
        "languageSource": language["source"],
    }


def page() -> bytes:
    return HTML.replace("__TEXTS__", json.dumps(page_texts(), ensure_ascii=False).replace("</", "<\\/")).encode()


def problem(code: str, **params) -> dict:
    """An answer the page shows in its language; the French message stays for older clients."""
    return {"message": TEXT["fr"][code].format(**params), "code": code, "params": params}


def discovery() -> dict:
    host = hostname()
    return {
        "instanceId": instance_id(),
        "instanceName": read_env("ELISE_DISCOVERY_NAME") or "Élise OS",
        "version": version(),
        "apiVersion": 1,
        "serverTime": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "supportsMobile": True,
        "setupRequired": True,
        "localUrl": f"http://{host}.local",
        "remoteUrl": None,
        # Apps that know this field show the preparation; older ones see a server to set up.
        "preparing": True,
        "preparation": read_status(),
    }


def is_local(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # Tailscale's CGNAT range is remote access, not the home network.
    return (ip.is_private or ip.is_loopback or ip.is_link_local) and ip not in ipaddress.ip_network("100.64.0.0/10")


def verify_token(username: str, token: str) -> dict | None:
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
            return problem("page_auth_refused")
        return problem("page_auth_github_status", status=error.code)
    except (urllib.error.URLError, TimeoutError):
        return problem("page_auth_github_unreachable")
    # Classic tokens list their scopes; ghcr.io needs read:packages to pull the images.
    if scopes is not None:
        granted = {scope.strip() for scope in scopes.split(",")}
        if not granted & {"read:packages", "write:packages"}:
            return problem("page_auth_scope")
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
        self.send(status, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/status.json":
            self.send_json(200, read_status())
        elif path == "/api/v1/discovery":
            self.send_json(200, discovery())
        elif path.startswith("/api/"):
            # The page reloads as soon as the real API answers; never pretend to be it.
            self.send_json(503, {"message": "Élise est en préparation."})
        elif path == "/logo.png":
            try:
                self.send(200, open(LOGO_FILE, "rb").read(), "image/png")
            except OSError:
                self.send_json(404, {"message": "Introuvable."})
        else:
            self.send(200, page(), "text/html; charset=utf-8")

    def do_POST(self):
        if self.path not in ("/github-auth", "/language"):
            return self.send_json(404, {"message": "Introuvable."})
        if not is_local(self.client_address[0]):
            return self.send_json(403, problem("page_local_only"))
        if self.headers.get("content-type", "").split(";")[0].strip() != "application/json":
            return self.send_json(415, {"message": "Format non pris en charge."})
        length = int(self.headers.get("content-length") or 0)
        if not 0 < length <= 4096:
            return self.send_json(400, problem("page_bad_request"))
        try:
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self.send_json(400, problem("page_bad_request"))
        if self.path == "/language":
            return self.post_language(body)
        username, token = str(body.get("username", "")).strip(), str(body.get("token", "")).strip()
        if not USERNAME.fullmatch(username) or not TOKEN.fullmatch(token):
            return self.send_json(400, problem("page_auth_invalid"))
        refused = verify_token(username, token)
        if refused:
            return self.send_json(400, refused)
        save_auth(username, token)
        return self.send_json(200, problem("page_auth_saved"))

    def post_language(self, body: dict):
        """The language of the Élise app or of a browser; the TV switches to it at once."""
        language, source = body.get("language"), body.get("source", "app")
        try:
            if not isinstance(language, str) or not isinstance(source, str):
                raise ValueError(language)
            chosen, changed = elise_language.save(language, source)
        except ValueError:
            return self.send_json(400, {**problem("page_bad_request"), "languages": list(elise_language.LANGUAGES)})
        except OSError:
            return self.send_json(500, {"message": "Élise n’a pas pu enregistrer la langue."})
        return self.send_json(200, {"language": chosen["language"], "languageSource": chosen["source"], "changed": changed})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("ELISE_PREPARATION_PORT", "80"))), Handler).serve_forever()
