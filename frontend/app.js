(function () {
  const SESSION_KEY = 'cityChaosSession';
  const TIER_KEY = 'cityChaosBotTier';
  const MODE_KEY = 'cityChaosMode';
  const MAX_PLAYERS = 10;
  const QUICK_BOTS = 3;

  const el = (id) => document.getElementById(id);

  const refs = {
    toast: el('toast'),
    feed: el('feed'),
    muteBtn: el('muteBtn'),
    backBtn: el('backBtn'),
    nameInput: el('nameInput'),
    avatarPicker: el('avatarPicker'),
    quickBtn: el('quickBtn'),
    quickRoyaleBtn: el('quickRoyaleBtn'),
    modeControls: el('modeControls'),
    modePills: el('modePills'),
    modeHint: el('modeHint'),
    brHud: el('brHud'),
    brAlive: el('brAlive'),
    brKills: el('brKills'),
    brZone: el('brZone'),
    specBanner: el('specBanner'),
    wastedTitle: el('wastedTitle'),
    adsBtn: el('adsBtn'),
    reloadBtn: el('reloadBtn'),
    createBtn: el('createBtn'),
    joinCodeInput: el('joinCodeInput'),
    joinBtn: el('joinBtn'),

    countdownOverlay: el('countdownOverlay'),
    cdReady: el('cdReady'),
    cdNum: el('cdNum'),
    cdSquad: el('cdSquad'),

    lobbyCode: el('lobbyCode'),
    copyCodeBtn: el('copyCodeBtn'),
    lobbyQr: el('lobbyQr'),
    squadCount: el('squadCount'),
    lobbyPlayers: el('lobbyPlayers'),
    botControls: el('botControls'),
    botTierPills: el('botTierPills'),
    addBotBtn: el('addBotBtn'),
    soloHint: el('soloHint'),
    startBtn: el('startBtn'),
    lobbyWaitingMsg: el('lobbyWaitingMsg'),
    lobbyNeedMoreMsg: el('lobbyNeedMoreMsg'),

    finalTitle: el('finalTitle'),
    finalSub: el('finalSub'),
    podium: el('podium'),
    awards: el('awards'),
    finalPlayers: el('finalPlayers'),
    playAgainBtn: el('playAgainBtn'),
    finalWaitingMsg: el('finalWaitingMsg'),

    cityCanvas: el('cityCanvas'),
    miniMap: el('miniMap'),
    joy: el('joy'),
    joyKnob: el('joyKnob'),
    cityMission: el('cityMission'),
    cityBoard: el('cityBoard'),
    cityTimer: el('cityTimer'),
    cityWanted: el('cityWanted'),
    cityBladder: el('cityBladder'),
    cbFace: el('cbFace'),
    cbFill: el('cbFill'),
    cbPct: el('cbPct'),
    cityGps: el('cityGps'),
    gpsArrow: el('gpsArrow'),
    gpsDist: el('gpsDist'),
    holdWrap: el('holdWrap'),
    holdLabel: el('holdLabel'),
    holdFill: el('holdFill'),
    hpFill: el('hpFill'),
    hpNum: el('hpNum'),
    arFill: el('arFill'),
    arNum: el('arNum'),
    cashNum: el('cashNum'),
    weaponChip: el('weaponChip'),
    hurtFlash: el('hurtFlash'),
    wasted: el('wasted'),
    wastedSub: el('wastedSub'),
    cityHint: el('cityHint'),
    micBtnCity: el('micBtnCity'),
    weaponBtn: el('weaponBtn'),
    useBtn: el('useBtn'),
    fireBtn: el('fireBtn'),

    mazeCanvas: el('mazeCanvas'),
    mazeMini: el('mazeMini'),
    mazeJoy: el('mazeJoy'),
    mazeKnob: el('mazeKnob'),
    mazeObj: el('mazeObj'),
    mazeBoard: el('mazeBoard'),
    mazeTimer: el('mazeTimer'),
    bladder: el('bladder'),
    blFace: el('blFace'),
    blFill: el('blFill'),
    blPct: el('blPct'),
    mhpFill: el('mhpFill'),
    mhpNum: el('mhpNum'),
    mcashNum: el('mcashNum'),
    mazeHurt: el('mazeHurt'),
    micBtnMaze: el('micBtnMaze'),
    mazeHint: el('mazeHint'),
    flashBtn: el('flashBtn'),
    mazeFireBtn: el('mazeFireBtn'),
    viewMaze: el('view-maze'),

    leaveModal: el('leaveModal'),
    leaveTitle: el('leaveTitle'),
    leaveDesc: el('leaveDesc'),
    leaveConfirmBtn: el('leaveConfirmBtn'),
    leaveStayBtn: el('leaveStayBtn'),
    howToPlayBtn: el('howToPlayBtn'),
    howToPlayModal: el('howToPlayModal'),
    closeHowToPlay: el('closeHowToPlay'),
    hallOfFameBtn: el('hallOfFameBtn'),
    hallOfFameModal: el('hallOfFameModal'),
    closeHallOfFame: el('closeHallOfFame'),
    periodPills: el('periodPills'),
    hallOfFameList: el('hallOfFameList'),
    hallOfFameEmpty: el('hallOfFameEmpty'),
    hallOfFameUnavailable: el('hallOfFameUnavailable'),
  };

  const WEAPON_LABEL = ['🥊 Fists', '🏏 Bat', '🔫 Pistol', '🔫 SMG', '🔫 Shotgun', '🔫 Assault Rifle', '🎯 Sniper'];
  const WEAPON_ICON = ['👊', '🏏', '🔫', '🔫', '🔫', '🔫', '🎯'];

  let mySession = { playerId: null, roomCode: null, name: null, isCreator: false };
  let selectedAvatar = null;
  let players = [];
  let activeView = 'home';
  let historyArmed = false;
  let toastTimer = null;
  let countdownTimer = null;
  let quickPending = false;
  let quickMode = 'city';
  let quickBotsWanted = 3;
  let selectedMode = safeGetEarly(MODE_KEY) === 'royale' ? 'royale' : 'city';
  let matchMode = 'city';
  let wakeLock = null;
  let lbPeriod = 'all';

  // the match
  let cityInfo = null;
  let cityOffset = 0;
  let cityMeIdx = -1;
  let lastSnap = null;
  let myWorld = 0;
  let mazeMounted = false;
  let speakingIds = new Set();
  let flashCooling = false;
  let lastBladder = 0;
  let lastFace = '';
  const prev = { dead: false, hp: 100, hurt: false, world: 0, wanted: 0, siren: 0, heart: 0, key: '', storm: 0 };

  function safeGetEarly(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage blocked (private mode) */ }
  }

  // sessionStorage (not localStorage): reconnect-on-refresh should be per-tab.
  function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(mySession)); } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    mySession = { playerId: null, roomCode: null, name: null, isCreator: false };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.add('hidden'), 4200);
  }

  function pushFeed(html) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = html;
    refs.feed.appendChild(item);
    while (refs.feed.children.length > 5) refs.feed.removeChild(refs.feed.firstChild);
    setTimeout(() => item.remove(), 4200);
  }

  function vibrate(pattern) {
    // Browsers block vibration until the user has tapped the page once.
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern);
  }

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (activeView === 'city' || activeView === 'maze')) acquireWakeLock();
  });

  function updateTopbarHeight() {
    const tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
  }
  updateTopbarHeight();
  window.addEventListener('resize', updateTopbarHeight);

  function showView(id) {
    activeView = id;
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    el('view-' + id).classList.remove('hidden');
    window.scrollTo(0, 0);
    document.body.classList.toggle('in-city', id === 'city' || id === 'maze');
    if (id !== 'city' && City.running) City.stop();
    if (id === 'home' || id === 'lobby' || id === 'final') SoundFX.rain(false);
    if (id !== 'maze' && mazeMounted && Maze3D.running) Maze3D.stop();
    if (id === 'home' && VoiceChat.active) VoiceChat.disable();
    if (id === 'city' || id === 'maze') acquireWakeLock();
    refs.backBtn.classList.toggle('hidden', id === 'home');
    if (id !== 'home' && !historyArmed) {
      historyArmed = true;
      try { history.pushState({ chaos: 1 }, ''); } catch (e) { /* ignore */ }
    }
    if (id === 'home') historyArmed = false;
    updateTopbarHeight();
  }

  function me() {
    return players.find((p) => p.playerId === mySession.playerId) || null;
  }
  function amHost() {
    const m = me();
    return !!(m && m.isCreator);
  }

  // ---- Meta (avatars + bot tiers) ----
  let AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐨', '🐙', '🦉', '🐢', '🐷', '🦁'];
  let BOT_TIERS = [
    { key: 'rookie', label: 'Rookie', emoji: '🍬' },
    { key: 'veteran', label: 'Veteran', emoji: '⚔️' },
    { key: 'elite', label: 'Elite', emoji: '🔥' },
    { key: 'legend', label: 'Legend', emoji: '👑' },
  ];
  let selectedTier = safeGet(TIER_KEY) || 'elite';

  function renderBotTierPills() {
    refs.botTierPills.innerHTML = '';
    if (!BOT_TIERS.some((t) => t.key === selectedTier)) selectedTier = 'elite';
    BOT_TIERS.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tier-pill' + (t.key === selectedTier ? ' active' : '');
      btn.innerHTML = `<span class="tier-emoji">${t.emoji}</span><span>${escapeHtml(t.label)}</span>`;
      btn.onclick = () => {
        SoundFX.click();
        selectedTier = t.key;
        safeSet(TIER_KEY, t.key);
        renderBotTierPills();
      };
      refs.botTierPills.appendChild(btn);
    });
  }

  function renderAvatarPicker() {
    refs.avatarPicker.innerHTML = '';
    AVATARS.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-option' + (a === selectedAvatar ? ' selected' : '');
      btn.textContent = a;
      btn.setAttribute('aria-label', `Avatar ${a}`);
      btn.onclick = () => {
        selectedAvatar = a;
        SoundFX.click();
        renderAvatarPicker();
      };
      refs.avatarPicker.appendChild(btn);
    });
  }

  fetch('/api/meta')
    .then((r) => r.json())
    .then((meta) => {
      if (Array.isArray(meta.avatars) && meta.avatars.length) AVATARS = meta.avatars;
      if (Array.isArray(meta.botTiers) && meta.botTiers.length) BOT_TIERS = meta.botTiers;
      const saved = loadSession();
      selectedAvatar = (saved && saved.avatar) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
      renderAvatarPicker();
      renderBotTierPills();
    })
    .catch(() => {
      selectedAvatar = AVATARS[0];
      renderAvatarPicker();
      renderBotTierPills();
    });

  // ---- Player lists ----
  const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

  function renderPlayerRows(container, list, showScore, allowBotRemove) {
    container.innerHTML = '';
    list.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.connected ? '' : ' disconnected');
      row.style.animationDelay = `${Math.min(i, 8) * 40}ms`;

      const identity = document.createElement('div');
      identity.className = 'pidentity';
      const avatar = document.createElement('span');
      avatar.className = 'pavatar';
      avatar.textContent = p.avatar || '🙂';
      identity.appendChild(avatar);

      const left = document.createElement('div');
      left.className = 'pname';
      left.appendChild(document.createTextNode(p.name));
      if (p.playerId === mySession.playerId) {
        const tag = document.createElement('span');
        tag.className = 'you-tag';
        tag.textContent = '(you)';
        left.appendChild(tag);
      }
      if (p.isCreator) {
        const tag = document.createElement('span');
        tag.className = 'host-tag';
        tag.textContent = '👑 host';
        left.appendChild(tag);
      }
      if (p.isBot && p.botTier) {
        const tag = document.createElement('span');
        tag.className = 'tier-badge';
        tag.textContent = p.botTier;
        left.appendChild(tag);
      }
      identity.appendChild(left);
      row.appendChild(identity);

      if (showScore) {
        const right = document.createElement('div');
        right.className = 'pscore';
        right.textContent = money(p.score);
        row.appendChild(right);
      }
      if (allowBotRemove && p.isBot && amHost()) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'bot-remove-btn';
        removeBtn.setAttribute('aria-label', `Remove ${p.name}`);
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
          SoundFX.click();
          socket.emit(EVENTS.BOT_REMOVE, { playerId: p.playerId });
        };
        row.appendChild(removeBtn);
      }
      container.appendChild(row);
    });
  }

  const MODES = [
    { key: 'city', label: 'City Chaos', emoji: '🌆', hint: 'Free-roam GTA-style brawl: missions, cars, cops, the haunted mansion and your bladder. Most cash in 8 minutes wins.' },
    { key: 'royale', label: 'City Royale', emoji: '🪂', hint: 'Battle Royale: parachute in, loot guns, stay inside the shrinking storm circle. Last one standing wins.' },
  ];
  function renderModePills() {
    refs.modePills.innerHTML = '';
    MODES.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tier-pill' + (m.key === selectedMode ? ' active' : '');
      btn.innerHTML = `<span class="tier-emoji">${m.emoji}</span><span>${escapeHtml(m.label)}</span>`;
      btn.onclick = () => {
        SoundFX.click();
        selectedMode = m.key;
        safeSet(MODE_KEY, m.key);
        renderModePills();
      };
      refs.modePills.appendChild(btn);
    });
    refs.modeHint.textContent = (MODES.find((m) => m.key === selectedMode) || MODES[0]).hint;
  }

  function renderLobbyControls() {
    refs.modeControls.classList.toggle('hidden', !amHost());
    if (amHost()) renderModePills();
    refs.lobbyCode.textContent = mySession.roomCode || '----';
    refs.squadCount.textContent = `${players.length}/${MAX_PLAYERS}`;
    const connectedCount = players.filter((p) => p.connected).length;
    if (amHost()) {
      refs.botControls.classList.remove('hidden');
      refs.startBtn.classList.remove('hidden');
      refs.startBtn.disabled = connectedCount < 2;
      refs.lobbyWaitingMsg.classList.add('hidden');
      refs.lobbyNeedMoreMsg.classList.toggle('hidden', connectedCount >= 2);
      refs.soloHint.classList.toggle('hidden', players.length >= 2);
    } else {
      refs.botControls.classList.add('hidden');
      refs.startBtn.classList.add('hidden');
      refs.lobbyWaitingMsg.classList.remove('hidden');
      refs.lobbyNeedMoreMsg.classList.add('hidden');
    }
  }

  function renderLobbyQr(roomCode) {
    refs.lobbyQr.innerHTML = '';
    if (typeof qrcode === 'undefined' || !roomCode) return;
    try {
      const url = `${location.origin}${location.pathname}?join=${roomCode}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      refs.lobbyQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    } catch (e) {
      // QR generation is a nice-to-have; join-by-code still works without it.
    }
  }

  function showLobby() {
    showView('lobby');
    renderLobbyQr(mySession.roomCode);
    renderPlayerRows(refs.lobbyPlayers, players, false, true);
    renderBotTierPills();
    renderLobbyControls();
  }

  // ---- Countdown ----
  function hideCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    refs.countdownOverlay.classList.add('hidden');
  }

  function replayAnimation(node) {
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }

  function runCountdown(startsAt, serverNow) {
    clearInterval(countdownTimer);
    const offset = serverNow - Date.now();
    if (startsAt - (Date.now() + offset) < 300) return;
    refs.cdReady.textContent = matchMode === 'royale' ? 'Get ready to drop' : 'Get ready';
    refs.cdSquad.innerHTML = '';
    refs.countdownOverlay.classList.remove('hidden');
    let shown = null;
    function update() {
      const remaining = startsAt - (Date.now() + offset);
      const label = remaining > 2400 ? '3' : remaining > 1400 ? '2' : remaining > 400 ? '1' : 'GO';
      if (label !== shown) {
        shown = label;
        const isGo = label === 'GO';
        refs.cdNum.textContent = isGo ? 'GO!' : label;
        refs.cdNum.classList.toggle('go', isGo);
        replayAnimation(refs.cdNum);
        if (isGo) {
          SoundFX.go();
          Engine.flash('rgba(255,255,255,0.35)');
        } else {
          SoundFX.count();
          vibrate(20);
        }
      }
      if (remaining < -1200) hideCountdown();
    }
    update();
    countdownTimer = setInterval(update, 80);
  }

  // ---- Final ----
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function updateFinalControls() {
    refs.playAgainBtn.classList.toggle('hidden', !amHost());
    refs.finalWaitingMsg.classList.toggle('hidden', amHost());
  }

  function renderAwards(awards) {
    refs.awards.innerHTML = '';
    if (!awards || !awards.length) {
      refs.awards.classList.add('hidden');
      return;
    }
    awards.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'award' + (a.playerId === mySession.playerId ? ' mine' : '');
      card.style.animationDelay = `${1.0 + i * 0.18}s`;
      card.innerHTML = `<span class="award-ico">${a.icon}</span><span class="award-txt"><b>${escapeHtml(a.title)}</b><small>${escapeHtml(a.name)} · ${escapeHtml(a.detail)}</small></span>`;
      refs.awards.appendChild(card);
    });
    refs.awards.classList.remove('hidden');
  }

  function renderFinal(data) {
    refs.podium.innerHTML = '';
    renderAwards(data.awards);
    (data.podium || []).forEach((p, i) => {
      const slot = document.createElement('div');
      slot.className = `podium-slot rank-${i + 1}`;
      slot.innerHTML =
        `<div class="medal">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>` +
        `<div class="pavatar">${escapeHtml(p.avatar || '')}</div>` +
        `<div class="pname">${escapeHtml(p.name)}</div>` +
        `<div class="pscore">${money(p.score)}</div>`;
      refs.podium.appendChild(slot);
    });
    renderPlayerRows(refs.finalPlayers, data.leaderboard, true);

    const board = data.leaderboard;
    const myIndex = board.findIndex((p) => p.playerId === mySession.playerId);
    const won = myIndex === 0;
    if (data.mode === 'royale') {
      const st = data.stats && data.stats[mySession.playerId];
      const place = st ? st.place : myIndex + 1;
      refs.finalTitle.textContent = place === 1 ? '🏆 WINNER WINNER!' : `#${place} of ${data.total || board.length}`;
      replayAnimation(refs.finalTitle);
      refs.finalSub.textContent = st ? `You placed #${place} with ${st.kills} elimination${st.kills === 1 ? '' : 's'} and ${st.damage} damage. ${board[0].name} won the match.` : '';
      updateFinalControls();
      return;
    }
    refs.finalTitle.textContent = won ? '👑 King of the City!' : 'Final Results';
    replayAnimation(refs.finalTitle);
    const st = data.stats && data.stats[mySession.playerId];
    const extra = st ? ` · ☠ ${st.kills} takedown${st.kills === 1 ? '' : 's'} · 💀 ${st.deaths} death${st.deaths === 1 ? '' : 's'} · 🎯 ${st.missions}/${data.total || 4} missions${st.accidents ? ` · 💩 ${st.accidents} accident${st.accidents === 1 ? '' : 's'}` : ''}` : '';
    if (myIndex >= 0) {
      const myScore = board[myIndex].score;
      refs.finalSub.textContent = (won
        ? `You finished first with ${money(myScore)}!`
        : `You finished ${ordinal(myIndex + 1)} with ${money(myScore)} — ${board[0].name} took the crown with ${money(board[0].score)}.`) + extra;
    } else refs.finalSub.textContent = '';
    updateFinalControls();
  }

  function applyRoomState(roomState) {
    players = roomState.players;
    hideCountdown();
    if (roomState.state === 'lobby') {
      showLobby();
    } else if (roomState.state === 'city' && roomState.city) {
      startCityView(roomState.city);
    } else if (roomState.state === 'final' && roomState.final) {
      showView('final');
      renderFinal(roomState.final);
    } else {
      showLobby();
    }
  }

  // ---- Socket setup ----
  const socket = io();

  socket.on('connect', () => {
    const s = loadSession();
    if (s && s.roomCode && s.playerId && s.name) {
      mySession = s;
      socket.emit(EVENTS.ROOM_JOIN, { roomCode: s.roomCode, name: s.name, playerId: s.playerId, avatar: s.avatar });
    }
  });

  socket.on(EVENTS.ROOM_JOINED, (data) => {
    mySession = {
      playerId: data.playerId,
      roomCode: data.roomCode,
      name: mySession.name || refs.nameInput.value.trim(),
      avatar: mySession.avatar || selectedAvatar,
      isCreator: data.isCreator,
    };
    saveSession();
    applyRoomState(data.roomState);
    if (quickPending && data.isCreator) {
      const tiers = [selectedTier, 'veteran', 'rookie', 'elite', 'veteran', 'legend', 'rookie', 'elite', 'veteran'];
      for (let i = 0; i < quickBotsWanted; i++) socket.emit(EVENTS.BOT_ADD, { difficulty: tiers[i % tiers.length] });
    }
  });

  socket.on(EVENTS.ROOM_ERROR, ({ code, message }) => {
    quickPending = false;
    showToast(message || 'Something went wrong.');
    SoundFX.wrong && SoundFX.wrong();
    Engine.shake(refs.toast);
    if (code === 'ROOM_NOT_FOUND') {
      clearSession();
      showView('home');
    }
  });

  socket.on(EVENTS.PLAYER_LIST_UPDATE, ({ players: p }) => {
    players = p;
    if (quickPending && players.filter((x) => x.isBot).length >= quickBotsWanted && activeView === 'lobby') {
      quickPending = false;
      socket.emit(EVENTS.GAME_START, { mode: quickMode });
    }
    if (activeView === 'lobby') {
      renderPlayerRows(refs.lobbyPlayers, players, false, true);
      renderLobbyControls();
    } else if (activeView === 'final') {
      renderPlayerRows(refs.finalPlayers, players, true);
      updateFinalControls();
    }
  });

  socket.on(EVENTS.GAME_FINAL, (data) => {
    players = data.leaderboard;
    hideCountdown();
    if (VoiceChat.active) VoiceChat.disable();
    refreshMicButtons();
    showView('final');
    renderFinal(data);
    SoundFX.win();
    vibrate([40, 60, 40, 60, 80]);
    Engine.celebrate();
    Engine.flash('rgba(255,255,255,0.4)');
  });

  socket.on(EVENTS.GAME_RESET_TO_LOBBY, ({ players: p }) => {
    players = p;
    showLobby();
  });

  // ---- The match: the open city and the haunted mansion ----
  socket.on(EVENTS.CITY_START, (payload) => startCityView(payload));

  socket.on(EVENTS.CITY_STATE, (snap) => {
    if (activeView !== 'city' && activeView !== 'maze') return;
    lastSnap = snap;
    const w = worldOf(snap);
    if (w !== myWorld) switchWorld(w);
    City.applyState(snap); // also feeds the HUD through the onState hook
    if (mazeMounted) Maze3D.applyState(toMazeSnap(snap));
  });

  socket.on(EVENTS.CITY_FX, (e) => {
    if (activeView !== 'city' && activeView !== 'maze') return;
    City.fx(e);
    if (mazeMounted) Maze3D.fx(e);
    combatSound(e);
  });

  socket.on(EVENTS.CITY_FEED, ({ text }) => {
    if (activeView === 'city' || activeView === 'maze') pushFeed(escapeHtml(text));
  });

  socket.on(EVENTS.BOT_SAY, ({ playerId, text }) => {
    if (activeView === 'city') City.say(playerId, text);
    else if (activeView === 'maze' && mazeMounted) Maze3D.say(playerId, text);
  });

  const worldOf = (snap) => {
    const m = snap.p.find((e) => e[0] === cityMeIdx);
    return m ? m[11] || 0 : 0;
  };
  // the mansion renderer only shows the people who are inside it
  function toMazeSnap(snap) {
    const mine = snap.p.find((e) => e[0] === cityMeIdx) || [];
    const mask = mine[12] || 0;
    const open = [];
    if (mask & 1) open.push('A');
    if (mask & 2) open.push('B');
    if (mask & 4) open.push('C');
    return {
      t: snap.t,
      p: snap.p.map((e) => (e[11] === 0 ? [e[0], e[1], e[2], e[3], e[4] | 64, ...e.slice(5)] : e)),
      g: snap.g || [],
      b: mine[10] || 0,
      open,
      done: snap.p.filter((e) => e[4] & 32).length,
    };
  }

  function fmtClock(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // A compass arrow to the current target when it is off-screen, like a GPS.
  function updateGps(target, screen, meWorld) {
    if (!target || activeView !== 'city') {
      refs.cityGps.classList.add('hidden');
      return;
    }
    const w = refs.cityCanvas.clientWidth;
    const h = refs.cityCanvas.clientHeight;
    const margin = 44;
    const dist = Math.round(Math.hypot(target.door.x - meWorld.x, target.door.y - meWorld.y) / 10);
    const onScreen = screen.x > margin && screen.x < w - margin && screen.y > margin && screen.y < h - margin;
    if (onScreen) {
      refs.cityGps.classList.add('hidden');
      return;
    }
    const cx = w / 2;
    const cy = h / 2;
    const ang = Math.atan2(screen.y - cy, screen.x - cx);
    const k = Math.min((w / 2 - margin) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - margin - 40) / Math.abs(Math.sin(ang) || 1e-6));
    refs.cityGps.style.left = `${cx + Math.cos(ang) * k}px`;
    refs.cityGps.style.top = `${cy + Math.sin(ang) * k}px`;
    refs.gpsArrow.style.transform = `rotate(${ang}rad)`;
    refs.gpsDist.textContent = `${dist} m`;
    refs.cityGps.classList.remove('hidden');
  }

  function boardHtml(snap) {
    const total = cityInfo.missions.length;
    if (matchMode === 'royale') {
      return snap.p
        .filter((e) => !(e[4] & 64))
        .slice()
        .sort((a, b) => (a[4] & 2048) - (b[4] & 2048) || b[6] - a[6])
        .slice(0, 5)
        .map((e) => {
          const info = cityInfo.players[e[0]];
          const out = e[4] & 2048;
          const talk = speakingIds.has(info.playerId) || (e[0] === cityMeIdx && speakingIds.has('__me')) ? ' 🎙️' : '';
          return `<div class="cb-row${e[0] === cityMeIdx ? ' me' : ''}${out ? ' done' : ''}">${escapeHtml(info.avatar)} ${escapeHtml(info.name.slice(0, 9))}${talk} <b>${out ? '💀' : '❤️' + e[8]}</b> ☠${e[6]}</div>`;
        })
        .join('');
    }
    return snap.p
      .filter((e) => !(e[4] & 64))
      .slice()
      .sort((a, b) => b[6] - a[6])
      .slice(0, 5)
      .map((e) => {
        const info = cityInfo.players[e[0]];
        const done = e[4] & 32;
        const talk = speakingIds.has(info.playerId) || (e[0] === cityMeIdx && speakingIds.has('__me')) ? ' 🎙️' : '';
        const where = e[11] === 1 ? '🏚️' : e[4] & 2048 ? '💀' : '';
        return `<div class="cb-row${e[0] === cityMeIdx ? ' me' : ''}${done ? ' done' : ''}">${escapeHtml(info.avatar)} ${escapeHtml(info.name.slice(0, 9))}${talk} <b>${done ? '🏁' : `${where}${e[5]}/${total}`}</b> ${money(e[6])}</div>`;
      })
      .join('');
  }

  function bladderFace(p) {
    return p < 25 ? '😌' : p < 50 ? '🙂' : p < 70 ? '😬' : p < 85 ? '😖' : p < 95 ? '😱' : '💦';
  }

  // the player's own noises as the pressure rises
  const CUES = [[52, 'strain'], [68, 'panic'], [82, 'strain'], [92, 'panic']];
  function bladderCues(pct) {
    if (pct < lastBladder - 25) lastBladder = pct; // relief: start over
    for (const [level, kind] of CUES) {
      if (lastBladder < level && pct >= level) {
        SoundFX.voice(kind, 0.95);
        if (level >= 82) SoundFX.tummy(0.8);
      }
    }
    lastBladder = pct;
  }

  function setBladder(pct) {
    const p = Math.max(0, Math.min(100, pct));
    const face = bladderFace(p);
    for (const [f, fill, num, box] of [
      [refs.cbFace, refs.cbFill, refs.cbPct, refs.cityBladder],
      [refs.blFace, refs.blFill, refs.blPct, refs.bladder],
    ]) {
      fill.style.width = `${p}%`;
      num.textContent = `${Math.round(p)}%`;
      if (face !== lastFace) f.textContent = face;
      box.classList.toggle('warn', p >= 55 && p < 80);
      box.classList.toggle('panic', p >= 80);
    }
    lastFace = face;
    if (p >= 80 && !setBladder.warned) {
      setBladder.warned = true;
      SoundFX.siren();
    }
    if (p < 70) setBladder.warned = false;
    bladderCues(p);
  }

  const setBar = (fill, num, v) => {
    fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
    num.textContent = Math.round(v);
  };

  // everything on the HUD comes from my row of the snapshot (City.me) plus the leaderboard
  function updateHud(m, snap) {
    if (!cityInfo || !snap) return;
    const total = cityInfo.missions.length;
    const inMansion = m.world === 1;
    const dead = !!(m.flags & 2048);
    const hurt = !!(m.flags & 8192);
    const now = Date.now() + cityOffset;

    if (matchMode === 'royale') refs.cityMission.innerHTML = royaleMissionText(m, snap, now);
    // mission text
    const mission = cityInfo.missions[m.mission];
    const wcHint = m.bladder >= 55 && !inMansion ? '<small class="wc-hint">🚽 Desperate? Hold still at a blue public toilet stall on a street corner!</small>' : '';
    if (matchMode !== 'royale') refs.cityMission.innerHTML = mission
      ? `MISSION ${m.mission + 1}/${total} · ${mission.icon} ${escapeHtml(mission.name)}<small>${escapeHtml(mission.line)} — hold still in the ring</small>${wcHint}`
      : `🏁 All missions done!<small>Grab cash, fight rivals — most money when the clock stops wins</small>${wcHint}`;
    const keyChips = ['A', 'B', 'C'].map((L, i) => {
      const got = m.keys & (1 << i);
      return `<span class="${got ? 'got' : ''}">${got ? '🔓 ' + L + ' ✓' : '🔑 ' + L.toLowerCase()}</span>`;
    });
    const keyHtml = matchMode === 'royale' ? '' : `<div>🏚️ Haunted Mansion — find the 🚽 exit!</div><small>Touch each key (+$300) · ghosts add to your bladder · F = flashlight · shout to scare them</small><div class="maze-keys">${keyChips.join('')}</div>`;
    if (keyHtml !== prev.key) {
      prev.key = keyHtml;
      refs.mazeObj.innerHTML = keyHtml;
    }

    // vitals
    setBar(refs.hpFill, refs.hpNum, m.hp);
    setBar(refs.arFill, refs.arNum, m.armor);
    refs.mhpFill.style.width = `${Math.max(0, m.hp)}%`;
    refs.mhpNum.textContent = Math.round(m.hp);
    refs.hpFill.parentNode.classList.toggle('low', m.hp < 30 && !dead);
    refs.cashNum.textContent = money(m.cash);
    refs.mcashNum.textContent = money(m.cash);
    refs.weaponChip.textContent = `${WEAPON_LABEL[m.weapon] || '🥊 Fists'}${m.ammo >= 0 ? (m.reloading ? ' · ↻ reloading…' : ` · ${Math.max(0, m.mag)} / ${Math.max(0, m.ammo - Math.max(0, m.mag))}`) : ''}`;
    refs.reloadBtn.classList.toggle('on', !!m.reloading);
    refs.fireBtn.textContent = WEAPON_ICON[m.weapon] || '👊';
    refs.mazeFireBtn.textContent = WEAPON_ICON[m.weapon] || '👊';

    // wanted
    const wantedHtml = m.wanted > 0 ? '⭐'.repeat(m.wanted) + '<span class="dim">' + '☆'.repeat(Math.max(0, 5 - m.wanted)) + '</span>' : '';
    refs.cityWanted.innerHTML = wantedHtml;
    refs.cityWanted.classList.toggle('on', m.wanted > 0);
    if (m.wanted > 0 && !inMansion && now - prev.siren > 3200) {
      prev.siren = now;
      SoundFX.policeSiren(0.35 + m.wanted * 0.06);
    }

    // hold-still progress at a door
    const holding = m.hold > 0 && !dead && !inMansion;
    refs.holdWrap.classList.toggle('hidden', !holding);
    if (holding) {
      refs.holdFill.style.width = `${m.hold}%`;
      refs.holdLabel.textContent = 'Hold still…';
    }

    // getting hurt / dying / coming back
    if ((hurt && !prev.hurt) || m.hp < prev.hp - 1) {
      const k = Math.min(1, 0.35 + (prev.hp - m.hp) / 40);
      for (const f of [refs.hurtFlash, refs.mazeHurt]) {
        f.style.transition = 'none';
        f.style.opacity = String(k);
        void f.offsetWidth;
        f.style.transition = 'opacity 0.5s ease-out';
        f.style.opacity = '0';
      }
    }
    if (m.hp < 30 && !dead && now - prev.heart > 1100) {
      prev.heart = now;
      SoundFX.heartbeat();
    }
    if (dead && !prev.dead) {
      SoundFX.wasted();
      SoundFX.voice('hurt', 1);
      vibrate([120, 60, 200]);
      Engine.flash('rgba(160,0,20,0.35)');
      refs.wastedTitle.textContent = matchMode === 'royale' ? `#${m.place || '?'} ELIMINATED` : 'WASTED';
      refs.wastedSub.textContent = matchMode === 'royale' ? 'Spectating the survivors — the match goes on' : 'Respawning at the hospital…';
    }
    if (!dead && prev.dead && matchMode !== 'royale') {
      SoundFX.respawn();
    }
    refs.wasted.classList.toggle('hidden', !dead);
    if (matchMode === 'royale') {
      const sp = m.spectate >= 0 ? cityInfo.players[m.spectate] : null;
      refs.specBanner.classList.toggle('hidden', !(dead && sp));
      if (dead && sp) refs.specBanner.textContent = `👁 Spectating ${sp.avatar} ${sp.name}`;
    }
    prev.dead = dead;
    prev.hurt = hurt;
    prev.hp = m.hp;

    if (matchMode !== 'royale') setBladder(m.bladder || 0);
    const left = snap.endsAt - now;
    refs.cityTimer.textContent = fmtClock(left);
    refs.mazeTimer.textContent = fmtClock(left);
    refs.cityTimer.classList.toggle('urgent', left < 30000);
    const rows = boardHtml(snap);
    refs.cityBoard.innerHTML = rows;
    refs.mazeBoard.innerHTML = rows;
    if (matchMode === 'royale') updateBrHud(m, snap, now);
  }

  function royaleMissionText(m, snap, now) {
    if (now < cityInfo.airUntil) return '🪂 Steer with WASD — pick your landing spot!<small>Loot guns and armor the moment you land</small>';
    if (m.flags & 2048) return `💀 You placed #${m.place || '?'}<small>Watch the rest of the match</small>`;
    const armed = m.weapon >= 2;
    return `🪂 CITY ROYALE — last one standing wins<small>${armed ? 'Stay inside the storm circle and eliminate the others' : 'Find a weapon! Guns are lying on the streets near buildings'}</small>`;
  }

  function updateBrHud(m, snap, now) {
    const alive = snap.al == null ? 0 : snap.al;
    refs.brAlive.textContent = `🧍 ${alive} alive`;
    refs.brKills.textContent = `☠ ${m.kills}`;
    const z = snap.z;
    let txt = '🌀 …';
    let hot = !!(m.flags & 65536);
    if (now < cityInfo.airUntil) txt = '🪂 Dropping…';
    else if (z) {
      if (now < z[6]) txt = `🌀 Shrinks in ${fmtClock(z[6] - now)}`;
      else if (now < z[7]) {
        txt = '🌀 Closing!';
        hot = true;
      } else txt = '🌀 Final circle';
      if (m.flags & 65536) txt = '⚠ IN THE STORM';
    }
    refs.brZone.textContent = txt;
    refs.brZone.classList.toggle('hot', hot);
    if (z && m.flags & 65536 && now - prev.storm > 1500) {
      prev.storm = now;
      SoundFX.zoneWarn();
    }
  }

  function startCityView(payload) {
    cityInfo = payload;
    matchMode = payload.mode || 'city';
    document.body.classList.toggle('mode-royale', matchMode === 'royale');
    cityOffset = payload.serverNow - Date.now();
    cityMeIdx = payload.players.findIndex((pl) => pl.playerId === mySession.playerId);
    hideCountdown();
    refs.cityHint.classList.remove('gone');
    setTimeout(() => refs.cityHint.classList.add('gone'), 12000);
    refs.mazeHint.classList.remove('gone');
    myWorld = 0;
    lastBladder = 0;
    lastFace = '';
    prev.dead = false;
    prev.hp = 100;
    prev.hurt = false;
    prev.key = '';
    lastSnap = payload.snapshot;
    flashCooling = false;
    refs.flashBtn.classList.remove('cooling');
    refs.wasted.classList.add('hidden');
    showView('city');
    City.start(payload, mySession.playerId);
    // build the mansion in the background so walking in is instant
    if (matchMode !== 'royale' && ensureMaze()) {
      Maze3D.start(
        { ...payload.mansion, players: payload.players, startsAt: payload.startsAt, serverNow: payload.serverNow, snapshot: toMazeSnap(payload.snapshot) },
        mySession.playerId,
        undefined,
        { paused: true }
      );
    }
    SoundFX.prepareBody();
    if (worldOf(payload.snapshot) === 1) switchWorld(1);
    runCountdown(payload.startsAt, payload.serverNow);
  }

  function ensureMaze() {
    if (mazeMounted) return true;
    try {
      Maze3D.mount(refs.mazeCanvas, refs.mazeMini, refs.mazeJoy, refs.mazeKnob, {
        sendInput: (dx, dy) => socket.emit(EVENTS.CITY_INPUT, { dx, dy }),
        attack: (ang) => socket.emit(EVENTS.CITY_ATTACK, { ang }),
        flash: doFlash,
        danger: (k) => refs.viewMaze.style.setProperty('--danger', k.toFixed(2)),
        thunder: () => SoundFX.thunder(),
        doorOpen: () => SoundFX.door(),
      });
      mazeMounted = true;
    } catch (err) {
      console.warn('3D mansion unavailable', err);
      return false;
    }
    return true;
  }

  // step through the door of the mansion (or back out of it)
  function switchWorld(w) {
    myWorld = w;
    if (w === 1) {
      City.stop();
      showView('maze');
      if (mazeMounted) Maze3D.resume();
      refs.mazeHint.classList.remove('gone');
      setTimeout(() => refs.mazeHint.classList.add('gone'), 12000);
      SoundFX.door();
      SoundFX.ghost();
    } else {
      if (mazeMounted) Maze3D.stop();
      showView('city');
      City.resume();
    }
  }

  function doFlash() {
    if (flashCooling) return;
    flashCooling = true;
    refs.flashBtn.classList.add('cooling');
    setTimeout(() => {
      flashCooling = false;
      refs.flashBtn.classList.remove('cooling');
    }, 7000);
    SoundFX.flashlight();
    socket.emit(EVENTS.CITY_USE);
  }
  refs.flashBtn.addEventListener('click', doFlash);

  /* ---- sounds for everything that happens around you ---- */

  // how loud something is for me: full for my own doings, fading with distance, silent from the other world
  function distVolume(x, y, range, worldOfSource) {
    const m = City.me;
    if (!m.init) return 0.5;
    if (worldOfSource != null && (worldOfSource | 0) !== (m.world | 0)) return 0;
    const d = Math.hypot(x - m.x, y - m.y);
    return d > range ? 0 : Math.max(0.1, 1 - d / range);
  }
  function panOf(x) {
    const m = City.me;
    const c = City.cam;
    if (!m.init || !c) return 0;
    return Math.max(-1, Math.min(1, ((x - m.x) * Math.cos(c.yaw)) / 500));
  }
  function playerWorld(playerId) {
    if (!lastSnap || !cityInfo) return null;
    const idx = cityInfo.players.findIndex((p) => p.playerId === playerId);
    const e = lastSnap.p.find((r) => r[0] === idx);
    return e ? e[11] || 0 : null;
  }
  function fxVolume(playerId) {
    if (playerId === mySession.playerId) return 1;
    if (!lastSnap || !cityInfo) return 0.4;
    const idx = cityInfo.players.findIndex((p) => p.playerId === playerId);
    const a = lastSnap.p.find((e) => e[0] === cityMeIdx);
    const b = lastSnap.p.find((e) => e[0] === idx);
    if (!a || !b || (a[11] || 0) !== (b[11] || 0)) return 0;
    const range = (a[11] || 0) === 1 ? 420 : 560;
    const d = Math.hypot(a[1] - b[1], a[2] - b[2]);
    return d > range ? 0 : Math.max(0.12, 1 - d / range);
  }

  function combatSound(e) {
    const mine = e.playerId === mySession.playerId;
    switch (e.type) {
      case 'shot': {
        const v = distVolume(e.x, e.y, 760, e.playerId ? playerWorld(e.playerId) : 0);
        if (v > 0) SoundFX.gun(e.w, mine ? 1 : v, mine ? 0 : panOf(e.x));
        break;
      }
      case 'melee': {
        const v = mine ? 1 : fxVolume(e.playerId);
        if (v <= 0) break;
        if (e.w === 1) e.hit ? SoundFX.bat(v) : SoundFX.swing(v);
        else e.hit ? SoundFX.punch(v) : SoundFX.swing(v * 0.7);
        break;
      }
      case 'hit': {
        if (e.dmg <= 0) break;
        if (e.by === mySession.playerId) SoundFX.hitmarker();
        const v = distVolume(e.x, e.y, 520, e.k === 0 ? playerWorld(e.playerId) : 0);
        if (v > 0.1) SoundFX.hit(v);
        if (e.k === 0 && e.playerId === mySession.playerId) {
          if (Math.random() < 0.6) SoundFX.hurtGrunt(0.8);
          vibrate(30);
        }
        break;
      }
      case 'boom': {
        const v = distVolume(e.x, e.y, 1300, 0);
        if (v > 0) SoundFX.boom(v);
        break;
      }
      case 'crash': {
        const v = distVolume(e.x, e.y, 700, 0);
        if (v > 0.1) SoundFX.crash(v);
        break;
      }
      case 'pickup':
        if (mine) e.what === 'cash' ? SoundFX.cash() : SoundFX.pickup();
        break;
      case 'carjack':
        if (mine) {
          SoundFX.carDoor(1);
          SoundFX.engineRev(0.9);
          vibrate(25);
        } else {
          const v = fxVolume(e.playerId);
          if (v > 0) SoundFX.carDoor(v);
        }
        break;
      case 'wanted':
        if (mine) {
          SoundFX.wanted();
          vibrate([40, 40, 40]);
        }
        break;
      case 'heist':
        if (mine) SoundFX.heistAlarm();
        break;
      case 'reward':
        if (mine) {
          SoundFX.cash();
          SoundFX.pickup();
        }
        break;
      case 'kill':
        if (e.killer === mySession.playerId) SoundFX.killDing();
        break;
      case 'airdrop':
        SoundFX.pickup();
        break;
      case 'zone':
        SoundFX.zoneWarn();
        break;
      case 'respawn':
        break;
      default:
        bodyFx(e);
    }
  }

  function bodyFx(e) {
    const mine = e.playerId === mySession.playerId;
    const vol = fxVolume(e.playerId);
    if (e.type === 'fart') {
      if (vol > 0) SoundFX.fart(e.kind, vol * (e.big ? 1.2 : 1));
      if (mine) vibrate([25, 30, 45]);
    } else if (e.type === 'accident') {
      if (vol > 0) SoundFX.accident(vol);
      if (mine) {
        vibrate([80, 50, 120]);
        Engine.flash('rgba(150,170,50,0.35)');
      }
    } else if (e.type === 'relief') {
      if (vol > 0) SoundFX.relief(vol);
      if (mine) Engine.flash('rgba(255,224,77,0.3)');
    } else if (e.type === 'caught') {
      SoundFX.boo();
      SoundFX.ghost();
      if (mine) {
        vibrate([80, 40, 80]);
        Engine.flash('rgba(120,190,255,0.35)');
      }
    } else if (e.type === 'flash') {
      if (!mine) SoundFX.flashlight();
    } else if (e.type === 'shout') {
      if (vol > 0 && !mine) SoundFX.voice('scream', vol);
    } else if (e.type === 'key' && !mine) {
      if (vol > 0.3) SoundFX.key();
    }
  }

  /* ---- controls on screen ---- */

  City.mount(refs.cityCanvas, refs.miniMap, refs.joy, refs.joyKnob, {
    sendInput: (dx, dy) => socket.emit(EVENTS.CITY_INPUT, { dx, dy }),
    attack: (ang) => socket.emit(EVENTS.CITY_ATTACK, { ang }),
    use: () => socket.emit(EVENTS.CITY_USE),
    weapon: (code) => {
      SoundFX.reload();
      socket.emit(EVENTS.CITY_WEAPON, { code });
    },
    reload: () => {
      SoundFX.reload();
      socket.emit(EVENTS.CITY_RELOAD);
    },
    gps: updateGps,
    onState: updateHud,
    thunder: () => SoundFX.thunder(),
    weather: (w) => SoundFX.rain(w === 'rain'),
  });

  function holdButton(btn, setter) {
    const on = (e) => {
      SoundFX.unlock();
      btn.classList.add('down');
      setter(true);
      e.preventDefault();
    };
    const off = () => {
      btn.classList.remove('down');
      setter(false);
    };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  holdButton(refs.fireBtn, (v) => City.setFire(v));
  holdButton(refs.mazeFireBtn, (v) => mazeMounted && Maze3D.setFire(v));
  refs.useBtn.addEventListener('click', () => {
    SoundFX.unlock();
    socket.emit(EVENTS.CITY_USE);
  });
  refs.reloadBtn.addEventListener('click', () => {
    SoundFX.unlock();
    City.reload();
  });
  refs.adsBtn.addEventListener('click', () => {
    SoundFX.unlock();
    refs.adsBtn.classList.toggle('on', City.toggleAds());
  });
  refs.weaponBtn.addEventListener('click', () => {
    SoundFX.unlock();
    City.cycleWeapon();
  });

  /* ---- the microphone: team voice chat + shout-to-scare ---- */

  function refreshMicButtons() {
    const on = VoiceChat.active;
    for (const b of [refs.micBtnCity, refs.micBtnMaze]) {
      b.classList.toggle('on', on);
      b.textContent = on ? '🎙️ Mic on' : '🎙️ Mic off';
    }
  }

  async function toggleMic() {
    SoundFX.unlock();
    SoundFX.click();
    if (VoiceChat.active) VoiceChat.disable();
    else if (!(await VoiceChat.enable())) showToast('Microphone blocked — allow it in your browser to talk with your gang and to scare ghosts by shouting.');
    refreshMicButtons();
  }
  refs.micBtnCity.addEventListener('click', toggleMic);
  refs.micBtnMaze.addEventListener('click', toggleMic);

  VoiceChat.init(socket, EVENTS, {
    shout: () => socket.emit(EVENTS.CITY_SHOUT),
    level: (lv, thr) => {
      const k = Math.min(1, lv / (thr || 0.3)).toFixed(2);
      refs.micBtnCity.style.setProperty('--mic', k);
      refs.micBtnMaze.style.setProperty('--mic', k);
    },
    speaking: (set) => {
      speakingIds = set;
      if (lastSnap && cityInfo) {
        const rows = boardHtml(lastSnap);
        refs.cityBoard.innerHTML = rows;
        refs.mazeBoard.innerHTML = rows;
      }
    },
    state: refreshMicButtons,
    error: () => {},
  });

  // ---- UI wiring ----
  refs.joinCodeInput.addEventListener('input', () => {
    refs.joinCodeInput.value = refs.joinCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  function requireName() {
    const name = refs.nameInput.value.trim();
    if (!name) {
      showToast('Enter your name first.');
      Engine.shake(refs.nameInput.closest('.panel'));
      refs.nameInput.focus();
      return null;
    }
    return name;
  }

  refs.createBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    const name = requireName();
    if (!name) return;
    quickPending = false;
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_CREATE, { name, avatar: selectedAvatar });
  });

  function quickPlay(mode) {
    SoundFX.unlock();
    SoundFX.click();
    const name = requireName();
    if (!name) return;
    quickMode = mode;
    quickBotsWanted = mode === 'royale' ? 9 : QUICK_BOTS;
    quickPending = true;
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_CREATE, { name, avatar: selectedAvatar });
  }
  refs.quickRoyaleBtn.addEventListener('click', () => quickPlay('royale'));
  refs.quickBtn.addEventListener('click', () => quickPlay('city'));

  refs.joinBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    const name = requireName();
    if (!name) return;
    const code = refs.joinCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      Engine.shake(refs.joinCodeInput);
      return showToast('Enter the 4-letter room code.');
    }
    quickPending = false;
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_JOIN, { roomCode: code, name, avatar: selectedAvatar });
  });

  refs.joinCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') refs.joinBtn.click(); });
  refs.nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (refs.joinCodeInput.value.trim().length === 4) refs.joinBtn.click();
    else refs.createBtn.click();
  });

  refs.addBotBtn.addEventListener('click', () => {
    SoundFX.click();
    socket.emit(EVENTS.BOT_ADD, { difficulty: selectedTier });
  });

  refs.copyCodeBtn.addEventListener('click', async () => {
    SoundFX.click();
    const code = mySession.roomCode || '';
    try {
      await navigator.clipboard.writeText(code);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* nothing more we can do */ }
      document.body.removeChild(ta);
    }
    refs.copyCodeBtn.textContent = 'Copied!';
    refs.copyCodeBtn.classList.add('copied');
    setTimeout(() => {
      refs.copyCodeBtn.textContent = 'Copy';
      refs.copyCodeBtn.classList.remove('copied');
    }, 1600);
  });
  refs.startBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    socket.emit(EVENTS.GAME_START, { mode: selectedMode });
  });
  refs.playAgainBtn.addEventListener('click', () => {
    SoundFX.click();
    socket.emit(EVENTS.GAME_PLAY_AGAIN);
  });

  // ---- Back / leave ----
  function openLeave() {
    if (activeView === 'home') return;
    const inMatch = activeView === 'city' || activeView === 'maze';
    refs.leaveTitle.textContent = inMatch ? 'Leave the match?' : 'Leave the room?';
    refs.leaveDesc.textContent = inMatch
      ? "You'll drop out of this match and can't rejoin it. Your cash stays on the board."
      : amHost() && players.filter((p) => !p.isBot).length > 1
        ? 'The host crown passes to the next player. You can rejoin later with the room code.'
        : 'You can rejoin later with the room code (if the room is still open).';
    refs.leaveConfirmBtn.textContent = inMatch ? 'Leave match' : 'Leave room';
    refs.leaveModal.classList.remove('hidden');
  }

  function leaveNow() {
    refs.leaveModal.classList.add('hidden');
    socket.emit(EVENTS.ROOM_LEAVE);
    hideCountdown();
    quickPending = false;
    clearSession();
    players = [];
    showView('home');
    SoundFX.click();
  }

  refs.backBtn.addEventListener('click', () => { SoundFX.click(); openLeave(); });
  refs.leaveStayBtn.addEventListener('click', () => refs.leaveModal.classList.add('hidden'));
  refs.leaveConfirmBtn.addEventListener('click', leaveNow);
  refs.leaveModal.addEventListener('click', (e) => { if (e.target === refs.leaveModal) refs.leaveModal.classList.add('hidden'); });
  // The browser/phone Back gesture does the same thing instead of leaving the page by accident.
  window.addEventListener('popstate', () => {
    if (activeView !== 'home') {
      try { history.pushState({ chaos: 1 }, ''); } catch (e) { /* ignore */ }
      openLeave();
    } else {
      historyArmed = false;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !refs.leaveModal.classList.contains('hidden')) refs.leaveModal.classList.add('hidden');
  });

  function openModal(modal) {
    modal.classList.remove('hidden');
  }
  [refs.howToPlayModal, refs.hallOfFameModal].forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });

  refs.howToPlayBtn.addEventListener('click', () => { SoundFX.click(); openModal(refs.howToPlayModal); });
  refs.closeHowToPlay.addEventListener('click', () => refs.howToPlayModal.classList.add('hidden'));

  refs.hallOfFameBtn.addEventListener('click', () => {
    SoundFX.click();
    openModal(refs.hallOfFameModal);
    loadHallOfFame();
  });
  refs.closeHallOfFame.addEventListener('click', () => refs.hallOfFameModal.classList.add('hidden'));

  refs.periodPills.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    SoundFX.click();
    lbPeriod = btn.dataset.period;
    [...refs.periodPills.children].forEach((p) => p.classList.toggle('active', p === btn));
    loadHallOfFame();
  });

  function formatRelativeDate(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function loadHallOfFame() {
    refs.hallOfFameList.innerHTML = '';
    refs.hallOfFameEmpty.classList.add('hidden');
    refs.hallOfFameUnavailable.classList.add('hidden');
    fetch(`/api/leaderboard?period=${encodeURIComponent(lbPeriod)}`)
      .then((r) => r.json())
      .then(({ enabled, scores }) => {
        if (!enabled) {
          refs.hallOfFameUnavailable.classList.remove('hidden');
          return;
        }
        if (!scores.length) {
          refs.hallOfFameEmpty.classList.remove('hidden');
          return;
        }
        scores.forEach((s, i) => {
          const row = document.createElement('div');
          row.className = 'hof-row';
          row.style.animationDelay = `${Math.min(i, 10) * 35}ms`;
          const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
          row.innerHTML =
            `<div class="hof-rank">${rank}</div>` +
            `<div class="hof-avatar">${escapeHtml(s.avatar || '')}</div>` +
            `<div class="hof-info"><div class="hof-name">${escapeHtml(s.name)}</div>` +
            `<div class="hof-meta">${escapeHtml(formatRelativeDate(s.playedAt))}</div></div>` +
            `<div class="hof-score">${money(s.score)}</div>`;
          refs.hallOfFameList.appendChild(row);
        });
      })
      .catch(() => refs.hallOfFameUnavailable.classList.remove('hidden'));
  }

  refs.muteBtn.addEventListener('click', () => {
    SoundFX.unlock();
    const nowMuted = !SoundFX.isMuted();
    SoundFX.setMuted(nowMuted);
    refs.muteBtn.textContent = nowMuted ? '🔇' : '🔊';
    if (!nowMuted) SoundFX.click();
  });

  // ---- Boot ----
  Engine.init('vice');
  refs.muteBtn.textContent = SoundFX.isMuted() ? '🔇' : '🔊';
  renderBotTierPills();

  const existing = loadSession();
  if (existing && existing.name) refs.nameInput.value = existing.name;
  if (existing && existing.avatar) selectedAvatar = existing.avatar;

  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam && (!existing || !existing.roomCode)) {
    refs.joinCodeInput.value = joinParam.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }

  if (!existing || !existing.roomCode) showView('home');
})();
