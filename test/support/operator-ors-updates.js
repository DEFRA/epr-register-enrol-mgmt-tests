/**
 * RA-782. Path B for ORS update (`update-overseas-site`) work items: an
 * in-year change request that changes an accredited overseas reprocessing
 * site (ORS), built and submitted through the Registration & Accreditation
 * service backend (the operator journey backend), which raises the case
 * management work item itself. Both systems then know the item, so
 * management-be's status pushes are applied there and "Confirm applicant
 * contact" can complete: a grant writes the changed details onto the ORS.
 *
 * It needs an Approved exporter accreditation with accredited ORSs, which no
 * API creates, so it uses org 50025 ("In-Year Update Exports Ltd"), which
 * that backend's dev seed (DevExporterAccreditationSeedService,
 * InYearUpdateOverseasSites) gives three accredited ORSs, in Development
 * only: the DEFRA/epr-register-enrol monorepo's root stack. Anywhere else
 * `findInYearUpdateAccreditation` returns null and the spec skips.
 *
 * A grant changes the ORS for good, and a submitted request locks its ORS, so
 * `resetInYearUpdateOrganisation` deletes 50025's change requests (and the
 * work items and submissions they raised) and puts ORSs 001 and 002 back as
 * the seed leaves them: on the accreditation application, and in the domain
 * model (the root stack runs dual-write, so the first write migrates the
 * application there), where the versions a grant wrote are deleted. That
 * needs the stack's MongoDB: MONOREPO_MONGO_URL (see
 * operator-change-requests.js). The fe-tests @monorepo specs
 * update-accredited-ors and review-ors-update use the same organisation and
 * reset it the same way; never run them at the same time as this.
 */

import { browser } from '@wdio/globals'
import { Binary, MongoClient, ObjectId } from 'mongodb'

import { expectStatus, operatorBackendRequest } from './backend-api.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'

export const IN_YEAR_UPDATE_ORGANISATION_ID = '50025'

const UPDATE_TYPE_ID = 'update-overseas-site'
const ORS_CHANGE_TYPE_IDS = ['add-overseas-site', UPDATE_TYPE_ID]
const OPERATOR_DATABASE = 'epr'
const CASE_MANAGEMENT_DATABASE = 'epr-register-case-management'

/** As the dev seed leaves an accredited 50025 ORS on the accreditation. */
const interimSite = (siteId, siteNumber, siteName) => ({
  siteId,
  siteNumber,
  country: 'Poland',
  siteName,
  addressLine1: '1 Quay Street',
  townOrCity: 'Port',
  contactName: 'Alex Morgan',
  contactEmail: 'alex.morgan@example.com',
  contactPhone: '0123456789',
  operationCodes: ['R3', 'R13'],
  isNewSite: false,
  statusHistory: []
})

function seededSite({
  siteId,
  orsId,
  siteName,
  country,
  coordinates,
  year,
  interimSites
}) {
  return {
    siteId,
    orsId,
    siteName,
    siteAddress: `${siteId} Harbour Estate, ${country}`,
    addressLine1: `${siteId} Harbour Estate`,
    townOrCity: 'Port',
    country,
    coordinates,
    contactName: 'Site Manager',
    contactEmail: `site${siteId}@example.com`,
    contactPhone: '+44 1234 567890',
    operationCodes: ['R3'],
    code1: 'B3011',
    repatriatedLoads: 'Rejected loads are returned to the UK exporter.',
    conditionsOfExport: true,
    isEu: true,
    isOecd: true,
    validFrom: `${year}-01-01T00:00:00Z`,
    selected: true,
    isNewSite: false,
    registeredNowAccredited: false,
    previousSites: [],
    ...(interimSites.length > 0 ? { interimSite: interimSites[0] } : {}),
    interimSites
  }
}

/** Accredited ORS 001, with two interim sites. */
export const GDANSK = {
  siteId: 902501,
  orsId: '001',
  siteName: 'Gdansk Recykling Sp. z o.o.',
  seeded: (year) =>
    seededSite({
      ...GDANSK,
      country: 'Poland',
      coordinates: '54.3520, 18.6466',
      year,
      interimSites: [
        interimSite(902511, '001', 'Gdynia Transfer Hub'),
        interimSite(902512, '002', 'Szczecin Sorting Centre')
      ]
    })
}

/** Accredited ORS 002, with no interim sites. */
export const PORTO = {
  siteId: 902502,
  orsId: '002',
  siteName: 'Porto Reciclagem Lda',
  townOrCity: 'Port',
  seeded: (year) =>
    seededSite({
      ...PORTO,
      country: 'Portugal',
      coordinates: '41.1579, -8.6291',
      year,
      interimSites: []
    })
}

/** Items no longer being decided: granted, refused or withdrawn. */
const FINAL_ITEM_STATUSES = new Set(['Approved', 'Rejected', 'Withdrawn'])

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
  `/api/v1/accreditation-changes/${IN_YEAR_UPDATE_ORGANISATION_ID}/${applicationId}${suffix}`

/**
 * The seeded accreditation application's id ("a", the year, then the org id
 * padded to 19 digits), or null where that backend has no such accreditation.
 */
export async function findInYearUpdateAccreditation() {
  const year = new Date().getUTCFullYear()
  for (const candidate of [year, year - 1]) {
    const applicationId = `a${candidate}${IN_YEAR_UPDATE_ORGANISATION_ID.padStart(19, '0')}`
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

/** The year in an accreditation application id ("a" then the year). */
const yearOf = (applicationId) => Number(applicationId.slice(1, 5))

/**
 * Deletes 50025's change requests, the ORS work items case management raised
 * for them and the submissions those came in, and puts `sites` (GDANSK,
 * PORTO) back as the dev seed leaves them: on the accreditation application,
 * keeping the domain model id the migration gave each, and in the domain
 * model, by deleting the ORS versions a grant wrote and making the one
 * before current again.
 */
export async function resetInYearUpdateOrganisation({ applicationId, sites }) {
  const organisationId = IN_YEAR_UPDATE_ORGANISATION_ID
  const seeded = sites.map((site) => site.seeded(yearOf(applicationId)))
  return withMongo(async (client) => {
    const operator = client.db(OPERATOR_DATABASE)
    const caseManagement = client.db(CASE_MANAGEMENT_DATABASE)
    const workItemFilter = {
      typeId: { $in: ORS_CHANGE_TYPE_IDS },
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

    const applications = operator.collection('accreditationApplications')
    // The accreditation application's id is its document's _id.
    const application = await applications.findOne({
      _id: ObjectId.createFromHexString(applicationId),
      organisationId
    })
    if (!application) {
      // Found through that backend's API, so it is there: a reset that
      // silently skipped it would leave a granted ORS behind.
      throw new Error(`No accreditation application ${applicationId} to reset`)
    }
    const applicationsChanged = (
      await applications.updateOne(
        { _id: application._id },
        { $set: { 'overseasSites.sites': seededSites(application, seeded) } }
      )
    ).modifiedCount
    const orsVersions = application.registrationEntityId
      ? await rollBackGrantedOrsVersions(
          operator.collection('overseasSiteVersions'),
          application.registrationEntityId,
          sites
        )
      : 0

    return {
      changeRequests: changeRequests.deletedCount,
      workItems: workItems.deletedCount,
      submissions: submissions.deletedCount,
      applications: applicationsChanged,
      orsVersions
    }
  })
}

/**
 * The application's sites with each seeded one put back, keeping the domain
 * model id the migration gave it.
 */
function seededSites(application, seeded) {
  return application.overseasSites.sites.map((site) => {
    const seed = seeded.find((s) => s.siteId === site.siteId)
    if (!seed) {
      return site
    }
    return site.overseasSiteEntityId
      ? { ...seed, overseasSiteEntityId: site.overseasSiteEntityId }
      : seed
  })
}

/**
 * Deletes the domain model versions a grant wrote for each of `sites`' ORSs
 * under the registration and makes the version before current again.
 * Returns how many were deleted.
 */
async function rollBackGrantedOrsVersions(versions, registrationId, sites) {
  let deleted = 0
  for (const { orsId } of sites) {
    const filter = { registrationId, orsId }
    deleted += (
      await versions.deleteMany({
        ...filter,
        'lastChange.reason': 'ChangeRequestGranted'
      })
    ).deletedCount
    if ((await versions.countDocuments({ ...filter, isCurrent: true })) > 0) {
      continue
    }
    const [latest] = await versions
      .find(filter)
      .sort({ version: -1 })
      .limit(1)
      .toArray()
    if (latest) {
      await versions.updateOne(
        { _id: latest._id },
        {
          $set: {
            isCurrent: true,
            validTo: new Date('9999-12-31T23:59:59.999Z')
          }
        }
      )
    }
  }
  return deleted
}

/** That backend's own record of the item's case management work item id. */
async function storedWorkItemId(itemId) {
  return withMongo(async (client) => {
    const requests = await client
      .db(OPERATOR_DATABASE)
      .collection('accreditationChangeRequests')
      .find({ organisationId: IN_YEAR_UPDATE_ORGANISATION_ID })
      .toArray()
    const item = requests
      .flatMap((request) => request.sites)
      .find((site) => guidString(site.itemId) === itemId)
    return item?.caseManagementWorkItemId
      ? guidString(item.caseManagementWorkItemId)
      : null
  })
}

async function getChangeRequests(applicationId) {
  return expectStatus(
    await operatorBackendRequest('GET', changesPath(applicationId)),
    200,
    `GET change requests for ${applicationId}`
  ).body
}

/**
 * The accredited ORS and the change request item, as that backend's API shows
 * them to the operator: { item, site } where `site.site` is the ORS's details.
 */
export async function getOrsUpdateItem({ applicationId, itemId, siteId }) {
  const body = await getChangeRequests(applicationId)
  const request = body.requests.find((r) =>
    r.sites.some((s) => s.itemId === itemId)
  )
  return {
    item: request?.sites.find((s) => s.itemId === itemId),
    site: body.sites.find((s) => s.siteId === siteId)
  }
}

/** Polls until management-be's push has set the item's status. */
export async function waitForOrsUpdateItemStatus(update, status) {
  let last
  await browser.waitUntil(
    async () => {
      last = await getOrsUpdateItem(update)
      return last.item?.status === status
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `Change request item ${update.itemId} never reached ${status}`
    }
  )
  return last
}

/**
 * As the operator: changes the accredited `site`'s `details` (its editable
 * details, e.g. { siteName }) in a new change request and submits it, so
 * that backend raises its ORS update work item. Nothing to pay. Returns
 *
 *   { id, itemId, applicationId, siteId, reference }
 *
 * where `id` is the case management work item id and `reference` its
 * IYC-ORS application reference.
 */
export async function submitOrsUpdateChangeRequest({
  applicationId,
  site,
  details
}) {
  expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(applicationId, '/requests/current/sites'),
      { body: { siteId: site.siteId, changeType: UPDATE_TYPE_ID } }
    ),
    [200, 201],
    `change ORS ${site.orsId} in a change request`
  )
  expectStatus(
    await operatorBackendRequest(
      'PATCH',
      changesPath(applicationId, `/requests/current/sites/${site.siteId}`),
      { body: details }
    ),
    200,
    `change ORS ${site.orsId}'s details`
  )
  expectStatus(
    await operatorBackendRequest(
      'POST',
      changesPath(applicationId, '/requests/current/submit'),
      {
        body: {
          fullName: 'E2E Submitter',
          jobTitle: 'Tester',
          email: SIMULATED_DELIVERED_EMAIL
        }
      }
    ),
    200,
    `submit the change request for ORS ${site.orsId}`
  )

  const body = await getChangeRequests(applicationId)
  const item = body.requests
    .filter((r) => r.status === 'Submitted')
    .flatMap((r) => r.sites)
    .find((s) => s.siteId === site.siteId && !FINAL_ITEM_STATUSES.has(s.status))
  if (!item) {
    throw new Error(`No submitted change request changes ORS ${site.orsId}`)
  }
  const id = await storedWorkItemId(item.itemId)
  if (!id) {
    throw new Error(
      `Change request item ${item.itemId} was submitted but has no case management work item`
    )
  }
  return {
    id,
    itemId: item.itemId,
    applicationId,
    siteId: site.siteId,
    reference: item.caseManagementReference
  }
}
