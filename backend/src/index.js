import express from 'express';
import cors from 'cors';
import { createRepository } from './repository.js';
import { resolveInstance } from './instance.js';
import multer from 'multer';
import { attachmentsEnabled, saveAttachment, openAttachment, deleteAttachment } from './attachments.js';

const INSTANCE = await resolveInstance();
console.log(JSON.stringify({ severity: 'INFO',
  message: `Instance: ${INSTANCE.name} (${INSTANCE.platform})`, instance: INSTANCE }));

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// M6 narrows this to the bucket origin. M7 removes it entirely.
// exposedHeaders lets the browser read X-Served-By when the frontend lives on a
// different origin (bucket / separate Cloud Run service).
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  exposedHeaders: ['X-Served-By'],
}));
app.use(express.json());

// Exercise 4: multipart uploads kept in memory (max 10 MB, PDF only) and
// forwarded to Cloud Storage. Nothing is written to the container's disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files are accepted')),
});

// Every response states which instance produced it. With the LB in front of the
// MIG, a repeated `curl -I` shows the spread without touching /health.
app.use((_req, res, next) => {
  res.set('X-Served-By', INSTANCE.name);
  next();
});

const repo = await createRepository();
console.log(JSON.stringify({ severity: 'INFO', message: `Repository: ${repo.kind}` }));

app.get('/health', async (_req, res) => {
  const instance = { ...INSTANCE, uptimeSeconds: Math.round(process.uptime()) };
  try {
    await repo.ping();
    res.json({ status: 'ok', storage: repo.kind, instance });
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR',
      message: 'health check failed', detail: err.message }));
    res.status(503).json({ status: 'degraded', storage: repo.kind, instance });
  }
});

app.get('/api/notes', async (_req, res, next) => {
  try { res.json(await repo.list()); } catch (e) { next(e); }
});

app.get('/api/notes/:id', async (req, res, next) => {
  try {
    const n = await repo.get(req.params.id);
    n ? res.json(n) : res.status(404).json({ error: 'Note not found' });
  } catch (e) { next(e); }
});

app.post('/api/notes', async (req, res, next) => {
  try {
    const { title, body } = req.body ?? {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    res.status(201).json(await repo.create({ title: title.trim(), body: (body ?? '').trim() }));
  } catch (e) { next(e); }
});

app.put('/api/notes/:id', async (req, res, next) => {
  try {
    const { title, body } = req.body ?? {};
    const n = await repo.update(req.params.id, { title, body });
    n ? res.json(n) : res.status(404).json({ error: 'Note not found' });
  } catch (e) { next(e); }
});

app.delete('/api/notes/:id', async (req, res, next) => {
  try {
    const existing = await repo.get(req.params.id);
    if (existing?.attachment && attachmentsEnabled()) await deleteAttachment(existing.attachment.object);
    (await repo.remove(req.params.id))
      ? res.status(204).end()
      : res.status(404).json({ error: 'Note not found' });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Exercise 4: "Attach file" -- one PDF per note, stored in Cloud Storage
// ---------------------------------------------------------------------------
app.post('/api/notes/:id/attachment', upload.single('file'), async (req, res, next) => {
  try {
    if (!attachmentsEnabled()) return res.status(501).json({ error: 'attachments not configured' });
    if (!req.file) return res.status(400).json({ error: 'file is required (multipart field "file")' });
    const note = await repo.get(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.attachment) await deleteAttachment(note.attachment.object); // replace the old one
    const attachment = await saveAttachment(note.id, req.file);
    res.status(201).json(await repo.setAttachment(note.id, attachment));
  } catch (e) { next(e); }
});

app.get('/api/notes/:id/attachment', async (req, res, next) => {
  try {
    const note = await repo.get(req.params.id);
    if (!note?.attachment) return res.status(404).json({ error: 'No attachment' });
    res.set('Content-Type', note.attachment.contentType);
    res.set('Content-Disposition', `inline; filename="${note.attachment.name}"`);
    openAttachment(note.attachment.object).on('error', next).pipe(res);
  } catch (e) { next(e); }
});

// On-demand 500. Needed in M10 to test the alerting policy.
app.get('/api/boom', () => { throw new Error('Deliberate error for alert testing'); });

app.use((err, req, res, _next) => {
  const status = err instanceof multer.MulterError || /PDF files/.test(err.message) ? 400 : 500;
  console.error(JSON.stringify({
    severity: status === 500 ? 'ERROR' : 'WARNING', message: err.message,
    endpoint: req.path, method: req.method, status,
  }));
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

app.listen(PORT, () => console.log(
  JSON.stringify({ severity: 'INFO', message: `Notely listening on ${PORT}` })));
