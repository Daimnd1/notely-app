# source deploy/00-env.sh   (terminal on your laptop, gcloud installed and signed in)
# Fill in YOUR values. Never commit real project IDs, passwords or keys to Git.
export PROJECT_ID="project-472dae6a-e39b-4e04-84a"
export REPO_URL="https://github.com/Daimnd1/notely-app.git"
export REGION="europe-north1"     # Finland
export ZONE="europe-north1-a"
export REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/notely"
gcloud config set project "${PROJECT_ID}"
gcloud config set run/region "${REGION}"
export PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
export DEFAULT_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
