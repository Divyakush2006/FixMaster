const router = require('express').Router();
const feedback = require('../controllers/feedbackController');
const { authenticate, authorize } = require('../middleware/auth');
const { feedbackValidators } = require('../middleware/validators');

// Any role that can RAISE a complaint can verify one; the procedure then
// checks the caller is the person who raised this particular complaint.
// (Previously STUDENT-only, which left supervisor-raised tickets unclosable.)
router.post('/', authenticate, authorize('STUDENT', 'SUPERVISOR', 'ADMIN'), feedbackValidators, feedback.submitResolutionFeedback);

module.exports = router;
