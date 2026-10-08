const express = require('express');
const router = express.Router();

const complaints = require('../controllers/complaintController');
const { authenticate, authorize } = require('../middleware/auth');
const {
    createComplaintValidators,
    listComplaintsValidators,
    complaintIdParamValidators,
    rejectComplaintValidators,
    mergeComplaintValidators,
} = require('../middleware/validators');

router.post('/', authenticate, authorize('STUDENT', 'SUPERVISOR', 'ADMIN'), createComplaintValidators, complaints.createComplaint);
router.get('/', authenticate, listComplaintsValidators, complaints.getComplaints);
router.get('/:id', authenticate, complaintIdParamValidators, complaints.getComplaintById);
router.get('/:id/logs', authenticate, complaintIdParamValidators, complaints.getComplaintLogs);
router.get('/:id/related', authenticate, authorize('SUPERVISOR', 'ADMIN'), complaintIdParamValidators, complaints.getRelatedComplaints);

// Closing a ticket without the work being done.
router.post('/:id/withdraw', authenticate, authorize('STUDENT'), complaintIdParamValidators, complaints.withdrawComplaint);
router.post('/:id/reject', authenticate, authorize('SUPERVISOR', 'ADMIN'), rejectComplaintValidators, complaints.rejectComplaint);
router.post('/:id/merge', authenticate, authorize('SUPERVISOR', 'ADMIN'), mergeComplaintValidators, complaints.mergeComplaint);

module.exports = router;
