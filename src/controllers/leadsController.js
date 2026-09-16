const leadsService = require('../services/leadsService');

async function search(req, res) {
  try {
    const q = req.query.q || '';
    const resultados = await leadsService.searchLeads(q);
    res.status(200).json({ query: q, resultados });
  } catch (error) {
    console.error('Error en leads search:', error);
    res.status(500).json({ message: error.message });
  }
}

module.exports = { search };
