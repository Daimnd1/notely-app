#!/usr/bin/env bash
# Exercise 2 - containers on Cloud Run: build the two images on your laptop, push them, deploy two services.
# Needs: Docker Desktop running, gcloud signed in, `source deploy/00-env.sh` done.
set -euo pipefail
source "$(dirname "$0")/00-env.sh"

# 1. APIs and the image repository in Finland
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create notely --repository-format=docker --location="${REGION}"

# 2. Let Docker push to that repository
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# 3. Build the two images (Cloud Run runs 64-bit Linux images, hence --platform)
docker build --platform linux/amd64 -t "${REGISTRY}/notely-api:v1" backend
docker build --platform linux/amd64 -t "${REGISTRY}/notely-web:v1" frontend
docker push "${REGISTRY}/notely-api:v1"
docker push "${REGISTRY}/notely-web:v1"

# 4. Deploy the API, then the page pointing at the API's URL.
#    Each service: at least 1 instance (one always warm) and at most 2 (the cost fuse).
gcloud run deploy notely-api --image "${REGISTRY}/notely-api:v1" --region "${REGION}" \
  --allow-unauthenticated --min-instances=1 --max-instances=2
API_URL=$(gcloud run services describe notely-api --region "${REGION}" --format='value(status.url)')
gcloud run deploy notely-web --image "${REGISTRY}/notely-web:v1" --region "${REGION}" \
  --allow-unauthenticated --min-instances=1 --max-instances=2 --set-env-vars "API_BASE_URL=${API_URL}"
gcloud run services describe notely-web --region "${REGION}" --format='value(status.url)'

# 5. The Exercise 1 VMs and their firewall rules are no longer needed
gcloud compute instances delete notely-api notely-web --zone="${ZONE}" --quiet || true
gcloud compute firewall-rules delete notely-allow-api-3000 notely-allow-web-80 --quiet || true
