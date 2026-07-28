const express = require('express');
const router = express.Router();
const { getDailyTotals, getDailyDetail, getSummary, getChannels } = require('../controllers/statsController');

router.get('/daily', getDailyTotals);
router.get('/daily/:fecha', getDailyDetail);
router.get('/summary', getSummary);
router.get('/channels', getChannels);

module.exports = router;
