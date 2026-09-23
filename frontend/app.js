(function () {
  const SESSION_KEY = 'triviaRoyaleSession';
  const THEME_KEY = 'triviaRoyaleTheme';
  const TIER_KEY = 'triviaRoyaleBotTier';
  const QUESTION_DURATION_MS = 15000;
  const RING_C = 119.38; // circumference of the timer ring (r = 19)
  const MIN_QUESTIONS_TO_START = 4;
  const MAX_PLAYERS = 10;

  const el = (id) => document.getElementById(id);

  const refs = {
    toast: el('toast'),
    feed: el('feed'),
    comboBurst: el('comboBurst'),
    muteBtn: el('muteBtn'),
    nameInput: el('nameInput'),
    avatarPicker: el('avatarPicker'),
    categorySelect: el('categorySelect'),
    createBtn: el('createBtn'),
    quickBtn: el('quickBtn'),
    joinCodeInput: el('joinCodeInput'),
    joinBtn: el('joinBtn'),

    countdownOverlay: el('countdownOverlay'),
    cdReady: el('cdReady'),
    cdNum: el('cdNum'),
    cdSquad: el('cdSquad'),

    lobbyCode: el('lobbyCode'),
    copyCodeBtn: el('copyCodeBtn'),
    lobbyQr: el('lobbyQr'),
    lobbyCategory: el('lobbyCategory'),
    lobbyPlayers: el('lobbyPlayers'),
    squadCount: el('squadCount'),
    botControls: el('botControls'),
    botTierPills: el('botTierPills'),
    addBotBtn: el('addBotBtn'),
    soloHint: el('soloHint'),
    startBtn: el('startBtn'),
    lobbyWaitingMsg: el('lobbyWaitingMsg'),
    lobbyNeedMoreMsg: el('lobbyNeedMoreMsg'),

    customPanel: el('customPanel'),
    customHostControls: el('customHostControls'),
    levelSelect: el('levelSelect'),
    studyCategorySelect: el('studyCategorySelect'),
    studySubcategorySelect: el('studySubcategorySelect'),
    generateBtn: el('generateBtn'),
    generatingStatus: el('generatingStatus'),
    aiDisabledHint: el('aiDisabledHint'),
    manualQText: el('manualQText'),
    manualOpt0: el('manualOpt0'),
    manualOpt1: el('manualOpt1'),
    manualOpt2: el('manualOpt2'),
    manualOpt3: el('manualOpt3'),
    addQuestionBtn: el('addQuestionBtn'),
    questionPoolCount: el('questionPoolCount'),
    questionPoolList: el('questionPoolList'),
    needMoreQuestionsMsg: el('needMoreQuestionsMsg'),

    powerBadge: el('powerBadge'),
    qProgress: el('qProgress'),
    streakChip: el('streakChip'),
    timerRing: el('timerRing'),
    ringFg: el('ringFg'),
    qTimer: el('qTimer'),
    timerFill: el('timerFill'),
    frozenNotice: el('frozenNotice'),
    questionCard: el('questionCard'),
    questionText: el('questionText'),
    choicesGrid: el('choicesGrid'),
    lifelineBtn: el('lifelineBtn'),
    lifelineCount: el('lifelineCount'),
    answerLockedMsg: el('answerLockedMsg'),
    frozenLockedMsg: el('frozenLockedMsg'),
    revealBanner: el('revealBanner'),
    miniLeaderboard: el('miniLeaderboard'),
    liveBoard: el('liveBoard'),
    powerWaitingBanner: el('powerWaitingBanner'),
    powerResultBanner: el('powerResultBanner'),

    powerModal: el('powerModal'),
    powerModalTitle: el('powerModalTitle'),
    powerModalDesc: el('powerModalDesc'),
    powerOpponents: el('powerOpponents'),
    powerSkipBtn: el('powerSkipBtn'),
    powerCountdown: el('powerCountdown'),

    podium: el('podium'),
    finalTitle: el('finalTitle'),
    finalSub: el('finalSub'),
    finalPlayers: el('finalPlayers'),
    playAgainBtn: el('playAgainBtn'),
    finalWaitingMsg: el('finalWaitingMsg'),

    howToPlayBtn: el('howToPlayBtn'),
    howToPlayModal: el('howToPlayModal'),
    closeHowToPlay: el('closeHowToPlay'),

    hallOfFameBtn: el('hallOfFameBtn'),
    hallOfFameModal: el('hallOfFameModal'),
    hallOfFameList: el('hallOfFameList'),
    hallOfFameEmpty: el('hallOfFameEmpty'),
    hallOfFameUnavailable: el('hallOfFameUnavailable'),
    closeHallOfFame: el('closeHallOfFame'),
    periodPills: el('periodPills'),
    lbCategorySelect: el('lbCategorySelect'),
    lbSubjectSelect: el('lbSubjectSelect'),

    themeBtn: el('themeBtn'),
    themeModal: el('themeModal'),
    themeSwatchGrid: el('themeSwatchGrid'),
    closeThemeModal: el('closeThemeModal'),
  };

  let mySession = { playerId: null, roomCode: null, name: null, isCreator: false };
  let players = [];
  let currentCategory = null;
  let currentQuestion = null;
  let selectedChoice = null;
  let answerLocked = false;
  let selectedAvatar = '🦊';
  let activeView = 'home';
  let clockOffset = 0;
  let questionRAF = null;
  let powerRAF = null;
  let toastTimer = null;
  let powerResultTimer = null;
  let comboTimer = null;
  let countdownTimer = null;
  let pendingActiveType = null;
  let iAmFrozenThisQuestion = false;
  let lifelineUsedThisQuestion = false;
  let myLifelines = 0;
  let currentPool = [];
  let answered = new Set();
  let lastTickSecond = null;
  let quickPending = false;
  let wakeLock = null;
  let lbPeriod = 'all';
  let lbCategory = '';
  let lbSubject = '';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage blocked (private mode) */ }
  }

  // ---- Themes ----
  const THEMES = [
    { key: 'candy', label: 'Candy Blast', tag: 'Sugar rush & jelly buttons', colors: ['#4b2bd4', '#ff4d9d', '#ffd23f'], meta: '#3d1fb0' },
    { key: 'battle', label: 'Battle Zone', tag: 'Last squad standing', colors: ['#10160c', '#f2a900', '#ff6b1a'], meta: '#10160c' },
    { key: 'vice', label: 'Neon City', tag: 'Sunset drive, neon lights', colors: ['#12002e', '#ff2e93', '#2ee6ff'], meta: '#12002e' },
    { key: 'midnight', label: 'Midnight', tag: 'Calm & classic', colors: ['#100e26', '#7c5cff', '#ffb84d'], meta: '#100e26' },
    { key: 'light', label: 'Daylight', tag: 'Bright & clean', colors: ['#f2f3fb', '#7c5cff', '#e08a1e'], meta: '#f2f3fb' },
  ];

  // Theme-flavoured wording so each look feels like its own game.
  const COPY = {
    candy: {
      ready: 'Get ready', go: 'GO!',
      correct: ['Sweet!', 'Tasty!', 'Delicious!', 'Divine!', 'SUGAR CRUSH!'],
      wrong: 'Oh no, sour!', timeout: "Time's up!", frozen: 'Frozen in jelly',
      combo: ['', 'Combo x2', 'Combo x3', 'Combo x4', 'Combo x5'],
      final: 'Sweet Victory!', finalLose: 'Sugar Rush Over',
    },
    battle: {
      ready: 'Deploying', go: 'DROP!',
      correct: ['HIT', 'ENEMY DOWN', 'DOUBLE KILL', 'TRIPLE KILL', 'UNSTOPPABLE'],
      wrong: 'MISSED', timeout: 'ZONE CLOSED', frozen: 'Suppressed',
      combo: ['', 'x2 streak', 'x3 streak', 'x4 streak', 'x5 streak'],
      final: 'WINNER WINNER', finalLose: 'Squad Wiped',
    },
    vice: {
      ready: 'Get ready', go: 'GO!',
      correct: ['NICE', 'SMOOTH', 'MISSION COMPLETE', 'RESPECT +', 'LEGENDARY'],
      wrong: 'BUSTED', timeout: 'TOO SLOW', frozen: 'Cooled down',
      combo: ['', 'x2 streak', 'x3 streak', 'x4 streak', 'x5 streak'],
      final: 'MISSION COMPLETE', finalLose: 'Wasted',
    },
    midnight: {
      ready: 'Get ready', go: 'GO!',
      correct: ['Correct!', 'Nice!', 'On fire!', 'Unstoppable!', 'Genius!'],
      wrong: 'Wrong answer', timeout: "Time's up", frozen: 'Frozen',
      combo: ['', 'x2 streak', 'x3 streak', 'x4 streak', 'x5 streak'],
      final: 'Final Results', finalLose: 'Final Results',
    },
  };
  COPY.light = COPY.midnight;

  function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return THEMES.some((x) => x.key === t) ? t : 'candy';
  }
  function copy() {
    return COPY[currentTheme()] || COPY.midnight;
  }

  function applyTheme(key) {
    const theme = THEMES.find((t) => t.key === key) || THEMES[0];
    document.documentElement.setAttribute('data-theme', theme.key);
    safeSet(THEME_KEY, theme.key);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.meta);
    Engine.setTheme(theme.key);
    renderThemeSwatches();
  }

  function renderThemeSwatches() {
    const active = currentTheme();
    refs.themeSwatchGrid.innerHTML = '';
    THEMES.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-swatch' + (t.key === active ? ' active' : '');
      btn.innerHTML =
        `<div class="theme-swatch-preview">${t.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</div>` +
        `<div class="theme-swatch-name">${t.label}</div><div class="theme-swatch-tag">${t.tag}</div>`;
      btn.onclick = () => {
        SoundFX.click();
        applyTheme(t.key);
        Engine.burst(btn, { kind: 'star', count: 14 });
      };
      refs.themeSwatchGrid.appendChild(btn);
    });
  }

  // sessionStorage (not localStorage): reconnect-on-refresh should be per-tab,
  // not shared across every tab someone happens to have this game open in.
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
    while (refs.feed.children.length > 4) refs.feed.removeChild(refs.feed.firstChild);
    setTimeout(() => item.remove(), 3000);
  }

  function showView(id) {
    activeView = id;
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    el('view-' + id).classList.remove('hidden');
    window.scrollTo(0, 0);
    if (id === 'question') acquireWakeLock();
  }

  function me() {
    return players.find((p) => p.playerId === mySession.playerId) || null;
  }
  function amHost() {
    const m = me();
    return !!(m && m.isCreator);
  }

  function vibrate(pattern) {
    // Browsers block vibration until the user has tapped the page once.
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern);
  }

  // Keep phones/tablets awake during a game so the screen doesn't dim mid-question.
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (activeView === 'question')) acquireWakeLock();
  });

  function animateNumber(node, from, to, ms) {
    if (Engine.reduceMotion || from === to) { node.textContent = to; return; }
    const start = performance.now();
    function step(now) {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * eased);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- Meta (avatars + categories + study levels + bot tiers) ----
  let AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐨', '🐙', '🦉', '🐢', '🐷', '🦁'];
  let CATEGORIES = [{ key: 'general', label: 'General Knowledge', emoji: '🌍' }];
  let LEVELS = [];
  let AI_ENABLED = false;
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

  function renderLevelSelect() {
    refs.levelSelect.innerHTML = '';
    let lastGroup = null;
    let groupEl = refs.levelSelect;
    LEVELS.forEach((l) => {
      if (l.group !== lastGroup) {
        groupEl = document.createElement('optgroup');
        groupEl.label = l.group;
        refs.levelSelect.appendChild(groupEl);
        lastGroup = l.group;
      }
      const opt = document.createElement('option');
      opt.value = l.key;
      opt.textContent = l.label;
      groupEl.appendChild(opt);
    });
    renderStudyCategorySelect();
  }

  function currentLevelData() {
    return LEVELS.find((l) => l.key === refs.levelSelect.value) || LEVELS[0];
  }

  function renderStudyCategorySelect() {
    const level = currentLevelData();
    refs.studyCategorySelect.innerHTML = '';
    (level ? level.categories : []).forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.label;
      opt.textContent = c.label;
      refs.studyCategorySelect.appendChild(opt);
    });
    renderStudySubcategorySelect();
  }

  function renderStudySubcategorySelect() {
    const level = currentLevelData();
    const category = level && level.categories.find((c) => c.label === refs.studyCategorySelect.value);
    refs.studySubcategorySelect.innerHTML = '';
    (category ? category.subcategories : ['General (mixed topics)']).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      refs.studySubcategorySelect.appendChild(opt);
    });
  }

  refs.levelSelect.addEventListener('change', renderStudyCategorySelect);
  refs.studyCategorySelect.addEventListener('change', renderStudySubcategorySelect);

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

  function renderCategorySelect() {
    refs.categorySelect.innerHTML = '';
    CATEGORIES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = `${c.emoji} ${c.label}`;
      refs.categorySelect.appendChild(opt);
    });
  }

  function categoryLabel(key) {
    const c = CATEGORIES.find((c) => c.key === key);
    return c ? `${c.emoji} ${c.label}` : '';
  }

  fetch('/api/meta')
    .then((r) => r.json())
    .then((meta) => {
      if (Array.isArray(meta.avatars) && meta.avatars.length) AVATARS = meta.avatars;
      if (Array.isArray(meta.categories) && meta.categories.length) CATEGORIES = meta.categories;
      if (Array.isArray(meta.levels) && meta.levels.length) LEVELS = meta.levels;
      if (Array.isArray(meta.botTiers) && meta.botTiers.length) BOT_TIERS = meta.botTiers;
      AI_ENABLED = !!meta.aiEnabled;
      const saved = loadSession();
      selectedAvatar = (saved && saved.avatar) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
      renderAvatarPicker();
      renderCategorySelect();
      renderLevelSelect();
      renderBotTierPills();
      if (activeView === 'lobby') {
        renderLobbyControls();
        renderCustomPanel();
      }
    })
    .catch(() => {
      selectedAvatar = AVATARS[0];
      renderAvatarPicker();
      renderCategorySelect();
      renderBotTierPills();
    });

  // ---- Player lists ----
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
        right.textContent = p.score;
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

  let rankChanges = {}; // playerId -> +n (climbed) / -n (dropped), shown once after a reveal

  function renderLiveBoard() {
    refs.liveBoard.innerHTML = '';
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (p.playerId === mySession.playerId ? ' me' : '') + (answered.has(p.playerId) ? ' answered' : '');
      const change = rankChanges[p.playerId] || 0;
      const arrow = change > 0 ? `<span class="rank-up">▲${change}</span>` : change < 0 ? `<span class="rank-down">▼${-change}</span>` : '';
      row.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-avatar">${escapeHtml(p.avatar || '')}</span>` +
        `<span class="lb-name">${escapeHtml(p.name)}${arrow}</span>` +
        `<span class="lb-check">✓</span>` +
        `<span class="lb-score">${p.score}</span>`;
      refs.liveBoard.appendChild(row);
    });
  }

  function renderLobbyControls() {
    refs.lobbyCode.textContent = mySession.roomCode || '----';
    refs.squadCount.textContent = `${players.length}/${MAX_PLAYERS}`;
    const connectedCount = players.filter((p) => p.connected).length;
    const needsMoreQuestions = currentCategory === 'custom' && currentPool.length < MIN_QUESTIONS_TO_START;
    if (amHost()) {
      refs.botControls.classList.remove('hidden');
      refs.startBtn.classList.remove('hidden');
      refs.startBtn.disabled = connectedCount < 2 || needsMoreQuestions;
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

  function renderCustomPanel() {
    const isCustom = currentCategory === 'custom';
    refs.customPanel.classList.toggle('hidden', !isCustom);
    if (!isCustom) return;
    refs.customHostControls.classList.toggle('hidden', !amHost());
    refs.generateBtn.classList.toggle('hidden', !AI_ENABLED);
    refs.aiDisabledHint.classList.toggle('hidden', AI_ENABLED);
    refs.questionPoolCount.textContent = `${currentPool.length} question${currentPool.length === 1 ? '' : 's'} ready`;
    refs.needMoreQuestionsMsg.classList.toggle('hidden', currentPool.length >= MIN_QUESTIONS_TO_START);

    refs.questionPoolList.innerHTML = '';
    currentPool.forEach((q, i) => {
      const row = document.createElement('div');
      row.className = 'pool-question-row';
      const idx = document.createElement('span');
      idx.className = 'pool-q-index';
      idx.textContent = `${i + 1}.`;
      const text = document.createElement('span');
      text.className = 'pool-q-text';
      text.textContent = q.text;
      row.appendChild(idx);
      row.appendChild(text);
      if (amHost()) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pool-q-remove';
        removeBtn.setAttribute('aria-label', 'Remove question');
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
          SoundFX.click();
          socket.emit(EVENTS.QUESTION_REMOVE, { index: i });
        };
        row.appendChild(removeBtn);
      }
      refs.questionPoolList.appendChild(row);
    });
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
    refs.lobbyCategory.textContent = categoryLabel(currentCategory);
    renderLobbyQr(mySession.roomCode);
    renderPlayerRows(refs.lobbyPlayers, players, false, true);
    renderBotTierPills();
    renderLobbyControls();
    renderCustomPanel();
  }

  // ---- Question screen ----
  function powerBadgeLabel(type) {
    return type === 'freeze' ? '🥶 FREEZE ROUND' : '⚡ STEAL ROUND';
  }

  function replayAnimation(node) {
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }

  function updateStreakChip() {
    const m = me();
    const streak = m ? m.streak || 0 : 0;
    if (streak >= 2) {
      refs.streakChip.textContent = `🔥 ${streak} streak`;
      refs.streakChip.classList.remove('hidden');
    } else {
      refs.streakChip.classList.add('hidden');
    }
  }

  function updateLifelineButton() {
    refs.lifelineCount.textContent = myLifelines;
    refs.lifelineBtn.disabled = myLifelines <= 0 || answerLocked || iAmFrozenThisQuestion || lifelineUsedThisQuestion;
  }

  function syncMyStats() {
    const m = me();
    myLifelines = m ? m.lifelines || 0 : 0;
  }

  function renderQuestion() {
    refs.qProgress.textContent = `Question ${currentQuestion.questionIndex + 1}/${currentQuestion.totalQuestions}`;
    if (currentQuestion.powerRoundType) {
      refs.powerBadge.textContent = powerBadgeLabel(currentQuestion.powerRoundType);
      refs.powerBadge.className = 'power-badge' + (currentQuestion.powerRoundType === 'freeze' ? ' freeze' : '');
    } else {
      refs.powerBadge.classList.add('hidden');
    }
    refs.questionText.textContent = currentQuestion.text;
    replayAnimation(refs.questionCard);

    iAmFrozenThisQuestion = currentQuestion.frozenPlayerId === mySession.playerId;
    lifelineUsedThisQuestion = false;
    answerLocked = false;
    const frozenPlayer = players.find((p) => p.playerId === currentQuestion.frozenPlayerId);
    if (currentQuestion.frozenPlayerId && frozenPlayer) {
      refs.frozenNotice.textContent = iAmFrozenThisQuestion
        ? "🥶 You're frozen this round — sit this one out."
        : `🥶 ${frozenPlayer.name} is frozen this round.`;
      refs.frozenNotice.classList.remove('hidden');
    } else {
      refs.frozenNotice.classList.add('hidden');
    }

    refs.choicesGrid.classList.remove('locked');
    refs.choicesGrid.querySelectorAll('.choice').forEach((btn, i) => {
      btn.querySelector('.choice-label').textContent = currentQuestion.choices[i];
      btn.disabled = iAmFrozenThisQuestion;
      btn.classList.remove('selected', 'correct', 'wrong', 'dim', 'eliminated');
      btn.onclick = iAmFrozenThisQuestion ? null : () => selectChoice(i);
      replayAnimation(btn);
    });

    refs.answerLockedMsg.classList.add('hidden');
    refs.frozenLockedMsg.classList.toggle('hidden', !iAmFrozenThisQuestion);
    refs.revealBanner.classList.add('hidden');
    refs.miniLeaderboard.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    refs.powerResultBanner.classList.add('hidden');
    refs.powerModal.classList.add('hidden');
    updateStreakChip();
    updateLifelineButton();
    renderLiveBoard();
  }

  // Tapping an answer locks it in instantly on-screen and sends it at the same moment —
  // no waiting on the server round-trip before the UI reacts.
  function selectChoice(i) {
    if (answerLocked || iAmFrozenThisQuestion || activeView !== 'question') return;
    const btn = refs.choicesGrid.querySelectorAll('.choice')[i];
    if (!btn || btn.classList.contains('eliminated')) return;
    answerLocked = true;
    selectedChoice = i;
    socket.emit(EVENTS.ANSWER_SUBMIT, { choiceIndex: i });

    refs.choicesGrid.classList.add('locked');
    refs.choicesGrid.querySelectorAll('.choice').forEach((b, idx) => {
      b.disabled = true;
      b.classList.toggle('selected', idx === i);
    });
    refs.answerLockedMsg.classList.remove('hidden');
    updateLifelineButton();
    SoundFX.lock();
    vibrate(18);
    Engine.burst(btn, { kind: 'spark', count: 16, power: 0.8 });
    Engine.shockwave(btn);
  }

  function useLifeline() {
    if (refs.lifelineBtn.disabled || answerLocked || iAmFrozenThisQuestion || lifelineUsedThisQuestion || myLifelines <= 0) return;
    SoundFX.click();
    lifelineUsedThisQuestion = true;
    updateLifelineButton();
    socket.emit(EVENTS.LIFELINE_USE);
  }

  function startQuestionCountdown(endsAt, serverNow) {
    clockOffset = serverNow - Date.now();
    lastTickSecond = null;
    if (questionRAF) cancelAnimationFrame(questionRAF);
    function tick() {
      const now = Date.now() + clockOffset;
      const remaining = Math.max(0, endsAt - now);
      const secs = Math.ceil(remaining / 1000);
      refs.qTimer.textContent = secs;
      const pct = Math.max(0, Math.min(1, remaining / QUESTION_DURATION_MS));
      refs.timerFill.style.width = pct * 100 + '%';
      refs.ringFg.style.strokeDashoffset = String(RING_C * (1 - pct));
      const urgent = remaining < 5000;
      refs.timerFill.classList.toggle('urgent', urgent);
      refs.timerRing.classList.toggle('urgent', urgent);
      if (urgent && remaining > 0 && secs !== lastTickSecond && !answerLocked) {
        lastTickSecond = secs;
        SoundFX.tick();
      }
      if (remaining > 0) questionRAF = requestAnimationFrame(tick);
    }
    tick();
  }

  function startPowerCountdown(endsAt) {
    if (powerRAF) cancelAnimationFrame(powerRAF);
    function tick() {
      const now = Date.now() + clockOffset;
      const remaining = Math.max(0, endsAt - now);
      refs.powerCountdown.textContent = Math.ceil(remaining / 1000);
      if (remaining > 0) powerRAF = requestAnimationFrame(tick);
    }
    tick();
  }

  // ---- Countdown overlay (3-2-1-GO before the first question) ----
  function hideCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    refs.countdownOverlay.classList.add('hidden');
  }

  function runCountdown(startsAt, serverNow) {
    clearInterval(countdownTimer);
    const offset = serverNow - Date.now();
    refs.cdReady.textContent = copy().ready;
    refs.cdSquad.innerHTML = players.map((p, i) => `<span style="animation-delay:${i * 70}ms">${escapeHtml(p.avatar || '🙂')}</span>`).join('');
    refs.countdownOverlay.classList.remove('hidden');
    acquireWakeLock();
    let shown = null;
    function update() {
      const remaining = startsAt - (Date.now() + offset);
      const label = remaining > 2400 ? '3' : remaining > 1400 ? '2' : remaining > 400 ? '1' : 'GO';
      if (label !== shown) {
        shown = label;
        const isGo = label === 'GO';
        refs.cdNum.textContent = isGo ? copy().go : label;
        refs.cdNum.classList.toggle('go', isGo);
        replayAnimation(refs.cdNum);
        if (isGo) {
          SoundFX.go();
          Engine.flash('rgba(255,255,255,0.45)');
          Engine.burst({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, { kind: 'spark', count: 40, power: 1.4 });
          Engine.shockwave({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        } else {
          SoundFX.count();
          vibrate(20);
        }
      }
      if (remaining < -1500) hideCountdown();
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
    if (amHost()) {
      refs.playAgainBtn.classList.remove('hidden');
      refs.finalWaitingMsg.classList.add('hidden');
    } else {
      refs.playAgainBtn.classList.add('hidden');
      refs.finalWaitingMsg.classList.remove('hidden');
    }
  }

  function renderFinal(data) {
    refs.podium.innerHTML = '';
    data.podium.forEach((p, i) => {
      const slot = document.createElement('div');
      slot.className = `podium-slot rank-${i + 1}`;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      slot.innerHTML =
        `<div class="medal">${medal}</div>` +
        `<div class="pavatar">${escapeHtml(p.avatar || '')}</div>` +
        `<div class="pname">${escapeHtml(p.name)}</div>` +
        `<div class="pscore">${p.score} pts</div>`;
      refs.podium.appendChild(slot);
    });
    renderPlayerRows(refs.finalPlayers, data.leaderboard, true);

    const myIndex = data.leaderboard.findIndex((p) => p.playerId === mySession.playerId);
    const won = myIndex === 0;
    refs.finalTitle.textContent = won ? copy().final : copy().finalLose;
    replayAnimation(refs.finalTitle);
    if (myIndex >= 0) {
      const myScore = data.leaderboard[myIndex].score;
      refs.finalSub.textContent = won
        ? `You took first place with ${myScore} points!`
        : `You finished ${ordinal(myIndex + 1)} with ${myScore} points — ${escapeHtml(data.leaderboard[0].name)} took the crown.`;
    } else {
      refs.finalSub.textContent = '';
    }
    updateFinalControls();
  }

  function applyRoomState(roomState) {
    players = roomState.players;
    currentCategory = roomState.category;
    currentPool = roomState.customPool ? roomState.customPool.questions : [];
    syncMyStats();
    hideCountdown();
    if (roomState.state === 'lobby') {
      showLobby();
    } else if (roomState.state === 'starting') {
      showLobby();
      runCountdown(roomState.startsAt, roomState.serverNow);
    } else if (roomState.state === 'question' && roomState.question) {
      currentQuestion = {
        ...roomState.question,
        questionIndex: roomState.questionIndex,
        totalQuestions: roomState.totalQuestions,
        frozenPlayerId: null,
      };
      selectedChoice = null;
      answered = new Set();
      showView('question');
      renderQuestion();
      startQuestionCountdown(roomState.question.questionEndsAt, roomState.question.serverNow);
    } else if (roomState.state === 'reveal' || roomState.state === 'steal_prompt' || roomState.state === 'freeze_prompt') {
      showView('question');
      refs.questionText.textContent = 'Reconnected — syncing with the game…';
      refs.choicesGrid.querySelectorAll('.choice').forEach((btn) => {
        btn.querySelector('.choice-label').textContent = '';
        btn.disabled = true;
      });
      renderLiveBoard();
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
    if (quickPending && data.isCreator) socket.emit(EVENTS.BOT_ADD, { difficulty: selectedTier });
  });

  socket.on(EVENTS.ROOM_ERROR, ({ code, message }) => {
    quickPending = false;
    showToast(message || 'Something went wrong.');
    SoundFX.wrong();
    Engine.shake(refs.toast);
    if (code === 'ROOM_NOT_FOUND') {
      clearSession();
      showView('home');
    }
  });

  socket.on(EVENTS.PLAYER_LIST_UPDATE, ({ players: p }) => {
    players = p;
    if (quickPending && players.some((x) => x.isBot) && activeView === 'lobby') {
      quickPending = false;
      socket.emit(EVENTS.GAME_START);
    }
    if (activeView === 'lobby') {
      renderPlayerRows(refs.lobbyPlayers, players, false, true);
      renderLobbyControls();
      renderCustomPanel();
    } else if (activeView === 'question') {
      renderLiveBoard();
    } else if (activeView === 'final') {
      renderPlayerRows(refs.finalPlayers, players, true);
      updateFinalControls();
    }
  });

  socket.on(EVENTS.QUESTIONS_GENERATING, ({ level, subject }) => {
    refs.generateBtn.disabled = true;
    refs.generatingStatus.textContent = `🤖 Generating questions on "${subject}" for ${level}…`;
    refs.generatingStatus.classList.remove('hidden');
  });

  socket.on(EVENTS.QUESTION_POOL_UPDATE, ({ questions }) => {
    const before = currentPool.length;
    currentPool = questions || [];
    refs.generateBtn.disabled = false;
    refs.generatingStatus.classList.add('hidden');
    renderCustomPanel();
    renderLobbyControls();
    if (currentPool.length > before) {
      SoundFX.correct();
      Engine.burst(refs.questionPoolCount, { kind: 'star', count: 16 });
    }
  });

  socket.on(EVENTS.GAME_STARTING, ({ startsAt, serverNow, players: p }) => {
    if (p) players = p;
    syncMyStats();
    answered = new Set();
    rankChanges = {};
    runCountdown(startsAt, serverNow);
  });

  socket.on(EVENTS.QUESTION_START, (payload) => {
    hideCountdown();
    if (payload.players) players = payload.players;
    syncMyStats();
    currentQuestion = payload;
    selectedChoice = null;
    answered = new Set();
    showView('question');
    renderQuestion();
    startQuestionCountdown(payload.questionEndsAt, payload.serverNow);
  });

  socket.on(EVENTS.ANSWER_ACK, ({ choiceIndex }) => {
    // Already shown instantly on tap; this just re-asserts the locked state after a reconnect.
    if (!answerLocked) {
      answerLocked = true;
      selectedChoice = choiceIndex;
      refs.choicesGrid.classList.add('locked');
      refs.choicesGrid.querySelectorAll('.choice').forEach((btn, i) => {
        btn.disabled = true;
        btn.classList.toggle('selected', i === choiceIndex);
      });
      refs.answerLockedMsg.classList.remove('hidden');
      updateLifelineButton();
    }
  });

  socket.on(EVENTS.ANSWER_PROGRESS, ({ playerId }) => {
    answered.add(playerId);
    renderLiveBoard();
    if (playerId !== mySession.playerId) {
      const p = players.find((x) => x.playerId === playerId);
      if (p) pushFeed(`${escapeHtml(p.avatar || '')} ${escapeHtml(p.name)} locked in`);
    }
  });

  socket.on(EVENTS.LIFELINE_RESULT, ({ removed, lifelines }) => {
    myLifelines = lifelines;
    SoundFX.lifeline();
    vibrate(25);
    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    removed.forEach((idx) => {
      const b = buttons[idx];
      if (!b) return;
      Engine.burst(b, { kind: 'spark', count: 14, colors: ['#ffffff', '#ffd23f'] });
      b.classList.add('eliminated');
      b.disabled = true;
    });
    Engine.floatText(refs.lifelineBtn, '50/50', { cls: 'gold' });
    updateLifelineButton();
  });

  socket.on(EVENTS.QUESTION_REVEAL, ({ correctIndex, deltas, bonuses, assisted, streaks, leaderboard }) => {
    if (questionRAF) cancelAnimationFrame(questionRAF);
    refs.timerRing.classList.remove('urgent');

    // Work out who climbed/dropped before replacing the list.
    const oldRank = {};
    players.forEach((p, i) => { oldRank[p.playerId] = i; });
    rankChanges = {};
    leaderboard.forEach((p, i) => {
      if (oldRank[p.playerId] !== undefined && oldRank[p.playerId] !== i) rankChanges[p.playerId] = oldRank[p.playerId] - i;
    });
    players = leaderboard;
    syncMyStats();

    refs.choicesGrid.classList.remove('locked');
    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove('selected');
      if (i === correctIndex) btn.classList.add('correct');
      else if (selectedChoice === i) btn.classList.add('wrong');
      else btn.classList.add('dim');
    });

    const myId = mySession.playerId;
    const myDelta = deltas[myId] || 0;
    const myBonus = (bonuses && bonuses[myId]) || 0;
    const myStreak = (streaks && streaks[myId]) || 0;
    const c = copy();
    const correctBtn = buttons[correctIndex];
    refs.revealBanner.classList.remove('hidden', 'good', 'bad');
    replayAnimation(refs.revealBanner);

    if (myDelta > 0) {
      const label = c.correct[Math.min(Math.max(myStreak - 1, 0), c.correct.length - 1)];
      const parts = [];
      if (assisted && assisted[myId]) parts.push('50/50 −40%');
      if (myBonus > 0) parts.push(`streak bonus +${myBonus}`);
      refs.revealBanner.innerHTML = `${escapeHtml(label)} +${myDelta}` + (parts.length ? `<span class="sub">${escapeHtml(parts.join(' · '))}</span>` : '');
      refs.revealBanner.classList.add('good');
      if (myStreak >= 2) SoundFX.combo(Math.min(myStreak, 6));
      else SoundFX.correct();
      vibrate(myStreak >= 3 ? [30, 40, 30] : 40);
      const kind = currentTheme() === 'vice' ? 'coin' : currentTheme() === 'candy' ? 'candy' : 'star';
      Engine.burst(correctBtn, { kind, count: 18 + myStreak * 4, power: 1 });
      Engine.burst(correctBtn, { kind: 'spark', count: 20, power: 1.1 });
      Engine.shockwave(correctBtn, '#3ee08f');
      Engine.floatText(correctBtn, `+${myDelta}`, { cls: 'gold' });
      if (myStreak >= 2) showCombo(c.combo[Math.min(myStreak - 1, c.combo.length - 1)], `+${myBonus} bonus`);
      if (myStreak >= 4) Engine.flash('rgba(255,210,63,0.35)');
    } else {
      const wasFrozen = iAmFrozenThisQuestion;
      refs.revealBanner.innerHTML = escapeHtml(wasFrozen ? c.frozen : selectedChoice === null ? c.timeout : c.wrong) + '<span class="sub">+0 points</span>';
      refs.revealBanner.classList.add('bad');
      if (!wasFrozen) {
        SoundFX.wrong();
        vibrate([30, 50, 30]);
        Engine.shake(refs.questionCard);
        Engine.flash('rgba(255,60,90,0.28)');
        if (selectedChoice !== null) Engine.floatText(buttons[selectedChoice], '✗', { cls: 'bad' });
      }
    }

    // A rival on a hot streak makes the room feel it.
    leaderboard.forEach((p) => {
      const s = streaks && streaks[p.playerId];
      if (p.playerId !== myId && s >= 3) pushFeed(`🔥 ${escapeHtml(p.avatar || '')} ${escapeHtml(p.name)} is on a ${s} streak`);
    });

    // Score change pops over each row that gained points.
    refs.miniLeaderboard.classList.remove('hidden');
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    renderLiveBoard();
    rankChanges = {};
    updateStreakChip();
    refs.answerLockedMsg.classList.add('hidden');
    refs.lifelineBtn.disabled = true;
  });

  function showCombo(text, sub) {
    refs.comboBurst.innerHTML = `${escapeHtml(text)}<span class="sub">${escapeHtml(sub)}</span>`;
    refs.comboBurst.classList.remove('hidden');
    replayAnimation(refs.comboBurst);
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => refs.comboBurst.classList.add('hidden'), 1400);
  }

  function showPowerPrompt(type, opponents, decisionEndsAt, serverNow) {
    pendingActiveType = type;
    if (serverNow) clockOffset = serverNow - Date.now();
    refs.powerModalTitle.textContent = type === 'freeze' ? '🥶 You can freeze!' : '⚡ You can steal!';
    refs.powerModalDesc.textContent =
      type === 'freeze'
        ? 'You answered fastest and correctly. Freeze one opponent out of the next question, or skip.'
        : 'You answered fastest and correctly. Take 150 points from one opponent, or skip.';

    refs.powerOpponents.innerHTML = '';
    opponents.forEach((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = type === 'freeze' ? `${o.avatar || ''} ${o.name}` : `${o.avatar || ''} ${o.name} — ${o.score} pts`;
      btn.onclick = () => {
        const event = type === 'freeze' ? EVENTS.FREEZE_CHOOSE : EVENTS.STEAL_CHOOSE;
        socket.emit(event, { targetPlayerId: o.playerId });
        SoundFX.click();
        refs.powerModal.classList.add('hidden');
        if (powerRAF) cancelAnimationFrame(powerRAF);
      };
      refs.powerOpponents.appendChild(btn);
    });
    refs.powerModal.classList.remove('hidden');
    startPowerCountdown(decisionEndsAt);
  }

  refs.powerSkipBtn.addEventListener('click', () => {
    const event = pendingActiveType === 'freeze' ? EVENTS.FREEZE_CHOOSE : EVENTS.STEAL_CHOOSE;
    socket.emit(event, { targetPlayerId: null });
    refs.powerModal.classList.add('hidden');
    if (powerRAF) cancelAnimationFrame(powerRAF);
  });

  socket.on(EVENTS.STEAL_PROMPT, ({ opponents, decisionEndsAt, serverNow }) => showPowerPrompt('steal', opponents, decisionEndsAt, serverNow));
  socket.on(EVENTS.FREEZE_PROMPT, ({ opponents, decisionEndsAt, serverNow }) => showPowerPrompt('freeze', opponents, decisionEndsAt, serverNow));

  socket.on(EVENTS.STEAL_WAITING, ({ chooserName }) => {
    refs.powerWaitingBanner.classList.remove('hidden');
    refs.powerWaitingBanner.textContent = `⚡ Waiting for ${chooserName} to decide whether to steal…`;
  });
  socket.on(EVENTS.FREEZE_WAITING, ({ chooserName }) => {
    refs.powerWaitingBanner.classList.remove('hidden');
    refs.powerWaitingBanner.textContent = `🥶 Waiting for ${chooserName} to decide whether to freeze…`;
  });

  function afterPowerResult(leaderboard) {
    const oldRank = {};
    players.forEach((p, i) => { oldRank[p.playerId] = i; });
    rankChanges = {};
    leaderboard.forEach((p, i) => {
      if (oldRank[p.playerId] !== undefined && oldRank[p.playerId] !== i) rankChanges[p.playerId] = oldRank[p.playerId] - i;
    });
    players = leaderboard;
    syncMyStats();
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.miniLeaderboard.classList.remove('hidden');
    renderLiveBoard();
    rankChanges = {};
    clearTimeout(powerResultTimer);
    powerResultTimer = setTimeout(() => refs.powerResultBanner.classList.add('hidden'), 3800);
  }

  socket.on(EVENTS.STEAL_RESULT, ({ stealerId, targetId, pointsMoved, leaderboard }) => {
    refs.powerModal.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    const stealer = leaderboard.find((p) => p.playerId === stealerId);
    const target = targetId ? leaderboard.find((p) => p.playerId === targetId) : null;

    refs.powerResultBanner.classList.remove('hidden', 'good', 'frozen');
    replayAnimation(refs.powerResultBanner);
    if (pointsMoved > 0 && stealer && target) {
      refs.powerResultBanner.textContent = `⚡ ${stealer.name} stole ${pointsMoved} points from ${target.name}!`;
      refs.powerResultBanner.classList.add('good');
      SoundFX.steal();
      Engine.flash('rgba(255,210,63,0.3)');
      Engine.burst(refs.powerResultBanner, { kind: 'coin', count: 22 });
      pushFeed(`⚡ ${escapeHtml(stealer.name)} stole ${pointsMoved} from ${escapeHtml(target.name)}`);
      if (target.playerId === mySession.playerId) { vibrate([20, 40, 20, 40, 20]); Engine.shake(refs.questionCard); }
      else if (stealer.playerId === mySession.playerId) vibrate(60);
    } else {
      refs.powerResultBanner.textContent = `${stealer ? stealer.name : 'No one'} chose not to steal.`;
    }
    afterPowerResult(leaderboard);
  });

  socket.on(EVENTS.FREEZE_RESULT, ({ freezerId, targetId, targetName, leaderboard }) => {
    refs.powerModal.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    const freezer = leaderboard.find((p) => p.playerId === freezerId);

    refs.powerResultBanner.classList.remove('hidden', 'good', 'frozen');
    replayAnimation(refs.powerResultBanner);
    if (targetId && freezer) {
      refs.powerResultBanner.textContent = `🥶 ${freezer.name} froze ${targetName} out of the next question!`;
      refs.powerResultBanner.classList.add('frozen');
      SoundFX.freeze();
      Engine.flash('rgba(127,212,255,0.3)');
      Engine.burst(refs.powerResultBanner, { kind: 'star', count: 20, colors: ['#b8ecff', '#7fd4ff', '#ffffff'] });
      pushFeed(`🥶 ${escapeHtml(freezer.name)} froze ${escapeHtml(targetName)}`);
      if (targetId === mySession.playerId) vibrate([20, 60, 20, 60]);
    } else {
      refs.powerResultBanner.textContent = `${freezer ? freezer.name : 'No one'} chose not to freeze anyone.`;
    }
    afterPowerResult(leaderboard);
  });

  socket.on(EVENTS.GAME_FINAL, ({ leaderboard, podium }) => {
    if (questionRAF) cancelAnimationFrame(questionRAF);
    players = leaderboard;
    showView('final');
    renderFinal({ leaderboard, podium });
    SoundFX.win();
    vibrate([40, 60, 40, 60, 80]);
    Engine.celebrate();
    Engine.flash('rgba(255,255,255,0.5)');
  });

  socket.on(EVENTS.GAME_RESET_TO_LOBBY, ({ players: p }) => {
    players = p;
    myLifelines = 0;
    showLobby();
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
    socket.emit(EVENTS.ROOM_CREATE, { name, avatar: selectedAvatar, category: refs.categorySelect.value });
  });

  refs.quickBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    const name = requireName();
    if (!name) return;
    if (refs.categorySelect.value === 'custom') {
      showToast('Quick Play needs a ready-made category. For Study Mode, create a room.');
      return;
    }
    quickPending = true;
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_CREATE, { name, avatar: selectedAvatar, category: refs.categorySelect.value });
  });

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

  refs.lifelineBtn.addEventListener('click', useLifeline);

  refs.generateBtn.addEventListener('click', () => {
    SoundFX.click();
    const category = refs.studyCategorySelect.value;
    const subcategory = refs.studySubcategorySelect.value;
    if (!category) return showToast('Pick a category first.');
    const subject = !subcategory || subcategory === 'General (mixed topics)' ? category : `${category}: ${subcategory}`;
    socket.emit(EVENTS.QUESTIONS_GENERATE, { levelKey: refs.levelSelect.value, subject, count: 10 });
  });

  refs.addQuestionBtn.addEventListener('click', () => {
    SoundFX.click();
    const text = refs.manualQText.value.trim();
    const choices = [refs.manualOpt0.value.trim(), refs.manualOpt1.value.trim(), refs.manualOpt2.value.trim(), refs.manualOpt3.value.trim()];
    if (!text) return showToast('Enter the question text.');
    if (choices.some((c) => !c)) return showToast('Fill in all 4 options.');
    const correctRadio = document.querySelector('input[name="manualCorrect"]:checked');
    const correctIndex = correctRadio ? Number(correctRadio.value) : 0;
    socket.emit(EVENTS.QUESTION_ADD, { text, choices, correctIndex });
    refs.manualQText.value = '';
    refs.manualOpt0.value = '';
    refs.manualOpt1.value = '';
    refs.manualOpt2.value = '';
    refs.manualOpt3.value = '';
    document.getElementById('manualCorrect0').checked = true;
    refs.manualQText.focus();
  });

  refs.copyCodeBtn.addEventListener('click', async () => {
    SoundFX.click();
    const code = mySession.roomCode || '';
    try {
      await navigator.clipboard.writeText(code);
    } catch (e) {
      // Clipboard API unavailable (older browser, insecure context) — fall back to a hidden textarea.
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
    socket.emit(EVENTS.GAME_START);
  });
  refs.playAgainBtn.addEventListener('click', () => {
    SoundFX.click();
    socket.emit(EVENTS.GAME_PLAY_AGAIN);
  });

  // Keyboard answers on laptops/desktops: 1-4 or A-D.
  document.addEventListener('keydown', (e) => {
    if (activeView !== 'question' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase())) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined) selectChoice(idx);
    else if (e.key.toLowerCase() === 'f') useLifeline();
  });

  function openModal(modal) {
    modal.classList.remove('hidden');
  }
  // Tapping the dimmed backdrop closes info modals (not the power-round decision).
  [refs.howToPlayModal, refs.hallOfFameModal, refs.themeModal].forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });

  refs.howToPlayBtn.addEventListener('click', () => { SoundFX.click(); openModal(refs.howToPlayModal); });
  refs.closeHowToPlay.addEventListener('click', () => refs.howToPlayModal.classList.add('hidden'));

  refs.hallOfFameBtn.addEventListener('click', () => {
    SoundFX.click();
    populateLeaderboardCategorySelect();
    openModal(refs.hallOfFameModal);
    loadHallOfFame();
  });
  refs.closeHallOfFame.addEventListener('click', () => refs.hallOfFameModal.classList.add('hidden'));

  function populateLeaderboardCategorySelect() {
    if (refs.lbCategorySelect.options.length > 1) return; // already populated
    CATEGORIES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = `${c.emoji} ${c.label}`;
      refs.lbCategorySelect.appendChild(opt);
    });
  }

  refs.periodPills.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    SoundFX.click();
    lbPeriod = btn.dataset.period;
    [...refs.periodPills.children].forEach((p) => p.classList.toggle('active', p === btn));
    loadHallOfFame();
  });

  refs.lbCategorySelect.addEventListener('change', () => {
    lbCategory = refs.lbCategorySelect.value;
    lbSubject = '';
    refs.lbSubjectSelect.classList.add('hidden');
    refs.lbSubjectSelect.innerHTML = '<option value="">All Subjects</option>';
    if (lbCategory === 'custom') {
      fetch('/api/leaderboard/subjects?category=custom')
        .then((r) => r.json())
        .then(({ subjects }) => {
          if (!subjects || !subjects.length) return;
          subjects.forEach((s) => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            refs.lbSubjectSelect.appendChild(opt);
          });
          refs.lbSubjectSelect.classList.remove('hidden');
        })
        .catch(() => {});
    }
    loadHallOfFame();
  });

  refs.lbSubjectSelect.addEventListener('change', () => {
    lbSubject = refs.lbSubjectSelect.value;
    loadHallOfFame();
  });

  function formatRelativeDate(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function loadHallOfFame() {
    refs.hallOfFameList.innerHTML = '';
    refs.hallOfFameEmpty.classList.add('hidden');
    refs.hallOfFameUnavailable.classList.add('hidden');
    const params = new URLSearchParams({ period: lbPeriod });
    if (lbCategory) params.set('category', lbCategory);
    if (lbSubject) params.set('subject', lbSubject);
    fetch(`/api/leaderboard?${params.toString()}`)
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
          const metaBits = [s.subject || s.category || '', formatRelativeDate(s.playedAt)].filter(Boolean);
          const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
          row.innerHTML =
            `<div class="hof-rank">${rank}</div>` +
            `<div class="hof-avatar">${escapeHtml(s.avatar || '')}</div>` +
            `<div class="hof-info"><div class="hof-name">${escapeHtml(s.name)}</div>` +
            `<div class="hof-meta">${escapeHtml(metaBits.join(' · '))}</div></div>` +
            `<div class="hof-score">${s.score}</div>`;
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

  refs.themeBtn.addEventListener('click', () => {
    SoundFX.click();
    renderThemeSwatches();
    openModal(refs.themeModal);
  });
  refs.closeThemeModal.addEventListener('click', () => refs.themeModal.classList.add('hidden'));

  // ---- Boot ----
  Engine.init(currentTheme());
  const bootTheme = THEMES.find((t) => t.key === currentTheme());
  const bootMeta = document.querySelector('meta[name="theme-color"]');
  if (bootMeta && bootTheme) bootMeta.setAttribute('content', bootTheme.meta);

  refs.muteBtn.textContent = SoundFX.isMuted() ? '🔇' : '🔊';
  renderThemeSwatches();
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
