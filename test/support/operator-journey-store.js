/**
 * What the Path B helpers share (operator-change-requests.js for add-ORS,
 * operator-ors-updates.js for ORS updates): the monorepo root stack's
 * MongoDB, which the operator journey backend and management-be share there
 * (MONOREPO_MONGO_URL; wdio.local.conf.js defaults it to the root stack's
 * published port), and that backend's change requests API for one seeded
 * organisation.
 */

import { Binary, MongoClient } from 'mongodb'

import { expectStatus, operatorBackendRequest } from './backend-api.js'

/** The operator journey backend's database. */
export const OPERATOR_DATABASE = 'epr'

/** management-be's database. */
export const CASE_MANAGEMENT_DATABASE = 'epr-register-case-management'

/** Items no longer being decided: granted, refused or withdrawn. */
export const FINAL_ITEM_STATUSES = new Set([
  'Approved',
  'Rejected',
  'Withdrawn'
])

export const isMonorepoMongoConfigured = () =>
  Boolean(process.env.MONOREPO_MONGO_URL)

/** `describe` where the monorepo Mongo is configured, `describe.skip` anywhere else. */
export const describeIfMonorepoMongo = (name, suite) =>
  (isMonorepoMongoConfigured() ? describe : describe.skip)(name, suite)

export async function withMongo(work) {
  const client = new MongoClient(process.env.MONOREPO_MONGO_URL)
  try {
    await client.connect()
    return await work(client)
  } finally {
    await client.close()
  }
}

/** A .NET Guid as that backend stores it (a UUID binary), as a string. */
export function guidString(value) {
  return value instanceof Binary ? value.toUUID().toHexString() : String(value)
}

/** That backend's change requests route for the organisation's accreditation. */
export const changesPath = (organisationId, applicationId, suffix = '') =>
  `/api/v1/accreditation-changes/${organisationId}/${applicationId}${suffix}`

/**
 * The organisation's seeded accreditation application's id ("a", the year,
 * then the org id padded to 19 digits), for the year the seed ran in (this
 * year, or last year for a stack started before 1 January), or null where
 * that backend has no such accreditation (or in-year changes are off).
 */
export async function findSeededAccreditation(organisationId) {
  const year = new Date().getUTCFullYear()
  for (const candidate of [year, year - 1]) {
    const applicationId = `a${candidate}${organisationId.padStart(19, '0')}`
    const result = await operatorBackendRequest(
      'GET',
      changesPath(organisationId, applicationId)
    )
    if (result.status === 200) {
      return applicationId
    }
  }
  return null
}

/** The accreditation's sites and its change requests, newest first. */
export async function getChangeRequests(organisationId, applicationId) {
  return expectStatus(
    await operatorBackendRequest(
      'GET',
      changesPath(organisationId, applicationId)
    ),
    200,
    `GET change requests for ${applicationId}`
  ).body
}

/**
 * That backend's own record of a change request item: its case management
 * work item id and its status-push ordering watermark, which its API does not
 * show. Null when no request of the organisation holds the item.
 *
 * @returns {Promise<{ workItemId: string | null, statusUpdatedAt: Date | null } | null>}
 */
export async function storedItem(organisationId, itemId) {
  return withMongo(async (client) => {
    const requests = await client
      .db(OPERATOR_DATABASE)
      .collection('accreditationChangeRequests')
      .find({ organisationId })
      .toArray()
    const item = requests
      .flatMap((request) => request.sites)
      .find((site) => guidString(site.itemId) === itemId)
    if (!item) {
      return null
    }
    return {
      workItemId: item.caseManagementWorkItemId
        ? guidString(item.caseManagementWorkItemId)
        : null,
      statusUpdatedAt: item.caseManagementStatusUpdatedAt ?? null
    }
  })
}

/**
 * Deletes the organisation's change requests, the work items of `typeIds`
 * case management raised for them and the submissions those came in.
 *
 * @returns {Promise<{ changeRequests: number, workItems: number, submissions: number }>}
 */
export async function deleteChangeRequests(client, organisationId, typeIds) {
  const operator = client.db(OPERATOR_DATABASE)
  const caseManagement = client.db(CASE_MANAGEMENT_DATABASE)
  const workItemFilter = {
    typeId: { $in: typeIds },
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

  return {
    changeRequests: changeRequests.deletedCount,
    workItems: workItems.deletedCount,
    submissions: submissions.deletedCount
  }
}
