import {
  eliseMobileCallConfig,
  eliseMobileCallInterfaceConfig,
  type ScreenJoin,
} from '@elise/contracts';

/*
 * Document loaded in the call WebView. It runs Jitsi through its External API and:
 * - hides every piece of Jitsi UI (config + CSS injected into the Jitsi frame, which has the same
 *   origin as this document thanks to the WebView baseUrl): the app draws one single control bar;
 * - draws the self-view (the phone's camera) as a fixed rounded thumbnail in the top corner;
 * - reports every Jitsi event to React Native as one JSON message (parsed by callSession.ts);
 * - exposes window.__eliseCall, called by the app through injectJavaScript.
 *
 * No relative import here: scripts/calls-ui-capture.mjs loads this file directly with Node.
 */

const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** Options given to JitsiMeetExternalAPI (parentNode is added in the page). */
export function mobileCallOptions(join: ScreenJoin) {
  return {
    roomName: join.room,
    jwt: join.jwt,
    width: '100%',
    height: '100%',
    userInfo: { displayName: join.name },
    configOverwrite: {
      ...eliseMobileCallConfig,
      startWithAudioMuted: false,
      startWithVideoMuted: false,
    },
    interfaceConfigOverwrite: eliseMobileCallInterfaceConfig,
  };
}

// Jitsi elements left on screen once the config has hidden what it can (stable-10978). Never a
// layout class: Jitsi puts `vertical-filmstrip` on #videoconference_page itself.
const HIDDEN_JITSI_UI = [
  '.watermark',
  '.leftwatermark',
  '.rightwatermark',
  '.subject',
  '.details-container',
  '#autoHide',
  '.new-toolbox',
  '#new-toolbox',
  '.toolbox-content',
  '.filmstrip',
  '#remoteVideos',
  '.displayname',
  '.display-name',
  '.stage-participant-label',
  '.connection-indicator',
  '.indicator-container',
  '.notification',
  '[class*="notificationsContainer"]',
  '.reactions-animations-container',
  '.pip-container',
  '.deep-linking-mobile',
  '.deep-linking-desktop',
  '#dominantSpeaker',
  '#largeVideoBackground',
];

/**
 * Where the other person's video goes inside the stage (the part of the screen left free by the
 * app's top pill, self-view and control bar): it fills the stage like a cover, but never loses
 * more than a third of the picture on either side (a TV filming a room in landscape, seen on a
 * phone held upright, would otherwise be cut down to the middle third). Plain JavaScript in a
 * string: the page runs it as is and the tests evaluate the very same code.
 */
export const FIT_VIDEO_JS = `function fitVideo(stageWidth, stageHeight, videoWidth, videoHeight){
  var w=Math.max(1, stageWidth), h=Math.max(1, stageHeight);
  if(!(videoWidth > 0 && videoHeight > 0)) return {left:0, top:0, width:w, height:h};
  var ratio=videoWidth / videoHeight, keep=${2 / 3};
  var width=Math.min(Math.max(w, h * ratio), w / keep, (h * ratio) / keep);
  var height=width / ratio;
  return {left:(w - width) / 2, top:(h - height) / 2, width:width, height:height};
}`;

/** Stage left free for the video, in px from each edge of the WebView (pushed by the app). */
export interface CallStage {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** CSS injected into the Jitsi frame. --elise-top/--elise-right come from the app's safe areas. */
export const JITSI_FRAME_CSS = `${HIDDEN_JITSI_UI.join(',')}{display:none!important}
html,body,#videoconference_page,#videospace{background:#06192D!important}
#largeVideoContainer{background:transparent!important}
#elise-ambient{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s;pointer-events:none}
#elise-ambient.on{opacity:.4}
#largeVideoWrapper{position:fixed!important;left:var(--elise-stage-left,0px)!important;top:var(--elise-stage-top,0px)!important;width:var(--elise-stage-width,100%)!important;height:var(--elise-stage-height,100%)!important;margin:0!important;transform:none!important;overflow:hidden!important;background:transparent!important}
#largeVideo{position:absolute!important;left:var(--elise-video-left,0px)!important;top:var(--elise-video-top,0px)!important;width:var(--elise-video-width,100%)!important;height:var(--elise-video-height,100%)!important;max-width:none!important;max-height:none!important;object-fit:cover!important;margin:0!important}
html.elise-alone #largeVideoWrapper,html.elise-alone #largeVideo,html.elise-alone #elise-ambient,html.elise-novideo #elise-ambient{visibility:hidden!important}
#elise-self{position:fixed;z-index:2147483000;top:calc(var(--elise-top,0px) + 12px);right:calc(var(--elise-right,0px) + 14px);width:104px;height:144px;border-radius:20px;overflow:hidden;background:#173B5C;box-shadow:0 10px 28px rgba(0,0,0,.45),0 0 0 1.5px rgba(255,255,255,.34);transition:opacity .25s;pointer-events:none}
@media (orientation:landscape){#elise-self{width:148px;height:104px}}
#elise-self video{width:100%;height:100%;object-fit:cover;display:block;background:#173B5C}
#elise-self.mirror video{transform:scaleX(-1)}
#elise-self.off video{visibility:hidden}
#elise-self .elise-off{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#D0E0E3}
#elise-self.off .elise-off{display:flex}
#elise-self.pending{opacity:0}`;

const CAMERA_OFF_ICON =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><path d="M2 2l20 20"/></svg>';

export function callPage(join: ScreenJoin) {
  const jitsi = new URL(join.url);
  return {
    baseUrl: jitsi.origin,
    html: `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
        <meta name="referrer" content="no-referrer">
        <style>html,body,#meet{height:100%;width:100%;margin:0;background:#06192D;overflow:hidden}</style>
      </head><body><div id="meet"></div>
        <script>
          (function(){
            var CSS=${inlineJson(JITSI_FRAME_CSS)};
            var OFF_ICON=${inlineJson(CAMERA_OFF_ICON)};
            ${FIT_VIDEO_JS}
            var api=null, joined=false, everJoined=false, layout={}, stage=null, sent={}, selfTrack=null;
            var media={audioMuted:false, videoMuted:false};
            function send(type, data){
              var message=data || {};
              message.type=type;
              if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
            }
            // Same value twice in a row is not sent again (store updates are frequent).
            function sendChanged(type, data){
              var key=JSON.stringify(data);
              if(sent[type]===key) return;
              sent[type]=key;
              send(type, data);
            }
            function frameWindow(){
              try {
                var frame=api && api.getIFrame();
                var win=frame && frame.contentWindow;
                return win && win.document ? win : null;
              } catch (error) { return null; }
            }
            function applyLayout(){
              var win=frameWindow();
              if(!win) return;
              for(var key in layout) win.document.documentElement.style.setProperty('--elise-'+key, layout[key]+'px');
              fitLarge();
            }
            // The other person's video fills the free stage (see FIT_VIDEO_JS), never under the
            // app's bars; a dimmed, blurred copy of it fills the rest of the screen.
            function fitLarge(){
              var win=frameWindow();
              if(!win) return;
              var doc=win.document, root=doc.documentElement;
              var large=doc.getElementById('largeVideo');
              var free=stage || {top:0, right:0, bottom:0, left:0};
              var width=Math.max(1, win.innerWidth-free.left-free.right);
              var height=Math.max(1, win.innerHeight-free.top-free.bottom);
              var fit=fitVideo(width, height, large && large.videoWidth, large && large.videoHeight);
              var values={'stage-left':free.left, 'stage-top':free.top, 'stage-width':width, 'stage-height':height,
                'video-left':fit.left, 'video-top':fit.top, 'video-width':fit.width, 'video-height':fit.height};
              for(var name in values) root.style.setProperty('--elise-'+name, Math.round(values[name])+'px');
              var container=doc.getElementById('largeVideoContainer');
              if(container && !doc.getElementById('elise-ambient')){
                var canvas=doc.createElement('canvas');
                canvas.id='elise-ambient';
                container.insertBefore(canvas, container.firstChild);
              }
            }
            function paintAmbient(){
              var win=frameWindow();
              var doc=win && win.document;
              var canvas=doc && doc.getElementById('elise-ambient');
              var large=doc && doc.getElementById('largeVideo');
              if(!canvas) return;
              var ready=!!(large && large.videoWidth > 0 && large.readyState >= 2);
              canvas.classList.toggle('on', ready);
              if(!ready) return;
              // A few pixels stretched to the whole screen: a soft glow of the picture's colours.
              canvas.width=24;
              canvas.height=Math.max(8, Math.round(24*large.videoHeight/large.videoWidth));
              try { canvas.getContext('2d').drawImage(large, 0, 0, canvas.width, canvas.height); } catch (error) {}
            }
            setInterval(paintAmbient, 700);
            function decorate(){
              var win=frameWindow();
              if(!win || !win.document.head || !win.document.body) return;
              var doc=win.document;
              if(!doc.getElementById('elise-ui')){
                var style=doc.createElement('style');
                style.id='elise-ui';
                style.textContent=CSS;
                doc.head.appendChild(style);
              }
              if(!doc.getElementById('elise-self')){
                var tile=doc.createElement('div');
                tile.id='elise-self';
                tile.className='pending';
                tile.innerHTML='<video autoplay playsinline muted></video><div class="elise-off">'+OFF_ICON+'</div>';
                doc.body.appendChild(tile);
              }
              applyLayout();
            }
            function tracksOf(state){ return state['features/base/tracks'] || []; }
            function syncSelf(state){
              var win=frameWindow();
              var tile=win && win.document.getElementById('elise-self');
              if(!tile) return;
              var track=null;
              tracksOf(state).forEach(function(item){ if(item.local && item.mediaType==='video') track=item; });
              var jitsiTrack=track && track.jitsiTrack;
              if(jitsiTrack!==selfTrack){
                selfTrack=jitsiTrack;
                var video=tile.querySelector('video');
                try {
                  video.srcObject=jitsiTrack ? jitsiTrack.getOriginalStream() : null;
                  var playing=video.play && video.play();
                  if(playing && playing.catch) playing.catch(function(){});
                } catch (error) {}
              }
              var facing=jitsiTrack && jitsiTrack.getCameraFacingMode ? jitsiTrack.getCameraFacingMode() : 'user';
              tile.className=(!track ? 'pending' : track.muted ? 'off' : '')+(facing==='environment' ? '' : ' mirror');
            }
            function syncRemote(state){
              var participants=state['features/base/participants'] || {};
              var ids=[];
              if(participants.remote && participants.remote.forEach)
                participants.remote.forEach(function(value, id){ if(!value.fakeParticipant) ids.push(id); });
              var audioOn=false, videoOn=false;
              tracksOf(state).forEach(function(item){
                if(item.local || ids.indexOf(item.participantId) < 0 || item.muted) return;
                if(item.mediaType==='audio') audioOn=true;
                if(item.mediaType==='video') videoOn=true;
              });
              var win=frameWindow();
              var large=win && win.document.getElementById('largeVideo');
              if(large && !large.__elise){
                large.__elise=true;
                ['loadeddata', 'playing', 'resize', 'emptied'].forEach(function(name){ large.addEventListener(name, scheduleSync); large.addEventListener(name, fitLarge); });
              }
              if(win){
                win.document.documentElement.classList.toggle('elise-alone', ids.length===0);
                // Camera switched off: no glow of the last picture behind the app's notice.
                win.document.documentElement.classList.toggle('elise-novideo', ids.length>0 && !videoOn);
              }
              // Camera on but no picture yet: the app shows a calm placeholder, not a black screen.
              var pending=ids.length>0 && videoOn && !(large && large.videoWidth > 0);
              sendChanged('remote', {ids:ids, audioMuted:ids.length>0 && !audioOn, videoMuted:ids.length>0 && !videoOn, videoPending:pending});
            }
            var storeTimer=null;
            function syncStore(){
              storeTimer=null;
              var win=frameWindow();
              if(!win || !win.APP || !win.APP.store) return;
              var state=win.APP.store.getState();
              syncSelf(state);
              syncRemote(state);
            }
            function scheduleSync(){ if(!storeTimer) storeTimer=setTimeout(syncStore, 120); }
            var quality={local:null, loss:null, remote:{}}, qualityAt=0;
            function sendQuality(){
              if(Date.now()-qualityAt < 2000) return;
              qualityAt=Date.now();
              var values=[quality.local];
              for(var id in quality.remote) values.push(quality.remote[id]);
              values=values.filter(function(value){ return typeof value==='number'; });
              send('quality', {quality:values.length ? Math.min.apply(null, values) : null, packetLoss:quality.loss});
            }
            function watchConference(){
              var win=frameWindow();
              var room=win && win.APP && win.APP.conference && win.APP.conference._room;
              if(!room || room.__elise) return;
              room.__elise=true;
              var events=win.JitsiMeetJS && win.JitsiMeetJS.events || {};
              var cq=events.connectionQuality || {}, conference=events.conference || {};
              room.on(cq.LOCAL_STATS_UPDATED || 'cq.local_stats_updated', function(stats){
                quality.local=stats && typeof stats.connectionQuality==='number' ? stats.connectionQuality : null;
                quality.loss=stats && stats.packetLoss && typeof stats.packetLoss.total==='number' ? stats.packetLoss.total : null;
                sendQuality();
              });
              room.on(cq.REMOTE_STATS_UPDATED || 'cq.remote_stats_updated', function(id, stats){
                if(stats && typeof stats.connectionQuality==='number') quality.remote[id]=stats.connectionQuality;
                sendQuality();
              });
              room.on(conference.CONNECTION_INTERRUPTED || 'conference.connectionInterrupted', function(){ send('interrupted'); });
              room.on(conference.CONNECTION_RESTORED || 'conference.connectionRestored', function(){ send('restored'); });
              room.on(conference.CONFERENCE_FAILED || 'conference.failed', function(){ send('failed'); });
              room.on(conference.USER_LEFT || 'conference.userLeft', function(id){ delete quality.remote[id]; });
              win.APP.store.subscribe(scheduleSync);
            }
            function sendMedia(){ send('media', {audioMuted:media.audioMuted, videoMuted:media.videoMuted}); }
            function readMedia(){
              Promise.all([api.isAudioMuted(), api.isVideoMuted()]).then(function(values){
                media.audioMuted=!!values[0];
                media.videoMuted=!!values[1];
                sendMedia();
              }).catch(function(){});
            }
            function reportCameras(devices){
              var cameras=devices && devices.videoInput || [];
              send('camera-switch', {available:cameras.length > 1});
            }
            // Loudspeaker or earpiece: only offered when the WebView names both kinds of output
            // (a list of anonymous outputs says nothing about where the sound would go).
            var SPEAKER=/speaker|haut-parleur|altavoz|altoparlante|altifalante/i;
            var EARPIECE=/earpiece|receiver|handset|écouteur|auricular|auricolare|auscultador/i;
            function isSpeaker(output){
              var label=output && output.label || '';
              return SPEAKER.test(label) ? true : EARPIECE.test(label) ? false : null;
            }
            function phoneOutputs(devices){
              return (devices && devices.audioOutput || []).filter(function(output){ return isSpeaker(output)!==null; });
            }
            function reportOutputs(devices, current){
              var outputs=phoneOutputs(devices);
              var available=outputs.some(isSpeaker) && outputs.some(function(output){ return isSpeaker(output)===false; });
              var speaker=available ? isSpeaker(current) : null;
              // The default output of a phone is its loudspeaker during a video call.
              if(available && speaker===null) speaker=true;
              sendChanged('audio-output', {available:available, speaker:speaker});
            }
            function refreshCameras(){
              api.getAvailableDevices().then(reportCameras).catch(function(){ send('camera-switch', {available:false}); });
              refreshOutputs();
            }
            function refreshOutputs(){
              Promise.all([api.getAvailableDevices(), api.getCurrentDevices()]).then(function(results){
                reportOutputs(results[0], results[1] && results[1].audioOutput);
              }).catch(function(){ sendChanged('audio-output', {available:false, speaker:null}); });
            }
            var switchingOutput=false;
            function switchSpeaker(){
              if(!api || switchingOutput) return;
              switchingOutput=true;
              Promise.all([api.getAvailableDevices(), api.getCurrentDevices()]).then(function(results){
                var current=results[1] && results[1].audioOutput || {};
                var wantSpeaker=isSpeaker(current)===false;
                var next=phoneOutputs(results[0]).filter(function(output){ return isSpeaker(output)===wantSpeaker; })[0];
                if(!next){ reportOutputs(results[0], current); return; }
                return api.setAudioOutputDevice(next.label, next.deviceId);
              }).catch(function(){ send('audio-output-error'); })
                .then(function(){ switchingOutput=false; refreshOutputs(); });
            }
            var switchingCamera=false;
            function switchCamera(){
              if(!api || switchingCamera) return;
              switchingCamera=true;
              Promise.all([api.getAvailableDevices(), api.getCurrentDevices()]).then(function(results){
                var cameras=results[0] && results[0].videoInput || [];
                var current=results[1] && results[1].videoInput || {};
                if(cameras.length < 2){ send('camera-switch', {available:false}); return; }
                var index=cameras.findIndex(function(camera){
                  return (current.deviceId && camera.deviceId===current.deviceId) || (current.label && camera.label===current.label);
                });
                var next=cameras[index < 0 ? 1 : (index + 1) % cameras.length];
                return api.setVideoInputDevice(next.label, next.deviceId);
              }).catch(function(){
                try { api.executeCommand('toggleCamera'); } catch (error) { send('camera-switch-error'); }
              }).then(function(){ switchingCamera=false; scheduleSync(); });
            }
            function deviceProblem(event){
              var type=String(event && (event.type || event.name) || '');
              return /permission|notallowed|denied/i.test(type) ? 'permission' : 'unavailable';
            }

            // Called by the app (injectJavaScript); harmless before Jitsi is ready.
            window.__eliseCall={
              toggleAudio:function(){ if(api) api.executeCommand('toggleAudio'); },
              toggleVideo:function(){ if(api) api.executeCommand('toggleVideo'); },
              switchCamera:switchCamera,
              switchSpeaker:switchSpeaker,
              hangup:function(){
                if(!api || !joined){ send('left'); return; }
                try { api.executeCommand('hangup'); } catch (error) { send('left'); }
              },
              layout:function(values){
                layout={};
                stage=null;
                for(var key in values || {}){
                  if(key==='stage' && values.stage) stage=values.stage;
                  else if(typeof values[key]==='number') layout[key]=values[key];
                }
                applyLayout();
              },
              // After the app comes back to the foreground: report the real state again.
              sync:function(){
                sent={};
                if(!api) return;
                if(joined){ send('joined'); readMedia(); refreshCameras(); syncStore(); }
                else if(everJoined) send('left');
              }
            };

            var script=document.createElement('script');
            script.src=${inlineJson(`${jitsi.origin}/external_api.js`)};
            // A phone outside the box's private network never loads the Jitsi script.
            var loaded=false;
            script.onerror=function(){ send('unreachable'); };
            setTimeout(function(){ if(!loaded) send('unreachable'); }, 15000);
            script.onload=function(){
              loaded=true;
              if(!window.JitsiMeetExternalAPI){ send('failed'); return; }
              var options=${inlineJson(mobileCallOptions(join))};
              options.parentNode=document.getElementById('meet');
              api=new window.JitsiMeetExternalAPI(${inlineJson(jitsi.host)}, options);
              api.getIFrame().addEventListener('load', decorate);
              // Rotation: the stage changes size, the video follows.
              window.addEventListener('resize', function(){ setTimeout(fitLarge, 50); });
              api.addEventListener('videoConferenceJoined', function(){
                joined=true;
                everJoined=true;
                decorate();
                send('joined');
                readMedia();
                refreshCameras();
                watchConference();
                syncStore();
              });
              api.addEventListener('videoConferenceLeft', function(){ joined=false; send('left'); });
              api.addEventListener('readyToClose', function(){ joined=false; send('left'); });
              api.addEventListener('participantJoined', function(event){
                if(event && event.id) send('participant-joined', {id:String(event.id)});
                scheduleSync();
              });
              api.addEventListener('participantLeft', function(event){
                if(event && event.id) send('participant-left', {id:String(event.id)});
                scheduleSync();
              });
              api.addEventListener('audioMuteStatusChanged', function(event){
                media.audioMuted=!!(event && event.muted);
                sendMedia();
              });
              api.addEventListener('videoMuteStatusChanged', function(event){
                media.videoMuted=!!(event && event.muted);
                sendMedia();
                scheduleSync();
              });
              api.addEventListener('audioAvailabilityChanged', function(event){
                send('availability', {kind:'microphone', available:!!(event && event.available)});
              });
              api.addEventListener('videoAvailabilityChanged', function(event){
                send('availability', {kind:'camera', available:!!(event && event.available)});
              });
              api.addEventListener('micError', function(event){
                send('device-error', {kind:'microphone', problem:deviceProblem(event)});
              });
              api.addEventListener('cameraError', function(event){
                send('device-error', {kind:'camera', problem:deviceProblem(event)});
              });
              api.addEventListener('errorOccurred', function(event){
                if(event && event.error && event.error.isFatal) send('failed');
              });
              api.addEventListener('deviceListChanged', function(event){ reportCameras(event && event.devices); refreshOutputs(); });
            };
            document.head.appendChild(script);
          })();
        </script>
      </body></html>`,
  };
}
