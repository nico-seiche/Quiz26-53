const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const auth = require('./src/auth');
const quizzes = require('./src/quizzes');
const game = require('./src/game');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(auth.loadUser);

app.use('/api/auth', auth.router);
app.use('/api/quizzes', quizzes.router);
app.use('/api/games', game.router);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
game.attach(new Server(server));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quiz läuft auf http://localhost:${PORT}`);
});
