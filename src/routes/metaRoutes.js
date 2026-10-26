const express = require('express');
const router = express.Router();
const meta = require('../controllers/metaController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const { blockIdParamValidators, listStaffValidators } = require('../middleware/validators');

// Public: dropdown data with no sensitive content, needed before login
// (e.g. to populate the registration/complaint forms).
router.get('/blocks', meta.getBlocks);
router.get('/blocks/:block_id/rooms', blockIdParamValidators, meta.getRoomsByBlock);
router.get('/blocks/:block_id/common-areas', blockIdParamValidators, meta.getCommonAreasByBlock);
router.get('/categories', meta.getCategoriesWithSubcategories);

// Gated: exposes staff identity, availability and live workload - only the
// people who dispatch work need it.
router.get('/staff', authenticate, authorize(...MANAGER_ROLES), listStaffValidators, meta.getStaff);

module.exports = router;
