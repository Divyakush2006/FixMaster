const express = require('express');
const router = express.Router();

const complaints = require('../controllers/complaintController');
const { authenticate, authorize } = require('../middleware/auth');
const { photoUploadLimiter } = require('../middleware/rateLimiters');
const { MAX_PHOTO_BYTES } = require('../services/attachmentService');
const {
    createComplaintValidators,
    listComplaintsValidators,
    complaintIdParamValidators,
    photoParamValidators,
    rejectComplaintValidators,
    mergeComplaintValidators,
} = require('../middleware/validators');

router.post('/', authenticate, authorize('STUDENT', 'SUPERVISOR', 'ADMIN'), createComplaintValidators, complaints.createComplaint);
router.get('/', authenticate, listComplaintsValidators, complaints.getComplaints);
router.get('/:id', authenticate, complaintIdParamValidators, complaints.getComplaintById);
// Photo of the problem. Uploaded as the raw image body (JPEG or PNG, 5 MB), so
// the request is authenticated and rate limited BEFORE any body is read.
router.put(
    '/:id/photo',
    authenticate,
    authorize('STUDENT'),
    photoUploadLimiter,
    photoParamValidators,
    express.raw({ type: ['image/jpeg', 'image/png'], limit: MAX_PHOTO_BYTES }),
    complaints.uploadPhoto
);
router.delete('/:id/photo', authenticate, authorize('STUDENT'), photoParamValidators, complaints.deletePhoto);
router.get('/:id/photo', authenticate, photoParamValidators, complaints.getPhoto);
router.get('/:id/logs', authenticate, complaintIdParamValidators, complaints.getComplaintLogs);
router.get('/:id/related', authenticate, authorize('SUPERVISOR', 'ADMIN'), complaintIdParamValidators, complaints.getRelatedComplaints);

// Closing a ticket without the work being done.
router.post('/:id/withdraw', authenticate, authorize('STUDENT'), complaintIdParamValidators, complaints.withdrawComplaint);
router.post('/:id/reject', authenticate, authorize('SUPERVISOR', 'ADMIN'), rejectComplaintValidators, complaints.rejectComplaint);
router.post('/:id/merge', authenticate, authorize('SUPERVISOR', 'ADMIN'), mergeComplaintValidators, complaints.mergeComplaint);

module.exports = router;
