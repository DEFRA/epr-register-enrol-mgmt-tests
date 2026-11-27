/**
 * RA-782 / RA-767. ORS update (`update-overseas-site`) submissions posted
 * straight to management-be's `POST /work-items`, as the operator backend
 * sends them when an operator changes accredited ORSs, alongside an add-ORS
 * group from the same operator request.
 *
 * The operator backend sends a request holding adds and updates as one
 * submission per type: the add-ORS group under the request id, then the
 * update group under `{requestId}:update-overseas-site`, carrying the first
 * group's `submissionReference`; every group carries the request's total
 * `submissionSize`. So the two groups share one SUB reference, and each
 * work item's Related change requests finds the other.
 *
 * An update is never charged: the group's `chargePence` and each site's are
 * 0, and its `paymentReference` is null, which the operator backend leaves
 * out of the JSON it sends, so it is left out here too. Each site is the ORS
 * as it stands (add-ORS's site shape) with `previous`
 * and `proposed` (the details the operator may change, as they were and as
 * requested), `interimSiteChanges` (`change`, `remove`, `add`) and
 * `addedBesEvidence` (BES files the update adds).
 *
 * Every submission is unique to its run (`e2e-` organisation, fresh request
 * id, unique organisation name), so the operator backend holds no change
 * request for it: confirming applicant contact on one of these fails its
 * status push (see ra-495-add-ors-status-push). The granted and refused
 * journeys start from the operator backend instead:
 * ra-782-update-ors-operator-journey.e2e.js.
 */

import { expectStatus, managementBeRequest } from './backend-api.js'
import {
  ADD_ORS_SUBMITTED_BY,
  buildAddOverseasSiteRequest,
  postAddOverseasSiteRequest
} from './in-year-change-api.js'

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
 * group.
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
 * Submit one operator request holding one add-ORS site and `updateCount`
 * ORS updates, as the operator backend sends it: the add-ORS group first,
 * then the update group under the first group's SUB reference. Returns
 *
 *   { submissionReference, organisationName, operatorOrgNumber,
 *     add: { site, workItem }, updates: [{ site, workItem }], payload }
 *
 * where each `workItem` is management-be's `{ siteId, id,
 * applicationReference }` and `payload` the update group's payload.
 */
export async function submitOrsUpdateRequest({
  organisationNamePrefix,
  updateCount = 1
}) {
  const submissionSize = 1 + updateCount
  const addRequest = buildAddOverseasSiteRequest({
    organisationNamePrefix,
    siteCount: 1
  })
  addRequest.payload.submissionSize = submissionSize
  const { body: addBody } = expectStatus(
    await postAddOverseasSiteRequest(addRequest.payload),
    201,
    `submit the add-ORS group for "${addRequest.organisationName}"`
  )

  const { organisationName, operatorOrgNumber } = addRequest
  const token = addRequest.payload.operatorRequestId.replace('e2e-request-', '')
  const sites = Array.from({ length: updateCount }, (_, index) =>
    buildUpdateSite({ token, organisationName, number: index + 1 })
  )
  // The add group's request, uncharged: no payment reference, nothing to pay.
  const shared = { ...addRequest.payload }
  delete shared.paymentReference
  const payload = {
    ...shared,
    chargePence: 0,
    operatorRequestId: `${addRequest.payload.operatorRequestId}:${UPDATE_ORS_TYPE_ID}`,
    changeType: UPDATE_ORS_TYPE_ID,
    submissionReference: addBody.submissionReference,
    submissionSize,
    submittedBy: ADD_ORS_SUBMITTED_BY,
    sites
  }
  const { body } = expectStatus(
    await managementBeRequest('POST', '/work-items', {
      body: { typeId: UPDATE_ORS_TYPE_ID, source: 'mgmt-tests', payload }
    }),
    201,
    `submit the ORS update group for "${organisationName}"`
  )

  return {
    submissionReference: addBody.submissionReference,
    updateSubmissionReference: body.submissionReference,
    organisationName,
    operatorOrgNumber,
    add: { site: addRequest.sites[0], workItem: addBody.workItems[0] },
    updates: sites.map((site, index) => ({
      site,
      workItem: body.workItems[index]
    })),
    payload
  }
}
