const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Photos attached to tickets. The database may not gain a table, so each photo
// is a file named after its ticket (`<ticket id>.jpg|png`) in UPLOAD_DIR, and
// the ticket's existing photo_evidence_url column points at the API route that
// serves it (checked against the same visibility rules as the ticket itself).
//
// Every upload is parsed and REBUILT here, never stored as received:
//   * only JPEG and PNG, judged by content, not by the declared type;
//   * metadata is dropped (EXIF / GPS position, XMP, comments, PNG text), so a
//     photo taken in a room does not leak where its owner was;
//   * anything after the end of the image (a hidden second payload) is cut off.
// The browser is told the type, forbidden to guess, and sandboxed (see the
// controller), so a hostile file cannot run as a page.
//
// Photos live on the host's disk: with more than one API instance, UPLOAD_DIR
// must be a shared volume, and it must be backed up with the database.

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
const photoUrl = (complaintId) => `/api/complaints/${complaintId}/photo`;
const isStoredPhotoUrl = (url) => typeof url === 'string' && url.startsWith('/api/complaints/');

/** JPEG: keep the picture and colour data, drop APP1 (EXIF/XMP), APP13 (IPTC), comments and any trailing bytes. */
function cleanJpeg(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    const out = [buf.subarray(0, 2)];
    let sawFrame = false;
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        if (marker === undefined) return null;
        if (marker === 0xff) {
            i += 1; // fill byte
            continue;
        }
        if (marker === 0xd9) return sawFrame ? Buffer.concat([...out, buf.subarray(i, i + 2)]) : null;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            out.push(buf.subarray(i, i + 2));
            i += 2;
            continue;
        }
        if (i + 4 > buf.length) return null;
        const length = buf.readUInt16BE(i + 2);
        if (length < 2 || i + 2 + length > buf.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) sawFrame = true;
        if (marker === 0xda) {
            // Start of scan: the entropy-coded data runs to the last EOI marker.
            if (!sawFrame) return null;
            const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
            if (end < i + 2 + length) return null;
            return Buffer.concat([...out, buf.subarray(i, end + 2)]);
        }
        const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
        if (!drop) out.push(buf.subarray(i, i + 2 + length));
        i += 2 + length;
    }
    return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'hIST']);

/** PNG: keep image chunks, drop text, EXIF and time chunks and anything after IEND. */
function cleanPng(buf) {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    const out = [PNG_SIGNATURE];
    let i = 8;
    let first = true;
    let sawData = false;
    while (i + 12 <= buf.length) {
        const length = buf.readUInt32BE(i);
        const type = buf.toString('latin1', i + 4, i + 8);
        const total = 12 + length;
        if (length > 0x7fffffff || i + total > buf.length) return null;
        if (first && type !== 'IHDR') return null;
        first = false;
        if (type === 'IDAT') sawData = true;
        if (PNG_KEEP.has(type)) out.push(buf.subarray(i, i + total));
        i += total;
        if (type === 'IEND') return sawData ? Buffer.concat(out) : null;
    }
    return null;
}

/** The rebuilt image and its extension, or null if `buf` is not a valid image of the declared type. */
function sanitizeImage(buf, declaredType) {
    const ext = TYPES[String(declaredType || '').split(';')[0].trim().toLowerCase()];
    if (!ext || !Buffer.isBuffer(buf) || buf.length === 0) return null;
    const clean = ext === 'jpg' ? cleanJpeg(buf) : cleanPng(buf);
    return clean ? { buffer: clean, ext } : null;
}

const fileFor = (complaintId, ext) => path.join(uploadDir(), `${complaintId}.${ext}`);

/** Writes the photo atomically, replacing any earlier one for the ticket (whatever its type). */
async function savePhoto(complaintId, buffer, ext) {
    await fs.promises.mkdir(uploadDir(), { recursive: true });
    const tmp = path.join(uploadDir(), `.${complaintId}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    await fs.promises.writeFile(tmp, buffer, { mode: 0o640 });
    await fs.promises.rename(tmp, fileFor(complaintId, ext));
    for (const other of Object.values(TYPES)) {
        if (other !== ext) await fs.promises.rm(fileFor(complaintId, other), { force: true });
    }
}

async function removePhoto(complaintId) {
    for (const ext of Object.values(TYPES)) await fs.promises.rm(fileFor(complaintId, ext), { force: true });
}

/** { file, contentType } for a stored photo, or null. */
async function findPhoto(complaintId) {
    for (const [contentType, ext] of Object.entries(TYPES)) {
        const file = fileFor(complaintId, ext);
        try {
            await fs.promises.access(file, fs.constants.R_OK);
            return { file, contentType, ext };
        } catch {
            // try the next type
        }
    }
    return null;
}

module.exports = { MAX_PHOTO_BYTES, TYPES, photoUrl, isStoredPhotoUrl, sanitizeImage, savePhoto, removePhoto, findPhoto, uploadDir };
