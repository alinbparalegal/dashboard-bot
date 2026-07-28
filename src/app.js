require('dotenv').config();
const express = require('express');
const path = require('path');
const connectDB = require('./config/db');
const statsRoutes = require('./routes/statsRoutes');

require('./services/dailyStatsCron');

const app = express();
const PORT = process.env.PORT || 3000;

connectDB().catch(err => {
  console.error('[MongoDB] Error de conexión:', err.message);
  process.exit(1);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/stats', statsRoutes);

app.listen(PORT, () => {
  console.log(`[Servidor] Escuchando en http://localhost:${PORT}`);
});
