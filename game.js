const MAX_PAIRS = 9;
const MISMATCH_DELAY = 850;

const elements = {
  startGame: document.querySelector('#startGame'),
  gameHeader: document.querySelector('#gameHeader'),
  gameMain: document.querySelector('#gameMain'),
  gamePlay: document.querySelector('#gamePlay'),
  gameStatus: document.querySelector('#gameStatus'),
  rankingBody: document.querySelector('#rankingBody'),
  gameBoard: document.querySelector('#gameBoard'),
  loadingPanel: document.querySelector('#gameLoading'),
  loadingText: document.querySelector('#gameLoadingText'),
  loadingBar: document.querySelector('#gameLoadingBar'),
  timer: document.querySelector('#gameTimer'),
  moves: document.querySelector('#gameMoves'),
  matches: document.querySelector('#gameMatches'),
  scoreModal: document.querySelector('#scoreModal'),
  scoreForm: document.querySelector('#scoreForm'),
  playerCode: document.querySelector('#playerCode'),
  finalTime: document.querySelector('#finalTime'),
  finalMoves: document.querySelector('#finalMoves'),
  scoreStatus: document.querySelector('#scoreStatus'),
  saveScore: document.querySelector('#saveScore'),
  skipScore: document.querySelector('#skipScore'),
};

const state = {
  records: [],
  cards: [],
  flipped: [],
  matchedPairs: 0,
  moves: 0,
  pairs: 0,
  startedAt: 0,
  elapsedMs: 0,
  timerId: null,
  locked: false,
  isPlaying: false,
  isLoading: false,
  loadToken: 0,
  audioContext: null,
};

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function getAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return null;
    }
    state.audioContext = new AudioContext();
  }

  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }

  return state.audioContext;
}

function playMatchSound() {
  const audioContext = getAudioContext();
  if (!audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  const notes = [523.25, 659.25, 783.99];

  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * 0.055;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  });
}

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function setStatus(message, type = '') {
  elements.gameStatus.textContent = message;
  elements.gameStatus.classList.remove('error', 'ready');
  if (type) {
    elements.gameStatus.classList.add(type);
  }
}

function setLoadingProgress(loaded, total) {
  const percent = total > 0 ? Math.round((loaded / total) * 100) : 100;
  elements.loadingText.textContent = `Loading cards... ${percent}%`;
  elements.loadingBar.style.width = `${percent}%`;
}

function showLoadingPanel() {
  elements.loadingPanel.hidden = false;
  setLoadingProgress(0, 1);
}

function hideLoadingPanel() {
  elements.loadingPanel.hidden = true;
}

function setScoreStatus(message, type = '') {
  const text = elements.scoreStatus.querySelector('span');
  const icon = elements.scoreStatus.querySelector('i, svg');
  text.textContent = message;
  elements.scoreStatus.classList.remove('error', 'ready', 'loading');
  if (type) {
    elements.scoreStatus.classList.add(type);
  }
  icon?.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : type === 'ready' ? 'circle-check' : 'info');
  refreshIcons();
}

function renderRanking(scores) {
  elements.rankingBody.innerHTML = '';

  if (!scores.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No rankings yet.';
    row.append(cell);
    elements.rankingBody.append(row);
    return;
  }

  scores.forEach((score, index) => {
    const row = document.createElement('tr');
    const rank = document.createElement('td');
    const code = document.createElement('td');
    const time = document.createElement('td');
    const moves = document.createElement('td');

    rank.textContent = index + 1;
    code.textContent = score.playerCode;
    time.textContent = formatTime(Number(score.timeMs || 0));
    moves.textContent = score.moves;
    row.append(rank, code, time, moves);
    elements.rankingBody.append(row);
  });
}

async function loadScores() {
  const response = await fetch('/api/game/scores');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Could not load ranking.');
  }
  renderRanking(result.scores || []);
}

async function loadCards() {
  const response = await fetch('/api/game/cards');
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Could not load cards.');
  }
  state.records = result.cards || [];
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildDeck() {
  const selected = shuffle(state.records).slice(0, Math.min(MAX_PAIRS, state.records.length));
  state.pairs = selected.length;
  return shuffle(selected.flatMap((record) => [
    {
      id: `${record.icNumber}-front-a`,
      matchKey: record.icNumber,
      imageUrl: record.frontThumbnailUrl,
      alt: `Card for ${record.name}`,
    },
    {
      id: `${record.icNumber}-front-b`,
      matchKey: record.icNumber,
      imageUrl: record.frontThumbnailUrl,
      alt: `Card for ${record.name}`,
    },
  ]));
}

function updateStats() {
  elements.timer.textContent = formatTime(state.elapsedMs);
  elements.moves.textContent = `${state.moves} move${state.moves === 1 ? '' : 's'}`;
  elements.matches.textContent = `${state.matchedPairs} / ${state.pairs} matched`;
}

function startTimer() {
  window.clearInterval(state.timerId);
  state.startedAt = Date.now();
  state.elapsedMs = 0;
  state.timerId = window.setInterval(() => {
    state.elapsedMs = Date.now() - state.startedAt;
    updateStats();
  }, 100);
}

function stopTimer() {
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.elapsedMs = Date.now() - state.startedAt;
  updateStats();
}

function createCard(card) {
  const button = document.createElement('button');
  const inner = document.createElement('span');
  const back = document.createElement('span');
  const label = document.createElement('strong');
  const front = document.createElement('img');

  button.className = 'match-card';
  button.type = 'button';
  button.dataset.id = card.id;
  button.dataset.matchKey = card.matchKey;
  button.setAttribute('aria-label', 'Face down match card');
  inner.className = 'match-card-inner';
  back.className = 'match-card-face match-card-backface';
  label.textContent = '?';
  label.setAttribute('aria-hidden', 'true');
  front.className = 'match-card-face match-card-frontface';
  front.src = card.imageUrl;
  front.alt = card.alt;
  back.append(label);
  inner.append(back, front);
  button.append(inner);
  button.addEventListener('click', () => flipCard(button));
  return button;
}

function renderBoard() {
  elements.gameBoard.innerHTML = '';
  state.cards.forEach((card) => {
    elements.gameBoard.append(createCard(card));
  });
}

function prepareGameState() {
  state.cards = buildDeck();
  state.flipped = [];
  state.matchedPairs = 0;
  state.moves = 0;
  state.elapsedMs = 0;
  state.locked = true;
  updateStats();
  elements.gameBoard.innerHTML = '';
}

function beginLoadedGame() {
  renderBoard();
  state.locked = false;
  state.isLoading = false;
  hideLoadingPanel();
  startTimer();
}

function preloadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ ok: true, url });
    image.onerror = () => resolve({ ok: false, url });
    image.src = url;
  });
}

async function preloadDeckImages(loadToken) {
  const imageUrls = [...new Set(state.cards.map((card) => card.imageUrl).filter(Boolean))];
  let loaded = 0;
  let failed = 0;

  setLoadingProgress(0, imageUrls.length);

  if (!imageUrls.length) {
    return { failed: 0, stale: state.loadToken !== loadToken };
  }

  await Promise.all(imageUrls.map(async (url) => {
    const result = await preloadImage(url);
    if (state.loadToken !== loadToken) {
      return;
    }

    loaded += 1;
    if (!result.ok) {
      failed += 1;
    }
    setLoadingProgress(loaded, imageUrls.length);
  }));

  return {
    failed,
    stale: state.loadToken !== loadToken,
  };
}

function setStartButtonMode(isPlaying) {
  const icon = elements.startGame.querySelector('i, svg');
  const label = elements.startGame.querySelector('span');
  elements.startGame.disabled = !isPlaying && state.records.length < 2;
  icon?.setAttribute('data-lucide', isPlaying ? 'rotate-cw' : 'play');
  if (label) {
    label.textContent = isPlaying ? 'Reset' : 'Start Game';
  }
  refreshIcons();
}

async function startGame() {
  if (state.records.length < 2) {
    return;
  }
  const loadToken = state.loadToken + 1;
  state.loadToken = loadToken;
  state.isLoading = true;
  state.isPlaying = true;
  window.clearInterval(state.timerId);
  state.timerId = null;
  elements.gameMain.hidden = true;
  elements.gamePlay.hidden = false;
  setStartButtonMode(true);
  showLoadingPanel();
  prepareGameState();
  setStatus('Loading selected cards...', 'ready');

  const result = await preloadDeckImages(loadToken);
  if (result.stale) {
    return;
  }

  beginLoadedGame();
  setStatus(result.failed > 0 ? 'Some cards could not preload.' : 'Game started.', result.failed > 0 ? 'error' : 'ready');
}

function finishGame() {
  stopTimer();
  elements.finalTime.textContent = formatTime(state.elapsedMs);
  elements.finalMoves.textContent = String(state.moves);
  elements.playerCode.value = '';
  setScoreStatus('Enter a name up to 8 characters.');
  elements.scoreModal.hidden = false;
  document.body.classList.add('modal-open');
  elements.playerCode.focus();
}

function returnToMain() {
  state.loadToken += 1;
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.locked = false;
  state.flipped = [];
  state.isPlaying = false;
  state.isLoading = false;
  hideLoadingPanel();
  elements.gameBoard.innerHTML = '';
  elements.scoreModal.hidden = true;
  elements.gamePlay.hidden = true;
  elements.gameMain.hidden = false;
  document.body.classList.remove('modal-open');
  setStartButtonMode(false);
  setStatus(`${state.records.length} cards available.`, 'ready');
}

function flipCard(button) {
  if (state.locked || button.classList.contains('flipped') || button.classList.contains('matched')) {
    return;
  }

  button.classList.add('flipped');
  button.setAttribute('aria-label', 'Revealed match card');
  state.flipped.push(button);

  if (state.flipped.length < 2) {
    return;
  }

  state.moves += 1;
  updateStats();
  const [first, second] = state.flipped;
  const isMatch = first.dataset.matchKey === second.dataset.matchKey;
  state.locked = true;

  if (isMatch) {
    playMatchSound();
    first.classList.add('matched');
    second.classList.add('matched');
    state.flipped = [];
    state.matchedPairs += 1;
    state.locked = false;
    updateStats();
    if (state.matchedPairs === state.pairs) {
      window.setTimeout(finishGame, 450);
    }
    return;
  }

  window.setTimeout(() => {
    first.classList.remove('flipped');
    second.classList.remove('flipped');
    first.setAttribute('aria-label', 'Face down match card');
    second.setAttribute('aria-label', 'Face down match card');
    state.flipped = [];
    state.locked = false;
  }, MISMATCH_DELAY);
}

function setSavingScore(isSaving) {
  elements.saveScore.disabled = isSaving;
  elements.skipScore.disabled = isSaving;
  elements.saveScore.classList.toggle('loading', isSaving);
  elements.saveScore.querySelector('i, svg')?.setAttribute('data-lucide', isSaving ? 'loader-circle' : 'trophy');
  elements.saveScore.querySelector('span').textContent = isSaving ? 'Saving...' : 'Save Ranking';
  refreshIcons();
}

async function submitScore(event) {
  event.preventDefault();
  const playerCode = elements.playerCode.value.trim().toUpperCase().slice(0, 8);
  if (!playerCode) {
    setScoreStatus('Name is required.', 'error');
    return;
  }

  setSavingScore(true);
  setScoreStatus('Saving ranking...', 'loading');

  try {
    const response = await fetch('/api/game/scores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerCode,
        timeMs: Math.round(state.elapsedMs),
        moves: state.moves,
        pairs: state.pairs,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Could not save ranking.');
    }

    renderRanking(result.scores || []);
    returnToMain();
  } catch (error) {
    setScoreStatus(error.message || 'Could not save ranking.', 'error');
  } finally {
    setSavingScore(false);
  }
}

async function init() {
  refreshIcons();
  setStatus('Loading game...');
  try {
    await Promise.all([loadCards(), loadScores()]);
    if (state.records.length < 2) {
      elements.startGame.disabled = true;
      setStatus('Not enough cards yet.', 'error');
    } else {
      elements.startGame.disabled = false;
      setStatus(`${state.records.length} cards available.`, 'ready');
    }
  } catch (error) {
    elements.startGame.disabled = true;
    setStatus(error.message || 'Could not load game.', 'error');
  }
}

elements.startGame.addEventListener('click', () => {
  if (state.isPlaying) {
    startGame();
    return;
  }
  startGame();
});
elements.scoreForm.addEventListener('submit', submitScore);
elements.skipScore.addEventListener('click', returnToMain);
elements.playerCode.addEventListener('input', () => {
  elements.playerCode.value = elements.playerCode.value.toUpperCase().slice(0, 8);
});

init();
