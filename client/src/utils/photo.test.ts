// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MAX_PHOTO_BYTES, photoProblem, preparePhoto } from './photo';

const file = (bytes: number, type = 'image/jpeg') => new File([new Uint8Array(bytes)], 'p.jpg', { type });

describe('photoProblem', () => {
  it('accepts JPEG and PNG, and nothing else', () => {
    expect(photoProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(photoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(photoProblem({ type: 'image/svg+xml', size: 1000 })).toMatch(/JPEG or PNG/);
    expect(photoProblem({ type: 'application/pdf', size: 1000 })).toMatch(/JPEG or PNG/);
    expect(photoProblem({ type: '', size: 1000 })).toMatch(/JPEG or PNG/);
  });

  it('refuses absurdly large originals before trying to decode them', () => {
    expect(photoProblem({ type: 'image/jpeg', size: 41 * 1024 * 1024 })).toMatch(/too large/);
  });
});

describe('preparePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubCanvas(result: Blob | null, size = { width: 4000, height: 3000 }) {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: vi.fn(), drawImage, fillStyle: '' }),
      toBlob: (cb: (b: Blob | null) => void) => cb(result),
    };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ ...size, close: vi.fn() }));
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
    return canvas;
  }

  it('scales a large photo down to 2048 px on its longest side and re-encodes it as JPEG', async () => {
    const out = new Blob([new Uint8Array(500_000)], { type: 'image/jpeg' });
    const canvas = stubCanvas(out);
    const prepared = await preparePhoto(file(9 * 1024 * 1024));
    expect(prepared).toBe(out);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1536);
  });

  it('keeps small images at their own size', async () => {
    const canvas = stubCanvas(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), { width: 800, height: 600 });
    await preparePhoto(file(100_000));
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  it('falls back to the original when the browser cannot re-encode it, if it fits', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
    const original = file(200_000);
    expect(await preparePhoto(original)).toBe(original);
  });

  it('refuses a photo that cannot be made small enough', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
    await expect(preparePhoto(file(MAX_PHOTO_BYTES + 1))).rejects.toThrow(/too large/);
  });
});
