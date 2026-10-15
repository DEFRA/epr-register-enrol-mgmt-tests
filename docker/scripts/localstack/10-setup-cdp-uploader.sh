#!/bin/bash
# The S3 bucket and SQS queues cdp-uploader needs. Specs that assert a file
# download upload their own fixture PDFs through cdp-uploader on every run
# (test/support/cdp-uploader.js), as they do on CDP test, so nothing is
# pre-loaded here.
set -e

ENDPOINT="$AWS_ENDPOINT_URL"
REGION="$AWS_REGION"

# The destination bucket: the operator journey's upload bucket
# (FILE_UPLOAD_S3_BUCKET), which management-fe also downloads from.
aws --endpoint-url="$ENDPOINT" s3 --region "$REGION" mb s3://epr-register-enrol-file-uploads

# cdp-uploader stages every upload here first and only copies it into the
# destination bucket once the mock scan clears it.
aws --endpoint-url="$ENDPOINT" s3 --region "$REGION" mb s3://cdp-uploader-quarantine

aws --endpoint-url="$ENDPOINT" sqs create-queue --region "$REGION" --queue-name cdp-clamav-results
aws --endpoint-url="$ENDPOINT" sqs create-queue --region "$REGION" --queue-name cdp-uploader-download-requests
aws --endpoint-url="$ENDPOINT" sqs create-queue --region "$REGION" --queue-name mock-clamav
aws --endpoint-url="$ENDPOINT" sqs create-queue --region "$REGION" \
  --queue-name cdp-uploader-scan-results-callback.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

# cdp-uploader's mock virus scanner listens on the mock-clamav queue for S3
# event notifications about new quarantine objects. Without this wiring
# nothing publishes to that queue and every upload stays "pending".
aws --endpoint-url="$ENDPOINT" s3api put-bucket-notification-configuration \
  --region "$REGION" \
  --bucket cdp-uploader-quarantine \
  --notification-configuration '{"QueueConfigurations":[{"QueueArn":"arn:aws:sqs:eu-west-2:000000000000:mock-clamav","Events":["s3:ObjectCreated:*"]}]}'

# Marker for the floci healthcheck (compose.yml): floci answers requests
# before this script has run, so "port is up" is not "provisioned".
touch /tmp/floci-init-complete
