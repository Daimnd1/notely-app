// Storage for notes.
//
// Exercises 1-2: the original in-memory Map (notes vanish on restart).
// Exercise 3: a PostgreSQL implementation backed by Cloud SQL. The repository
//             is chosen at startup from the environment, so the same image runs
//             locally (memory) and on GCP (postgres) without a rebuild.
//
// Selection rule: if DB_HOST is set -> postgres, otherwise -> memory.
//
// The PostgreSQL client is the `pg` package (node-postgres). Cloud SQL for
// PostgreSQL is a standard PostgreSQL server, so no Google-specific driver is
// needed when connecting over the instance's private IP (see the Cloud SQL docs,
// "Connect from Compute Engine" -> "Connect using private IP").

import pg from 'pg';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// In-memory repository (unchanged from the original project, plus attachments)
// ---------------------------------------------------------------------------
function memoryRepository() {
  let nextId = 1;
  const notes = new Map();
  const t = now();
  notes.set(1, { id: 1, title: 'First note',
                 body: 'This lives in memory. It disappears when the process restarts.',
                 createdAt: t, updatedAt: t });
  nextId = 2;

  return {
    kind: 'memory',
    async list()  { return [...notes.values()].sort((a, b) => b.id - a.id); },
    async get(id) { return notes.get(Number(id)) ?? null; },
    async create({ title, body }) {
      const t = now();
      const note = { id: nextId, title, body, createdAt: t, updatedAt: t };
      notes.set(nextId++, note);
      return note;
    },
    async update(id, { title, body }) {
      const note = notes.get(Number(id));
      if (!note) return null;
      if (title !== undefined) note.title = title;
      if (body  !== undefined) note.body  = body;
      note.updatedAt = now();
      return note;
    },
    async setAttachment(id, attachment) {
      const note = notes.get(Number(id));
      if (!note) return null;
      note.attachment = attachment;
      note.updatedAt = now();
      return note;
    },
    async remove(id) { return notes.delete(Number(id)); },
    async ping()     { return true; },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL repository (Cloud SQL) -- Exercise 3 (+ attachment columns, Exercise 4)
// ---------------------------------------------------------------------------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id                SERIAL PRIMARY KEY,
    title             TEXT NOT NULL,
    body              TEXT NOT NULL DEFAULT '',
    attachment_name   TEXT,
    attachment_object TEXT,
    attachment_size   INTEGER,
    attachment_type   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

// Map a database row to the JSON shape the frontend already understands.
function toNote(row) {
  if (!row) return null;
  const note = {
    id: row.id, title: row.title, body: row.body,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
  if (row.attachment_object) {
    note.attachment = { name: row.attachment_name, object: row.attachment_object,
                        size: row.attachment_size, contentType: row.attachment_type };
  }
  return note;
}

async function postgresRepository() {
  // The password arrives as the DB_PASSWORD environment variable. On Cloud Run
  // it is injected from Secret Manager at instance start; locally it comes from
  // docker-compose. It is never written into the image or the repository.
  const password = process.env.DB_PASSWORD;

  const pool = new pg.Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT || 5432),
    user:     process.env.DB_USER || 'notely',
    password,
    database: process.env.DB_NAME || 'notely',
    max: 5,
    // Cloud SQL private IP traffic stays inside the VPC. To enforce TLS as well,
    // set DB_SSL=true (and require SSL on the instance with --ssl-mode).
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  await pool.query(SCHEMA);

  return {
    kind: 'postgres',
    async list() {
      const { rows } = await pool.query('SELECT * FROM notes ORDER BY id DESC');
      return rows.map(toNote);
    },
    async get(id) {
      const { rows } = await pool.query('SELECT * FROM notes WHERE id = $1', [Number(id)]);
      return toNote(rows[0]);
    },
    async create({ title, body }) {
      const { rows } = await pool.query(
        'INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING *', [title, body]);
      return toNote(rows[0]);
    },
    async update(id, { title, body }) {
      const { rows } = await pool.query(
        `UPDATE notes SET title = COALESCE($2, title), body = COALESCE($3, body),
                          updated_at = now()
         WHERE id = $1 RETURNING *`, [Number(id), title, body]);
      return toNote(rows[0]);
    },
    async setAttachment(id, a) {
      const { rows } = await pool.query(
        `UPDATE notes SET attachment_name = $2, attachment_object = $3,
                          attachment_size = $4, attachment_type = $5, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [Number(id), a.name, a.object, a.size, a.contentType]);
      return toNote(rows[0]);
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM notes WHERE id = $1', [Number(id)]);
      return rowCount > 0;
    },
    // /health calls this: a failing database now makes the instance report
    // "degraded" (503), which the load balancer health check will notice.
    async ping() { await pool.query('SELECT 1'); return true; },
  };
}

export async function createRepository() {
  return process.env.DB_HOST ? postgresRepository() : memoryRepository();
}
