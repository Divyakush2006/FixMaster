const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const infra = require('../controllers/infrastructureController');
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

// Hostel infrastructure: blocks -> floors -> rooms
router.get('/blocks', infra.listBlocks);
router.post('/blocks', v.createBlockValidators, infra.createBlock);
router.patch('/blocks/:block_id', v.updateBlockValidators, infra.updateBlock);
router.get('/blocks/:block_id/floors', v.blockOnlyValidators, infra.listFloors);
router.post('/blocks/:block_id/floors', v.addFloorValidators, infra.addFloor);
router.delete('/blocks/:block_id/floors/:floor_number', v.removeFloorValidators, infra.removeFloor);
router.get('/blocks/:block_id/rooms', v.blockOnlyValidators, infra.listRooms);
router.post('/blocks/:block_id/rooms', v.createRoomsValidators, infra.createRooms);
router.patch('/rooms/:room_id', v.updateRoomValidators, infra.updateRoom);

module.exports = router;
