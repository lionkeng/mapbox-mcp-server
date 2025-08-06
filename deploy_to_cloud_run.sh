# Meant to be run from the root of alpine
if echo "" | gcloud projects list &> /dev/null; then
    echo "Already logged in."
else
    gcloud auth login
fi

DOCKERFILE_LOCATION=Dockerfile.alpine
SERVICE=mapbox-mcp-server
TAG_NAME=$(date +"%Y%m%d_%H%M%S")
IMAGE_NAME="us-east1-docker.pkg.dev/skilled-snow-234313/anewgo/$SERVICE:$TAG_NAME"

gcloud auth configure-docker us-east1-docker.pkg.dev
gcloud config set project skilled-snow-234313
docker build . --platform linux/amd64 -f $DOCKERFILE_LOCATION -t "$IMAGE_NAME"
docker push "$IMAGE_NAME"
gcloud config set project research-415119
gcloud run deploy "$SERVICE" --image "$IMAGE_NAME"
