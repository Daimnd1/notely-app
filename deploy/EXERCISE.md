# Exercise 4 — "Attach file": one PDF per note, stored in a bucket

**What changes in the code:**
- Backend: `src/attachments.js` (writes and reads objects in the bucket named by `ATTACHMENTS_BUCKET`
  with the API's own identity) and two routes in `src/index.js`: `POST /api/notes/:id/attachment`
  (multipart field `file`, PDF only, up to 10 MB) and `GET /api/notes/:id/attachment` (streams the PDF).
  Deleting a note deletes its file. New dependencies: `multer` (2.x), `@google-cloud/storage`.
- Frontend (`src/App.jsx`, `src/api.js`): the **New note** form has an *Attach a PDF* field (the note is
  created first, then its PDF is uploaded); the edit form can replace the PDF; every note in the list
  shows its file's name, as a link, and its size; the note's page keeps the **Attach file** button.
- The database row keeps the file's name, object path, size and type (columns already in the table).

**How it is deployed:** one bucket in `europe-north1` (uniform access, versioning) and new revisions
of both services. The bucket is **deliberately exposed**: public access prevention is off and `allUsers`
has *Storage Object Viewer*, so anyone with a file's address can download it. The API needs no grant
yet: it runs as the Compute Engine default service account, which gets the Editor role on the project
unless an organization policy disables that grant, and Editor brings *Storage Legacy Object Owner* on a
bucket with uniform access (`exercise4.sh` has the one-line grant to run if your account lacks Editor).
Exercise 5 makes the bucket private and gives the API an explicit grant.

**Run it:** `bash deploy/exercise4.sh`. Console click-paths: course document, Exercise 4.

**Check it:** create a note with a PDF in the page and see the file's link in the list;
`curl -o out.pdf …/api/notes/1/attachment`; the direct file address
`https://storage.googleapis.com/notely-attachments-…/notes/1/…` answers **200**: that is the exposure.
