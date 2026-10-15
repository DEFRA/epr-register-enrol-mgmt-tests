/**
 * Uploading fixture files the way the operator journey does, through
 * cdp-uploader, so a spec that follows a download link fetches a real object
 * in the bucket management-fe downloads from. Every run uploads its own files:
 * nothing is pre-loaded into S3, on CDP test or on the compose stack.
 *
 * The flow is cdp-uploader's own: initiate an upload into
 * FILE_UPLOAD_S3_BUCKET, POST the file as multipart to the returned upload
 * URL, then poll the upload's status until the (mock, on compose) virus scan
 * has finished and the file has been copied into the bucket.
 */

import { browser } from '@wdio/globals'

import { cdpUploaderRequest, expectStatus } from './backend-api.js'

const FILE_FIELD = 'file'

const uploadBucket = () =>
  process.env.FILE_UPLOAD_S3_BUCKET ?? 'epr-register-enrol-file-uploads'

/**
 * Upload one PDF and return the file record a submission carries for it:
 * `{ fileId, filename, contentType, scanStatus, s3Key, s3Bucket }`.
 *
 * `content` must start with `%PDF`, so the content type cdp-uploader detects
 * matches the one it was told to accept.
 */
export async function uploadPdf(filename, content) {
  const initiated = expectStatus(
    await cdpUploaderRequest('POST', 'initiate', {
      body: {
        redirect: '/',
        s3Bucket: uploadBucket(),
        s3Path: `mgmt-tests/${Date.now()}`,
        mimeTypes: ['application/pdf'],
        metadata: { source: 'epr-register-enrol-mgmt-tests' }
      }
    }),
    [200, 201],
    `cdp-uploader initiate for ${filename}`
  ).body

  const form = new FormData()
  form.append(
    FILE_FIELD,
    new Blob([content], { type: 'application/pdf' }),
    filename
  )
  expectStatus(
    await cdpUploaderRequest('POST', initiated.uploadUrl, { body: form }),
    [200, 201, 302, 303],
    `cdp-uploader upload of ${filename}`
  )

  let status
  await browser.waitUntil(
    async () => {
      status = (await cdpUploaderRequest('GET', `status/${initiated.uploadId}`))
        .body
      return status?.uploadStatus === 'ready'
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `cdp-uploader never finished ${filename} (last status ${JSON.stringify(status)})`
    }
  )
  const file = status.form?.[FILE_FIELD]
  if (!file?.s3Key || file.hasError) {
    throw new Error(
      `cdp-uploader rejected ${filename}: ${JSON.stringify(status)}`
    )
  }
  return {
    fileId: file.fileId,
    filename: file.filename,
    contentType: file.contentType ?? 'application/pdf',
    scanStatus: 'Clean',
    s3Key: file.s3Key,
    s3Bucket: file.s3Bucket
  }
}
