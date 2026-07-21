#!/bin/bash

# Sampling-plan file download (case-management "Application details" page).
# Seeds a fixture object matching the s3Key on the `full-payload-verification`
# work item (see ReAccreditationSeeder.cs) so the download e2e spec resolves
# to a real object end-to-end, not just a rendered link.
aws --endpoint-url="$LOCALSTACK_URL" s3 --region "$AWS_REGION" mb s3://epr-register-enrol-sampling-plans

echo "%PDF-1.4 fixture content for e2e download tests" > /tmp/sampling-plan.pdf
aws --endpoint-url="$LOCALSTACK_URL" s3 cp /tmp/sampling-plan.pdf \
  s3://epr-register-enrol-sampling-plans/sampling-plans/full-payload-verification/sampling-plan.pdf \
  --content-type application/pdf
