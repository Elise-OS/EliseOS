#!/usr/bin/env python3
"""Local, bounded display/network operations. No shell or arbitrary command API."""
import http.server, json, os, pathlib, re, shutil, socket, socketserver, subprocess, threading, time, urllib.request
ROOT=pathlib.Path('/etc/elise')
RUN=pathlib.Path('/run/elise-screen')
CONFIG=ROOT/'screen-agent.json'
NETWORK=ROOT/'screen-network.json'
STATUS=RUN/'network.json'
DISPLAY_STATUS=RUN/'display.json'
CEC_STATUS=RUN/'cec.json'
PLAYBACK_CACHE=ROOT/'screen-playback.json'
LOCK=threading.Lock()
def read(path):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return {}
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data));tmp.chmod(0o600);tmp.replace(path)
def run(args,timeout=20):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout).stdout.strip()
def try_run(args,timeout=20):
    try:return run(args,timeout)
    except (OSError,subprocess.SubprocessError):return ''
def device(path,body=None):
    config=read(CONFIG)
    if not config.get('token'): return None
    req=urllib.request.Request(config['url']+'/api/v1/screen-device/'+path,data=None if body is None else json.dumps(body).encode(),headers={'X-Screen-Token':config['token'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=5) as r: return json.load(r)
def display_outputs(query):
    outputs={};current=None
    for line in query.splitlines():
        match=re.match(r'^(\S+) (connected|disconnected)',line)
        if match:
            current=match.group(1) if match.group(2)=='connected' else None
            if current:outputs[current]={'modes':[],'preferred':None,'current':None,'primary':' primary ' in line,'origin':bool(re.search(r'\d+x\d+\+0\+0',line))}
        elif current and line.startswith('   '):
            mode=line.strip().split()[0]
            if re.fullmatch(r'\d+x\d+(i)?',mode):
                outputs[current]['modes'].append(mode)
                if '+' in line:outputs[current]['preferred']=mode
                if '*' in line:outputs[current]['current']=mode
    return outputs
def output_priority(name):
    value=name.upper()
    if value.startswith('HDMI'):return (0,value)
    if value.startswith('DP'):return (1,value)
    if value.startswith(('DVI','VGA')):return (2,value)
    if value.startswith(('EDP','LVDS')):return (4,value)
    return (3,value)
def select_output(outputs):
    return min(outputs,key=output_priority) if outputs else None
def output_mode(details):
    modes=details.get('modes',[])
    return '1920x1080' if '1920x1080' in modes else details.get('preferred') or details.get('current') or (modes[0] if modes else None)
def configure_outputs(env,outputs=None):
    outputs=outputs if outputs is not None else display_outputs(run(env+['xrandr','--query']))
    selected=select_output(outputs)
    if not selected:return None
    mode=output_mode(outputs[selected])
    command=env+['xrandr','--output',selected]
    command+=(['--mode',mode] if mode else ['--auto'])+['--primary','--pos','0x0']
    if outputs[selected].get('current')!=mode or not outputs[selected].get('primary') or not outputs[selected].get('origin'):run(command)
    for name in outputs:
        if name!=selected:try_run(env+['xrandr','--output',name,'--off'])
    return selected
def configure_audio(env,volume):
    sinks=[]
    for line in try_run(env+['pactl','list','short','sinks']).splitlines():
        fields=line.split('\t')
        if len(fields)>1:sinks.append((fields[0],fields[1]))
    if not sinks:return None
    sink=next((name for _,name in sinks if 'hdmi' in name.lower()),sinks[0][1])
    try_run(env+['pactl','set-default-sink',sink])
    try_run(env+['pactl','set-sink-volume',sink,f'{max(0,min(100,int(volume)))}%'])
    try_run(env+['pactl','set-sink-mute',sink,'1' if int(volume)<=0 else '0'])
    for line in try_run(env+['pactl','list','short','sink-inputs']).splitlines():
        input_id=line.split('\t',1)[0]
        if input_id.isdigit():try_run(env+['pactl','move-sink-input',input_id,sink])
    sources=[]
    for line in try_run(env+['pactl','list','short','sources']).splitlines():
        fields=line.split('\t')
        if len(fields)>1 and not fields[1].endswith('.monitor'):sources.append(fields[1])
    if sources:
        source=next((name for name in sources if 'usb' in name.lower()),sources[0])
        try_run(env+['pactl','set-default-source',source])
    return sink
def cec_connector(name):
    match=re.fullmatch(r'vc4-hdmi-(\d+)',name)
    if match:return 'HDMI-'+str(int(match.group(1))+1)
    return name.replace('HDMI-A-','HDMI-')
def native_cec_adapters(selected=None):
    adapters=[]
    for path in sorted(pathlib.Path('/dev').glob('cec[0-9]*')):
        info=try_run(['cec-ctl','-d',str(path)],5)
        name=re.search(r'Adapter Name\s*:\s*(\S+)',info)
        address=re.search(r'Physical Address\s*:\s*([0-9a-fA-F.]+)',info)
        if not name or not address:continue
        connector=cec_connector(name.group(1))
        # Never take control of a different, identifiable television output.
        if selected and connector.startswith(('HDMI-','DP-')) and connector!=selected:continue
        adapters.append({'device':str(path),'name':name.group(1),'physicalAddress':address.group(1).lower(),'configured':bool(re.search(r'Logical Address\s*:\s*\d+',info))})
    return sorted(adapters,key=lambda item:(cec_connector(item['name'])!=selected,item['physicalAddress']=='f.f.f.f',item['device']))
def cec_transmit(args):
    try:
        result=subprocess.run(args,check=False,capture_output=True,text=True,timeout=5)
        output=result.stdout+'\n'+result.stderr
        # cec-ctl can exit zero even when a message was NACKed or aborted.
        return result.returncode==0 and bool(re.search(r'Tx, OK',output)) and not re.search(r'Aborted|NACK|Max Retries|\bError\b',output,re.I),output
    except (OSError,subprocess.SubprocessError) as error:return False,str(error)
def control_cec(asleep,selected=None):
    if shutil.which('cec-ctl'):
        adapters=native_cec_adapters(selected)
        if adapters:
            adapter=adapters[0];base=['cec-ctl','-s','-d',adapter['device']]
            if not adapter['configured']:
                try_run(base+['--playback','--cec-version-1.4','--allow-unreg-fallback','--no-rc-passthrough','--osd-name','EliseOS'],5)
            ok,output=cec_transmit(base+['--to','0','--standby' if asleep else '--image-view-on'])
            if not asleep and not ok:
                ok,fallback=cec_transmit(base+['--to','0','--text-view-on']);output+='\n'+fallback
            active=False;power=None
            if not asleep and ok:
                refreshed=native_cec_adapters(selected)
                address=next((item['physicalAddress'] for item in refreshed if item['device']==adapter['device']),adapter['physicalAddress'])
                if address not in ('f.f.f.f','0.0.0.0'):
                    active,_=cec_transmit(base+['--active-source','phys-addr='+address])
                _,reply=cec_transmit(base+['--to','0','--give-device-power-status'])
                match=re.search(r'pwr-state:\s*([^\n]+)',reply)
                if match:power=match.group(1).strip()
            write(CEC_STATUS,{**adapter,'backend':'linux','detected':True,'tvAcknowledged':ok,'activeSourceSent':active,'power':power,'asleepRequested':asleep,'updatedAt':time.time(),'error':None if ok else output[-600:]})
            return ok and (asleep or active)
    return control_libcec(asleep)
def control_libcec(asleep):
    write(CEC_STATUS,{'detected':False,'tvAcknowledged':False,'updatedAt':time.time(),'error':'Aucune liaison CEC native disponible.'})
    if not shutil.which('cec-client'):return False
    listing=try_run(['cec-client','-l'],8)
    if not listing or re.search(r'Found devices:\s*NONE',listing,re.I):return False
    commands='standby 0\npow 0\n' if asleep else 'on 0\nas\npow 0\n'
    try:
        result=subprocess.run(['cec-client','-s','-d','1'],input=commands,check=False,capture_output=True,text=True,timeout=8)
        ok=result.returncode==0 and not re.search(r'transmit failed|failed to transmit|NACK',result.stdout+result.stderr,re.I)
        confirmed=ok and bool(re.search(r'power status:\s*(standby|in transition.*standby)' if asleep else r'power status:\s*(on|in transition.*on)',result.stdout,re.I))
        write(CEC_STATUS,{'backend':'libcec','detected':True,'tvAcknowledged':confirmed,'commandSent':ok,'updatedAt':time.time()})
        return confirmed
    except (OSError,subprocess.SubprocessError):return False
def display_loop():
    previous=None;previous_outputs=None;display_ready=False;cec_ready=False;last_assert=0;last_cec=0;cec_desired=None
    cached=read(PLAYBACK_CACHE)
    desired=(bool(cached.get('asleep',False)),int(cached.get('volume',30)))
    selected=read(DISPLAY_STATUS).get('selected')
    while True:
        try:
            snapshot=device('heartbeat',{'host':True,'button':bool(read(CONFIG).get('buttonDevice')),'displayPower':display_ready,'cec':cec_ready})
            if snapshot:
                playback=snapshot['state']['playback'];updated=(bool(playback['asleep']),int(playback['volume']))
                if updated!=desired or not cached:
                    write(PLAYBACK_CACHE,{'asleep':updated[0],'volume':updated[1]});cached=True
                desired=updated
        except Exception: pass
        # Keep the last requested state even if the API/network or X server is down.
        if not read(CONFIG).get('token'):time.sleep(2);continue
        now=time.monotonic()
        try:
            uid=run(['id','-u','elise-screen'])
            env=['runuser','-u','elise-screen','--','env','DISPLAY=:0','XAUTHORITY=/home/elise-screen/.Xauthority','XDG_RUNTIME_DIR=/run/user/'+uid]
            outputs=display_outputs(run(env+['xrandr','--query']))
            connected=tuple((name,tuple(value['modes'])) for name,value in sorted(outputs.items()))
            topology_changed=connected!=previous_outputs;desired_changed=desired!=previous
            if topology_changed or desired_changed or now-last_assert>=30:
                output=configure_outputs(env,outputs)
                if output:selected=output
                display_ready=output is not None;last_assert=now
                if desired[0]:
                    if topology_changed or desired_changed:
                        try_run(env+['xset','+dpms']);try_run(env+['xset','dpms','force','off'])
                else:
                    # Avoid link resets on an already awake display (they abort CEC).
                    if 'Monitor is Off' in try_run(env+['xset','q']):try_run(env+['xset','dpms','force','on'])
                    try_run(env+['xset','-dpms']);try_run(env+['xset','s','off'])
                sink=configure_audio(env,desired[1])
                write(DISPLAY_STATUS,{'connected':list(outputs),'selected':output,'mode':output_mode(outputs[output]) if output else None,'audioSink':sink,'updatedAt':time.time()})
            if topology_changed and previous_outputs is not None:
                subprocess.run(['pkill','-u','elise-screen','-f','/snap/chromium/'],capture_output=True)
            previous_outputs=connected;previous=desired
        except Exception:display_ready=False
        try:
            interval=30 if cec_ready else 10
            if desired[0]!=cec_desired or now-last_cec>=interval:
                cec_ready=control_cec(desired[0],selected);last_cec=now;cec_desired=desired[0]
        except Exception:cec_ready=False;last_cec=now
        time.sleep(2)
def configure_network(data):
    if data.get('enabled') is not True:
        write(NETWORK,{'enabled':False});return
    interface=data.get('primaryInterface','');apn=data.get('apn','');pin=data.get('pin','')
    if interface not in [name for _,name in socket.if_nameindex()] or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',apn) or (pin and not re.fullmatch(r'\d{4,8}',pin)): raise ValueError('Interface, APN ou PIN invalide')
    run(['systemctl','is-active','NetworkManager'])
    name='elise-4g'
    existing=run(['nmcli','-g','NAME','connection','show']).splitlines()
    if name not in existing: run(['nmcli','connection','add','type','gsm','ifname','*','con-name',name,'apn',apn])
    run(['nmcli','connection','modify',name,'gsm.apn',apn,'gsm.pin',pin,'connection.autoconnect','no','ipv4.route-metric','5','ipv6.route-metric','5'])
    write(NETWORK,{'enabled':True,'primaryInterface':interface})
def connectivity(interface):
    for url in ['https://connectivity-check.ubuntu.com','https://www.gstatic.com/generate_204']:
        try: run(['curl','--interface',interface,'--fail','--silent','--max-time','4',url],timeout=5);return True
        except Exception: pass
    return False
def network_loop():
    failed=healthy=0;active=False
    while True:
        config=read(NETWORK)
        try:
            if not config.get('enabled'):
                if active: run(['nmcli','connection','down','elise-4g']);active=False
                write(STATUS,{'enabled':False,'active':'primary'});time.sleep(5);continue
            good=connectivity(config['primaryInterface']);healthy=healthy+1 if good else 0;failed=0 if good else failed+1
            if failed>=3 and not active: run(['nmcli','connection','up','elise-4g'],timeout=50);active=True
            if healthy>=5 and active: run(['nmcli','connection','down','elise-4g']);active=False
            modem=run(['nmcli','-t','-f','DEVICE,TYPE,STATE','device'])
            usage=0
            for line in modem.splitlines():
                parts=line.split(':')
                if len(parts)>1 and parts[1]=='gsm':
                    for counter in ['rx_bytes','tx_bytes']:
                        counter_file=pathlib.Path('/sys/class/net')/parts[0]/'statistics'/counter
                        if counter_file.exists():usage+=int(counter_file.read_text())
            write(STATUS,{'enabled':True,'active':'4g' if active else 'primary','primaryOnline':good,'modem':modem,'bytesSinceBoot':usage,'updatedAt':time.time()})
        except Exception:
            write(STATUS,{'enabled':True,'active':'4g' if active else 'primary','error':'Vérifiez le modem, la SIM et la connexion.'})
        time.sleep(5)
def button_loop():
    import struct,fcntl,select
    event=struct.Struct('@llHHi')
    while True:
        selected=read(CONFIG).get('buttonDevice')
        if not selected:time.sleep(2);continue
        try:
            with open(selected,'rb',buffering=0) as device_file:
                # Exclusive read avoids also triggering a browser keyboard handler.
                fcntl.ioctl(device_file,0x40044590,1)
                while read(CONFIG).get('buttonDevice')==selected:
                    if not select.select([device_file],[],[],2)[0]:continue
                    raw=device_file.read(event.size)
                    if len(raw)!=event.size:break
                    _,_,kind,code,value=event.unpack(raw)
                    if kind==1 and code in (57,183) and value==1:
                        try:device('button',{})
                        except Exception:pass
        except OSError:time.sleep(2)
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        result={'installed':True,'paired':bool(read(CONFIG).get('token')),'network':read(STATUS),'display':read(DISPLAY_STATUS),'cec':read(CEC_STATUS),'buttons':[str(p) for p in pathlib.Path('/dev/input/by-id').glob('*-event-kbd')],'outputs':{p.parent.name:p.read_text().strip() for p in pathlib.Path('/sys/class/drm').glob('card*-*/status')}}
        self.respond(200,result)
    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>4096: raise ValueError('Too large')
            data=json.loads(self.rfile.read(size))
            with LOCK:
                if self.path=='/pair':
                    if not re.fullmatch(r'[a-f0-9]{64}',data.get('token','')) or not re.fullmatch(r'http://127\.0\.0\.1:\d{1,5}',data.get('url','')):raise ValueError('Invalid pairing')
                    data.update({k:v for k,v in read(CONFIG).items() if k=='buttonDevice'})
                    write(CONFIG,data)
                    import pwd
                    account=pwd.getpwnam('elise-screen'); token_file=pathlib.Path('/home/elise-screen/.elise-token');write(token_file,{'token':data['token']});os.chown(token_file,account.pw_uid,account.pw_gid)
                    subprocess.run(['pkill','-u','elise-screen','-f','/snap/chromium/'],capture_output=True)
                elif self.path=='/button-device':
                    selected=data.get('path','')
                    devices=[str(p) for p in pathlib.Path('/dev/input/by-id').glob('*-event-kbd')]
                    if selected and selected not in devices:raise ValueError('Bouton introuvable')
                    config=read(CONFIG);config['buttonDevice']=selected;write(CONFIG,config)
                elif self.path=='/network': configure_network(data)
                elif self.path=='/button': device('button',{})
                else: raise ValueError('Unknown action')
            self.respond(200,{'ok':True})
        except Exception: self.respond(400,{'error':'Action impossible : vérifiez les paramètres et le matériel.'})
    def respond(self,code,value):
        body=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer): daemon_threads=True
if __name__=='__main__':
    RUN.mkdir(parents=True,exist_ok=True);sock=RUN/'agent.sock';sock.unlink(missing_ok=True)
    for worker in [display_loop,network_loop,button_loop]:threading.Thread(target=worker,daemon=True).start()
    server=Server(str(sock),Handler);os.chmod(sock,0o660)
    import grp
    os.chown(sock,0,grp.getgrnam('elise-agent').gr_gid)
    server.serve_forever()
