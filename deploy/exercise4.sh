#!/usr/bin/env bash
# Exercise 4 - PDF attachments in a Cloud Storage bucket, written and read by the API.
# The bucket is deliberately EXPOSED here: public access prevention is off and anyone who knows a
# file's address can download it. Exercise 5 makes it private.
set -euo pipefail
source "$(dirname "$0")/00-env.sh"

# 1. A versioned bucket in Finland, IAM only (uniform access), public access prevention OFF
gcloud storage buckets create "gs://notely-attachments-${PROJECT_ID}" --location="${REGION}" \
  --uniform-bucket-level-access --no-public-access-prevention
gcloud storage buckets update "gs://notely-attachments-${PROJECT_ID}" --versioning

# 2. Make every file in it publicly readable (the exposure Exercise 5 removes)
gcloud storage buckets add-iam-policy-binding "gs://notely-attachments-${PROJECT_ID}" --member=allUsers --role=roles/storage.objectViewer

# No grant for the API yet: it runs as the Compute Engine default service account, which gets the Editor
# role on the project unless an organization policy disables that grant, and on a bucket with uniform
# access Editor brings Storage Legacy Object Owner. Exercise 5 replaces that with an explicit grant.
# If your project's default service account has no Editor role, run this now:
#   gcloud storage buckets add-iam-policy-binding "gs://notely-attachments-${PROJECT_ID}" \
#     --member="serviceAccount:${DEFAULT_SA}" --role=roles/storage.objectAdmin

# 3. New images (this branch adds the routes and the button), built on your laptop
docker build --platform linux/amd64 -t "${REGISTRY}/notely-api:v3" backend && docker push "${REGISTRY}/notely-api:v3"
docker build --platform linux/amd64 -t "${REGISTRY}/notely-web:v2" frontend && docker push "${REGISTRY}/notely-web:v2"

# 4. New revisions: the API learns the bucket's name
gcloud run services update notely-api --region "${REGION}" --image "${REGISTRY}/notely-api:v3" \
  --update-env-vars "ATTACHMENTS_BUCKET=notely-attachments-${PROJECT_ID}"
gcloud run services update notely-web --region "${REGION}" --image "${REGISTRY}/notely-web:v2"
