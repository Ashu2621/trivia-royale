(function () {
  const SESSION_KEY = 'triviaRoyaleSession';
  const QUESTION_DURATION_MS = 15000;

  const el = (id) => document.getElementById(id);

  const refs = {
    toast: el('toast'),
    nameInput: el('nameInput'),
    createBtn: el('createBtn'),
    joinCodeInput: el('joinCodeInput'),
    joinBtn: el('joinBtn'),

    lobbyCode: el('lobbyCode'),
    lobbyPlayers: el('lobbyPlayers'),
    startBtn: el('startBtn'),
    lobbyWaitingMsg: el('lobbyWaitingMsg'),
    lobbyNeedMoreMsg: el('lobbyNeedMoreMsg'),

    stealBadge: el('stealBadge'),
    qProgress: el('qProgress'),
    qTimer: el('qTimer'),
    timerFill: el('timerFill'),
    questionText: el('questionText'),
    choicesGrid: el('choicesGrid'),
    answerLockedMsg: el('answerLockedMsg'),
    revealBanner: el('revealBanner'),
    miniLeaderboard: el('miniLeaderboard'),

    stealModal: el('stealModal'),
    stealOpponents: el('stealOpponents'),
    stealSkipBtn: el('stealSkipBtn'),
    stealCountdown: el('stealCountdown'),
    stealWaitingBanner: el('stealWaitingBanner'),
    stealResultBanner: el('stealResultBanner'),

    podium: el('podium'),
    finalPlayers: el('finalPlayers'),
    playAgainBtn: el('playAgainBtn'),
    finalWaitingMsg: el('finalWaitingMsg'),

    howToPlayBtn: el('howToPlayBtn'),
    howToPlayModal: el('howToPlayModal'),
    closeHowToPlay: el('closeHowToPlay'),
  };

  let mySession = { playerId: null, roomCode: null, name: null, isCreator: false };
  let players = [];
  let currentQuestion = null;
  let selectedChoice = null;
  let activeView = 'home';
  let clockOffset = 0;
  let questionRAF = null;
  let stealRAF = null;
  let toastTimer = null;
  let stealResultTimer = null;

  function saveSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(mySession));
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
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

  function renderPlayerRows(container, list, showScore) {
    container.innerHTML = '';
    list.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.connected ? '' : ' disconnected');

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
      row.appendChild(left);

      if (showScore) {
        const right = document.createElement('div');
        right.className = 'pscore';
        right.textContent = p.score;
        row.appendChild(right);
      }
      container.appendChild(row);
    });
  }

  function renderLobbyControls() {
    refs.lobbyCode.textContent = mySession.roomCode || '----';
    const connectedCount = players.filter((p) => p.connected).length;
    if (mySession.isCreator) {
      refs.startBtn.classList.remove('hidden');
      refs.startBtn.disabled = connectedCount < 2;
      refs.lobbyWaitingMsg.classList.add('hidden');
      refs.lobbyNeedMoreMsg.classList.toggle('hidden', connectedCount >= 2);
    } else {
      refs.startBtn.classList.add('hidden');
      refs.lobbyWaitingMsg.classList.remove('hidden');
      refs.lobbyNeedMoreMsg.classList.add('hidden');
    }
  }

  function renderQuestion() {
    refs.qProgress.textContent = `Question ${currentQuestion.questionIndex + 1}/${currentQuestion.totalQuestions}`;
    refs.stealBadge.classList.toggle('hidden', !currentQuestion.isStealRound);
    refs.questionText.textContent = currentQuestion.text;

    const buttons = refs.choicesGrid.querySelectorAll('.choice');
    buttons.forEach((btn, i) => {
      btn.textContent = currentQuestion.choices[i];
      btn.disabled = false;
      btn.classList.remove('selected', 'correct', 'wrong', 'dim');
      btn.onclick = () => selectChoice(i);
    });

    refs.answerLockedMsg.classList.add('hidden');
    refs.revealBanner.classList.add('hidden');
    refs.miniLeaderboard.classList.add('hidden');
    refs.stealWaitingBanner.classList.add('hidden');
    refs.stealResultBanner.classList.add('hidden');
    refs.stealModal.classList.add('hidden');
  }

  function selectChoice(i) {
    if (selectedChoice !== null) return;
    selectedChoice = i;
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

  function startStealCountdown(endsAt) {
    if (stealRAF) cancelAnimationFrame(stealRAF);
    function tick() {
      const now = Date.now() + clockOffset;
      const remaining = Math.max(0, endsAt - now);
      refs.stealCountdown.textContent = Math.ceil(remaining / 1000);
      if (remaining > 0) stealRAF = requestAnimationFrame(tick);
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
        `<div class="pname">${escapeHtml(p.name)}</div>` +
        `<div class="pscore">${p.score} pts</div>`;
      refs.podium.appendChild(slot);
    });
    renderPlayerRows(refs.finalPlayers, data.leaderboard, true);
    if (mySession.isCreator) {
      refs.playAgainBtn.classList.remove('hidden');
      refs.finalWaitingMsg.classList.add('hidden');
    } else {
      refs.playAgainBtn.classList.add('hidden');
      refs.finalWaitingMsg.classList.remove('hidden');
    }
  }

  function applyRoomState(roomState) {
    players = roomState.players;
    if (roomState.state === 'lobby') {
      showView('lobby');
      renderPlayerRows(refs.lobbyPlayers, players, false);
      renderLobbyControls();
    } else if (roomState.state === 'question' && roomState.question) {
      currentQuestion = {
        ...roomState.question,
        questionIndex: roomState.questionIndex,
        totalQuestions: roomState.totalQuestions,
      };
      selectedChoice = null;
      showView('question');
      renderQuestion();
      startQuestionCountdown(roomState.question.questionEndsAt, roomState.question.serverNow);
    } else if (roomState.state === 'reveal' || roomState.state === 'steal_prompt') {
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
      renderPlayerRows(refs.lobbyPlayers, players, false);
      renderLobbyControls();
    }
  }

  // ---- Socket setup ----
  const socket = io();

  socket.on('connect', () => {
    const s = loadSession();
    if (s && s.roomCode && s.playerId && s.name) {
      mySession = s;
      socket.emit(EVENTS.ROOM_JOIN, { roomCode: s.roomCode, name: s.name, playerId: s.playerId });
    }
  });

  socket.on(EVENTS.ROOM_JOINED, (data) => {
    mySession = {
      playerId: data.playerId,
      roomCode: data.roomCode,
      name: mySession.name || refs.nameInput.value.trim(),
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
      renderPlayerRows(refs.lobbyPlayers, players, false);
      renderLobbyControls();
    }
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

  socket.on(EVENTS.QUESTION_REVEAL, ({ correctIndex, deltas, leaderboard, stealEligiblePlayerId }) => {
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
    } else {
      refs.revealBanner.textContent = selectedChoice === null ? "Time's up — no points" : 'Wrong answer — +0 points';
      refs.revealBanner.classList.add('bad');
    }
    refs.miniLeaderboard.classList.remove('hidden');
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.answerLockedMsg.classList.add('hidden');
  });

  socket.on(EVENTS.STEAL_PROMPT, ({ opponents, decisionEndsAt }) => {
    refs.stealOpponents.innerHTML = '';
    opponents.forEach((o) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${o.name} — ${o.score} pts`;
      btn.onclick = () => {
        socket.emit(EVENTS.STEAL_CHOOSE, { targetPlayerId: o.playerId });
        refs.stealModal.classList.add('hidden');
        if (stealRAF) cancelAnimationFrame(stealRAF);
      };
      refs.stealOpponents.appendChild(btn);
    });
    refs.stealModal.classList.remove('hidden');
    startStealCountdown(decisionEndsAt);
  });

  refs.stealSkipBtn.addEventListener('click', () => {
    socket.emit(EVENTS.STEAL_CHOOSE, { targetPlayerId: null });
    refs.stealModal.classList.add('hidden');
    if (stealRAF) cancelAnimationFrame(stealRAF);
  });

  socket.on(EVENTS.STEAL_WAITING, ({ stealerName }) => {
    refs.stealWaitingBanner.classList.remove('hidden');
    refs.stealWaitingBanner.textContent = `⚡ Waiting for ${stealerName} to decide whether to steal…`;
  });

  socket.on(EVENTS.STEAL_RESULT, ({ stealerId, targetId, pointsMoved, leaderboard }) => {
    refs.stealModal.classList.add('hidden');
    refs.stealWaitingBanner.classList.add('hidden');
    players = leaderboard;
    const stealer = leaderboard.find((p) => p.playerId === stealerId);
    const target = targetId ? leaderboard.find((p) => p.playerId === targetId) : null;

    refs.stealResultBanner.classList.remove('hidden', 'good');
    if (pointsMoved > 0 && stealer && target) {
      refs.stealResultBanner.textContent = `⚡ ${stealer.name} stole ${pointsMoved} points from ${target.name}!`;
      refs.stealResultBanner.classList.add('good');
    } else {
      refs.stealResultBanner.textContent = `${stealer ? stealer.name : 'No one'} chose not to steal.`;
    }
    renderPlayerRows(refs.miniLeaderboard, leaderboard.slice(0, 6), true);
    refs.miniLeaderboard.classList.remove('hidden');

    clearTimeout(stealResultTimer);
    stealResultTimer = setTimeout(() => refs.stealResultBanner.classList.add('hidden'), 3800);
  });

  socket.on(EVENTS.GAME_FINAL, ({ leaderboard, podium }) => {
    players = leaderboard;
    showView('final');
    renderFinal({ leaderboard, podium });
  });

  socket.on(EVENTS.GAME_RESET_TO_LOBBY, ({ players: p }) => {
    players = p;
    showView('lobby');
    renderPlayerRows(refs.lobbyPlayers, players, false);
    renderLobbyControls();
  });

  // ---- UI wiring ----
  refs.joinCodeInput.addEventListener('input', () => {
    refs.joinCodeInput.value = refs.joinCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  refs.createBtn.addEventListener('click', () => {
    const name = refs.nameInput.value.trim();
    if (!name) return showToast('Enter your name first.');
    mySession.name = name;
    socket.emit(EVENTS.ROOM_CREATE, { name });
  });

  refs.joinBtn.addEventListener('click', () => {
    const name = refs.nameInput.value.trim();
    const code = refs.joinCodeInput.value.trim().toUpperCase();
    if (!name) return showToast('Enter your name first.');
    if (code.length !== 4) return showToast('Enter the 4-letter room code.');
    mySession.name = name;
    socket.emit(EVENTS.ROOM_JOIN, { roomCode: code, name });
  });

  refs.startBtn.addEventListener('click', () => socket.emit(EVENTS.GAME_START));
  refs.playAgainBtn.addEventListener('click', () => socket.emit(EVENTS.GAME_PLAY_AGAIN));

  refs.howToPlayBtn.addEventListener('click', () => refs.howToPlayModal.classList.remove('hidden'));
  refs.closeHowToPlay.addEventListener('click', () => refs.howToPlayModal.classList.add('hidden'));

  // ---- Boot ----
  const existing = loadSession();
  if (existing && existing.name) refs.nameInput.value = existing.name;
  if (!existing || !existing.roomCode) showView('home');
})();
