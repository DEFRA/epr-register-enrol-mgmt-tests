/**
 * RA-782 / RA-767. ORS update (`update-overseas-site`) submissions posted
 * straight to management-be's `POST /work-items`, as the operator backend
 * sends them when an operator changes accredited ORSs, optionally alongside
 * adding a registered ORS in the same operator request.
 *
 * The operator backend sends one operator request as one POST: the
 * submission's `typeId` is `add-overseas-site` when the request adds any ORS
 * and `update-overseas-site` otherwise, and each entry in `payload.sites[]`
 * carries its own `typeId`. management-be accepts the whole request in one
 * transaction, under one SUB reference whose `submissionSize` is every site
 * in it, or rejects it and creates nothing; a repeated `operatorRequestId` is
 * a replay. So the add and the updates share one SUB reference, and each
 * work item's Related change requests finds the others.
 *
 * An update is never charged: each update site's `chargePence` is 0. A
 * request with no add has no charge and no `paymentReference`, which the
 * operator backend leaves out of the JSON it sends, so it is left out here
 * too. Each update site is the ORS as it stands (add-ORS's site shape) with
 * `previous` and `proposed` (the details the operator may change, as they
 * were and as requested), `interimSiteChanges` (`change`, `remove`, `add`)
 * and `addedBesEvidence` (BES files the update adds).
 *
 * Every submission is unique to its run (`e2e-` organisation, fresh request
 * id, unique organisation name), so the operator backend holds no change
 * request for it: confirming applicant contact on one of these fails its
 * status push (see ra-495-add-ors-status-push). The granted and refused
 * journeys start from the operator backend instead:
 * ra-782-update-ors-operator-journey.e2e.js.
 */

import { expectStatus, managementBeRequest } from './backend-api.js'
import { buildAddOverseasSiteRequest } from './in-year-change-api.js'
import { listWorkItemsViaApi } from './work-item-api.js'

export const ADD_ORS_TYPE_ID = 'add-overseas-site'
export const UPDATE_ORS_TYPE_ID = 'update-overseas-site'

const interimSite = (siteId, siteNumber, siteName) => ({
  siteId,
  siteNumber,
  isNewSite: false,
  country: 'Poland',
  siteName,
  addressLine1: '1 Quay Street',
  townOrCity: 'Gdynia',
  contactName: 'Alex Morgan',
  contactEmail: 'alex.morgan@example.com',
  contactPhone: '0123456789',
  operationCodes: ['R3', 'R13']
})

/** The details an interim site change carries: the site's, without its ids. */
const interimDetails = ({ siteId, siteNumber, isNewSite, ...details }) =>
  details

/**
 * One update site: an accredited ORS whose name changes, with two interim
 * sites (the first changed, the second removed) and one added, and one BES
 * file added to the one it holds. `number` keeps the ids unique across the
 * request: the add sites take the numbers before the update sites'.
 */
function buildUpdateSite({ token, organisationName, number }) {
  const siteName = `${organisationName} ORS ${number}`
  const details = {
    siteName,
    addressLine1: `${number} Harbour Estate`,
    townOrCity: 'Gdansk',
    contactName: 'Site Manager',
    contactEmail: `ors${number}@example.com`,
    contactPhone: '01632 960000',
    repatriatedLoads: 'Rejected loads are returned to the UK exporter.'
  }
  const changed = interimSite(number * 100 + 1, '001', 'Gdynia Transfer Hub')
  const removed = interimSite(number * 100 + 2, '002', 'Szczecin Sorting')
  const added = {
    ...interimDetails(interimSite(0, '', 'Krakow Depot')),
    townOrCity: 'Krakow',
    operationCodes: ['R13']
  }
  const besFile = (kind) => ({
    fileId: `e2e-bes-${token}-${number}-${kind}`,
    filename: `bes-${kind}-${number}.pdf`,
    contentType: 'application/pdf',
    uploadedAt: '2026-01-15T10:00:00Z',
    scanStatus: 'Clean',
    besEvidenceValidFromDate: '2026-01-01',
    besEvidenceExpiryDate: '2027-12-31',
    s3Key: `bes-evidence/e2e-bes-${token}-${number}-${kind}`,
    s3Bucket: 'bes-evidence'
  })

  return {
    typeId: UPDATE_ORS_TYPE_ID,
    siteId: `e2e-site-${token}-u${number}`,
    orsId: String(number).padStart(3, '0'),
    ...details,
    siteAddress: `${number} Harbour Estate, Gdansk, Poland`,
    country: 'Poland',
    coordinates: '54.3520, 18.6466',
    operationCodes: ['R3'],
    code1: 'B3011',
    conditionsOfExport: true,
    isEu: true,
    isOecd: true,
    interimSites: [changed, removed],
    besEvidence: { files: [besFile('held')] },
    addedBesEvidence: { files: [besFile('new')] },
    chargePence: 0,
    previous: details,
    proposed: { ...details, siteName: `${siteName} Renamed` },
    interimSiteChanges: [
      {
        changeId: `e2e-change-${token}-${number}-1`,
        action: 'change',
        interimSiteId: changed.siteId,
        previous: interimDetails(changed),
        proposed: {
          ...interimDetails(changed),
          siteName: 'Gdynia Port Hub',
          contactName: 'Marta Kowalska'
        }
      },
      {
        changeId: `e2e-change-${token}-${number}-2`,
        action: 'remove',
        interimSiteId: removed.siteId,
        previous: interimDetails(removed)
      },
      {
        changeId: `e2e-change-${token}-${number}-3`,
        action: 'add',
        proposed: added
      }
    ]
  }
}

/**
 * Build, without sending, one operator request holding `addCount` add-ORS
 * sites and `updateCount` ORS updates, as the operator backend sends it:
 *
 *   { typeId, payload, organisationName, operatorOrgNumber,
 *     addSites, updateSites }
 *
 * `typeId` is the submission's (add-ORS when it adds any ORS), and
 * `payload.sites` the add sites then the update sites, each with its own
 * `typeId`. No `submissionReference` or `submissionSize`: management-be
 * gives the request its SUB reference and counts its sites.
 */
export function buildOrsUpdateRequest({
  organisationNamePrefix,
  addCount = 1,
  updateCount = 1
}) {
  const request = buildAddOverseasSiteRequest({
    organisationNamePrefix,
    siteCount: addCount
  })
  const { token, organisationName, operatorOrgNumber } = request
  const addSites = request.sites.map((site) => ({
    typeId: ADD_ORS_TYPE_ID,
    ...site
  }))
  const updateSites = Array.from({ length: updateCount }, (_, index) =>
    buildUpdateSite({ token, organisationName, number: addCount + index + 1 })
  )
  const typeId = addCount > 0 ? ADD_ORS_TYPE_ID : UPDATE_ORS_TYPE_ID
  const payload = {
    ...request.payload,
    changeType: typeId,
    sites: [...addSites, ...updateSites]
  }
  if (addCount === 0) {
    // Nothing to pay: no charge and no payment reference.
    payload.chargePence = 0
    delete payload.paymentReference
  }
  return {
    typeId,
    payload,
    organisationName,
    operatorOrgNumber,
    addSites,
    updateSites
  }
}

/**
 * Post a `buildOrsUpdateRequest` request to management-be and return the raw
 * `{ status, headers, body }`, whatever the status.
 */
export function postOrsUpdateRequest({ typeId, payload }) {
  return managementBeRequest('POST', '/work-items', {
    body: { typeId, source: 'mgmt-tests', payload }
  })
}

/**
 * Submit one operator request (see `buildOrsUpdateRequest`) and return
 *
 *   { submissionReference, workItems, organisationName, operatorOrgNumber,
 *     add: { site, workItem } | undefined, adds: [{ site, workItem }],
 *     updates: [{ site, workItem }], typeId, payload }
 *
 * where `workItems` is management-be's response (`{ siteId, id,
 * applicationReference }` each), `add` the first add-ORS site, and each
 * `workItem` the one management-be raised for its `site`.
 */
export async function submitOrsUpdateRequest({
  organisationNamePrefix,
  addCount = 1,
  updateCount = 1
}) {
  const request = buildOrsUpdateRequest({
    organisationNamePrefix,
    addCount,
    updateCount
  })
  const { body } = expectStatus(
    await postOrsUpdateRequest(request),
    201,
    `submit the ORS change request for "${request.organisationName}"`
  )
  const withWorkItem = (site) => {
    const workItem = body.workItems.find((w) => w.siteId === site.siteId)
    if (!workItem) {
      throw new Error(`management-be raised no work item for ${site.siteId}`)
    }
    return { site, workItem }
  }
  const adds = request.addSites.map(withWorkItem)
  return {
    ...request,
    submissionReference: body.submissionReference,
    workItems: body.workItems,
    add: adds[0],
    adds,
    updates: request.updateSites.map(withWorkItem)
  }
}

/**
 * The add-ORS and ORS update work items management-be holds for
 * `organisationName`.
 */
export async function listOrsWorkItems(organisationName) {
  const items = []
  for (const typeId of [ADD_ORS_TYPE_ID, UPDATE_ORS_TYPE_ID]) {
    const { body } = expectStatus(
      await listWorkItemsViaApi({
        typeId,
        orgName: organisationName,
        pageSize: '50'
      }),
      200,
      `list ${typeId} work items for "${organisationName}"`
    )
    items.push(...body.items)
  }
  return items
}
