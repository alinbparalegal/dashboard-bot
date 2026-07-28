const mongoose = require('mongoose');

const dailyStatSchema = new mongoose.Schema({
  marca: { type: String, required: true }, // 'CYA' | 'ETH' | 'ETV' | 'NAC' | 'MNEE'
  fecha: { type: String, required: true }, // 'YYYY-MM-DD'

  conversacion: { type: Number, default: 0 },
  lead_cualificando: { type: Number, default: 0 },
  lead_potencial: { type: Number, default: 0 },
  pago_pendiente: { type: Number, default: 0 },
  consulta_agendada: { type: Number, default: 0 },
  cliente_postventa: { type: Number, default: 0 },
  lead_no_potencial: { type: Number, default: 0 },

  motivos_descarte: { type: Map, of: Number, default: {} },
  tramites_potencial: { type: Map, of: Number, default: {} },
  meta_ads_potencial: { type: Number, default: 0 },

  computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

dailyStatSchema.index({ marca: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('DailyStat', dailyStatSchema);
