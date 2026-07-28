const mongoose = require('mongoose');
const dns = require('dns');

// Mismo workaround que cohen-bot-api: forzar resolutores DNS públicos para evitar
// problemas de resolución del SRV record de MongoDB Atlas en algunos entornos.
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log('[MongoDB] Conectado');
}

module.exports = connectDB;
