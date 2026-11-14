#!/usr/bin/env python3
"""Read-only host health endpoint and asynchronous backup trigger for Élise."""
from __future__ import annotations
import glob, json, os, re, shutil, subprocess, threading, time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from socketserver import UnixStreamServer
from typing import Any

SOCKET = os.environ.get('ELISE_HEALTH_AGENT_SOCKET', '/run/elise-health/agent.sock')
PROC = os.environ.get('PROC_ROOT', '/proc')
SYS = os.environ.get('SYS_ROOT', '/sys')
BACKUP_META = os.environ.get('ELISE_BACKUP_META', '/var/lib/elise/backups/last.json')
BACKUP_SCRIPT = os.environ.get('ELISE_BACKUP_SCRIPT', '/usr/lib/elise/elise-backup.sh')
LOCK = threading.Lock()
RUNNING = False

def read_text(path: str) -> str | None:
    try:
        with open(path, encoding='utf-8') as f: return f.read()
    except OSError: return None

def command(*args: str, timeout: int = 8) -> str | None:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired): return None

def disk(path: str) -> dict[str, Any]:
    try:
        stat = os.statvfs(path); total = stat.f_blocks * stat.f_frsize; free = stat.f_bavail * stat.f_frsize
        return {'totalBytes': total, 'freeBytes': free, 'usedPercent': round((total-free)*100/total, 1) if total else None}
    except OSError: return {'totalBytes': None, 'freeBytes': None, 'usedPercent': None}

def status() -> dict[str, Any]:
    mem: dict[str, int] = {}
    raw = read_text(os.path.join(PROC, 'meminfo'))
    if raw:
        for line in raw.splitlines():
            m = re.match(r'^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)', line)
            if m: mem[m.group(1)] = int(m.group(2))*1024
    temps=[]
    for path in glob.glob(os.path.join(SYS, 'class/thermal/thermal_zone*/temp')):
        try: temps.append(int(read_text(path) or '')/1000)
        except (ValueError, TypeError): pass
    uptime=read_text(os.path.join(PROC, 'uptime')); load=read_text(os.path.join(PROC, 'loadavg'))
    containers=[]
    ids=command('docker','ps','-q','--no-trunc')
    if ids:
        for cid in ids.splitlines()[:50]:
            raw_info=command('docker','inspect',cid)
            try:
                item=json.loads(raw_info or '[]')[0]; state=item.get('State',{})
                containers.append({'name': (item.get('Name') or '').lstrip('/'), 'status': state.get('Status'), 'health': (state.get('Health') or {}).get('Status'), 'restartCount': item.get('RestartCount'), 'oomKilled': state.get('OOMKilled'), 'startedAt': state.get('StartedAt')})
            except (ValueError, IndexError, TypeError): continue
    errors=command('journalctl','-k','-b','-p','err','--since','-24h','--no-pager','-o','cat')
    lines=[line for line in (errors or '').splitlines() if re.search(r'I/O error|mmc|EXT4-fs error|blk_update_request',line,re.I)]
    try: backup=json.load(open(BACKUP_META,encoding='utf-8'))
    except (OSError,ValueError): backup=None
    throttled=command('vcgencmd','get_throttled')
    match=re.search(r'0x([0-9a-fA-F]+)',throttled or '')
    return {'checkedAt':datetime.now(timezone.utc).isoformat(), 'disk':{'root':disk('/'), 'docker':disk('/var/lib/docker')}, 'memory':mem, 'temperatureC':temps or None, 'throttled':int(match.group(1),16) if match else None, 'uptimeSeconds':float(uptime.split()[0]) if uptime else None, 'load':load.split()[:3] if load else None, 'containers':containers if ids is not None else None, 'diskErrors':{'count':len(lines),'recent':lines[-5:]}, 'backup':{'running':RUNNING,'last':backup}}

def run_backup() -> None:
    global RUNNING
    try: subprocess.run([BACKUP_SCRIPT], check=False, timeout=3600)
    finally:
        with LOCK: RUNNING=False

class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != '/status': self.send_error(404); return
        payload=json.dumps(status()).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def do_POST(self) -> None:
        global RUNNING
        if self.path != '/backup': self.send_error(404); return
        with LOCK:
            if RUNNING: code=202
            else: RUNNING=True; threading.Thread(target=run_backup,daemon=True).start(); code=202
        payload=b'{"accepted":true}'; self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def log_message(self, *_: object) -> None: pass

if __name__ == '__main__':
    os.makedirs(os.path.dirname(SOCKET),exist_ok=True)
    try: os.unlink(SOCKET)
    except FileNotFoundError: pass
    with UnixStreamServer(SOCKET,Handler) as server:
        os.chmod(SOCKET,0o660); server.serve_forever()
