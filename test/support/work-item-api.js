/**
 * RA-000. Path A: case-management-only work items, created over the API.
 *
 * Specs that need a rich application (overseas sites, interim sites, a
 * business plan, an exporter) cannot get one from the "Create work item"
 * form, which only captures a handful of fields. They used to read items
 * management-be's Development seeder had inserted, which never exist on CDP.
 * Instead, each spec now submits its own item to management-be's
 * `POST /work-items`, the same endpoint the operator journey submits to, with
 * the payload it needs.
 *
 * Every item is unique to its run:
 *
 *   - `organisationName` is `uniqueOrganisationName(prefix)`;
 *   - `operatorOrganisationId` is `e2e-<hex>`, which marks a test
 *     organisation, so management-be answers its ReEx lookups (the prior
 *     year's accreditation, RA-254) from its stub rather than real ReEx;
 *   - `operatorApplicationId` is fresh, because management-be treats a
 *     repeated one as a replay of an earlier submission;
 *   - the site (or, for an exporter, registered office) postcode has a random
 *     suffix, because the application reference is derived from it (see
 *     `unique-postcode.js`).
 *
 * Every operator and submitter email is GOV.UK Notify's simulated delivered
 * address, so a notification this item triggers is never a real email.
 *
 * Items created here are not known to the operator journey backend, so they
 * must never be approved or refused (the Registration & Accreditation service would refuse that push). Use
 * `operator-backend-api.js` for those.
 */

import { randomBytes } from 'node:crypto'

import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from './backend-api.js'
import { SIMULATED_DELIVERED_EMAIL } from './operator-backend-api.js'
import { uniqueOrganisationName } from './unique-name.js'
import { uniquePostcode } from './unique-postcode.js'

const hex = () => randomBytes(6).toString('hex')

/**
 * The fields every real submission carries. Fixtures spread their own
 * fields over this.
 */
function basePayload({ organisationName, token }) {
  return {
    organisationName,
    registrationNumber: `EPR-${token.slice(0, 6).toUpperCase()}`,
    operatorOrganisationId: `e2e-${token}`,
    operatorApplicationId: `e2e-app-${token}`,
    operatorRegistrationId: `e2e-reg-${token}`,
    material: 'plastic',
    accreditationYear: new Date().getUTCFullYear(),
    previousAccreditationYear: new Date().getUTCFullYear() - 1,
    complianceIssuesReported: 0,
    operatorEmail: SIMULATED_DELIVERED_EMAIL,
    companiesHouseNumber: '12345678',
    siteAddress: '1 E2E Way, London',
    siteAddressPostcode: uniquePostcode(),
    // RA-526: the submission states its nation; nothing derives it.
    nation: 'England',
    chargeAmountPence: 54600
  }
}

/**
 * The `POST /work-items` body for a new re-accreditation submission, without
 * sending it, so a spec can send the same valid submission as two callers.
 * `organisationNamePrefix` and `fields` are as for `createWorkItemViaApi`.
 */
export function buildWorkItemSubmission({
  organisationNamePrefix,
  fields = {}
}) {
  const base = basePayload({
    organisationName: uniqueOrganisationName(organisationNamePrefix),
    token: hex()
  })
  const payload =
    typeof fields === 'function' ? fields(base) : { ...base, ...fields }
  return { typeId: 're-accreditation', source: 'mgmt-tests', payload }
}

/**
 * Submit a re-accreditation work item and return
 *
 *   { id, organisationName, applicationReference, operatorOrganisationId,
 *     payload }
 *
 * `payload` is the payload management-be stored (with the nation and
 * reference it derived), so a spec can assert against the values actually
 * submitted.
 *
 * `fields` is either an object spread over the base payload, or a function
 * that receives the base payload and returns the whole payload, for a fixture
 * that must leave a base field out (e.g. an exporter has no location).
 */
export async function createWorkItemViaApi(options) {
  const body = buildWorkItemSubmission(options)
  const { payload } = body
  const result = expectStatus(
    await managementBeRequest('POST', '/work-items', { body }),
    201,
    `create work item for "${payload.organisationName}"`
  )
  const created = result.body
  return {
    id: created.id,
    organisationName: payload.organisationName,
    applicationReference: created.payload?.applicationReference,
    operatorOrganisationId: payload.operatorOrganisationId,
    payload: created.payload
  }
}

/**
 * RA-000. Call management-be's generic apply-action endpoint directly, as a
 * caseworker, without asserting the outcome.
 *
 * Used by the guard specs, which assert the refusal itself. Going round
 * management-fe matters there: management-fe refuses some ids before it
 * calls the backend, so a browser POST alone cannot show that
 * management-be refuses them too.
 */
export function applyActionViaApi(workItemId, actionId) {
  return managementBeRequest(
    'POST',
    `/work-items/${workItemId}/actions/${actionId}`,
    { user: CASEWORKER_USER }
  )
}

/**
 * Call management-be's `GET /work-items` as a caseworker with the query
 * `params` (an object, or `URLSearchParams` for a repeated parameter),
 * without asserting the outcome, so a spec can assert a 400 as well as a
 * page of results.
 */
export function listWorkItemsViaApi(params) {
  return managementBeRequest(
    'GET',
    `/work-items?${new URLSearchParams(params)}`,
    { user: CASEWORKER_USER }
  )
}

/**
 * RA-681. Page 1 of the requests submitted with `workItemId`, as the Related
 * change requests tab reads them from management-be.
 */
export async function getRelatedWorkItemsViaApi(workItemId) {
  const { body } = expectStatus(
    await managementBeRequest(
      'GET',
      `/work-items/${workItemId}/related-work-items`,
      { user: CASEWORKER_USER }
    ),
    200,
    `related work items of ${workItemId}`
  )
  return body
}

/** Assign the work item to `user` over management-be's assign endpoint. */
export async function assignWorkItemViaApi(workItemId, user = CASEWORKER_USER) {
  expectStatus(
    await managementBeRequest('POST', `/work-items/${workItemId}/assign`, {
      body: { assigneeId: user.id, assigneeName: user.name },
      user
    }),
    200,
    `assign work item ${workItemId} to ${user.id}`
  )
}

/**
 * RA-751. Duly make the work item over management-be's own duly-make route,
 * as a caseworker, with today's (UTC) date as the payment date, as the
 * duly-making page does by default. Moves a `submitted` item to `duly-made`.
 */
export async function dulyMakeViaApi(workItemId) {
  expectStatus(
    await managementBeRequest(
      'POST',
      `/work-items/re-accreditation/${workItemId}/duly-make`,
      {
        // `yyyy-MM-dd`, the date part of the ISO timestamp.
        body: { paymentDate: new Date().toISOString().split('T')[0] },
        user: CASEWORKER_USER
      }
    ),
    200,
    `duly make work item ${workItemId}`
  )
}
