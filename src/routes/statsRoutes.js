const express = require('express');
const router = express.Router();
const { getLaunchDate, getDailyTotals, getDailyDetail, getSummary, getChannels, getTimeline, getAttribution, debugFields } = require('../controllers/statsController');

router.get('/launch-date', getLaunchDate);
router.get('/daily', getDailyTotals);
router.get('/daily/:fecha', getDailyDetail);
router.get('/summary', getSummary);
router.get('/channels', getChannels);
router.get('/timeline', getTimeline);
router.get('/attribution', getAttribution);
router.get('/_debug-fields', debugFields); // temporal, se borra tras el diagnóstico

module.exports = router;
