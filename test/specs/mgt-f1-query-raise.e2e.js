import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import { seedQueryableApplication } from '../support/operator-backend-db.js'
import { getAccreditationApplication } from '../support/operator-backend-api.js'

/**
 * RA-311/MGT-F1 — a query raised through management-be actually lands on
 * the linked operator's own record, via the real
 * HttpOperatorBackendPushAdapter (not the no-op one MGT-4's "never-throw"
 * spec exercises).
 *
 * Per the RA-311 fix doc's test-linkage decision, the operator-backend side
 * of the link is seeded directly into its Mongo collection rather than
 * driven through a full submit (see operator-backend-db.js) — there's no
 * flow that produces a `CaseManagementWorkItemId`-linked, `Submitted`
 * application to order. The query itself is raised through the real
 * management-fe UI (query.page.js), reusing RA-291's own coverage for that
 * half; only the read-back of what landed on the operator-backend side is
 * new here, against `GetById`'s raw JSON (no operator-facing UI reads a
 * case-management-linked application in this stack either).
 *
 * NOTE ON CI: depends on both management-be's
 * `feature/RA-337-query-resubmit-push` branch (MBE-1 — the outbound push's
 * corrected contract, and the `OperatorBackendApi:Enabled` switch this
 * stack turns on in docker/config/management-be.env) and
 * epr-register-enrol-backend's `feature/RA-338-query-resubmit-endpoint`
 * branch (OBE-2 — the inbound query endpoint). Per run-journey-tests/
 * action.yml, only management-be has branch-matching build-from-source
 * logic; epr-register-enrol-backend always pulls `latest`, which does not
 * yet include OBE-2. This spec (and MGT-4's "never-throw" block, which now
 * depends on OBE-2's 404 for its own assertion) will fail in CI until both
 * branches merge to their repos' respective mains.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

const createSubmittedWorkItem = async (organisationName, postcode) => {
  await workItems.goto()
  return (
    await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Query Raise Street',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material: 'plastic',
      tonnageBand: '0-500'
    })
  ).id
}

describe('MGT-F1 — a raised query lands on the linked operator-backend application', () => {
  const sectionKeys = [
    'business-plan',
    'sampling-and-inspection-plan',
    'prn-tonnage'
  ]
  const reason = 'Please confirm the business plan and sampling plan figures.'

  let workItemId
  let operatorApp

  before(async () => {
    await login.login()
    workItemId = await createSubmittedWorkItem(
      uniqueOrg('Query Raise Ltd'),
      'SW1A 1RD'
    )
    operatorApp = await seedQueryableApplication(workItemId, {
      organisationId: `mgt-f1-org-${Date.now()}`
    })

    await query.gotoFor(workItemId)
    await query.selectSections(sectionKeys)
    await query.fillReason(reason)
    await query.submit()
    await query.waitForDetailUrl(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('records a query-push-sent audit entry on management-be — the real adapter handled the push, not the no-op one', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()
    await detail.assertAuditEntry('Query pushed to operator backend')
  })

  it('transitions the linked operator-backend application to Queried', async () => {
    const application = await getAccreditationApplication(
      operatorApp.organisationId,
      operatorApp.applicationId
    )
    expect(application.applicationStatus).toBe('Queried')
  })

  it('marks every queried section as Queried on the operator-backend application', async () => {
    const application = await getAccreditationApplication(
      operatorApp.organisationId,
      operatorApp.applicationId
    )
    expect(application.businessPlan.sectionStatus).toBe('Queried')
    expect(application.samplingPlan.sectionStatus).toBe('Queried')
    expect(application.prns.sectionStatus).toBe('Queried')
  })

  it('records the query note and queried section keys intact on the operator-backend application', async () => {
    const application = await getAccreditationApplication(
      operatorApp.organisationId,
      operatorApp.applicationId
    )
    expect(application.query.queryNote).toBe(reason)
    // Order follows the query form's own section-checkbox order (query.page.js's
    // QUERY_SECTIONS), not selection order, so compare as sets.
    expect([...application.query.queriedSectionKeys].sort()).toEqual(
      [...sectionKeys].sort()
    )
  })
})
