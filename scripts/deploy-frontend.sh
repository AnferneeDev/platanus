#!/bin/bash
set -e

# Deploy frontend to S3 and invalidate CloudFront cache
# Usage: ./scripts/deploy-frontend.sh <s3-bucket-name> [cloudfront-distribution-id]

BUCKET=$1
DIST_ID=$2

if [ -z "$BUCKET" ]; then
  echo "Usage: $0 <s3-bucket-name> [cloudfront-distribution-id]"
  exit 1
fi

echo "Building frontend..."
cd frontend
npm run build
cd ..

echo "Syncing to s3://$BUCKET ..."
aws s3 sync frontend/dist "s3://$BUCKET" --delete

if [ -n "$DIST_ID" ]; then
  echo "Invalidating CloudFront cache..."
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
fi

echo "Done!"
