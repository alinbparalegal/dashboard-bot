const express = require('express');
const router = express.Router();
const { getDailyTotals, getDailyDetail, getSummary, getChannels, getTimeline } = require('../controllers/statsController');

router.get('/daily', getDailyTotals);
router.get('/daily/:fecha', getDailyDetail);
router.get('/summary', getSummary);
router.get('/channels', getChannels);
router.get('/timeline', getTimeline);

module.exports = router;
