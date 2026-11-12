/**
 * RA-739. Add-ORS (`add-overseas-site`) submissions posted straight to
 * management-be's `POST /work-items`, the call the operator backend makes when
 * an operator submits a request to add overseas reprocessing sites.
 * management-be splits the request into one work item per site.
 *
 * Every submission is unique to its run: a fresh `operatorRequestId` (a
 * repeated one is a replay), a `uniqueOrganisationName` and an `e2e-`
 * organisation id, which marks a test organisation.
 */

import { randomBytes, randomInt } from 'node:crypto'

import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from './backend-api.js'
import { uniqueOrganisationName } from './unique-name.js'

const TYPE_ID = 'add-overseas-site'

/**
 * Each site's own charge: the operator backend's per-site in-year ORS fee
 * (£328), in pence. The submission's `chargePence` is the total.
 */
export const ADD_ORS_SITE_CHARGE_PENCE = 32800

const hex = () => randomBytes(6).toString('hex')

/**
 * One `sites[]` entry as the operator backend sends it: re-accreditation's
 * overseas site shape (address, contact, codes, interim sites and BES files)
 * plus the site's own `chargePence`. One active interim site and one Clean BES
 * file with its valid-from and expiry dates.
 */
function buildSite({ token, organisationName, number }) {
  return {
    siteId: `e2e-site-${token}-${number}`,
    orsId: String(number).padStart(3, '0'),
    siteName: `${organisationName} site ${number}`,
    siteAddress: `${number} Rue du Port, Lyon, France`,
    addressLine1: `${number} Rue du Port`,
    addressLine2: 'Zone Industrielle',
    townOrCity: 'Lyon',
    country: 'France',
    coordinates: '45.7640, 4.8357',
    contactName: 'Marie Dubois',
    contactEmail: `site${number}@example.com`,
    contactPhone: '+33 4 11 22 33 44',
    operationCodes: ['R3'],
    code1: 'B3011',
    code2: 'B3020',
    repatriatedLoads: 'Rejected loads are returned to the UK exporter.',
    conditionsOfExport: true,
    isEu: true,
    isOecd: true,
    interimSites: [
      {
        // Unique across the submission's sites: 101, 201, ...
        siteId: number * 100 + 1,
        siteNumber: '001',
        isNewSite: false,
        country: 'Belgium',
        siteName: 'Antwerp Transfer Hub',
        addressLine1: '1 Quay Street',
        townOrCity: 'Antwerp',
        contactName: 'Alex Morgan',
        contactEmail: 'alex.morgan@example.com',
        contactPhone: '0123456789',
        operationCodes: ['R13'],
        createdAt: '2025-09-01T09:00:00Z'
      }
    ],
    besEvidence: {
      files: [
        {
          fileId: `e2e-bes-${token}-${number}`,
          filename: `bes-evidence-${number}.pdf`,
          contentType: 'application/pdf',
          uploadedAt: '2026-01-15T10:00:00Z',
          scanStatus: 'Clean',
          besEvidenceValidFromDate: '2026-01-01',
          besEvidenceExpiryDate: '2027-12-31',
          s3Key: `bes-evidence/e2e-bes-${token}-${number}`,
          s3Bucket: 'bes-evidence'
        }
      ]
    },
    suppliedFields: [],
    chargePence: ADD_ORS_SITE_CHARGE_PENCE
  }
}

/**
 * Build, without sending, an add-ORS request with `siteCount` sites:
 *
 *   { payload, organisationName, operatorOrgNumber, sites }
 *
 * `payload` is what `postAddOverseasSiteRequest` sends; `sites` is its
 * `sites[]`.
 */
export function buildAddOverseasSiteRequest({
  organisationNamePrefix,
  siteCount
}) {
  const token = hex()
  const organisationName = uniqueOrganisationName(organisationNamePrefix)
  const operatorOrgNumber = randomInt(100000, 1000000)
  const sites = Array.from({ length: siteCount }, (_, index) =>
    buildSite({ token, organisationName, number: index + 1 })
  )
  const payload = {
    operatorRequestId: `e2e-request-${token}`,
    changeType: TYPE_ID,
    operatorOrganisationId: `e2e-${token}`,
    organisationName,
    operatorOrgNumber,
    material: 'Plastic',
    accreditationYear: new Date().getUTCFullYear(),
    accreditationReference: `A26EX${operatorOrgNumber}PL`,
    wasteProcessingType: 'Exporter',
    chargePence: ADD_ORS_SITE_CHARGE_PENCE * siteCount,
    paymentReference: `PR/PK/EXP/${operatorOrgNumber}`,
    sites
  }
  return { payload, organisationName, operatorOrgNumber, sites }
}

/**
 * Post `payload` to management-be as an add-ORS submission and return the raw
 * `{ status, headers, body }`, whatever the status.
 */
export function postAddOverseasSiteRequest(payload) {
  return managementBeRequest('POST', '/work-items', {
    body: { typeId: TYPE_ID, source: 'mgmt-tests', payload }
  })
}

/**
 * Submit an add-ORS request with `siteCount` sites and return
 *
 *   { submissionReference, workItems: [{ siteId, id, applicationReference }],
 *     organisationName, operatorOrgNumber, sites, payload }
 *
 * `workItems` is management-be's response, in site order; `sites` is what
 * was submitted, in the same order.
 */
export async function submitAddOverseasSiteRequest({
  organisationNamePrefix,
  siteCount
}) {
  const request = buildAddOverseasSiteRequest({
    organisationNamePrefix,
    siteCount
  })
  const { body } = expectStatus(
    await postAddOverseasSiteRequest(request.payload),
    201,
    `submit add-ORS request for "${request.organisationName}"`
  )
  return {
    ...request,
    submissionReference: body.submissionReference,
    workItems: body.workItems
  }
}

/** The add-ORS work items management-be holds for `organisationName`. */
export async function listAddOverseasSiteWorkItems(organisationName) {
  const query = new URLSearchParams({
    typeId: TYPE_ID,
    orgName: organisationName,
    pageSize: '50'
  })
  const { body } = expectStatus(
    await managementBeRequest('GET', `/work-items?${query}`, {
      user: CASEWORKER_USER
    }),
    200,
    `list add-ORS work items for "${organisationName}"`
  )
  return body.items
}
