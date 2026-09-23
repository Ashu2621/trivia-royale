(function () {
  const SESSION_KEY = 'triviaRoyaleSession';
  const QUESTION_DURATION_MS = 15000;

  const el = (id) => document.getElementById(id);

  const refs = {
    toast: el('toast'),
    muteBtn: el('muteBtn'),
    nameInput: el('nameInput'),
    avatarPicker: el('avatarPicker'),
    categorySelect: el('categorySelect'),
    createBtn: el('createBtn'),
    joinCodeInput: el('joinCodeInput'),
    joinBtn: el('joinBtn'),

    lobbyCode: el('lobbyCode'),
    copyCodeBtn: el('copyCodeBtn'),
    lobbyQr: el('lobbyQr'),
    lobbyCategory: el('lobbyCategory'),
    lobbyPlayers: el('lobbyPlayers'),
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
    qTimer: el('qTimer'),
    timerFill: el('timerFill'),
    frozenNotice: el('frozenNotice'),
    questionText: el('questionText'),
    choicesGrid: el('choicesGrid'),
    answerLockedMsg: el('answerLockedMsg'),
    frozenLockedMsg: el('frozenLockedMsg'),
    revealBanner: el('revealBanner'),
    miniLeaderboard: el('miniLeaderboard'),

    powerModal: el('powerModal'),
    powerModalTitle: el('powerModalTitle'),
    powerModalDesc: el('powerModalDesc'),
    powerOpponents: el('powerOpponents'),
    powerSkipBtn: el('powerSkipBtn'),
    powerCountdown: el('powerCountdown'),
    powerWaitingBanner: el('powerWaitingBanner'),
    powerResultBanner: el('powerResultBanner'),

    podium: el('podium'),
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
  let selectedAvatar = '🦊'; // overwritten once /api/meta resolves or a saved session is restored
  let activeView = 'home';
  let clockOffset = 0;
  let questionRAF = null;
  let powerRAF = null;
  let toastTimer = null;
  let powerResultTimer = null;
  let pendingActiveType = null; // 'steal' | 'freeze' — which prompt is currently open
  let iAmFrozenThisQuestion = false;
  let currentPool = []; // [{text}] — this room's live custom/study question pool
  const MIN_QUESTIONS_TO_START = 4;
  let lbPeriod = 'all';
  let lbCategory = '';
  let lbSubject = '';

  // ---- Themes ----
  const THEME_KEY = 'triviaRoyaleTheme';
  const THEMES = [
    { key: 'midnight', label: 'Midnight', colors: ['#100e26', '#7c5cff', '#ffb84d'] },
    { key: 'ocean', label: 'Ocean', colors: ['#071a2b', '#22b8cf', '#ffd166'] },
    { key: 'sunset', label: 'Sunset', colors: ['#200f14', '#ff6b6b', '#ffb84d'] },
    { key: 'forest', label: 'Forest', colors: ['#0c1a13', '#2dd881', '#ffd166'] },
    { key: 'light', label: 'Daylight', colors: ['#f2f3fb', '#7c5cff', '#e08a1e'] },
  ];

  function applyTheme(key) {
    if (key === 'midnight') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', key);
    try { localStorage.setItem(THEME_KEY, key); } catch (e) { /* private mode etc — theme just won't persist */ }
    renderThemeSwatches();
  }

  function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'midnight'; } catch (e) { return 'midnight'; }
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
        `<div class="theme-swatch-name">${t.label}</div>`;
      btn.onclick = () => {
        SoundFX.click();
        applyTheme(t.key);
      };
      refs.themeSwatchGrid.appendChild(btn);
    });
  }

  // sessionStorage (not localStorage): reconnect-on-refresh should be per-tab,
  // not shared across every tab someone happens to have this game open in.
  function saveSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(mySession));
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
    sessionStorage.removeItem(SESSION_KEY);
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
    toastTimer = setTimeout(() => refs.toast.classList.add('hidden'), 3500);
  }

  function showView(id) {
    activeView = id;
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    el('view-' + id).classList.remove('hidden');
  }

  function amHost() {
    const me = players.find((p) => p.playerId === mySession.playerId);
    return !!(me && me.isCreator);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ---- Meta (avatars + categories + study levels) ----
  let AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐯', '🐨', '🐙', '🦉', '🐢', '🐷', '🦁'];
  let CATEGORIES = [{ key: 'general', label: 'General Knowledge', emoji: '🌍' }];
  let LEVELS = [];
  let AI_ENABLED = false;

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
      AI_ENABLED = !!meta.aiEnabled;
      const saved = loadSession();
      selectedAvatar = (saved && saved.avatar) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
      renderAvatarPicker();
      renderCategorySelect();
      renderLevelSelect();
      if (activeView === 'lobby') {
        renderLobbyControls();
        renderCustomPanel();
      }
    })
    .catch(() => {
      selectedAvatar = AVATARS[0];
      renderAvatarPicker();
      renderCategorySelect();
    });

  function renderPlayerRows(container, list, showScore, allowBotRemove) {
    container.innerHTML = '';
    list.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.connected ? '' : ' disconnected');

      const identity = document.createElement('div');
      identity.className = 'pidentity';

      const avatar = document.createElement('span');
      avatar.className = 'pavatar';
      avatar.textContent = p.avatar || '🙂';
      identity.appendChild(avatar);

      const left = document.createElement('div');
      left.className = 'pname';
      left.textContent = p.name;
      if (p.playerId === mySession.playerId) {
        const tag = document.createElement('span');
        tag.className = 'you-tag';
        tag.textContent = '(you)';
        left.appendChild(tag);
      }
      if (p.isCreator) {
        const tag = document.createElement('span');
        tag.className = 'host-tag';
        tag.textContent = '· host';
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

  function renderLobbyControls() {
    refs.lobbyCode.textContent = mySession.roomCode || '----';
    const connectedCount = players.filter((p) => p.connected).length;
    const needsMoreQuestions = currentCategory === 'custom' && currentPool.length < MIN_QUESTIONS_TO_START;
    if (amHost()) {
      refs.addBotBtn.classList.remove('hidden');
      refs.startBtn.classList.remove('hidden');
      refs.startBtn.disabled = connectedCount < 2 || needsMoreQuestions;
      refs.lobbyWaitingMsg.classList.add('hidden');
      refs.lobbyNeedMoreMsg.classList.toggle('hidden', connectedCount >= 2);
      refs.soloHint.classList.toggle('hidden', players.length >= 2);
    } else {
      refs.addBotBtn.classList.add('hidden');
      refs.soloHint.classList.add('hidden');
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

  function powerBadgeLabel(type) {
    return type === 'freeze' ? '🥶 FREEZE ROUND' : '⚡ STEAL ROUND';
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

    iAmFrozenThisQuestion = currentQuestion.frozenPlayerId === mySession.playerId;
    const frozenPlayer = players.find((p) => p.playerId === currentQuestion.frozenPlayerId);
    if (currentQuestion.frozenPlayerId && frozenPlayer) {
      refs.frozenNotice.textContent = iAmFrozenThisQuestion
        ? "🥶 You're frozen this round — sit this one out."
        : `🥶 ${frozenPlayer.name} is frozen this round.`;
      refs.frozenNotice.classList.remove('hidden');
    } else {
      refs.frozenNotice.classList.add('hidden');
    }

    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    buttons.forEach((btn, i) => {
      btn.textContent = currentQuestion.choices[i];
      btn.disabled = iAmFrozenThisQuestion;
      btn.classList.remove('selected', 'correct', 'wrong', 'dim');
      btn.onclick = iAmFrozenThisQuestion ? null : () => selectChoice(i);
    });

    refs.answerLockedMsg.classList.add('hidden');
    refs.frozenLockedMsg.classList.toggle('hidden', !iAmFrozenThisQuestion);
    refs.revealBanner.classList.add('hidden');
    refs.miniLeaderboard.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    refs.powerResultBanner.classList.add('hidden');
    refs.powerModal.classList.add('hidden');
  }

  function selectChoice(i) {
    if (selectedChoice !== null || iAmFrozenThisQuestion) return;
    selectedChoice = i;
    SoundFX.click();
    socket.emit(EVENTS.ANSWER_SUBMIT, { choiceIndex: i });
  }

  function startQuestionCountdown(endsAt, serverNow) {
    clockOffset = serverNow - Date.now();
    if (questionRAF) cancelAnimationFrame(questionRAF);
    function tick() {
      const now = Date.now() + clockOffset;
      const remaining = Math.max(0, endsAt - now);
      refs.qTimer.textContent = Math.ceil(remaining / 1000);
      const pct = Math.max(0, Math.min(1, remaining / QUESTION_DURATION_MS));
      refs.timerFill.style.width = pct * 100 + '%';
      refs.timerFill.classList.toggle('urgent', remaining < 5000);
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

  function renderFinal(data) {
    refs.podium.innerHTML = '';
    data.podium.forEach((p, i) => {
      const slot = document.createElement('div');
      slot.className = `podium-slot rank-${i + 1}`;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      slot.innerHTML =
        `<div class="medal">${medal}</div>` +
        `<div style="font-size:1.4rem">${escapeHtml(p.avatar || '')}</div>` +
        `<div class="pname">${escapeHtml(p.name)}</div>` +
        `<div class="pscore">${p.score} pts</div>`;
      refs.podium.appendChild(slot);
    });
    renderPlayerRows(refs.finalPlayers, data.leaderboard, true);
    if (amHost()) {
      refs.playAgainBtn.classList.remove('hidden');
      refs.finalWaitingMsg.classList.add('hidden');
    } else {
      refs.playAgainBtn.classList.add('hidden');
      refs.finalWaitingMsg.classList.remove('hidden');
    }
  }

  function applyRoomState(roomState) {
    players = roomState.players;
    currentCategory = roomState.category;
    currentPool = roomState.customPool ? roomState.customPool.questions : [];
    if (roomState.state === 'lobby') {
      showView('lobby');
      refs.lobbyCategory.textContent = categoryLabel(roomState.category);
      renderLobbyQr(mySession.roomCode);
      renderPlayerRows(refs.lobbyPlayers, players, false, true);
      renderLobbyControls();
      renderCustomPanel();
    } else if (roomState.state === 'question' && roomState.question) {
      currentQuestion = {
        ...roomState.question,
        questionIndex: roomState.questionIndex,
        totalQuestions: roomState.totalQuestions,
        frozenPlayerId: null,
      };
      selectedChoice = null;
      showView('question');
      renderQuestion();
      startQuestionCountdown(roomState.question.questionEndsAt, roomState.question.serverNow);
    } else if (roomState.state === 'reveal' || roomState.state === 'steal_prompt' || roomState.state === 'freeze_prompt') {
      showView('question');
      refs.questionText.textContent = 'Reconnected — syncing with the game…';
      refs.choicesGrid.querySelectorAll('.choice').forEach((btn) => {
        btn.textContent = '';
        btn.disabled = true;
      });
    } else if (roomState.state === 'final' && roomState.final) {
      showView('final');
      renderFinal(roomState.final);
    } else {
      showView('lobby');
      refs.lobbyCategory.textContent = categoryLabel(roomState.category);
      renderLobbyQr(mySession.roomCode);
      renderPlayerRows(refs.lobbyPlayers, players, false, true);
      renderLobbyControls();
      renderCustomPanel();
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
  });

  socket.on(EVENTS.ROOM_ERROR, ({ code, message }) => {
    showToast(message || 'Something went wrong.');
    if (code === 'ROOM_NOT_FOUND') {
      clearSession();
      showView('home');
    }
  });

  socket.on(EVENTS.PLAYER_LIST_UPDATE, ({ players: p }) => {
    players = p;
    if (activeView === 'lobby') {
      renderPlayerRows(refs.lobbyPlayers, players, false, true);
      renderLobbyControls();
      renderCustomPanel();
    } else if (activeView === 'final') {
      renderFinal({ leaderboard: players, podium: players.slice(0, 3) });
    }
  });

  socket.on(EVENTS.QUESTIONS_GENERATING, ({ level, subject }) => {
    refs.generateBtn.disabled = true;
    refs.generatingStatus.textContent = `🤖 Generating questions on "${subject}" for ${level}…`;
    refs.generatingStatus.classList.remove('hidden');
  });

  socket.on(EVENTS.QUESTION_POOL_UPDATE, ({ questions, count }) => {
    currentPool = questions || [];
    refs.generateBtn.disabled = false;
    refs.generatingStatus.classList.add('hidden');
    renderCustomPanel();
    renderLobbyControls();
  });

  socket.on(EVENTS.QUESTION_START, (payload) => {
    currentQuestion = payload;
    selectedChoice = null;
    showView('question');
    renderQuestion();
    startQuestionCountdown(payload.questionEndsAt, payload.serverNow);
  });

  socket.on(EVENTS.ANSWER_ACK, ({ choiceIndex }) => {
    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === choiceIndex) btn.classList.add('selected');
    });
    refs.answerLockedMsg.classList.remove('hidden');
  });

  socket.on(EVENTS.QUESTION_REVEAL, ({ correctIndex, deltas, leaderboard }) => {
    if (questionRAF) cancelAnimationFrame(questionRAF);
    players = leaderboard;
    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === correctIndex) btn.classList.add('correct');
      else btn.classList.add('dim');
      if (selectedChoice === i && i !== correctIndex) btn.classList.add('wrong');
    });

    const myDelta = deltas[mySession.playerId] || 0;
    refs.revealBanner.classList.remove('hidden', 'good', 'bad');
    if (myDelta > 0) {
      refs.revealBanner.textContent = `Correct! +${myDelta} points`;
      refs.revealBanner.classList.add('good');
      SoundFX.correct();
      vibrate(40);
    } else {
      refs.revealBanner.textContent = iAmFrozenThisQuestion
        ? "You were frozen this round — 0 points"
        : selectedChoice === null
        ? "Time's up — no points"
        : 'Wrong answer — +0 points';
      refs.revealBanner.classList.add('bad');
      if (!iAmFrozenThisQuestion) {
        SoundFX.wrong();
        vibrate([30, 50, 30]);
      }
    }
    refs.miniLeaderboard.classList.remove('hidden');
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.answerLockedMsg.classList.add('hidden');
  });

  function showPowerPrompt(type, opponents, decisionEndsAt) {
    pendingActiveType = type;
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

  socket.on(EVENTS.STEAL_PROMPT, ({ opponents, decisionEndsAt }) => showPowerPrompt('steal', opponents, decisionEndsAt));
  socket.on(EVENTS.FREEZE_PROMPT, ({ opponents, decisionEndsAt }) => showPowerPrompt('freeze', opponents, decisionEndsAt));

  socket.on(EVENTS.STEAL_WAITING, ({ chooserName }) => {
    refs.powerWaitingBanner.classList.remove('hidden');
    refs.powerWaitingBanner.textContent = `⚡ Waiting for ${chooserName} to decide whether to steal…`;
  });
  socket.on(EVENTS.FREEZE_WAITING, ({ chooserName }) => {
    refs.powerWaitingBanner.classList.remove('hidden');
    refs.powerWaitingBanner.textContent = `🥶 Waiting for ${chooserName} to decide whether to freeze…`;
  });

  socket.on(EVENTS.STEAL_RESULT, ({ stealerId, targetId, pointsMoved, leaderboard }) => {
    refs.powerModal.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    players = leaderboard;
    const stealer = leaderboard.find((p) => p.playerId === stealerId);
    const target = targetId ? leaderboard.find((p) => p.playerId === targetId) : null;

    refs.powerResultBanner.classList.remove('hidden', 'good', 'frozen');
    if (pointsMoved > 0 && stealer && target) {
      refs.powerResultBanner.textContent = `⚡ ${stealer.name} stole ${pointsMoved} points from ${target.name}!`;
      refs.powerResultBanner.classList.add('good');
      SoundFX.steal();
      if (target.playerId === mySession.playerId) vibrate([20, 40, 20, 40, 20]);
      else if (stealer.playerId === mySession.playerId) vibrate(60);
    } else {
      refs.powerResultBanner.textContent = `${stealer ? stealer.name : 'No one'} chose not to steal.`;
    }
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.miniLeaderboard.classList.remove('hidden');

    clearTimeout(powerResultTimer);
    powerResultTimer = setTimeout(() => refs.powerResultBanner.classList.add('hidden'), 3800);
  });

  socket.on(EVENTS.FREEZE_RESULT, ({ freezerId, targetId, targetName, leaderboard }) => {
    refs.powerModal.classList.add('hidden');
    refs.powerWaitingBanner.classList.add('hidden');
    players = leaderboard;
    const freezer = leaderboard.find((p) => p.playerId === freezerId);

    refs.powerResultBanner.classList.remove('hidden', 'good', 'frozen');
    if (targetId && freezer) {
      refs.powerResultBanner.textContent = `🥶 ${freezer.name} froze ${targetName} out of the next question!`;
      refs.powerResultBanner.classList.add('frozen');
      SoundFX.freeze();
      if (targetId === mySession.playerId) vibrate([20, 60, 20, 60]);
    } else {
      refs.powerResultBanner.textContent = `${freezer ? freezer.name : 'No one'} chose not to freeze anyone.`;
    }
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.miniLeaderboard.classList.remove('hidden');

    clearTimeout(powerResultTimer);
    powerResultTimer = setTimeout(() => refs.powerResultBanner.classList.add('hidden'), 3800);
  });

  socket.on(EVENTS.GAME_FINAL, ({ leaderboard, podium }) => {
    players = leaderboard;
    showView('final');
    renderFinal({ leaderboard, podium });
    SoundFX.win();
    vibrate([40, 60, 40, 60, 80]);
    fireConfetti();
  });

  socket.on(EVENTS.GAME_RESET_TO_LOBBY, ({ players: p }) => {
    players = p;
    showView('lobby');
    refs.lobbyCategory.textContent = categoryLabel(currentCategory);
    renderLobbyQr(mySession.roomCode);
    renderPlayerRows(refs.lobbyPlayers, players, false, true);
    renderLobbyControls();
    renderCustomPanel();
  });

  // ---- UI wiring ----
  refs.joinCodeInput.addEventListener('input', () => {
    refs.joinCodeInput.value = refs.joinCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  refs.createBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    const name = refs.nameInput.value.trim();
    if (!name) return showToast('Enter your name first.');
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_CREATE, { name, avatar: selectedAvatar, category: refs.categorySelect.value });
  });

  refs.joinBtn.addEventListener('click', () => {
    SoundFX.unlock();
    SoundFX.click();
    const name = refs.nameInput.value.trim();
    const code = refs.joinCodeInput.value.trim().toUpperCase();
    if (!name) return showToast('Enter your name first.');
    if (code.length !== 4) return showToast('Enter the 4-letter room code.');
    mySession.name = name;
    mySession.avatar = selectedAvatar;
    socket.emit(EVENTS.ROOM_JOIN, { roomCode: code, name, avatar: selectedAvatar });
  });

  refs.addBotBtn.addEventListener('click', () => {
    SoundFX.click();
    socket.emit(EVENTS.BOT_ADD);
  });

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
      // Clipboard API unavailable (older browser, insecure context) — fall back to a manual-select textarea.
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
    SoundFX.click();
    socket.emit(EVENTS.GAME_START);
  });
  refs.playAgainBtn.addEventListener('click', () => {
    SoundFX.click();
    socket.emit(EVENTS.GAME_PLAY_AGAIN);
  });

  refs.howToPlayBtn.addEventListener('click', () => refs.howToPlayModal.classList.remove('hidden'));
  refs.closeHowToPlay.addEventListener('click', () => refs.howToPlayModal.classList.add('hidden'));

  refs.hallOfFameBtn.addEventListener('click', () => {
    SoundFX.click();
    populateLeaderboardCategorySelect();
    refs.hallOfFameModal.classList.remove('hidden');
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
      fetch(`/api/leaderboard/subjects?category=custom`)
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
          const metaBits = [s.subject || s.category || '', formatRelativeDate(s.playedAt)].filter(Boolean);
          row.innerHTML =
            `<div class="hof-rank">${i + 1}</div>` +
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
    refs.themeModal.classList.remove('hidden');
  });
  refs.closeThemeModal.addEventListener('click', () => refs.themeModal.classList.add('hidden'));

  // ---- Boot ----
  refs.muteBtn.textContent = SoundFX.isMuted() ? '🔇' : '🔊';
  renderThemeSwatches();

  const existing = loadSession();
  if (existing && existing.name) refs.nameInput.value = existing.name;
  if (existing && existing.avatar) selectedAvatar = existing.avatar;

  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam && (!existing || !existing.roomCode)) {
    refs.joinCodeInput.value = joinParam.toUpperCase().slice(0, 4);
  }

  if (!existing || !existing.roomCode) showView('home');
})();
