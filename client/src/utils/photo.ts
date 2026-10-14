/**
 * Preparing a photo for upload. The API accepts JPEG or PNG up to 5 MB and
 * strips metadata itself; doing the heavy lifting here means a 12 MP phone
 * photo (often 4-8 MB) still goes through, quickly, on campus Wi-Fi.
 *
 * Drawing the picture onto a canvas also applies the camera's rotation to the
 * pixels, which matters because the server removes the EXIF tag that carried it.
 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png';
const MAX_EDGE = 2048;
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024; // refuse absurd files before decoding them

/** What is wrong with the chosen file, or null if it can be used. */
export function photoProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return 'Choose a JPEG or PNG photo.';
  if (file.size > MAX_ORIGINAL_BYTES) return 'That photo is too large. Choose one under 40 MB.';
  return null;
}

/** A JPEG no larger than MAX_PHOTO_BYTES, scaled down if needed. Falls back to the original when it already fits. */
export async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
    }
  } catch {
    // The browser could not decode or re-encode it; fall through to the original.
  }
  if (file.size <= MAX_PHOTO_BYTES) return file;
  throw new Error('That photo is too large to upload. Try a smaller one.');
}
