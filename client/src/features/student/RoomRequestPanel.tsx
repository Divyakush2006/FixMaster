import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EMPTY_ROOM_CHOICE, RoomChoice, RoomPicker, floorProblem, roomProblem } from '../../components/common/RoomPicker';
import { floorLabel, formatRelativeTime } from '../../utils/formatters';
import { blockLabel } from '../../utils/labels';

/**
 * Shown to a student who has no allotted room. A room request grants nothing
 * by itself: the hostel office approves it through the allotment workflow, and
 * only then can the student raise room tickets.
 */
export const RoomRequestPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<RoomChoice>(EMPTY_ROOM_CHOICE);
  const [hasInfrastructure, setHasInfrastructure] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['my-room-request'], queryFn: meApi.getRoomRequest });
  const request = data?.request ?? null;

  const send = useMutation({
    mutationFn: () => meApi.requestRoom({ block_id: choice.blockId, floor_number: Number(choice.floor), room_number: choice.roomNo }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['my-room-request'] });
      showToast('Request sent', 'success', res.message);
      setEditing(false);
      setChoice(EMPTY_ROOM_CHOICE);
    },
    onError: (err: Error) => setError(err.message || 'Could not send the request.'),
  });

  const withdraw = useMutation({
    mutationFn: meApi.withdrawRoomRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-room-request'] });
      showToast('Request withdrawn', 'success');
      setEditing(false);
    },
    onError: (err: Error) => setError(err.message || 'Could not withdraw the request.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!choice.blockId || !choice.floor || !choice.roomId) {
      return setError(
        !choice.blockId || !choice.floor || !choice.roomNo
          ? 'Choose a block and enter your floor and room number.'
          : floorProblem(choice.floor) || roomProblem(choice.roomNo) || 'That room number is already used on another floor of this block. Check the floor and the number on your door.'
      );
    }
    send.mutate();
  };

  if (isLoading) return null;

  const showForm = editing || !request;
  const where = request ? `${request.room_id} (${blockLabel(request.block_id)}, ${floorLabel(request.floor_number)})` : '';

  return (
    <Alert
      tone={request?.status === 'PENDING' ? 'info' : 'warning'}
      title={
        request?.status === 'PENDING'
          ? `Waiting for the hostel office to confirm room ${request.room_id}`
          : request?.status === 'DECLINED'
            ? 'Your room request was not approved'
            : 'No room has been allotted to your account yet'
      }
    >
      <div className="space-y-3">
        {request?.status === 'PENDING' && (
          <p>
            You asked for {where} {formatRelativeTime(request.requested_at)}. Room tickets unlock once it is approved. You can still report problems in common areas.
          </p>
        )}
        {request?.status === 'DECLINED' && (
          <p>
            Request for {where}: {request.decline_reason ?? 'no reason given'}. Choose another room below, or ask the hostel office.
          </p>
        )}
        {!request && <p>Tell the hostel office which room you live in. You can still report problems in common areas meanwhile.</p>}

        {showForm ? (
          <form onSubmit={submit} className="space-y-3" noValidate>
            {error && <p role="alert" className="text-[13px] font-medium text-rose-700">{error}</p>}
            <RoomPicker value={choice} onChange={setChoice} onAvailability={setHasInfrastructure} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={send.isPending} disabled={!hasInfrastructure}>
                Send request
              </Button>
              {request && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Request a different room
            </Button>
            {request?.status === 'PENDING' && (
              <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
                Withdraw request
              </Button>
            )}
          </div>
        )}
      </div>
    </Alert>
  );
};
