const express = require('express');
const router = express.Router();
const { getLaunchDate, getDailyTotals, getDailyDetail, getSummary, getChannels, getTimeline, getAttribution, runBackfillCitasFiables, runExportRaw } = require('../controllers/statsController');

router.get('/launch-date', getLaunchDate);
router.get('/daily', getDailyTotals);
router.get('/daily/:fecha', getDailyDetail);
router.get('/summary', getSummary);
router.get('/channels', getChannels);
router.get('/timeline', getTimeline);
router.get('/attribution', getAttribution);
router.get('/_backfill-citas-fiables', runBackfillCitasFiables); // temporal, se borra tras usarlo
router.get('/_export-raw', runExportRaw); // temporal, se borra tras usarlo

module.exports = router;
