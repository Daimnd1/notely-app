# Exercise 3 — the notes move to a database in Finland

**What changes in the code:** `backend/src/repository.js` gets a PostgreSQL implementation (package
`pg`), chosen when `DB_HOST` is set; the in-memory one stays for local runs. `/health` now checks the
database (`SELECT 1`). `docker-compose.yml` adds a local PostgreSQL so you can test on your laptop.
The backend reads `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (and `DB_SSL`) from the environment.

**How it is deployed:** a Cloud SQL for PostgreSQL 16 instance in `europe-north1`, *regional* (a
primary and a standby in two zones), backups kept in Finland. The instance is created in the
**Enterprise** edition (`--edition=ENTERPRISE`): for PostgreSQL 16 the default is Enterprise Plus, which
offers no shared-core machine, so `db-f1-micro` would be refused. The API connects to the instance's
**public address**, and the instance accepts connections from any address (`0.0.0.0/0`) because a
Cloud Run instance has no fixed address to authorize. The connection is encrypted (`DB_SSL=true`) and
needs the password, which lives in Secret Manager and reaches the API as `DB_PASSWORD`. This is the
simplest set-up — and a database that listens to the whole internet. Exercise 5 closes it.

**Run it:** `bash deploy/exercise3.sh`. Console click-paths: course document, Exercise 3.

**Check it:** `curl https://…run.app/health` → `"storage":"postgres"`. Create a note, deploy a
no-change revision, reload: the note is still there.
