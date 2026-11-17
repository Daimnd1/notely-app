import { useEffect, useRef, useState } from 'react';
import { listNotes, getNote, createNote, updateNote, deleteNote, fetchHealth, frontendId,
         uploadAttachment, apiBase, attachmentHref } from './api.js';

const s = {
  page:  { fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' },
  card:  { border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '.75rem' },
  input: { width: '100%', padding: '.5rem', marginBottom: '.5rem', boxSizing: 'border-box' },
  label: { display: 'block', margin: '.25rem 0 .75rem', color: '#444' },
  btn:   { padding: '.5rem 1rem', marginRight: '.5rem', cursor: 'pointer' },
  att:   { margin: '.5rem 0' },
  err:   { background: '#fee', border: '1px solid #f99', padding: '.75rem', borderRadius: 6 },
  foot:  { marginTop: '2rem', paddingTop: '.75rem', borderTop: '1px solid #eee',
           color: '#666', fontSize: '.8rem', fontFamily: 'ui-monospace, monospace' },
};


// Diagnostics bar: makes it visible from the browser which instance serves the
// static files and which one answers the API. With a MIG behind a load balancer,
// just reload to watch the backend change.
function ServedBy() {
  const [health, setHealth] = useState(null);
  const [front, setFront]   = useState(null);
  const [failed, setFailed] = useState(false);

  const probe = () => {
    fetchHealth().then((h) => { setHealth(h); setFailed(false); })
                 .catch(() => { setHealth(null); setFailed(true); });
  };

  useEffect(() => { frontendId().then(setFront); probe(); }, []);

  const i = health?.instance;
  const where = i && [i.zone ?? i.region, i.mig, i.revision].filter(Boolean).join(' · ');

  return (
    <footer style={s.foot}>
      <span><strong>Frontend:</strong> {front ?? 'local/bucket'}</span>
      {' — '}
      <span>
        <strong>API:</strong>{' '}
        {failed ? 'no response'
          : !i ? '…'
          : `${i.name} (${i.ip}) · ${i.platform}${where ? ` · ${where}` : ''} · up ${i.uptimeSeconds}s`}
      </span>
      <button style={{ ...s.btn, padding: '.15rem .5rem', marginLeft: '.5rem' }} onClick={probe}>
        refresh
      </button>
    </footer>
  );
}

// Exercise 4: the attached PDF of a note, as a link. The API streams the file
// (GET /api/notes/:id/attachment); the page never addresses the bucket itself.
function Attachment({ base, note }) {
  if (!note.attachment) return null;
  const kb = Math.max(1, Math.round(note.attachment.size / 1024));
  return (
    <p style={s.att}>
      <strong>Attachment:</strong>{' '}
      <a href={attachmentHref(base, note.id)} target="_blank" rel="noreferrer">
        {note.attachment.name}
      </a>{' '}
      <small>({kb} KB)</small>
    </p>
  );
}

export default function App() {
  const [notes, setNotes]       = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [base, setBase]         = useState('');

  const guard = fn => async (...a) => {
    try { await fn(...a); setError(null); } catch (e) { setError(e.message); }
  };

  const refresh = guard(async () => {
    setLoading(true);
    try { setNotes(await listNotes()); } finally { setLoading(false); }
  });

  useEffect(() => { apiBase().then(setBase); refresh(); }, []);

  const open = guard(async id => { setSelected(await getNote(id)); setEditing(null); });

  // Save the note; if the form has a PDF, upload it once the note exists (the
  // upload route needs the note's id). If the upload fails, the note is kept and
  // the error is shown: open the note and use "Attach file" to try again.
  const save = guard(async e => {
    e.preventDefault();
    const { id, title, body, file } = editing;
    const note = id ? await updateNote(id, { title, body }) : await createNote({ title, body });
    setEditing(null); setSelected(null);
    try {
      if (file) await uploadAttachment(note.id, file);
    } finally {
      await refresh();
    }
  });

  const remove = guard(async id => {
    if (!confirm('Delete this note?')) return;
    await deleteNote(id); setSelected(null); await refresh();
  });

  // Exercise 4: "Attach file" (PDF) on an existing note. A hidden <input type="file">
  // is opened by the button; on selection the file is posted to the API.
  const fileInput = useRef(null);
  const attach = guard(async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelected(await uploadAttachment(selected.id, file));
    e.target.value = '';
    await refresh();
  });

  return (
    <div style={s.page}>
      <h1>Notely</h1>
      {error && <p style={s.err}><strong>Error:</strong> {error}</p>}

      {editing ? (
        <form onSubmit={save} style={s.card}>
          <h2>{editing.id ? 'Edit note' : 'New note'}</h2>
          <input style={s.input} placeholder="Title" required value={editing.title}
                 onChange={e => setEditing({ ...editing, title: e.target.value })} />
          <textarea style={{ ...s.input, minHeight: 120 }} placeholder="Body" value={editing.body}
                    onChange={e => setEditing({ ...editing, body: e.target.value })} />
          {/* Exercise 4: a PDF can be attached while the note is created (or replaced while it is edited) */}
          <label style={s.label}>
            {editing.id ? 'Replace the attached PDF (optional): ' : 'Attach a PDF (optional): '}
            <input type="file" accept="application/pdf"
                   onChange={e => setEditing({ ...editing, file: e.target.files?.[0] ?? null })} />
          </label>
          <button style={s.btn} type="submit">Save</button>
          <button style={s.btn} type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      ) : selected ? (
        <div style={s.card}>
          <h2>{selected.title}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{selected.body}</p>
          <small>Updated: {selected.updatedAt}</small>
          <Attachment base={base} note={selected} />
          <input ref={fileInput} type="file" accept="application/pdf" style={{ display: 'none' }}
                 onChange={attach} />
          <div style={{ marginTop: '1rem' }}>
            <button style={s.btn} onClick={() => fileInput.current.click()}>Attach file</button>
            <button style={s.btn} onClick={() =>
              setEditing({ id: selected.id, title: selected.title, body: selected.body, file: null })}>Edit</button>
            <button style={s.btn} onClick={() => remove(selected.id)}>Delete</button>
            <button style={s.btn} onClick={() => setSelected(null)}>Back</button>
          </div>
        </div>
      ) : (
        <>
          <button style={s.btn} onClick={() => setEditing({ id: null, title: '', body: '', file: null })}>
            New note
          </button>
          {loading ? <p>Loading…</p>
            : notes.length === 0 ? <p>No notes yet.</p>
            : notes.map(n => (
                <div key={n.id} style={s.card}>
                  <strong>{n.title}</strong>
                  <p style={{ color: '#666', margin: '.5rem 0' }}>
                    {n.body?.slice(0, 90)}{n.body?.length > 90 ? '…' : ''}
                  </p>
                  <Attachment base={base} note={n} />
                  <button style={s.btn} onClick={() => open(n.id)}>View</button>
                </div>
              ))}
        </>
      )}

      <ServedBy />
    </div>
  );
}
