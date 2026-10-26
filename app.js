'use strict';

const STORAGE_KEY = 'back-track:v1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const els = {
  setupScreen: $('#setupScreen'),
  playScreen: $('#playScreen'),
  winScreen: $('#winScreen'),
  resumeBtn: $('#resumeBtn'),
  playerList: $('#playerList'),
  addPlayerForm: $('#addPlayerForm'),
  newPlayer: $('#newPlayer'),
  modeHelp: $('#modeHelp'),
  lengthLabel: $('#lengthLabel'),
  lengthGroup: $('#lengthGroup'),
  fromYear: $('#fromYear'),
  toYear: $('#toYear'),
  songCount: $('#songCount'),
  startBtn: $('#startBtn'),
  howBtn: $('#howBtn'),
  howDialog: $('#howDialog'),
  quitBtn: $('#quitBtn'),
  confirmDialog: $('#confirmDialog'),
  roundLabel: $('#roundLabel'),
  scoreboard: $('#scoreboard'),
  turnLabel: $('#turnLabel'),
  songCard: $('#songCard'),
  record: $('#record'),
  art: $('#art'),
  songYear: $('#songYear'),
  songTitle: $('#songTitle'),
  songArtist: $('#songArtist'),
  playBtn: $('#playBtn'),
  progressBar: $('#progressBar'),
  playerNote: $('#playerNote'),
  timelinePanel: $('#timelinePanel'),
  timelineTitle: $('#timelineTitle'),
  timeline: $('#timeline'),
  guessPanel: $('#guessPanel'),
  guessList: $('#guessList'),
  resultLabel: $('#resultLabel'),
  lockBtn: $('#lockBtn'),
  nextBtn: $('#nextBtn'),
  winnerName: $('#winnerName'),
  winnerNote: $('#winnerNote'),
  standings: $('#standings'),
  againBtn: $('#againBtn'),
  newGameBtn: $('#newGameBtn'),
  audio: $('#audio'),
};

// ---- Songs ----
// SONGS (from songs.js) is a list of [year, title, artist, appleTrackId].

const song = (i) => {
  const [year, title, artist, id] = SONGS[i];
  return { year, title, artist, id };
};
const FIRST_DECADE = Math.floor(Math.min(...SONGS.map((s) => s[0])) / 10) * 10;
const LAST_YEAR = Math.max(...SONGS.map((s) => s[0]));
const LAST_DECADE = Math.floor(LAST_YEAR / 10) * 10;

const LENGTHS = { timeline: [5, 8, 10], year: [5, 10, 15] };

const MODE_HELP = {
  timeline: 'Take turns placing each song in your own timeline. Place it right to keep the card.',
  year: 'Everyone guesses the year of every song. Closest guesses score the most.',
};
// ---- State ----
// settings: { players: [name], mode: 'timeline' | 'year', length: { timeline, year }, from, to }
// game (while playing): {
//   mode, target, players: [{ name, cards: [songIndex], score, missed }],
//   deck: [songIndex], turn, round, current: songIndex,
//   phase: 'guess' | 'reveal', slot, guesses: [year], result, over }

function loadState() {
  const fresh = {
    settings: { players: [], mode: 'timeline', length: { timeline: 8, year: 10 }, from: FIRST_DECADE, to: LAST_DECADE },
    game: null,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.settings) return { ...fresh, ...saved, settings: { ...fresh.settings, ...saved.settings } };
  } catch { /* fall through to a fresh state */ }
  return fresh;
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage full or unavailable; keep running in memory */ }
}

const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

function songsInRange() {
  const { from, to } = state.settings;
  return SONGS.map((_, i) => i).filter((i) => SONGS[i][0] >= from && SONGS[i][0] <= to + 9);
}

// ---- Music ----
// Each song's preview clip, artwork and Apple Music link come from the iTunes
// lookup API, fetched once and remembered for the session.

const media = new Map();
// The same results once they've arrived, so a tap can use them without waiting.
const ready = new Map();

function getMedia(i) {
  if (!media.has(i)) {
    const request = fetch(`https://itunes.apple.com/lookup?country=US&entity=song&id=${song(i).id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const hit = data.results.find((r) => r.kind === 'song') || {};
        const m = {
          preview: hit.previewUrl || '',
          art: hit.artworkUrl100 ? hit.artworkUrl100.replace('100x100', '300x300') : '',
        };
        ready.set(i, m);
        return m;
      });
    request.catch(() => media.delete(i)); // let a later attempt retry
    media.set(i, request);
  }
  return media.get(i);
}

function stopAudio() {
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  els.playBtn.classList.remove('playing', 'loading');
  els.record.classList.remove('playing');
  els.progressBar.style.width = '0';
}

// How many songs in a row may be skipped before we assume the connection is
// down, rather than working through the whole deck.
const MAX_SKIPS = 5;
let skips = 0;

// When a song's clip can't be played, quietly swap in another song. Only
// while guessing: once revealed, the song has already been scored.
function skipSong() {
  const game = state.game;
  if (game.phase === 'guess' && game.deck.length && skips < MAX_SKIPS) {
    skips++;
    game.current = game.deck.pop();
    save();
    loadCurrentSong();
    return;
  }
  autoplay = false;
  els.playBtn.classList.remove('loading');
  els.playerNote.textContent = 'Couldn\'t load a song. Check your connection and tap play to try again.';
}

// True from tapping Next turn until the new song starts, so it plays without
// another tap.
let autoplay = false;

function startPlayback() {
  els.audio.play().catch(() => {
    els.playerNote.textContent = 'Tap play to start the music.';
  });
  autoplay = false;
}

// Load the current song so the play button can start it straight away (iOS
// only allows audio to start directly from a tap).
function loadCurrentSong() {
  const game = state.game;
  const i = game.current;
  stopAudio();
  els.playerNote.textContent = '';

  const use = (m) => {
    els.playBtn.classList.remove('loading');
    els.audio.src = m.preview;
    if (autoplay) startPlayback();
    if (game.phase === 'reveal' && m.art) showArt(m.art);
  };

  // Usually the clip was fetched ahead of time: use it right away, while
  // we're still inside the tap that got us here.
  const known = ready.get(i);
  if (known && known.preview) {
    use(known);
    if (game.deck.length) getMedia(game.deck[game.deck.length - 1]).catch(() => {});
    return;
  }

  els.playBtn.classList.add('loading');
  getMedia(i).then((m) => {
    if (state.game !== game || game.current !== i) return;
    if (!m.preview) { skipSong(); return; }
    use(m);
  }).catch(() => {
    if (state.game !== game || game.current !== i) return;
    skipSong();
  });

  // Fetch the next song too so it's ready when the turn changes.
  if (game.deck.length) getMedia(game.deck[game.deck.length - 1]).catch(() => {});
}

function showArt(src) {
  els.art.src = src;
  els.art.hidden = false;
}

els.playBtn.addEventListener('click', () => {
  const audio = els.audio;
  if (!audio.getAttribute('src')) { skips = 0; loadCurrentSong(); return; }
  if (audio.paused) audio.play().catch(() => { els.playerNote.textContent = 'Tap play again to start the music.'; });
  else audio.pause();
});

els.audio.addEventListener('play', () => {
  // Keep the lock screen and Control Center from giving the song away.
  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Mystery song', artist: 'Back Track' });
  }
  els.playBtn.classList.add('playing');
  els.record.classList.add('playing');
  els.playerNote.textContent = '';
});
// The clip loaded fine, so the connection is working.
els.audio.addEventListener('loadedmetadata', () => { skips = 0; });
// The clip itself is broken or missing.
els.audio.addEventListener('error', () => {
  if (els.audio.getAttribute('src')) skipSong();
});
els.audio.addEventListener('pause', () => {
  els.playBtn.classList.remove('playing');
  els.record.classList.remove('playing');
});
els.audio.addEventListener('timeupdate', () => {
  const { currentTime, duration } = els.audio;
  els.progressBar.style.width = duration ? `${(currentTime / duration) * 100}%` : '0';
});

// ---- Setup screen ----

function show(screen) {
  for (const s of [els.setupScreen, els.playScreen, els.winScreen]) s.hidden = s !== screen;
  window.scrollTo(0, 0);
}

function renderSetup() {
  const { settings } = state;

  els.playerList.replaceChildren(...settings.players.map((name, i) => {
    const li = document.createElement('li');
    li.textContent = name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.addEventListener('click', () => {
      settings.players.splice(i, 1);
      save();
      renderSetup();
    });
    li.append(remove);
    return li;
  }));

  for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode));
  els.modeHelp.textContent = MODE_HELP[settings.mode];
  els.lengthLabel.textContent = settings.mode === 'timeline' ? 'Cards to win' : 'Rounds';
  els.lengthGroup.replaceChildren(...LENGTHS[settings.mode].map((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = n;
    b.setAttribute('aria-pressed', String(settings.length[settings.mode] === n));
    b.addEventListener('click', () => {
      settings.length[settings.mode] = n;
      save();
      renderSetup();
    });
    return b;
  }));

  const decades = [];
  for (let d = FIRST_DECADE; d <= LAST_DECADE; d += 10) decades.push(d);
  const options = (selected) => decades.map((d) => new Option(`${d}s`, d, false, d === selected));
  els.fromYear.replaceChildren(...options(settings.from));
  els.toYear.replaceChildren(...options(settings.to));

  const count = songsInRange().length;
  const needed = neededSongs();
  els.songCount.textContent = `${count} songs from ${settings.from} to ${Math.min(settings.to + 9, LAST_YEAR)}.`
    + (count < needed ? ` That's not enough for this game; widen the years.` : '');
  els.startBtn.disabled = settings.players.length === 0 || count < needed;

  els.resumeBtn.hidden = !(state.game && !state.game.over);
}

function neededSongs() {
  const { settings } = state;
  const players = Math.max(1, settings.players.length);
  return settings.mode === 'timeline' ? players * 2 : settings.length.year;
}

els.addPlayerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.newPlayer.value.trim();
  if (!name) return;
  state.settings.players.push(name);
  els.newPlayer.value = '';
  save();
  renderSetup();
});

for (const b of $$('[data-mode]')) {
  b.addEventListener('click', () => {
    state.settings.mode = b.dataset.mode;
    save();
    renderSetup();
  });
}

els.fromYear.addEventListener('change', () => {
  state.settings.from = +els.fromYear.value;
  if (state.settings.to < state.settings.from) state.settings.to = state.settings.from;
  save();
  renderSetup();
});
els.toYear.addEventListener('change', () => {
  state.settings.to = +els.toYear.value;
  if (state.settings.from > state.settings.to) state.settings.from = state.settings.to;
  save();
  renderSetup();
});

els.howBtn.addEventListener('click', () => els.howDialog.showModal());
els.startBtn.addEventListener('click', startGame);
els.resumeBtn.addEventListener('click', () => {
  show(els.playScreen);
  renderPlay();
  loadCurrentSong();
});

// ---- Game ----

function startGame() {
  const { settings } = state;
  const deck = shuffle(songsInRange());
  const game = {
    mode: settings.mode,
    target: settings.length[settings.mode],
    // In the timeline game everyone starts with one card already face up.
    players: settings.players.map((name) => ({ name, cards: settings.mode === 'timeline' ? [deck.pop()] : [], score: 0, missed: 0 })),
    deck,
    turn: 0,
    round: 1,
    current: deck.pop(),
    phase: 'guess',
    slot: null,
    guesses: [],
    result: null,
    over: false,
  };
  const middle = Math.round((settings.from + Math.min(settings.to + 9, LAST_YEAR)) / 2);
  game.guesses = game.players.map(() => middle);
  state.game = game;
  save();
  show(els.playScreen);
  renderPlay();
  loadCurrentSong();
}

const byYear = (a, b) => SONGS[a][0] - SONGS[b][0];

function renderPlay() {
  const game = state.game;
  const current = game.players[game.turn];
  const s = song(game.current);
  const revealed = game.phase === 'reveal';

  els.roundLabel.textContent = game.mode === 'year' ? `Round ${game.round} of ${game.target}` : `Round ${game.round}`;

  els.scoreboard.replaceChildren(...game.players.map((p, i) => {
    const li = document.createElement('li');
    if (game.mode === 'timeline' && i === game.turn) li.className = 'current';
    const name = document.createElement('span');
    name.textContent = p.name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = game.mode === 'timeline' ? `${p.cards.length}/${game.target}` : p.score;
    li.append(name, pts);
    if (p.missed) {
      const missed = document.createElement('span');
      missed.className = 'missed';
      missed.textContent = `✕${p.missed}`;
      missed.setAttribute('aria-label', `${p.missed} missed`);
      li.append(missed);
    }
    return li;
  }));

  els.turnLabel.textContent = game.mode === 'timeline'
    ? (game.players.length > 1 ? `${current.name}'s turn` : 'Your turn')
    : 'Everyone guess!';

  els.songCard.classList.toggle('revealed', revealed);
  els.songYear.textContent = revealed ? s.year : '?';
  els.songTitle.textContent = revealed ? s.title : 'Mystery song';
  els.songArtist.textContent = revealed ? s.artist : '';
  if (!revealed) els.art.hidden = true;

  els.timelinePanel.hidden = game.mode !== 'timeline';
  els.guessPanel.hidden = game.mode !== 'year';
  if (game.mode === 'timeline') renderTimeline(current, s, revealed);
  else renderGuesses(s, revealed);

  els.resultLabel.hidden = !revealed;
  if (revealed) {
    els.resultLabel.textContent = game.result.text;
    els.resultLabel.className = `result ${game.result.good ? 'good' : 'bad'}`;
  }

  els.lockBtn.hidden = revealed;
  els.lockBtn.disabled = game.mode === 'timeline' && game.slot === null;
  els.nextBtn.hidden = !revealed;
  els.nextBtn.textContent = isGameOver() ? 'See the winner' : 'Next turn';
}

function cardItem(i, extraClass) {
  const s = song(i);
  const li = document.createElement('li');
  li.className = `tl-card ${extraClass || ''}`;
  const y = document.createElement('span');
  y.className = 'y';
  y.textContent = s.year;
  const text = document.createElement('div');
  text.style.minWidth = '0';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = s.title;
  const a = document.createElement('div');
  a.className = 'a';
  a.textContent = s.artist;
  text.append(t, a);
  li.append(y, text);
  return li;
}

function renderTimeline(player, s, revealed) {
  const game = state.game;
  const cards = [...player.cards].sort(byYear);
  els.timelineTitle.textContent = revealed
    ? `${player.name}'s timeline`
    : 'Where does this song fit?';
  els.timeline.classList.toggle('locked', revealed);

  const items = [];
  if (revealed) {
    // Show the song where it really belongs: kept if right, faded if wrong.
    const shown = game.result.good ? cards : [...cards, game.current].sort(byYear);
    for (const i of shown) items.push(cardItem(i, i === game.current ? (game.result.good ? 'new' : 'wrong') : ''));
  } else {
    for (let slot = 0; slot <= cards.length; slot++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot';
      const before = cards[slot - 1];
      const after = cards[slot];
      b.textContent = cards.length === 0 ? 'Place it here'
        : before === undefined ? `Before ${SONGS[after][0]}`
        : after === undefined ? `After ${SONGS[before][0]}`
        : `Between ${SONGS[before][0]} and ${SONGS[after][0]}`;
      b.setAttribute('aria-pressed', String(game.slot === slot));
      b.addEventListener('click', () => {
        game.slot = slot;
        save();
        renderPlay();
      });
      const li = document.createElement('li');
      li.append(b);
      items.push(li);
      if (after !== undefined) items.push(cardItem(after));
    }
  }
  els.timeline.replaceChildren(...items);
}

const points = (guess, year) => {
  const off = Math.abs(guess - year);
  return off === 0 ? 3 : off <= 2 ? 2 : off <= 5 ? 1 : 0;
};

function renderGuesses(s, revealed) {
  const game = state.game;
  els.guessList.replaceChildren(...game.players.map((p, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    li.append(name);

    if (revealed) {
      const got = points(game.guesses[i], s.year);
      const verdict = document.createElement('span');
      verdict.className = `verdict ${got ? 'good' : 'bad'}`;
      verdict.textContent = `${game.guesses[i]} · ${got ? `+${got}` : '0'}`;
      li.append(verdict);
      return li;
    }

    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `${p.name}: one year earlier`);
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.value = game.guesses[i];
    input.setAttribute('aria-label', `${p.name}'s guess`);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `${p.name}: one year later`);
    const set = (year) => {
      game.guesses[i] = year;
      input.value = year;
      save();
    };
    minus.addEventListener('click', () => set(game.guesses[i] - 1));
    plus.addEventListener('click', () => set(game.guesses[i] + 1));
    input.addEventListener('change', () => {
      const year = parseInt(input.value, 10);
      set(Number.isFinite(year) ? year : game.guesses[i]);
    });
    stepper.append(minus, input, plus);
    li.append(stepper);
    return li;
  }));
}

els.lockBtn.addEventListener('click', () => {
  const game = state.game;
  const s = song(game.current);
  if (game.mode === 'timeline') {
    const player = game.players[game.turn];
    const cards = [...player.cards].sort(byYear);
    const before = cards[game.slot - 1];
    const after = cards[game.slot];
    const good = (before === undefined || SONGS[before][0] <= s.year)
      && (after === undefined || SONGS[after][0] >= s.year);
    if (good) player.cards.push(game.current);
    else player.missed = (player.missed || 0) + 1;
    game.result = { good, text: good ? 'Nailed it! The card is yours.' : 'Not quite. The card goes back.' };
  } else {
    // Read any year still being typed before scoring.
    const active = document.activeElement;
    if (active && active.matches('.stepper input')) active.dispatchEvent(new Event('change'));
    const scores = game.guesses.map((g) => points(g, s.year));
    game.players.forEach((p, i) => {
      p.score += scores[i];
      if (!scores[i]) p.missed = (p.missed || 0) + 1;
    });
    const exact = game.players.filter((_, i) => scores[i] === 3).map((p) => p.name);
    game.result = {
      good: scores.some((n) => n > 0),
      text: exact.length ? `Spot on: ${exact.join(', ')}!` : scores.some((n) => n > 0) ? 'Close!' : 'Nobody got close.',
    };
  }
  game.phase = 'reveal';
  save();
  renderPlay();
  getMedia(game.current).then((m) => { if (state.game === game && m.art) showArt(m.art); }).catch(() => {});
});

function isGameOver() {
  const game = state.game;
  if (game.mode === 'timeline') return game.players.some((p) => p.cards.length >= game.target) || game.deck.length === 0;
  return game.round >= game.target || game.deck.length === 0;
}

els.nextBtn.addEventListener('click', () => {
  const game = state.game;
  if (isGameOver()) {
    game.over = true;
    save();
    stopAudio();
    renderWin();
    return;
  }
  if (game.mode === 'timeline') {
    game.turn = (game.turn + 1) % game.players.length;
    if (game.turn === 0) game.round++;
  } else {
    game.round++;
  }
  game.current = game.deck.pop();
  game.phase = 'guess';
  game.slot = null;
  game.result = null;
  save();
  renderPlay();
  autoplay = true;
  loadCurrentSong();
  window.scrollTo(0, 0);
});

els.quitBtn.addEventListener('click', () => els.confirmDialog.showModal());
els.confirmDialog.addEventListener('close', () => {
  if (els.confirmDialog.returnValue !== 'ok') return;
  stopAudio();
  state.game = null;
  save();
  renderSetup();
  show(els.setupScreen);
});

// ---- Winner ----

function renderWin() {
  const game = state.game;
  const scoreOf = (p) => (game.mode === 'timeline' ? p.cards.length : p.score);
  const ranked = [...game.players].sort((a, b) => scoreOf(b) - scoreOf(a));
  const best = scoreOf(ranked[0]);
  const winners = ranked.filter((p) => scoreOf(p) === best).map((p) => p.name);
  const unit = game.mode === 'timeline' ? 'cards' : 'points';

  els.winnerName.textContent = winners.length > 1 ? `It's a tie!` : game.players.length > 1 ? `${winners[0]} wins!` : 'Game over!';
  els.winnerNote.textContent = winners.length > 1 ? `${winners.join(' & ')} with ${best} ${unit}` : `${best} ${unit}`;
  els.standings.replaceChildren(...ranked.map((p) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = `${scoreOf(p)} ${unit}`;
    const missed = document.createElement('span');
    missed.className = 'missed';
    missed.textContent = `${p.missed || 0} missed`;
    const right = document.createElement('span');
    right.className = 'standing-scores';
    right.append(pts, missed);
    li.append(name, right);
    return li;
  }));
  show(els.winScreen);
}

els.againBtn.addEventListener('click', startGame);
els.newGameBtn.addEventListener('click', () => {
  state.game = null;
  save();
  renderSetup();
  show(els.setupScreen);
});

// ---- Start up ----

renderSetup();
if (state.game && state.game.over) renderWin();
else show(els.setupScreen);

// ---- Offline support ----

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable */ });
  });
}
