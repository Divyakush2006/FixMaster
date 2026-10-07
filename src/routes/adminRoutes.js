const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');
const v = require('../middleware/validators');

router.use(authenticate, authorize('ADMIN'));

router.get('/users', v.adminListUsersValidators, admin.listUsers);
router.post('/users', v.adminCreateUserValidators, admin.createUser);
router.patch('/users/:user_id', v.adminUpdateUserValidators, admin.updateUser);
router.post('/users/:user_id/reset-password', v.adminResetPasswordValidators, admin.resetPassword);

router.get('/allotments', admin.listAllotments);
router.post('/allotments', v.adminAllotValidators, admin.allotRoom);
router.delete('/allotments/:student_id', v.adminEndAllotmentValidators, admin.endAllotment);

module.exports = router;
