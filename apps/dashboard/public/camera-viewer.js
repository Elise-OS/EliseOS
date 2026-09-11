const params = new URLSearchParams(location.search);
const source = params.get('src');
const ticket = params.get('ticket');
const talk = params.get('talk') === '1';
const video = document.getElementById('camera');
const state = document.getElementById('state');
const label = state.querySelector('span');

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
  if (!source || !ticket) return fail('Session invalide');
  const peer = new RTCPeerConnection();
  const remote = new MediaStream();
  video.srcObject = remote;
  peer.ontrack = (event) => remote.addTrack(event.track);
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      state.className = 'connected';
      label.textContent = talk ? 'En direct · micro actif' : 'En direct';
    } else if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
      fail('Flux interrompu');
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

connect().catch(() => fail(talk ? 'Micro ou interphone indisponible' : 'Caméra indisponible'));
