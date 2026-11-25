/**
 * RA-495. Path B for add-ORS (`add-overseas-site`) work items: an in-year
 * change request built and submitted through the Registration & Accreditation
 * service backend (the operator journey backend), which raises the
 * case-management work item itself. Both systems then know the item, so
 * management-be's status pushes to that backend's change-request status route
 * are applied, and "Confirm applicant contact" can complete.
 *
 * A change request needs an Approved exporter accreditation with a registered
 * overseas reprocessing site (ORS) not yet on it, which no API creates: an
 * `e2e-` test organisation is a reprocessor with no ORSs. So these items use
 * org 50019 ("In-Year Change Exports Ltd"), which that backend's dev seed
 * (DevExporterAccreditationSeedService) gives such an accreditation, and only
 * in Development: the DEFRA/epr-register-enrol monorepo's root stack, which
 * also has in-year changes on and sends them to case management. Nowhere else
 * holds it, so `findInYearChangeAccreditation` returns null there and the
 * spec skips.
 *
 * Granting a site is one-way, and a request in progress locks its site, so
 * reruns need the organisation reset. That needs the stack's MongoDB, which
 * both backends share there: set MONOREPO_MONGO_URL (wdio.local.conf.js
 * defaults it to the root stack's published port). The fe-tests @monorepo
 * specs use the same organisation and reset it the same way; never run the
 * two suites at once.
 */

import { browser } from '@wdio/globals'
import { Binary, MongoClient } from 'mongodb'

import {
  cdpUploaderRequest,
  expectStatus,
  operatorBackendRequest
} from './backend-api.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'

export const IN_YEAR_CHANGE_ORGANISATION_ID = '50019'

/**
 * Seeded on 50019's accreditation, registered only and complete, so it can be
 * added with no further answers. The fe-tests @monorepo specs use Lyon.
 */
export const ROTTERDAM = { siteId: 901914, orsId: '009' }

/**
 * RA-769. Seeded on 50019's accreditation, registered only and outside the EU
 * and OECD, so a request for it must carry its coordinates, operation codes
 * and conditions of export, and BES evidence while those are not met. Granting
 * it writes all of those onto the site (and locks them), so a rerun needs them
 * taken off again: `pristine` is the seeded state that
 * resetInYearChangeOrganisation({ site }) puts back.
 */
export const DELHI = {
  siteId: 901911,
  orsId: '006',
  siteName: 'Delhi Polymers Pvt',
  answers: {
    coordinates: '28.6139, 77.2090',
    operationCodes: ['R3'],
    conditionsOfExport: false
  },
  pristine: {
    coordinates: null,
    operationCodes: [],
    conditionsOfExport: null,
    besEvidence: null
  }
}

const TYPE_ID = 'add-overseas-site'
const OPERATOR_DATABASE = 'epr'
const CASE_MANAGEMENT_DATABASE = 'epr-register-case-management'

/** Items no longer being decided: granted, refused or withdrawn. */
const FINAL_ITEM_STATUSES = new Set(['Approved', 'Rejected', 'Withdrawn'])

export const isMonorepoMongoConfigured = () =>
  Boolean(process.env.MONOREPO_MONGO_URL)

/** `describe` where the monorepo Mongo is configured, `describe.skip` anywhere else. */
export const describeIfMonorepoMongo = (name, suite) =>
  (isMonorepoMongoConfigured() ? describe : describe.skip)(name, suite)

async function withMongo(work) {
  const client = new MongoClient(process.env.MONOREPO_MONGO_URL)
  try {
    await client.connect()
    return await work(client)
  } finally {
    await client.close()
  }
}

/** A .NET Guid as that backend stores it (a UUID binary), as a string. */
function guidString(value) {
  return value instanceof Binary ? value.toUUID().toHexString() : String(value)
}

const changesPath = (applicationId, suffix = '') =>
  `/api/v1/accreditation-changes/${IN_YEAR_CHANGE_ORGANISATION_ID}/${applicationId}${suffix}`

/**
 * The seeded accreditation application's id ("a", the year, then the org id
 * padded to 19 digits), for the year the seed ran in, or null where that
 * backend has no such accreditation (or in-year changes are off).
 */
export async function findInYearChangeAccreditation() {
  const year = new Date().getUTCFullYear()
  for (const candidate of [year, year - 1]) {
    const applicationId = `a${candidate}${IN_YEAR_CHANGE_ORGANISATION_ID.padStart(19, '0')}`
    const result = await operatorBackendRequest(
      'GET',
      changesPath(applicationId)
    )
    if (result.status === 200) {
      return applicationId
    }
  }
  return null
}

/**
 * Deletes 50019's change requests, the add-ORS work items case management
 * raised for them and the submissions those came in, and puts `siteId` back
 * to registered only on the accreditation application, as the seed leaves
 * it. Only the legacy application: the root stack runs without dual-write,
 * so the domain model holds no grant.
 *
 * RA-769: a site that was not seeded complete (DELHI) also has the answers
 * and BES evidence a grant wrote taken off again: pass its `pristine` values.
 */
export async function resetInYearChangeOrganisation({ siteId, pristine = {} }) {
  const organisationId = IN_YEAR_CHANGE_ORGANISATION_ID
  const pristineSet = Object.fromEntries(
    Object.entries(pristine).map(([field, value]) => [
      `overseasSites.sites.$[site].${field}`,
      value
    ])
  )
  return withMongo(async (client) => {
    const operator = client.db(OPERATOR_DATABASE)
    const caseManagement = client.db(CASE_MANAGEMENT_DATABASE)
    const workItemFilter = {
      typeId: TYPE_ID,
      'payload.operatorOrganisationId': organisationId
    }

    const requestIds = await caseManagement
      .collection('workItems')
      .distinct('payload.operatorRequestId', workItemFilter)
    const submissions = await caseManagement
      .collection('submissions')
      .deleteMany({ _id: { $in: requestIds } })
    const workItems = await caseManagement
      .collection('workItems')
      .deleteMany(workItemFilter)
    const changeRequests = await operator
      .collection('accreditationChangeRequests')
      .deleteMany({ organisationId })
    const applications = await operator
      .collection('accreditationApplications')
      .updateMany(
        { organisationId, 'overseasSites.sites.siteId': siteId },
        {
          $set: {
            'overseasSites.sites.$[site].selected': false,
            ...pristineSet
          },
          $unset: { 'overseasSites.sites.$[site].validFrom': '' }
        },
        { arrayFilters: [{ 'site.siteId': siteId }] }
      )

    return {
      changeRequests: changeRequests.deletedCount,
      workItems: workItems.deletedCount,
      submissions: submissions.deletedCount,
      applications: applications.modifiedCount
    }
  })
}

/**
 * That backend's own record of the item: its case-management work item id
 * and its status-push ordering watermark, which its API does not show.
 */
async function storedItem(itemId) {
  return withMongo(async (client) => {
    const requests = await client
      .db(OPERATOR_DATABASE)
      .collection('accreditationChangeRequests')
      .find({ organisationId: IN_YEAR_CHANGE_ORGANISATION_ID })
      .toArray()
    const item = requests
      .flatMap((request) => request.sites)
      .find((site) => guidString(site.itemId) === itemId)
    if (!item) {
      throw new Error(`No change request item ${itemId} is stored`)
    }
    return {
      workItemId: item.caseManagementWorkItemId
        ? guidString(item.caseManagementWorkItemId)
        : null,
      statusUpdatedAt: item.caseManagementStatusUpdatedAt ?? null
    }
  })
}

/** The item's status-push ordering watermark, as a Date (null before any push). */
export async function itemStatusWatermark(itemId) {
  return (await storedItem(itemId)).statusUpdatedAt
}

/** The accreditation's sites and its change requests, newest first. */
async function getChangeRequests(applicationId) {
  return expectStatus(
    await operatorBackendRequest('GET', changesPath(applicationId)),
    200,
    `GET change requests for ${applicationId}`
  ).body
}

/**
 * The accreditation's site and the change request item, as that backend's
 * API shows them to the operator.
 */
export async function getChangeRequestItem({ applicationId, itemId, siteId }) {
  const body = await getChangeRequests(applicationId)
  const request = body.requests.find((r) =>
    r.sites.some((s) => s.itemId === itemId)
  )
  return {
    request,
    item: request?.sites.find((s) => s.itemId === itemId),
    site: body.sites.find((s) => s.siteId === siteId)
  }
}

/** Polls until management-be's background push has set the item's status. */
export async function waitForChangeRequestItemStatus(item, status) {
  let last
  await browser.waitUntil(
    async () => {
      last = await getChangeRequestItem(item)
      return last.item?.status === status
    },
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: `Change request item ${item.itemId} never reached ${status}`
    }
  )
  return last
}

/**
 * As the operator: adds the registered `site` to a new change request on the
 * accreditation and submits it, so that backend raises its case-management
 * work item. Returns
 *
 *   { id, itemId, applicationId, siteId, submittedAt }
 *
 * where `id` is the case-management work item id.
 *
 * RA-770: `alsoSites` ([{ site, answers, besEvidence }]) are added to the
 * same request before the submit, so one submission raises several work
 * items; each is returned in `others`, as { id, itemId, applicationId, siteId,
 * submittedAt }.
 *
 * RA-769: a site that needs more than adding (DELHI) takes `answers`
 * (its coordinates, operation codes and conditions of export) and
 * `besEvidence` ({ filename, content }, one PDF uploaded through that
 * backend and cdp-uploader, as the operator's page does), sent before the
 * submit. The uploaded file's record is returned as `besFile`.
 */
export async function submitAddOverseasSiteChangeRequest({
  applicationId,
  site,
  answers,
  besEvidence,
  alsoSites = []
}) {
  const besFile = await addSiteToChangeRequest({
    applicationId,
    site,
    answers,
    besEvidence
  })
  for (const also of alsoSites) {
    await addSiteToChangeRequest({ applicationId, ...also })
  }
  expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(applicationId, '/requests/current/submit'),
      {
        body: {
          fullName: 'E2E Submitter',
          jobTitle: 'Tester',
          email: SIMULATED_DELIVERED_EMAIL,
          paymentReference: 'E2E-IYC-PAYMENT'
        }
      }
    ),
    200,
    `submit the change request for ORS ${site.orsId}`
  )

  const body = await getChangeRequests(applicationId)
  // Newest first. Only an item still being decided: a site requested again
  // after a refusal has its old item too.
  const request = body.requests.find(
    (r) =>
      r.status === 'Submitted' &&
      r.sites.some(
        (s) => s.siteId === site.siteId && !FINAL_ITEM_STATUSES.has(s.status)
      )
  )
  if (!request) {
    throw new Error(`No submitted change request holds ORS ${site.orsId}`)
  }
  const submitted = async (siteId) => {
    const item = request.sites.find((s) => s.siteId === siteId)
    const { workItemId } = await storedItem(item.itemId)
    if (!workItemId) {
      throw new Error(
        `Change request item ${item.itemId} was submitted but has no case-management work item`
      )
    }
    return {
      id: workItemId,
      itemId: item.itemId,
      applicationId,
      siteId,
      submittedAt: request.submittedAt
    }
  }
  const others = []
  for (const also of alsoSites) {
    others.push(await submitted(also.site.siteId))
  }
  return { ...(await submitted(site.siteId)), besFile, others }
}

/**
 * As the operator: adds `site` to the open change request, answers its
 * questions and uploads its BES evidence when given. Returns the uploaded
 * file, if any.
 */
async function addSiteToChangeRequest({
  applicationId,
  site,
  answers,
  besEvidence
}) {
  expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(applicationId, '/requests/current/sites'),
      { body: { siteId: site.siteId } }
    ),
    [200, 201],
    `add ORS ${site.orsId} to a change request`
  )
  if (answers) {
    expectStatus(
      await operatorBackendRequest(
        'PATCH',
        changesPath(applicationId, `/requests/current/sites/${site.siteId}`),
        { body: answers }
      ),
      200,
      `answer ORS ${site.orsId}'s questions`
    )
  }
  return besEvidence
    ? uploadBesEvidence({ applicationId, site, ...besEvidence })
    : undefined
}

/**
 * RA-769. Upload one PDF as BES evidence for `site` on the open change
 * request, the way the operator's page does: that backend starts the upload
 * with cdp-uploader, the file is posted to cdp-uploader (whose mock scan then
 * calls that backend back), and the scanned file is attached to the site. The
 * object lands in the BES bucket, so a download from case management
 * after the grant streams it for real. Returns the file as that backend now
 * holds it: { fileId, filename, s3Key, s3Bucket, ... }.
 */
async function uploadBesEvidence({ applicationId, site, filename, content }) {
  const initiated = expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(applicationId, '/requests/current/bes-evidence/initiate'),
      {
        body: {
          redirectUrl: '/',
          s3Bucket:
            process.env.FILE_UPLOAD_S3_BUCKET ??
            'epr-register-enrol-file-uploads',
          s3Path: `mgmt-tests/${Date.now()}`,
          mimeTypes: ['application/pdf'],
          maxFileSize: 10 * 1024 * 1024
        }
      }
    ),
    200,
    `initiate a BES evidence upload for ORS ${site.orsId}`
  ).body

  const form = new FormData()
  form.append(
    'file',
    new Blob([content], { type: 'application/pdf' }),
    filename
  )
  // The upload URL names the uploader as that backend reaches it; the runner
  // reaches the same service at CDP_UPLOADER_URL.
  expectStatus(
    await cdpUploaderRequest('POST', new URL(initiated.uploadUrl).pathname, {
      body: form
    }),
    [200, 201, 302, 303],
    `cdp-uploader upload of ${filename}`
  )

  // That backend's own status route, which the callback completes.
  const statusPath = new URL(initiated.statusUrl).pathname
  let status
  await browser.waitUntil(
    async () => {
      status = (await operatorBackendRequest('GET', statusPath)).body
      return status?.processingStatus === 'validated'
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `The BES evidence upload ${filename} was never validated (last status ${JSON.stringify(status)})`
    }
  )

  const year = new Date().getUTCFullYear()
  const body = expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(
        applicationId,
        `/requests/current/sites/${site.siteId}/bes-evidence/files`
      ),
      {
        body: {
          fileUploadId: initiated.fileUploadId,
          besEvidenceValidFromDate: `${year}-01-01`,
          besEvidenceExpiryDate: `${year + 2}-12-31`
        }
      }
    ),
    [200, 201],
    `attach ${filename} to ORS ${site.orsId}`
  ).body
  const attached = body.sites
    .find((s) => s.siteId === site.siteId)
    ?.besEvidence?.besEvidenceUploads?.find((f) => f.filename === filename)
  if (!attached) {
    throw new Error(`${filename} is not on ORS ${site.orsId}'s request`)
  }
  return attached
}
