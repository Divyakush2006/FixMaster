import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { dispatchApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DetailList } from '../../components/ui/Card';
import { StaffTask } from '../../types';
import { ticketRef } from '../../utils/labels';

interface MarkDoneSheetProps {
  isOpen: boolean;
  onClose: () => void;
  task: StaffTask;
}

export const MarkDoneSheet: React.FC<MarkDoneSheetProps> = ({ isOpen, onClose, task }) => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const mutation = useMutation({
    mutationFn: () => dispatchApi.markTaskCompleted(task.assignment_id),
    onSuccess: (data) => {
      showToast('Task marked complete', 'success', data.message || 'The student has been asked to confirm the work.');
      queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
      onClose();
    },
    onError: (err: Error) => showToast('Could not complete the task', 'error', err.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mark work complete"
      subtitle={ticketRef(task.complaint_id)}
      maxWidth="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon={CheckCircle2} loading={mutation.isPending} onClick={() => mutation.mutate()} data-autofocus>
            Confirm completion
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <DetailList
          items={[
            { label: 'Location', value: <span className="font-mono font-semibold">{task.location_identifier}</span> },
            { label: 'Issue', value: task.issue_name },
            { label: 'Student', value: task.student_name },
            {
              label: 'Contact',
              value: task.student_phone ? (
                <a href={`tel:${task.student_phone}`} className="link">
                  {task.student_phone}
                </a>
              ) : (
                'Not provided'
              ),
            },
          ]}
        />
        <Alert tone="info" title="What happens next">
          The ticket moves to <strong>awaiting confirmation</strong>. The student checks the work and either closes the ticket or escalates it.
        </Alert>
      </div>
    </Modal>
  );
};
