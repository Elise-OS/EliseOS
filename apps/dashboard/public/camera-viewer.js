// A static page outside the dashboard bundle: its few texts live here, in the dashboard's
// languages, and follow the language chosen in the dashboard (same origin) or the browser's.
const TEXTS = {
  fr: {
    title: 'Direct caméra Élise',
    connecting: 'Connexion locale…',
    invalid: 'Session invalide',
    live: 'En direct',
    liveTalk: 'En direct · micro actif',
    interrupted: 'Flux interrompu',
    noCamera: 'Caméra indisponible',
    noMicrophone: 'Micro ou interphone indisponible',
  },
  en: {
    title: 'Élise live camera',
    connecting: 'Connecting locally…',
    invalid: 'Invalid session',
    live: 'Live',
    liveTalk: 'Live · microphone on',
    interrupted: 'Stream interrupted',
    noCamera: 'Camera unavailable',
    noMicrophone: 'Microphone or intercom unavailable',
  },
  es: {
    title: 'Cámara en directo Élise',
    connecting: 'Conexión local…',
    invalid: 'Sesión no válida',
    live: 'En directo',
    liveTalk: 'En directo · micrófono activo',
    interrupted: 'Imagen interrumpida',
    noCamera: 'Cámara no disponible',
    noMicrophone: 'Micrófono o interfono no disponible',
  },
  it: {
    title: 'Telecamera in diretta Élise',
    connecting: 'Connessione locale…',
    invalid: 'Sessione non valida',
    live: 'In diretta',
    liveTalk: 'In diretta · microfono attivo',
    interrupted: 'Immagine interrotta',
    noCamera: 'Telecamera non disponibile',
    noMicrophone: 'Microfono o citofono non disponibile',
  },
};
const savedLanguage = () => {
  try {
    return localStorage.getItem('elise_locale');
  } catch {
    return null;
  }
};
const language = [
  new URLSearchParams(location.search).get('lang'),
  savedLanguage(),
  navigator.language.slice(0, 2),
  'fr',
].find((code) => code && code in TEXTS);
const text = TEXTS[language];

const params = new URLSearchParams(location.search);
const source = params.get('src');
const ticket = params.get('ticket');
const talk = params.get('talk') === '1';
const video = document.getElementById('camera');
const state = document.getElementById('state');
const label = state.querySelector('span');
document.documentElement.lang = language;
document.title = text.title;
label.textContent = text.connecting;

const fail = (message) => {
  state.className = 'error';
  label.textContent = message;
};

const waitForIce = (peer) =>
  peer.iceGatheringState === 'complete'
    ? Promise.resolve()
    : new Promise((resolve) => {
        const changed = () => {
          if (peer.iceGatheringState === 'complete') {
            peer.removeEventListener('icegatheringstatechange', changed);
            resolve();
          }
        };
        peer.addEventListener('icegatheringstatechange', changed);
        setTimeout(resolve, 2500);
      });

async function connect() {
  if (!source || !ticket) return fail(text.invalid);
  const peer = new RTCPeerConnection();
  const remote = new MediaStream();
  video.srcObject = remote;
  peer.ontrack = (event) => remote.addTrack(event.track);
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      state.className = 'connected';
      label.textContent = talk ? text.liveTalk : text.live;
    } else if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
      fail(text.interrupted);
    }
  };
  peer.addTransceiver('video', { direction: 'recvonly' });
  if (talk) {
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    const track = microphone.getAudioTracks()[0];
    if (track) peer.addTransceiver(track, { direction: 'sendrecv', streams: [microphone] });
  } else {
    peer.addTransceiver('audio', { direction: 'recvonly' });
  }
  await peer.setLocalDescription(await peer.createOffer());
  await waitForIce(peer);
  const query = new URLSearchParams({ src: source, ticket, talk: talk ? '1' : '0' });
  const response = await fetch(`/camera-media/api/webrtc?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: peer.localDescription.sdp,
  });
  if (!response.ok) throw new Error(`media ${response.status}`);
  await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  await video.play().catch(() => undefined);
  addEventListener('pagehide', () => peer.close(), { once: true });
}

connect().catch(() => fail(talk ? text.noMicrophone : text.noCamera));
