// Lokaler Entwicklungsserver: API + statische Seiten aus public/
const path = require('path');
const express = require('express');
const app = require('./src/app');

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Quiz läuft auf http://localhost:${PORT}`);
});
