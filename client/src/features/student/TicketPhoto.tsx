import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus } from 'lucide-react';
import { complaintsApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { Complaint } from '../../types';
import { PHOTO_ACCEPT, photoProblem, preparePhoto } from '../../utils/photo';

/** A photo stored by this API is served from the API itself, behind the ticket's own access rules. */
const isStoredPhoto = (url: string | null | undefined): url is string => !!url && url.startsWith('/api/complaints/');
/** Older tickets may hold a pasted link; only http(s) is ever offered as a link. */
const isWebLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);

/** The ticket's photo, with add / replace / remove for the people who reported it. */
export const TicketPhoto: React.FC<{ complaint: Complaint }> = ({ complaint }) => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [broken, setBroken] = useState(false);
  const [version, setVersion] = useState(0); // forces the browser to re-fetch after a replace
  const url = complaint.photo_evidence_url;
  const canEdit = !!complaint.can_attach_photo;

  const refresh = () => {
    setBroken(false);
    setVersion((v) => v + 1);
    queryClient.invalidateQueries({ queryKey: ['complaints'] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => complaintsApi.uploadPhoto(complaint.complaint_id, await preparePhoto(file)),
    onSuccess: () => {
      showToast('Photo saved', 'success');
      refresh();
    },
    onError: (err: Error) => showToast('Photo not saved', 'error', err.message),
  });
  const remove = useMutation({
    mutationFn: () => complaintsApi.deletePhoto(complaint.complaint_id),
    onSuccess: () => {
      showToast('Photo removed', 'success');
      refresh();
    },
    onError: (err: Error) => showToast('Could not remove the photo', 'error', err.message),
  });

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = photoProblem(file);
    if (problem) return showToast('Photo not saved', 'error', problem);
    upload.mutate(file);
  };

  if (!isStoredPhoto(url) && !isWebLink(url) && !canEdit) return null;

  return (
    <section>
      <h3 className="eyebrow mb-2">Photo</h3>
      {isStoredPhoto(url) &&
        (broken ? (
          <p className="text-[13px] text-slate-500">The photo could not be loaded.</p>
        ) : (
          <a href={`${url}?v=${version}`} target="_blank" rel="noopener noreferrer" className="block w-fit">
            <img
              src={`${url}?v=${version}`}
              alt="Photo attached to this ticket"
              onError={() => setBroken(true)}
              className="max-h-64 max-w-full rounded-md border border-slate-200 object-contain"
            />
          </a>
        ))}
      {isWebLink(url) && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1.5 text-[13px]">
          View photo
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input ref={input} type="file" accept={PHOTO_ACCEPT} onChange={choose} className="sr-only" aria-label="Choose a photo" tabIndex={-1} />
          <Button size="sm" variant="secondary" icon={ImagePlus} loading={upload.isPending} onClick={() => input.current?.click()}>
            {isStoredPhoto(url) || isWebLink(url) ? 'Replace photo' : 'Add a photo'}
          </Button>
          {(isStoredPhoto(url) || isWebLink(url)) && (
            <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
