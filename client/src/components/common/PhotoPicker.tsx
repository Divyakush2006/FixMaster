import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { PHOTO_ACCEPT, photoProblem } from '../../utils/photo';

interface PhotoPickerProps {
  value: File | null;
  onChange: (file: File | null) => void;
  /** Label for screen readers; the visible text sits in the surrounding Field. */
  ariaLabel?: string;
}

/** Choose one photo and see it before it is sent. The preview is a data: URL (the site's CSP does not allow blob:). */
export const PhotoPicker: React.FC<PhotoPickerProps> = ({ value, onChange, ariaLabel = 'Photo of the problem' }) => {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return setPreview(null);
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => !cancelled && setPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(value);
    return () => {
      cancelled = true;
    };
  }, [value]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // choosing the same file again must still fire
    if (!file) return;
    const problem = photoProblem(file);
    setError(problem);
    if (!problem) onChange(file);
  };

  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={PHOTO_ACCEPT} onChange={pick} className="sr-only" aria-label={ariaLabel} tabIndex={-1} />
      {value ? (
        <div className="flex items-center gap-3 rounded-md border border-slate-200 p-2">
          {preview && <img src={preview} alt="Chosen photo" className="h-16 w-16 rounded object-cover" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{value.name}</span>
          <Button type="button" size="sm" variant="ghost" icon={X} onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" icon={ImagePlus} onClick={() => input.current?.click()}>
          Add a photo
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
};
