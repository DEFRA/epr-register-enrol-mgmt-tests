import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * epr-81p — Role-gating negatives.
 *
 * Existing specs cover the SLA-extend 403 (ra-131) and the standard-user
 * self-assign happy path (ra-153). This fills the remaining role-gating
 * gaps:
 *
 *   1. A standard user (no `assign` role) is refused the assign and
 *      unassign endpoints with a 403. The FE's `requireAssign` scope check
 *      short-circuits the request before any backend call, and the assign/
 *      unassign controls are never rendered for a standard user — so the
 *      403 is exercised with a direct same-origin POST (CSRF crumb scraped
 *      from the page) rather than a UI click.
 *
 *   2. The re-accreditation "Approve" CTA is visible only to the assignee
 *      OR a decision-maker. A user who is neither sees no CTA; the assignee
 *      sees it even without the decision-maker role; a decision-maker sees
 *      it even when they are not the assignee.
 *
 * The third concern from epr-81p — create route 404 when
 * `featureFlags.workItemCreationEnabled` is off — is not covered here: the
 * flag is read from env at FE boot, so it cannot be toggled per-test in the
 * single-FE E2E stack. It is unit-tested in the management-fe
 * `re-accreditation/create/routes.test.js` flag-off suite, with E2E
 * coverage tracked separately.
 */
describe('epr-81p — standard user is refused assign/unassign (403)', () => {
  let workItemId

  before(async () => {
    // The assign-role user creates an unassigned item to target. A standard
    // user can view it but must not be able to (un)assign it.
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Role Gating Negatives Ltd',
      siteAddressLine1: '1 Forbidden Road',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AA',
      material: 'plastic',
      tonnageBand: '0-500'
    }))
    await login.logout()

    await login.loginAs('standard')
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('returns 403 when a standard user POSTs to assign', async () => {
    const status = await detail.postFormStatus(
      `/work-items/${workItemId}/assign`,
      { assignedToId: 'stub-decision-maker-1' }
    )
    expect(status).toBe(403)
  })

  it('returns 403 when a standard user POSTs to unassign', async () => {
    const status = await detail.postFormStatus(
      `/work-items/${workItemId}/unassign`
    )
    expect(status).toBe(403)
  })
})

describe('epr-81p — approve CTA visibility is gated by assignee OR decision-maker', () => {
  let workItemId

  before(async () => {
    // Build an item in the eligible "Awaiting decision" state, assigned to
    // the standard stub user (stub-standard-1 — the same id the `standard`
    // login resolves to), so the assignee branch can be exercised.
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Approve CTA Visibility Ltd',
      siteAddressLine1: '1 Decision Way',
      siteAddressTown: 'Cardiff',
      siteAddressPostcode: 'CF1 1AA',
      material: 'plastic',
      tonnageBand: '500-5000'
    }))

    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-standard-1')
    await detail.assertAssignedTo('Stub Standard User')

    // Submitted -> Duly made
    await detail.gotoTasks()
    await detail.setTaskStatus('verify-organisation-details', 'Completed')
    await detail.setTaskStatus('confirm-application-completeness', 'Completed')
    await detail.gotoDetail()
    await detail.assertState('Duly made')

    // Duly made -> Assessment in progress
    await detail.gotoTasks()
    await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('payment-received')
    await detail.assertState('Assessment in progress')

    // Assessment in progress -> Awaiting decision (the eligible state)
    await detail.gotoTasks()
    await detail.setTaskStatus('review-compliance-history', 'Completed')
    await detail.setTaskStatus('assess-technical-capacity', 'Completed')
    await detail.setTaskStatus('assess-financial-capacity', 'Completed')
    await detail.gotoDetail()
    await detail.triggerAction('submit-for-decision')
    await detail.assertState('Awaiting decision')

    await login.logout()
  })

  it('hides the approve CTA from a user who is neither assignee nor decision-maker', async () => {
    // The assign-role user (stub-assign-1) is not the assignee and holds no
    // decision-maker role, so the CTA must not render even in the eligible
    // state.
    await login.loginAs('assign')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')
    expect(await detail.hasApproveCta()).toBe(false)
    await login.logout()
  })

  it('shows the approve CTA to the assignee even without the decision-maker role', async () => {
    // The standard login resolves to stub-standard-1, the assignee. The
    // assignee branch of (callerIsAssignee || hasDecisionMakerRole) makes
    // the CTA visible despite the missing decision-maker role.
    await login.loginAs('standard')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')
    expect(await detail.hasApproveCta()).toBe(true)
    await login.logout()
  })

  it('shows the approve CTA to a decision-maker who is not the assignee', async () => {
    // The decision-maker (stub-decision-maker-1) is not the assignee but
    // holds the decision-maker role, so the role branch makes the CTA
    // visible.
    await login.loginAs('decision-maker')
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Awaiting decision')
    expect(await detail.hasApproveCta()).toBe(true)
    await login.logout()
  })
})
