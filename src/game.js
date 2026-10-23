const express = require('express');
const QRCode = require('qrcode');
const { requireAuth, userFromCookieHeader } = require('./auth');
const { loadQuiz } = require('./quizzes');

// Laufende Spiele liegen nur im Speicher (pin -> game)
const games = new Map();
let io;

function generatePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (games.has(pin));
  return pin;
}

// Punkte für eine Antwort; später leicht austauschbar
function scoreAnswer(game, answer) {
  const q = game.quiz.questions[game.questionIndex];
  if (answer.choice !== q.correct) return 0;
  const elapsed = (answer.at - game.questionStartedAt) / 1000;
  const speed = Math.max(0, 1 - elapsed / q.timeLimit);
  return Math.round(500 + 500 * speed);
}

function currentQuestion(game) {
  return game.quiz.questions[game.questionIndex];
}

function rankedPlayers(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ username: p.username, score: p.score, connected: p.connected }));
}

function distribution(game) {
  const counts = currentQuestion(game).answers.map(() => 0);
  for (const a of game.answers.values()) counts[a.choice]++;
  return counts;
}

function hostView(game) {
  const view = {
    pin: game.pin,
    title: game.quiz.title,
    state: game.state,
    questionIndex: game.questionIndex,
    total: game.quiz.questions.length,
    players: rankedPlayers(game),
  };
  if (game.state === 'question' || game.state === 'reveal') {
    const q = currentQuestion(game);
    view.question = { text: q.text, answers: q.answers, timeLimit: q.timeLimit };
    view.endsAt = game.endsAt;
    view.answeredCount = game.answers.size;
  }
  if (game.state === 'reveal') {
    view.question.correct = currentQuestion(game).correct;
    view.distribution = distribution(game);
  }
  return view;
}

function playerView(game, player) {
  const ranking = rankedPlayers(game);
  const view = {
    pin: game.pin,
    title: game.quiz.title,
    state: game.state,
    questionIndex: game.questionIndex,
    total: game.quiz.questions.length,
    username: player.username,
    score: player.score,
    rank: ranking.findIndex((p) => p.username === player.username) + 1,
    playerCount: ranking.length,
  };
  if (game.state === 'question' || game.state === 'reveal') {
    const q = currentQuestion(game);
    const mine = game.answers.get(player.userId);
    view.question = { text: q.text, answers: q.answers };
    view.endsAt = game.endsAt;
    view.myAnswer = mine ? mine.choice : null;
    if (game.state === 'reveal') {
      view.question.correct = q.correct;
      view.lastPoints = mine ? mine.points : 0;
    }
  }
  return view;
}

function broadcast(game) {
  io.to(`host:${game.pin}`).emit('game:state', hostView(game));
  for (const player of game.players.values()) {
    if (player.socketId) io.to(player.socketId).emit('game:state', playerView(game, player));
  }
}

function startQuestion(game, index) {
  clearTimeout(game.timer);
  game.state = 'question';
  game.questionIndex = index;
  game.answers = new Map();
  game.questionStartedAt = Date.now();
  game.endsAt = game.questionStartedAt + currentQuestion(game).timeLimit * 1000;
  game.timer = setTimeout(() => reveal(game), game.endsAt - Date.now());
  broadcast(game);
}

function reveal(game) {
  if (game.state !== 'question') return;
  clearTimeout(game.timer);
  for (const [userId, answer] of game.answers) {
    answer.points = scoreAnswer(game, answer);
    game.players.get(userId).score += answer.points;
  }
  game.state = 'reveal';
  broadcast(game);
}

function finish(game) {
  clearTimeout(game.timer);
  game.state = 'finished';
  broadcast(game);
  // Beendete Spiele nach einer Stunde aufräumen
  setTimeout(() => games.delete(game.pin), 60 * 60 * 1000).unref();
}

function advance(game) {
  if (game.state === 'lobby') {
    if (game.quiz.questions.length) startQuestion(game, 0);
  } else if (game.state === 'question') {
    reveal(game);
  } else if (game.state === 'reveal') {
    const next = game.questionIndex + 1;
    if (next < game.quiz.questions.length) startQuestion(game, next);
    else finish(game);
  }
}

const router = express.Router();

// Neues Spiel aus einem eigenen Quiz starten
router.post('/', requireAuth, (req, res) => {
  const quiz = loadQuiz(req.body.quizId);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  if (!quiz.questions.length) return res.status(400).json({ error: 'Das Quiz hat noch keine Fragen' });

  const pin = generatePin();
  games.set(pin, {
    pin,
    quiz,
    hostUserId: req.user.id,
    state: 'lobby',
    questionIndex: -1,
    players: new Map(),
    answers: new Map(),
  });
  res.json({ pin });
});

// QR-Code mit Beitritts-Link für den Host-Bildschirm
router.get('/:pin/qr', requireAuth, async (req, res) => {
  const game = games.get(req.params.pin);
  if (!game || game.hostUserId !== req.user.id) return res.status(404).json({ error: 'Spiel nicht gefunden' });
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const joinUrl = `${base.replace(/\/$/, '')}/play?pin=${game.pin}`;
  const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 400 });
  res.json({ joinUrl, qr });
});

function attach(ioServer) {
  io = ioServer;

  io.use((socket, next) => {
    const user = userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('Nicht angemeldet'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    socket.on('host:join', ({ pin } = {}, reply = () => {}) => {
      const game = games.get(String(pin));
      if (!game || game.hostUserId !== user.id) return reply({ error: 'Spiel nicht gefunden' });
      socket.join(`host:${game.pin}`);
      socket.data.hostPin = game.pin;
      reply({ ok: true });
      socket.emit('game:state', hostView(game));
    });

    socket.on('host:next', () => {
      const game = games.get(socket.data.hostPin);
      if (game) advance(game);
    });

    socket.on('host:end', () => {
      const game = games.get(socket.data.hostPin);
      if (game && game.state !== 'finished') finish(game);
    });

    socket.on('player:join', ({ pin } = {}, reply = () => {}) => {
      const game = games.get(String(pin || '').trim());
      if (!game) return reply({ error: 'Kein Spiel mit dieser PIN gefunden' });

      let player = game.players.get(user.id);
      if (!player) {
        if (game.state !== 'lobby') return reply({ error: 'Das Spiel läuft bereits' });
        player = { userId: user.id, username: user.username, score: 0 };
        game.players.set(user.id, player);
      }
      player.socketId = socket.id;
      player.connected = true;
      socket.data.playerPin = game.pin;
      reply({ ok: true });
      broadcast(game);
    });

    socket.on('player:answer', ({ choice } = {}) => {
      const game = games.get(socket.data.playerPin);
      if (!game || game.state !== 'question' || game.answers.has(user.id)) return;
      const q = currentQuestion(game);
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.answers.length) return;

      game.answers.set(user.id, { choice, at: Date.now() });
      const connected = [...game.players.values()].filter((p) => p.connected);
      if (connected.every((p) => game.answers.has(p.userId))) reveal(game);
      else broadcast(game);
    });

    socket.on('disconnect', () => {
      const game = games.get(socket.data.playerPin);
      const player = game && game.players.get(user.id);
      if (player && player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        broadcast(game);
      }
    });
  });
}

module.exports = { router, attach };
