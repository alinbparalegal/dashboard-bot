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

  // Canal de entrada (canal_whatsapp/instagram/facebook), procedencia real (sessionSource,
  // incluido TikTok) y rendimiento por campaña UTM, acotados a este día — permiten componer
  // cualquier periodo (Todo/mes) sumando documentos ya guardados, sin volver a pedir nada a
  // GHL salvo el día de hoy en vivo.
  canales: { type: Map, of: Number, default: {} },
  session_source: { type: Map, of: Number, default: {} },
  campanas: [{
    key: String,
    nombre: String,
    leads: { type: Number, default: 0 },
    cualificados: { type: Number, default: 0 },
    citas: { type: Number, default: 0 },
    _id: false,
  }],

  // Citas conseguidas ese día (tag consulta_agendada, fecha de creación del lead), con
  // verificación (tag "pago info") y gestión bot/humano — misma info que el timeline.
  citas: [{
    contactId: String,
    nombre: String,
    fecha: String,
    verificado: Boolean,
    gestionadoPor: String,
    esBot: Boolean,
    _id: false,
  }],

  // Distingue los documentos ya recalculados con los bloques de arriba (2) de los antiguos
  // que aún no los tienen (undefined) — usado por el script de backfill único.
  statsVersion: { type: Number, default: 2 },

  computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

dailyStatSchema.index({ marca: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model('DailyStat', dailyStatSchema);
