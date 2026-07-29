const statsService = require('../services/statsService');

async function getDailyTotals(req, res) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const data = await statsService.getDailyTotals(days);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getDailyTotals:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getDailyDetail(req, res) {
  try {
    const { fecha } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ message: 'Fecha inválida, usar formato YYYY-MM-DD' });
    }
    const data = await statsService.getDetailForDate(fecha);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getDailyDetail:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getSummary(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const data = await statsService.getSummary(desde, hasta);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getSummary:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getChannels(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const data = await statsService.getChannelBreakdown(desde, hasta);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getChannels:', error);
    res.status(500).json({ message: error.message });
  }
}

async function getTimeline(req, res) {
  try {
    const hasta = req.query.hasta || statsService.todayStr();
    const desde = req.query.desde || process.env.BOT_LAUNCH_DATE || hasta;
    const data = await statsService.getCitasTimeline(desde, hasta);
    res.status(200).json(data);
  } catch (error) {
    console.error('Error en getTimeline:', error);
    res.status(500).json({ message: error.message });
  }
}

module.exports = { getDailyTotals, getDailyDetail, getSummary, getChannels, getTimeline };
