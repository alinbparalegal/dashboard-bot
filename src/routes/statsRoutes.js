const express = require('express');
const router = express.Router();
const { getLaunchDate, getDailyTotals, getDailyDetail, getSummary, getChannels, getHours, getTimeline, getAttribution } = require('../controllers/statsController');

router.get('/launch-date', getLaunchDate);
router.get('/daily', getDailyTotals);
router.get('/daily/:fecha', getDailyDetail);
router.get('/summary', getSummary);
router.get('/channels', getChannels);
router.get('/hours', getHours);
router.get('/timeline', getTimeline);
router.get('/attribution', getAttribution);

module.exports = router;
