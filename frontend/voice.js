/*
 * VoiceChat — live team voice with the real microphone, peer to peer (WebRTC, audio only).
 *
 * The Socket.IO server only relays the signalling (offers / answers / ICE); the audio itself flows
 * directly between the players' browsers. Everyone who switches their mic on joins a small mesh
 * (fine for the ≤10 players of a room). The same microphone also drives the game: a real SHOUT
 * (loud for a moment) scares nearby ghosts in the haunted mansion, and the speaking indicator lights
 * up next to whoever is talking.
 */
const VoiceChat = (function () {
  'use strict';

  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

  let socket = null;
  let EV = null;
  let hooks = {};
  let stream = null;
  let active = false;
  let audioCtx = null;
  let localAnalyser = null;
  let localData = null;
  let timer = 0;
  let baseline = 0.015;
  let loudSince = 0;
  let lastShout = 0;
  const peers = new Map(); // playerId -> { pc, audio, analyser, data, pending }
  let speaking = new Set();
  let localLevel = 0;

  function init(sock, events, h) {
    socket = sock;
    EV = events;
    hooks = h || {};
    socket.on(EV.VOICE_PEERS, ({ peers: list }) => {
      if (!active) return;
      (list || []).forEach((id) => makePeer(id, true));
    });
    socket.on(EV.VOICE_JOINED, () => {
      /* the newcomer sends us an offer; nothing to do until it arrives */
    });
    socket.on(EV.VOICE_LEFT, ({ playerId }) => closePeer(playerId));
    socket.on(EV.VOICE_SIGNAL_IN, (msg) => onSignal(msg));
  }

  const send = (to, data) => socket && socket.emit(EV.VOICE_SIGNAL, { to, data });

  function rms(analyser, data) {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const x = (data[i] - 128) / 128;
      sum += x * x;
    }
    return Math.sqrt(sum / data.length);
  }

  function makeAnalyser(mediaStream) {
    const a = audioCtx.createAnalyser();
    a.fftSize = 512;
    audioCtx.createMediaStreamSource(mediaStream).connect(a);
    return { analyser: a, data: new Uint8Array(a.fftSize) };
  }

  function makePeer(id, initiator) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection(ICE);
    const rec = { pc, audio: null, analyser: null, data: null, pending: [] };
    peers.set(id, rec);
    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) send(id, { type: 'ice', candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const remote = e.streams[0];
      if (!remote || rec.audio) return;
      const a = new Audio();
      a.srcObject = remote;
      a.autoplay = true;
      a.play().catch(() => {});
      rec.audio = a;
      try {
        const an = makeAnalyser(remote);
        rec.analyser = an.analyser;
        rec.data = an.data;
      } catch (err) { /* level meter is optional */ }
    };
    pc.onconnectionstatechange = () => {
      hooks.peerState && hooks.peerState(id, pc.connectionState);
      if (pc.connectionState === 'failed') closePeer(id);
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send(id, { type: 'offer', sdp: pc.localDescription });
        } catch (err) {
          console.warn('voice offer failed', err);
        }
      };
    }
    return rec;
  }

  function closePeer(id) {
    const rec = peers.get(id);
    if (!rec) return;
    peers.delete(id);
    try { rec.pc.close(); } catch (e) { /* already closed */ }
    if (rec.audio) {
      rec.audio.srcObject = null;
      rec.audio = null;
    }
    if (speaking.delete(id)) hooks.speaking && hooks.speaking(new Set(speaking));
  }

  async function onSignal({ from, data }) {
    if (!active || !data) return;
    try {
      if (data.type === 'offer') {
        const rec = peers.get(from) || makePeer(from, false);
        await rec.pc.setRemoteDescription(data.sdp);
        while (rec.pending.length) await rec.pc.addIceCandidate(rec.pending.shift());
        const answer = await rec.pc.createAnswer();
        await rec.pc.setLocalDescription(answer);
        send(from, { type: 'answer', sdp: rec.pc.localDescription });
      } else if (data.type === 'answer') {
        const rec = peers.get(from);
        if (rec) {
          await rec.pc.setRemoteDescription(data.sdp);
          while (rec.pending.length) await rec.pc.addIceCandidate(rec.pending.shift());
        }
      } else if (data.type === 'ice') {
        const rec = peers.get(from);
        if (!rec) return;
        if (rec.pc.remoteDescription) await rec.pc.addIceCandidate(data.candidate);
        else rec.pending.push(data.candidate);
      }
    } catch (err) {
      console.warn('voice signal failed', err);
    }
  }

  function tick() {
    if (!active) return;
    localLevel = localAnalyser ? rms(localAnalyser, localData) : 0;
    baseline = baseline * 0.99 + Math.min(localLevel, 0.06) * 0.01;
    const now = performance.now();
    // a real shout: clearly louder than the room for a moment
    const threshold = Math.max(0.3, baseline * 9);
    if (localLevel > threshold) {
      if (!loudSince) loudSince = now;
      else if (now - loudSince > 200 && now - lastShout > 2500) {
        lastShout = now;
        hooks.shout && hooks.shout(localLevel);
      }
    } else loudSince = 0;
    // who is talking?
    const next = new Set();
    if (localLevel > Math.max(0.05, baseline * 3)) next.add('__me');
    peers.forEach((rec, id) => {
      if (rec.analyser && rms(rec.analyser, rec.data) > 0.03) next.add(id);
    });
    let changed = next.size !== speaking.size;
    if (!changed) next.forEach((id) => { if (!speaking.has(id)) changed = true; });
    if (changed) {
      speaking = next;
      hooks.speaking && hooks.speaking(new Set(speaking));
    }
    hooks.level && hooks.level(localLevel, threshold);
  }

  // opts.stream lets tests use a synthetic stream instead of the real microphone
  async function enable(opts) {
    if (active) return true;
    try {
      stream = (opts && opts.stream) || (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }));
    } catch (err) {
      hooks.error && hooks.error(err);
      return false;
    }
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const an = makeAnalyser(stream);
    localAnalyser = an.analyser;
    localData = an.data;
    active = true;
    timer = setInterval(tick, 80);
    socket.emit(EV.VOICE_JOIN);
    hooks.state && hooks.state(true);
    return true;
  }

  function disable() {
    if (!active) return;
    active = false;
    clearInterval(timer);
    peers.forEach((_, id) => closePeer(id));
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    localAnalyser = null;
    speaking = new Set();
    socket.emit(EV.VOICE_LEAVE);
    hooks.speaking && hooks.speaking(new Set());
    hooks.state && hooks.state(false);
  }

  return {
    init,
    enable,
    disable,
    get active() { return active; },
    get level() { return localLevel; },
    get peerIds() { return [...peers.keys()]; },
    peerLevels() {
      const out = {};
      peers.forEach((rec, id) => (out[id] = rec.analyser ? +rms(rec.analyser, rec.data).toFixed(3) : -1));
      return out;
    },
    peerStates() {
      const out = {};
      peers.forEach((rec, id) => (out[id] = rec.pc.connectionState));
      return out;
    },
  };
})();
