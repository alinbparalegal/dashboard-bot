const express = require('express');
const router = express.Router();
const { search } = require('../controllers/leadsController');

router.get('/search', search);

module.exports = router;
