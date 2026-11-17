// PDF attachments stored in Cloud Storage (Exercise 4).
//
// Design choice (kept deliberately simple): the browser never talks to the
// bucket. Uploads and downloads go through the API, which reads/writes objects
// with the VM's service account. The bucket can therefore stay completely
// private (Exercise 5: Public access prevention + uniform bucket-level access).
// An alternative is V4 signed URLs (Cloud Storage docs, "Signed URLs"), which
// let the browser download straight from the bucket for a limited time.
import { Storage } from '@google-cloud/storage';

const BUCKET = process.env.ATTACHMENTS_BUCKET; // e.g. notely-attachments-<project>

let bucket = null;
export function attachmentsEnabled() { return Boolean(BUCKET); }

function getBucket() {
  bucket ??= new Storage().bucket(BUCKET);
  return bucket;
}

// Object name: notes/<noteId>/<sanitized original file name>
export function objectNameFor(noteId, originalName) {
  const safe = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return `notes/${noteId}/${safe}`;
}

export async function saveAttachment(noteId, file) {
  const object = objectNameFor(noteId, file.originalname);
  await getBucket().file(object).save(file.buffer, {
    contentType: file.mimetype,
    resumable: false,
    metadata: { metadata: { noteId: String(noteId) } },
  });
  return { name: file.originalname, object, size: file.size, contentType: file.mimetype };
}

// Returns a readable stream; the caller pipes it into the HTTP response.
export function openAttachment(object) {
  return getBucket().file(object).createReadStream();
}

export async function deleteAttachment(object) {
  await getBucket().file(object).delete({ ignoreNotFound: true });
}
