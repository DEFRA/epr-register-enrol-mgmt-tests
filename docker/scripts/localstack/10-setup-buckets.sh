#!/bin/bash

# Sampling-plan file download (case-management "Application details" page).
# Seeds a fixture object matching the s3Key on the `full-payload-verification`
# work item (see ReAccreditationSeeder.cs) so the download e2e spec resolves
# to a real object end-to-end, not just a rendered link.
aws --endpoint-url="$AWS_ENDPOINT_URL" s3 --region "$AWS_REGION" mb s3://epr-register-enrol-sampling-plans

echo "%PDF-1.4 fixture content for e2e download tests" > /tmp/sampling-plan.pdf
aws --endpoint-url="$AWS_ENDPOINT_URL" s3 cp /tmp/sampling-plan.pdf \
  s3://epr-register-enrol-sampling-plans/sampling-plans/full-payload-verification/sampling-plan.pdf \
  --content-type application/pdf

# RA-295 (AC02): a SECOND supporting document on the same sampling plan.
# AC02 requires every supporting document to be listed, not just the first,
# which is untestable against a fixture holding one file — the assertion would
# pass against a template that renders files[0] and stops. management-be added
# the matching `sampling-plan-002` entry to the `full-payload-verification`
# seed, including an s3Key in this bucket; without the object below that key
# would be a dangling reference, which is a trap for whoever next adds download
# coverage. Seeded here for the same reason as file 1: so the link resolves to
# a real object end-to-end rather than merely being shaped correctly.
echo "%PDF-1.4 appendix fixture content for e2e download tests" > /tmp/sampling-plan-appendix.pdf
aws --endpoint-url="$AWS_ENDPOINT_URL" s3 cp /tmp/sampling-plan-appendix.pdf \
  s3://epr-register-enrol-sampling-plans/sampling-plans/full-payload-verification/sampling-plan-appendix.pdf \
  --content-type application/pdf

# BES-evidence file download (case-management "Application details" page,
# overseas sites section). Same pattern as the sampling-plan fixture above,
# matching the s3Key/s3Bucket on the `full-payload-verification` work item's
# seeded overseas site (see ReAccreditationSeeder.cs).
aws --endpoint-url="$AWS_ENDPOINT_URL" s3 --region "$AWS_REGION" mb s3://epr-register-enrol-bes-evidence

echo "%PDF-1.4 fixture content for e2e download tests" > /tmp/bes-evidence.pdf
aws --endpoint-url="$AWS_ENDPOINT_URL" s3 cp /tmp/bes-evidence.pdf \
  s3://epr-register-enrol-bes-evidence/bes-evidence/full-payload-verification/bes-evidence.pdf \
  --content-type application/pdf
