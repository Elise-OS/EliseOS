#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATUS = "/run/elise-preparation/status.json"
HTML = """<!doctype html><html lang=fr><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Préparation d’Élise</title><style>body{margin:0;background:#f4f0e8;color:#20352e;font:18px system-ui;display:grid;place-items:center;min-height:100vh}.c{width:min(620px,86vw);background:white;padding:42px;border-radius:28px;box-shadow:0 20px 60px #28463a1a}i{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:#e3f2ec;font-style:normal;font-size:28px}h1{font-size:34px;margin:22px 0 10px}p{color:#617069;line-height:1.6}.bar{height:9px;background:#e8ece9;border-radius:9px;overflow:hidden}.bar:after{content:'';display:block;width:35%;height:100%;background:#5e927e;border-radius:9px;animation:m 1.5s infinite alternate}@keyframes m{to{transform:translateX(185%)}}small{display:block;margin-top:16px;color:#78847f}</style><main class=c><i>É</i><h1>Préparation d’Élise</h1><p id=m>Connexion et préparation des services…</p><div class=bar></div><small>Vous pouvez laisser cet écran ouvert. Élise apparaîtra automatiquement dès qu’elle sera prête.</small></main><script>async function u(){try{let r=await fetch('/status.json'),j=await r.json();m.textContent=j.message||m.textContent}catch{}setTimeout(u,2000)}u();setInterval(()=>fetch('/api/v1/system/health').then(r=>{if(r.ok)location.reload()}).catch(()=>{}),3000)</script></html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status.json":
            try:
                data = open(STATUS, "rb").read()
            except OSError:
                data = json.dumps({"message": "Démarrage de la préparation…"}).encode()
            content_type = "application/json"
        else:
            data = HTML.encode()
            content_type = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *_args): pass

os.makedirs(os.path.dirname(STATUS), exist_ok=True)
ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("ELISE_PREPARATION_PORT", "80"))), Handler).serve_forever()
