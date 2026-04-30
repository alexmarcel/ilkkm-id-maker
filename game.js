const MAX_PAIRS = 8;
const MISMATCH_DELAY = 850;

const elements = {
  startGame: document.querySelector('#startGame'),
  newGame: document.querySelector('#newGame'),
  gameMain: document.querySelector('#gameMain'),
  gamePlay: document.querySelector('#gamePlay'),
  gameStatus: document.querySelector('#gameStatus'),
  rankingBody: document.querySelector('#rankingBody'),
  gameBoard: document.querySelector('#gameBoard'),
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
};

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
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
      id: `${record.icNumber}-front`,
      matchKey: record.icNumber,
      imageUrl: record.frontThumbnailUrl,
      alt: `Front card for ${record.name}`,
    },
    {
      id: `${record.icNumber}-back`,
      matchKey: record.icNumber,
      imageUrl: record.backThumbnailUrl,
      alt: `Back card for ${record.name}`,
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
  const icon = document.createElement('img');
  const front = document.createElement('img');

  button.className = 'match-card';
  button.type = 'button';
  button.dataset.id = card.id;
  button.dataset.matchKey = card.matchKey;
  button.setAttribute('aria-label', 'Face down match card');
  inner.className = 'match-card-inner';
  back.className = 'match-card-face match-card-backface';
  label.textContent = 'MATCH CARD';
  icon.src = '/icon.jpg';
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  front.className = 'match-card-face match-card-frontface';
  front.src = card.imageUrl;
  front.alt = card.alt;
  front.loading = 'lazy';
  back.append(label, icon);
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

function resetGameState() {
  state.cards = buildDeck();
  state.flipped = [];
  state.matchedPairs = 0;
  state.moves = 0;
  state.elapsedMs = 0;
  state.locked = false;
  updateStats();
  renderBoard();
}

function startGame() {
  if (state.records.length < 2) {
    return;
  }
  elements.gameMain.hidden = true;
  elements.gamePlay.hidden = false;
  resetGameState();
  startTimer();
  setStatus('Game started.', 'ready');
}

function finishGame() {
  stopTimer();
  elements.finalTime.textContent = formatTime(state.elapsedMs);
  elements.finalMoves.textContent = String(state.moves);
  elements.playerCode.value = '';
  setScoreStatus('Enter up to 8 characters.');
  elements.scoreModal.hidden = false;
  document.body.classList.add('modal-open');
  elements.playerCode.focus();
}

function returnToMain() {
  elements.scoreModal.hidden = true;
  elements.gamePlay.hidden = true;
  elements.gameMain.hidden = false;
  document.body.classList.remove('modal-open');
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
    setScoreStatus('Ranking code is required.', 'error');
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

elements.startGame.addEventListener('click', startGame);
elements.newGame.addEventListener('click', () => {
  resetGameState();
  startTimer();
});
elements.scoreForm.addEventListener('submit', submitScore);
elements.skipScore.addEventListener('click', returnToMain);
elements.playerCode.addEventListener('input', () => {
  elements.playerCode.value = elements.playerCode.value.toUpperCase().slice(0, 8);
});

init();
