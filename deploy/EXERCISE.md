# Exercise 1 — two VMs, no containers

**What changes in the code:** nothing. This branch is the original app plus this `deploy/` folder.
The Dockerfiles appear in the `exercise2` branch.

**How it is deployed:** two `e2-micro` VMs in `europe-north1-a`. Each VM runs a startup script
(`deploy/startup-api.sh`, `deploy/startup-web.sh`) that installs Node.js 22, clones this repository,
installs the dependencies and starts its part. The frontend VM writes `dist/config.json` with the
API VM's address and serves the built page on port 80. Two firewall rules open ports 3000 and 80.

**Run it:** `source deploy/00-env.sh` (fill in your values first), then `bash deploy/exercise1.sh`.
The console click-paths are in the course document, Exercise 1.

**Check it:** `curl http://API_IP:3000/health` → `"storage":"memory"`. Create a note, reset the
API VM, reload: the note is gone (notes live in memory). That is what Exercise 3 fixes.

# Exercise 2 — containers on Cloud Run

**What changes in the code:** `backend/Dockerfile`, `frontend/Dockerfile`, `.dockerignore` files and
`docker-compose.yml` (to run both containers on your laptop). The frontend image writes
`dist/config.json` from the `API_BASE_URL` variable when the container starts.

**How it is deployed:** build the two images on your laptop (Docker Desktop), push them to an
Artifact Registry repository in `europe-north1`, and create two Cloud Run services from them.
Cloud Run replicates a service across the zones of the region and adds instances with traffic.
Both services run with minimum instances 1 (one copy always warm) and maximum instances 2 (the cost fuse).

**Run it:** `bash deploy/exercise2.sh`. Console click-paths: course document, Exercise 2.

**Check it:** open the page's `https://…run.app` URL. Notes still live in memory — and now there
may be several instances, each with its own notes. That is the "notes appear and disappear"
problem Exercise 3 solves.
