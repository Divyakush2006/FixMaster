const express = require('express');
const router = express.Router();
const infra = require('../controllers/infrastructureController');
const { authenticate, authorize } = require('../middleware/auth');
const { MANAGER_ROLES } = require('../config/roles');
const v = require('../middleware/validators');

// Block settings for everyone who runs blocks (migration 016): a supervisor
// manages the floors, rooms and shared areas of their blocks, a chief warden
// those of their hostel (and adds blocks to it), an administrator any block.
// Every handler checks the block is one the caller runs (scopeService).
router.use(authenticate, authorize(...MANAGER_ROLES));

router.get('/blocks', infra.listBlocks);
router.post('/blocks', authorize('CHIEF_WARDEN', 'ADMIN'), v.createBlockValidators, infra.createBlock);
router.patch('/blocks/:block_id', v.updateBlockValidators, infra.updateBlock);
router.get('/blocks/:block_id/floors', v.blockOnlyValidators, infra.listFloors);
router.post('/blocks/:block_id/floors', v.addFloorValidators, infra.addFloor);
router.delete('/blocks/:block_id/floors/:floor_number', v.removeFloorValidators, infra.removeFloor);
router.get('/blocks/:block_id/rooms', v.blockOnlyValidators, infra.listRooms);
router.post('/blocks/:block_id/rooms', v.createRoomsValidators, infra.createRooms);
router.patch('/rooms/:room_id', v.updateRoomValidators, infra.updateRoom);
router.get('/blocks/:block_id/common-areas', v.blockOnlyValidators, infra.listCommonAreas);
router.post('/blocks/:block_id/common-areas', v.createCommonAreaValidators, infra.createCommonArea);
router.patch('/common-areas/:area_id', v.updateCommonAreaValidators, infra.updateCommonArea);

module.exports = router;
