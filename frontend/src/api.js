const authHeaders = () => { const token = sessionStorage.getItem('notely-token'); return token ? { Authorization: `Bearer ${token}` } : {}; };
let configPromise = null;

// config.json is served with no-store: every frontend VM or container can
// rewrite it at startup to announce who is serving the static files.
function config() {
  configPromise ??= fetch('/config.json', { cache: 'no-store' })
    .then((r) => r.json())
    .catch(() => ({}));
  return configPromise;
}

async function base() {
  return (await config()).apiBaseUrl ?? '';
}

async function request(path, options = {}) {
  const res = await fetch(`${await base()}/api/notes${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? null : res.json();
}

export const listNotes  = ()      => request('');
export const getNote    = (id)    => request(`/${id}`);
export const createNote = (d)     => request('', { method: 'POST', body: JSON.stringify(d) });
export const updateNote = (id, d) => request(`/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteNote = (id)    => request(`/${id}`, { method: 'DELETE' });

// Exercise 4 -- "Attach file". The browser posts a multipart form to the API;
// the API stores the PDF in Cloud Storage. Do NOT set Content-Type here: the
// browser adds the multipart boundary itself.
export async function uploadAttachment(id, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${await base()}/api/notes/${id}/attachment`, { method: 'POST', body: form, headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// The API's base address, read once from config.json ('' = same origin).
export const apiBase = () => base();

// The PDF is streamed back by the API: links point at the API, never at the bucket.
export async function downloadAttachment(id) {
  const response = await fetch(`${await base()}/api/notes/${id}/attachment`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = `note-${id}.pdf`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Who serves the static files. The VM startup script writes it into config.json;
// on the bucket (final stage) there is no instance, just Cloud Storage itself.
export const frontendId = async () => (await config()).frontendInstance ?? null;

export async function fetchHealth() {
  const res = await fetch(`${await base()}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
