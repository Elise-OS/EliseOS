#!/usr/bin/env python3
"""Local, bounded display/network operations. No shell or arbitrary command API."""
import concurrent.futures, hashlib, http.server, ipaddress, json, os, pathlib, re, shutil, socket, socketserver, subprocess, threading, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET
ROOT=pathlib.Path('/etc/elise')
RUN=pathlib.Path('/run/elise-screen')
CONFIG=ROOT/'screen-agent.json'
NETWORK=ROOT/'screen-network.json'
STATUS=RUN/'network.json'
DISPLAY_STATUS=RUN/'display.json'
CEC_STATUS=RUN/'cec.json'
CEC_RECLAIM=RUN/'cec-reclaim'
TV_NETWORK=ROOT/'tv-network.json'
TV_NETWORK_STATUS=RUN/'tv-network.json'
TV_DISCOVERY_STATUS=RUN/'tv-discovery.json'
PLAYBACK_CACHE=ROOT/'screen-playback.json'
LOCK=threading.Lock()
TV_DISCOVERY_LOCK=threading.Lock()
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
    # Keep HDMI ahead of other connector classes; within each class prefer an EDID mode.
    return min(outputs,key=lambda name:(output_priority(name)[0],not bool(outputs[name].get('modes') or outputs[name].get('preferred') or outputs[name].get('current')),output_priority(name)[1])) if outputs else None
def output_mode(details):
    modes=details.get('modes',[])
    return '1920x1080' if '1920x1080' in modes else details.get('preferred') or details.get('current') or (modes[0] if modes else None)
def configure_outputs(env,outputs=None):
    outputs=outputs if outputs is not None else display_outputs(run(env+['xrandr','--query']))
    if not outputs:return None
    first=select_output(outputs)
    candidates=[first]+sorted((name for name in outputs if name!=first),key=lambda name:(output_priority(name)[0],not bool(outputs[name].get('modes') or outputs[name].get('preferred') or outputs[name].get('current')),output_priority(name)[1]))
    for selected in candidates:
        details=outputs[selected]
        preferred=output_mode(details)
        modes=[]
        for mode in (preferred,details.get('preferred'),details.get('current'),None):
            if mode not in modes:modes.append(mode)
        for mode in modes:
            command=env+['xrandr','--output',selected]
            command+=(['--mode',mode] if mode else ['--auto'])+['--primary','--pos','0x0']
            if details.get('current')==mode and details.get('primary') and details.get('origin'):break
            try:
                run(command,5)
                break
            except (OSError,subprocess.SubprocessError):continue
        else:continue
        for name in outputs:
            if name!=selected:try_run(env+['xrandr','--output',name,'--off'])
        return selected
    return None
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
                adapter=next((item for item in native_cec_adapters(selected) if item['device']==adapter['device']),adapter)
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
            if ok and (asleep or active):return True
            return control_libcec(asleep,True)
    return control_libcec(asleep)
def control_libcec(asleep,preserve_native=False):
    if not shutil.which('cec-client'):
        if not preserve_native:write(CEC_STATUS,{'detected':False,'tvAcknowledged':False,'updatedAt':time.time(),'error':'Aucune liaison CEC native disponible.'})
        return False
    listing=try_run(['cec-client','-l'],8)
    if not listing or re.search(r'Found devices:\s*NONE',listing,re.I):
        if not preserve_native:write(CEC_STATUS,{'detected':False,'tvAcknowledged':False,'updatedAt':time.time(),'error':'Aucune liaison CEC disponible.'})
        return False
    commands='standby 0\npow 0\n' if asleep else 'on 0\nas\npow 0\n'
    try:
        result=subprocess.run(['cec-client','-s','-d','1'],input=commands,check=False,capture_output=True,text=True,timeout=8)
        ok=result.returncode==0 and not re.search(r'transmit failed|failed to transmit|NACK',result.stdout+result.stderr,re.I)
        confirmed=ok and bool(re.search(r'power status:\s*(standby|in transition.*standby)' if asleep else r'power status:\s*(on|in transition.*on)',result.stdout,re.I))
        write(CEC_STATUS,{'backend':'libcec','detected':True,'tvAcknowledged':confirmed,'commandSent':ok,'activeSourceSent':confirmed and not asleep,'asleepRequested':asleep,'updatedAt':time.time()})
        return confirmed
    except (OSError,subprocess.SubprocessError):return False
def ssdp_headers(payload):
    result={}
    for line in payload.decode('utf-8','replace').splitlines()[1:]:
        if ':' in line:
            key,value=line.split(':',1);result[key.strip().lower()]=value.strip()
    return result
def private_location(value):
    try:
        parsed=urllib.parse.urlsplit(value)
        if parsed.scheme not in ('http','https') or not parsed.hostname:return None
        addresses={item[4][0] for item in socket.getaddrinfo(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)}
        def local(address):
            ip=ipaddress.ip_address(address)
            return (ip.is_private or ip.is_link_local) and not (ip.is_loopback or ip.is_multicast or ip.is_unspecified)
        if not addresses or any(not local(address) for address in addresses):return None
        return parsed,sorted(addresses)[0]
    except (OSError,ValueError):return None
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def xml_value(root,name):
    for element in root.iter():
        if element.tag.rsplit('}',1)[-1]==name and element.text:return element.text.strip()
    return ''
def neighbour_mac(address):
    output=try_run(['ip','neigh','show',address],3)
    match=re.search(r'\blladdr\s+([0-9a-f:]{17})\b',output,re.I)
    if match:return match.group(1).lower()
    try:
        for line in pathlib.Path('/proc/net/arp').read_text().splitlines()[1:]:
            fields=line.split()
            if fields and fields[0]==address and len(fields)>3 and re.fullmatch(r'[0-9a-f:]{17}',fields[3],re.I):return fields[3].lower()
    except OSError:pass
    return None
def tv_protocols(text):
    lower=text.lower();protocols=[]
    if 'samsung' in lower:protocols.append('samsung')
    if 'webos' in lower or 'lge' in lower or 'lg electronics' in lower:protocols.append('webos')
    if any(value in lower for value in ('android tv','google tv','chromecast')):protocols.append('android-tv')
    if 'roku' in lower:protocols.append('roku')
    if 'dial' in lower:protocols.append('dial')
    if 'mediarenderer' in lower or 'avtransport' in lower:protocols.append('upnp')
    return protocols
def local_ipv4_addresses():
    addresses=[]
    try:
        for interface in json.loads(try_run(['ip','-j','-4','addr','show'],3) or '[]'):
            if interface.get('operstate') not in ('UP','UNKNOWN') or interface.get('ifname')=='lo':continue
            for value in interface.get('addr_info',[]):
                address=str(value.get('local',''))
                try:
                    ip=ipaddress.ip_address(address)
                    if ip.is_private and not (ip.is_loopback or ip.is_link_local):addresses.append(address)
                except ValueError:pass
    except (TypeError,ValueError):pass
    return list(dict.fromkeys(addresses))
def describe_tv(headers,peer):
    location=headers.get('location','');validated=private_location(location)
    if not validated or len(location)>2048:return None
    _,address=validated
    # Prefer the address that answered the discovery packet when the description uses a hostname.
    if peer:
        try:
            peer_address=ipaddress.ip_address(peer)
            if (peer_address.is_private or peer_address.is_link_local) and not peer_address.is_loopback:address=peer
        except ValueError:pass
    description=b''
    try:
        request=urllib.request.Request(location,headers={'User-Agent':'EliseOS/1.0 UPnP/1.1'})
        with urllib.request.build_opener(NoRedirect).open(request,timeout=1) as response:description=response.read(131073)
    except Exception:pass
    values={}
    if description and len(description)<=131072:
        try:
            root=ET.fromstring(description)
            values={key:xml_value(root,key) for key in ('friendlyName','manufacturer','modelName','deviceType','UDN')}
        except ET.ParseError:pass
    combined=' '.join([*headers.values(),*values.values()])
    protocols=tv_protocols(combined)
    tv_words=('tv','television','mediarenderer','dial','samsung','webos','roku','chromecast','bravia','philips')
    if not protocols and not any(word in combined.lower() for word in tv_words):return None
    clean=lambda value,fallback:(value or fallback).strip()[:200]
    name=clean(values.get('friendlyName'),f'TV {address}')
    manufacturer=clean(values.get('manufacturer'),'Inconnue')
    model=clean(values.get('modelName'),'Modèle non communiqué')
    mac=neighbour_mac(address)
    identity=mac or '|'.join(re.sub(r'[^a-z0-9]','',value.lower()) for value in (address,name,manufacturer,model))
    return {'id':hashlib.sha256(identity.encode()).hexdigest()[:16],'name':name,'manufacturer':manufacturer,'model':model,'address':address,'mac':mac,'location':location,'protocols':protocols or ['ssdp']}
def discover_tvs(timeout=3):
    if not TV_DISCOVERY_LOCK.acquire(blocking=False):
        cached=read(TV_DISCOVERY_STATUS)
        return cached.get('devices',[]) if time.time()-cached.get('updatedAt',0)<360 else []
    try:
        message=('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n').encode()
        found={};sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM,socket.IPPROTO_UDP)
        try:
            sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_TTL,2);sock.settimeout(.25)
            sent=False
            for address in local_ipv4_addresses():
                try:
                    sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_IF,socket.inet_aton(address))
                    for _ in range(2):sock.sendto(message,('239.255.255.250',1900))
                    sent=True
                except OSError:pass
            if not sent:
                for _ in range(2):sock.sendto(message,('239.255.255.250',1900))
            deadline=time.monotonic()+max(1,min(5,float(timeout)))
            while time.monotonic()<deadline:
                try:payload,peer=sock.recvfrom(65535)
                except socket.timeout:continue
                headers=ssdp_headers(payload);location=headers.get('location','')
                if location and location not in found and len(found)<32:found[location]=(headers,peer[0])
        finally:sock.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=pool.map(lambda item:describe_tv(*item),found.values())
            devices_by_id={}
            for result in results:
                if not result:continue
                existing=devices_by_id.get(result['id'])
                if existing:
                    existing['protocols']=list(dict.fromkeys([*existing['protocols'],*result['protocols']]))
                    if existing['manufacturer']=='Inconnue' and result['manufacturer']!='Inconnue':existing['manufacturer']=result['manufacturer']
                    if existing['model']=='Modèle non communiqué' and result['model']!='Modèle non communiqué':existing['model']=result['model']
                else:devices_by_id[result['id']]=result
        devices=sorted(devices_by_id.values(),key=lambda item:(item['name'].lower(),item['address']))
        write(TV_DISCOVERY_STATUS,{'devices':devices,'updatedAt':time.time()})
        return devices
    finally:TV_DISCOVERY_LOCK.release()
def select_network_tv(data):
    allowed={'id','name','manufacturer','model','address','mac','location','protocols','homeAssistantEntityId','homeAssistantName'}
    selected={key:data.get(key) for key in allowed if data.get(key) not in (None,'')}
    if not re.fullmatch(r'[a-f0-9]{16}',str(selected.get('id',''))):raise ValueError('TV invalide')
    if selected.get('address'):
        try:
            address=ipaddress.ip_address(str(selected['address']))
            if not (address.is_private or address.is_link_local) or address.is_loopback:raise ValueError('Adresse TV invalide')
        except ValueError:raise ValueError('Adresse TV invalide')
    if not selected.get('address') and not selected.get('homeAssistantEntityId'):raise ValueError('TV invalide')
    if selected.get('mac') and not re.fullmatch(r'[0-9a-f:]{17}',str(selected['mac']),re.I):raise ValueError('Adresse TV invalide')
    if selected.get('homeAssistantEntityId') and not re.fullmatch(r'media_player\.[a-z0-9_]+',str(selected['homeAssistantEntityId'])):raise ValueError('Entité TV invalide')
    selected['updatedAt']=time.time();write(TV_NETWORK,selected);return selected
def local_broadcasts():
    targets={'255.255.255.255'}
    try:
        for interface in json.loads(try_run(['ip','-j','-4','addr','show'],3) or '[]'):
            if interface.get('operstate') not in ('UP','UNKNOWN'):continue
            for address in interface.get('addr_info',[]):
                broadcast=address.get('broadcast')
                if broadcast:targets.add(str(broadcast))
    except (TypeError,ValueError):pass
    return targets
def wake_network_tv():
    selected=read(TV_NETWORK);mac=str(selected.get('mac','')).replace(':','')
    if not re.fullmatch(r'[0-9a-fA-F]{12}',mac):return {'sent':False,'reason':'Adresse MAC indisponible'}
    packet=b'\xff'*6+bytes.fromhex(mac)*16
    targets={(broadcast,port) for broadcast in local_broadcasts() for port in (7,9)}
    address=selected.get('address')
    if address:targets.add((str(address),9))
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);sock.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
    sent=0
    try:
        for target in targets:
            for _ in range(3):
                try:sock.sendto(packet,target);sent+=1
                except OSError:break
    finally:sock.close()
    return {'sent':sent>0,'target':selected.get('name'),'attempts':sent,'updatedAt':time.time()}
def tv_reachable(selected):
    address=str(selected.get('address',''))
    try:
        ip=ipaddress.ip_address(address)
        if not (ip.is_private or ip.is_link_local) or ip.is_loopback:return False,None
    except ValueError:return False,None
    protocols=set(selected.get('protocols') or [])
    ports=[]
    if 'samsung' in protocols:ports.extend((8002,8001))
    if 'webos' in protocols:ports.append(3000)
    if 'roku' in protocols:ports.append(8060)
    ports.extend((443,80))
    for port in dict.fromkeys(ports):
        try:
            with socket.create_connection((address,port),timeout=.2):return True,port
        except OSError:pass
    if try_run(['ping','-c','1','-W','1',address],2):return True,'icmp'
    return False,None
def cec_confirmed(asleep=False):
    status=read(CEC_STATUS);updated=status.get('updatedAt')
    if not isinstance(updated,(int,float)) or time.time()-updated>45:return False
    if status.get('tvAcknowledged') is not True:return False
    return status.get('asleepRequested') is True if asleep else status.get('activeSourceSent') is True
def same_tv(selected,candidate):
    if selected.get('id')==candidate.get('id'):return True
    if selected.get('mac') and selected.get('mac')==candidate.get('mac'):return True
    identity=lambda value:re.sub(r'[^a-z0-9]','',str(value).lower())
    return all(identity(selected.get(key)) and identity(selected.get(key))==identity(candidate.get(key)) for key in ('name','manufacturer','model'))
def network_tv_loop():
    last_wake=0.;last_scan=0.;wake_result={};selected_id=None
    while True:
        selected=read(TV_NETWORK)
        if not selected:
            selected_id=None;write(TV_NETWORK_STATUS,{'configured':False,'updatedAt':time.time()});time.sleep(10);continue
        if selected.get('id')!=selected_id:
            selected_id=selected.get('id');last_scan=0.;last_wake=0.;wake_result={}
        playback=read(PLAYBACK_CACHE);asleep=playback.get('asleep')
        reachable,port=tv_reachable(selected);cec_ok=cec_confirmed(bool(asleep))
        now=time.monotonic()
        if asleep is False and selected.get('mac') and (not cec_ok or not reachable) and now-last_wake>=60:
            wake_result=wake_network_tv();last_wake=now
        if asleep is False and now-last_scan>=300:
            last_scan=now
            try:
                candidate=next((item for item in discover_tvs(2) if same_tv(selected,item)),None)
                if candidate:
                    preserved={key:selected[key] for key in ('homeAssistantEntityId','homeAssistantName') if selected.get(key)}
                    selected=select_network_tv({**candidate,**preserved})
                    reachable=True
            except Exception:pass
        write(TV_NETWORK_STATUS,{
            'configured':True,'reachable':reachable,'detectedPort':port,'cecConfirmed':cec_ok,
            'automaticWake':wake_result,'lastWakeAt':wake_result.get('updatedAt'),'address':selected.get('address'),
            'updatedAt':time.time()
        })
        time.sleep(10)
def display_loop():
    previous=None;previous_outputs=None;display_ready=False;cec_ready=False;last_assert=0;last_cec=0;cec_desired=None
    cached=read(PLAYBACK_CACHE)
    desired=(bool(cached.get('asleep',False)),int(cached.get('volume',30)))
    selected=read(DISPLAY_STATUS).get('selected')
    while True:
        try:
            snapshot=device('heartbeat',{'host':True,'button':bool(read(CONFIG).get('buttonDevice')),'displayPower':display_ready,'cec':cec_ready})
            if snapshot:
                state=snapshot['state'];playback=state['playback'];updated=(bool(playback['asleep']),int(playback['volume']))
                if updated!=desired or not cached:
                    write(PLAYBACK_CACHE,{'asleep':updated[0],'volume':updated[1]});cached=True
                desired=updated
                if 'tvControl' in state:
                    tv_control=state.get('tvControl');current_tv=read(TV_NETWORK)
                    if isinstance(tv_control,dict) and tv_control.get('id')!=current_tv.get('id'):select_network_tv(tv_control)
                    elif tv_control is None and current_tv:TV_NETWORK.unlink(missing_ok=True);TV_NETWORK_STATUS.unlink(missing_ok=True)
        except Exception: pass
        # The display and CEC are local hardware controls; keep them running while
        # pairing, API access, or network connectivity is unavailable.
        now=time.monotonic()
        force_cec=CEC_RECLAIM.exists()
        if force_cec:
            CEC_RECLAIM.unlink(missing_ok=True)
            desired=(False,desired[1])
            write(PLAYBACK_CACHE,{'asleep':False,'volume':desired[1]})
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
            if force_cec or desired[0]!=cec_desired or now-last_cec>=interval:
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
        result={'installed':True,'paired':bool(read(CONFIG).get('token')),'network':read(STATUS),'display':read(DISPLAY_STATUS),'cec':read(CEC_STATUS),'networkTv':read(TV_NETWORK),'networkTvStatus':read(TV_NETWORK_STATUS),'buttons':[str(p) for p in pathlib.Path('/dev/input/by-id').glob('*-event-kbd')],'outputs':{p.parent.name:p.read_text().strip() for p in pathlib.Path('/sys/class/drm').glob('card*-*/status')}}
        self.respond(200,result)
    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>4096: raise ValueError('Too large')
            data=json.loads(self.rfile.read(size) or b'{}')
            # A discovery can take several seconds; never let it delay an emergency reclaim.
            if self.path=='/cec/reclaim':
                CEC_RECLAIM.touch(mode=0o600,exist_ok=True);self.respond(200,{'ok':True,'networkWake':wake_network_tv()});return
            if self.path=='/tv/scan':
                self.respond(200,{'devices':discover_tvs()});return
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
                elif self.path=='/tv/select':
                    selected=select_network_tv(data);self.respond(200,{'ok':True,'selected':selected});return
                elif self.path=='/tv/forget':
                    TV_NETWORK.unlink(missing_ok=True);TV_NETWORK_STATUS.unlink(missing_ok=True);self.respond(200,{'ok':True});return
                elif self.path=='/network': configure_network(data)
                elif self.path=='/button': device('button',{})
                else: raise ValueError('Unknown action')
            self.respond(200,{'ok':True})
        except Exception: self.respond(400,{'error':'Action impossible : vérifiez les paramètres et le matériel.'})
    def respond(self,code,value):
        body=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer): daemon_threads=True
def supervise(worker):
    while True:
        try:worker()
        except Exception:time.sleep(2)
if __name__=='__main__':
    RUN.mkdir(parents=True,exist_ok=True);sock=RUN/'agent.sock';sock.unlink(missing_ok=True)
    for worker in [display_loop,network_loop,network_tv_loop,button_loop]:threading.Thread(target=supervise,args=(worker,),daemon=True).start()
    server=Server(str(sock),Handler);os.chmod(sock,0o660)
    import grp
    os.chown(sock,0,grp.getgrnam('elise-agent').gr_gid)
    server.serve_forever()
