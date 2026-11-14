#!/usr/bin/env bash
# Exercise 3 - Cloud SQL for PostgreSQL in Finland with a standby (regional). The API connects to the
# instance's PUBLIC address; the instance accepts connections from any address (authorized network
# 0.0.0.0/0). That is deliberately simple and deliberately exposed: Exercise 5 closes it.
set -euo pipefail
source "$(dirname "$0")/00-env.sh"
gcloud services enable sqladmin.googleapis.com secretmanager.googleapis.com

# 1. The database: REGIONAL = primary + standby in two zones; backups kept in Finland; public IP,
#    reachable from anywhere (a Cloud Run instance has no fixed address to authorize).
#    --edition=ENTERPRISE: PostgreSQL 16 defaults to Enterprise Plus, which has no shared-core tier (db-f1-micro).
gcloud sql instances create notely-db --database-version=POSTGRES_16 --edition=ENTERPRISE --region="${REGION}" \
  --tier=db-f1-micro --availability-type=REGIONAL --storage-type=SSD --storage-size=10 \
  --backup-start-time=02:00 --backup-location="${REGION}" --enable-point-in-time-recovery \
  --authorized-networks=0.0.0.0/0
gcloud sql databases create notely --instance=notely-db
DB_PASSWORD=$(openssl rand -base64 18)          # generated here, never written to a file
gcloud sql users create notely --instance=notely-db --password="${DB_PASSWORD}"
DB_IP=$(gcloud sql instances describe notely-db --format='value(ipAddresses[0].ipAddress)')

# 2. The password becomes a secret stored only in Finland; the API's identity may read it
printf '%s' "${DB_PASSWORD}" | gcloud secrets create notely-db-password --data-file=- --replication-policy=user-managed --locations="${REGION}"
gcloud secrets add-iam-policy-binding notely-db-password --member="serviceAccount:${DEFAULT_SA}" --role=roles/secretmanager.secretAccessor

# 3. New API image (this branch adds PostgreSQL support), built on your laptop
docker build --platform linux/amd64 -t "${REGISTRY}/notely-api:v2" backend
docker push "${REGISTRY}/notely-api:v2"

# 4. New revision: image v2, the database's public address, encrypted connection, the secret as DB_PASSWORD
gcloud run services update notely-api --region "${REGION}" --image "${REGISTRY}/notely-api:v2" \
  --set-env-vars "DB_HOST=${DB_IP},DB_NAME=notely,DB_USER=notely,DB_SSL=true" \
  --update-secrets "DB_PASSWORD=notely-db-password:1"
curl -s "$(gcloud run services describe notely-api --region "${REGION}" --format='value(status.url)')/health"
