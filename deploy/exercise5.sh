#!/usr/bin/env bash
# Exercise 5 - only the page faces the internet.
#
#   Internet ──► notely-web ──(VPC)──► notely-api ──(VPC)──► Cloud SQL (private address only)
#                                          └──────────────► Cloud Storage (private bucket)
#
# The script runs in six steps; the order matters (each one relies on the previous ones):
#   1. DATABASE   Private services access: Cloud SQL gets a private address and loses the public one
#   2. API        Direct VPC egress (private ranges only): the API reaches the database's private address
#   3. PAGE       Private Google Access + firewall + Direct VPC egress (all traffic): the page joins the
#                 VPC, reaches the API through it, and is kept away from the database
#   4. API        Ingress "internal": the API stops accepting requests from the internet
#   5. BUCKET     Private for good; the Cloud Run identity gets explicit access
#   6. CHECK
#
# Needs: Docker Desktop running (the page's image changes), gcloud signed in, deploy/00-env.sh filled in.
set -euo pipefail
source "$(dirname "$0")/00-env.sh"
BUCKET="gs://notely-attachments-${PROJECT_ID}"
gcloud services enable compute.googleapis.com servicenetworking.googleapis.com


# ==============================================================================================
# 1. DATABASE - Private services access
#    Cloud SQL ends up with a private address only, reachable from the default network
#
#    What Private services access is: Cloud SQL does not run in our network but in a network Google
#    manages. We reserve an address range in our network (it is NOT a subnet: none of our resources
#    use it) and connect both networks through VPC peering. Google creates its own subnets inside that
#    range and gives the database a private address from it, reachable from our network as if it
#    were local. The same range and peering also serve Memorystore, AlloyDB, Filestore, etc.
# ==============================================================================================

# An address range in the default network reserved for Google's services, and the peering that hands it over
gcloud compute addresses create notely-psa-range --global --purpose=VPC_PEERING --prefix-length=16 --network=default
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com --ranges=notely-psa-range --network=default

# Give the database instance a private address (restarts the instance), then drop the public one and the open network
gcloud sql instances patch notely-db --network="projects/${PROJECT_ID}/global/networks/default"
gcloud sql instances patch notely-db --no-assign-ip --clear-authorized-networks
DB_IP=$(gcloud sql instances describe notely-db --flatten=ipAddresses \
  --format='value(ipAddresses.type,ipAddresses.ipAddress)' | awk '$1 == "PRIVATE" {print $2}')


# ==============================================================================================
# 2. API -> DATABASE - Direct VPC egress (private ranges only)
#    Only traffic to private addresses goes through the VPC; Cloud Storage keeps its usual path
#
#    What Direct VPC egress is: Cloud Run does not live in our network either, so on its own it
#    cannot reach a private address. With --network/--subnet, each instance gets an address in that
#    subnet and sends its OUTBOUND traffic through the VPC (it changes nothing about who can call it).
#    --vpc-egress picks which traffic goes that way:
#      private-ranges-only  only traffic to private addresses (10.x, 172.16.x, 192.168.x)
#      all-traffic          everything, including calls to Google services and the internet
# ==============================================================================================

gcloud run services update notely-api --region "${REGION}" \
  --network=default --subnet=default --vpc-egress=private-ranges-only \
  --update-env-vars "DB_HOST=${DB_IP}"


# ==============================================================================================
# 3. PAGE -> API - Private Google Access + firewall + Direct VPC egress (all traffic)
#    The page sends everything through the VPC, so its calls to the API arrive as "internal"
#
#    What Private Google Access is: an option of a subnet. Addresses in the subnet are private, with
#    no public address and no Cloud NAT, so on their own they cannot leave the network. With this
#    option on, they can still reach Google's APIs and services (Cloud Storage, *.run.app, ...) over
#    Google's network, never through the internet. Only the page needs it: with all-traffic, its call
#    to the API's *.run.app address goes through the subnet. The API uses private-ranges-only, so its
#    calls to Google services (Cloud Storage) never go through the subnet.
# ==============================================================================================

# 3a. Private Google Access on the subnet both services use: from the VPC, the page can still reach *.run.app
gcloud compute networks subnets update default --region="${REGION}" --enable-private-ip-google-access

# 3b. The page is about to join the same network as the database: a firewall rule denies it the database port
#     An EGRESS rule on the default network: traffic leaving resources tagged notely-web towards the
#     Private services access range on port 5432 is dropped. The API has no tag, so it is not affected.
PSA_RANGE="$(gcloud compute addresses describe notely-psa-range --global --format='value(address)')/16"
gcloud compute firewall-rules create notely-deny-web-to-db --network=default --direction=EGRESS --action=DENY \
  --rules=tcp:5432 --destination-ranges="${PSA_RANGE}" --target-tags=notely-web --priority=900

# 3c. The page becomes the API's reverse proxy: new image, all its outbound traffic through the VPC,
#     the network tag the firewall rule targets, and the API's address in API_URL
API_URL=$(gcloud run services describe notely-api --region "${REGION}" --format='value(status.url)')
docker build --platform linux/amd64 -t "${REGISTRY}/notely-web:v3" frontend && docker push "${REGISTRY}/notely-web:v3"
gcloud run services update notely-web --region "${REGION}" --image "${REGISTRY}/notely-web:v3" \
  --network=default --subnet=default --network-tags=notely-web --vpc-egress=all-traffic \
  --remove-env-vars=API_BASE_URL --update-env-vars "API_URL=${API_URL}"


# ==============================================================================================
# 4. API - Ingress "internal"
#    Only now, with the page already going through the VPC, can the API stop listening to the internet
#
#    What ingress "internal" is: it controls who may CALL the service (the opposite direction of
#    egress). The *.run.app address still exists, but Cloud Run only accepts requests that come from
#    our VPC (or from a few Google services); anything from the internet gets a 404.
# ==============================================================================================

gcloud run services update notely-api --region "${REGION}" --ingress=internal


# ==============================================================================================
# 5. BUCKET - private for good
#    Nobody on the internet reads it any more; the Cloud Run identity gets explicit access
# ==============================================================================================

gcloud storage buckets remove-iam-policy-binding "${BUCKET}" --member=allUsers --role=roles/storage.objectViewer
gcloud storage buckets update "${BUCKET}" --public-access-prevention
gcloud storage buckets add-iam-policy-binding "${BUCKET}" --member="serviceAccount:${DEFAULT_SA}" --role=roles/storage.objectAdmin


# ==============================================================================================
# 6. CHECK
# ==============================================================================================

WEB_URL=$(gcloud run services describe notely-web --region "${REGION}" --format='value(status.url)')
curl -s -o /dev/null -w "API from the internet: %{http_code} (404 = refused by ingress)\n" "${API_URL}/health"
curl -s "${WEB_URL}/health"; echo "   <- the API, answering through the page"
gcloud sql instances describe notely-db --format='yaml(ipAddresses)'
gcloud storage buckets describe "${BUCKET}" --format='value(public_access_prevention)'
