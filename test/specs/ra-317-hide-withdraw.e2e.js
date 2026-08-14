import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import { driveToDecisionReady } from '../support/terminal-states.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'

/**
 * RA-317 — CM: Hide withdraw functionality from Case Management.
 *
 * "Withdraw" is an OPERATOR action. It was being offered in the case
 * management (regulator) UI, where it does not belong; RA-317 removes the
 * affordance from every state and blocks the confirmation route server-side,
 * while KEEPING the withdrawn-status display (a withdrawal initiated by the
 * operator must still be visible to a regulator).
 *
 *   AC01 — the Withdraw action is not displayed in CM, on the case-details
 *          page AND on the Log decision page.
 *   AC02 — all OTHER case-management actions remain available; only Withdraw
 *          is gone.
 *   AC03 — an operator-initiated withdrawal still surfaces the Withdrawn
 *          status/notice in CM.
 *
 * Withdraw actions are rendered (were rendered) as `action-<id>` controls, one
 * per state: `withdraw` from `submitted`, and `withdraw-during-*` from every
 * later non-terminal state. The absence assertions below sweep the whole set
 * so a regression that reintroduced the affordance in ANY single state fails
 * here, not just the one the happy path happens to visit.
 */

// Every withdraw action id the re-accreditation type ever projected, across
// all states. None of these may render as a CM affordance after RA-317.
const WITHDRAW_ACTION_IDS = [
  'withdraw',
  'withdraw-during-duly-made',
  'withdraw-during-assessment',
  'withdraw-during-decision',
  'withdraw-during-query',
  'withdraw-during-updated'
]

async function assertNoWithdrawAffordance() {
  for (const actionId of WITHDRAW_ACTION_IDS) {
    await expect($(`[data-testid="action-${actionId}"]`)).not.toBeExisting()
  }
}

describe('RA-317 — withdraw hidden from case management', () => {
  before(async () => {
    await login.login()
    await workItems.goto()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC01/AC02 — the case-details page of an open application', () => {
    let workItemId

    before(async () => {
      const created = await workItems.createWorkItem({
        organisationName: 'RA-317 Hide Withdraw Ltd',
        siteAddressLine1: '1 Withdraw Free Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AT',
        material: 'plastic',
        tonnageBand: '0-500'
      })
      workItemId = created.id
      await workItems.openWorkItem(workItemId)
    })

    it('renders the actions panel but offers no Withdraw affordance', async () => {
      // Positive anchor first: an absence is only meaningful once the panel
      // has demonstrably rendered, or a page that failed to load would satisfy
      // every negative below.
      await detail.assertActionsPanelWellFormed()
      await assertNoWithdrawAffordance()
      // Panel-scoped count too, so the assertion also fails if the affordance
      // came back under a control the direct testid sweep above missed.
      expect(await detail.countActionsLabelled('Withdraw')).toBe(0)
    })

    it('still offers the other case-management actions (only Withdraw is gone)', async () => {
      // AC02. Query is the canonical non-withdraw affordance in `submitted`,
      // so its presence proves the actions panel was pruned OF WITHDRAW rather
      // than emptied wholesale.
      await expect($('[data-testid="action-query"]')).toBeExisting()
    })
  })

  describe('AC01/AC02 — the assessment stage and the Log decision page', () => {
    let workItemId

    before(async () => {
      workItemId = await driveToDecisionReady({
        organisationName: 'RA-317 Decision No Withdraw Ltd',
        material: 'paper'
      })
      await workItems.openWorkItem(workItemId)
    })

    it('offers no Withdraw affordance on the detail page in assessment', async () => {
      // The state that used to project `withdraw-during-assessment`. Anchored
      // on the Log decision CTA (asserted in the next test) rather than the
      // actions panel: the panel's shape once Withdraw is its only removed
      // entry is management-fe's to define, so the absence sweep is anchored
      // on a control the page is known to still render.
      await expect(detail.logDecisionCta()).toBeExisting()
      await assertNoWithdrawAffordance()
    })

    it('still offers the Log decision affordance in assessment (AC02)', async () => {
      // The decision route is how a caseworker still progresses the case —
      // removing Withdraw must not have taken the rest of the panel with it.
      expect(await detail.hasLogDecisionCta()).toBe(true)
    })

    it('offers approve and refuse but no Withdraw on the Log decision page', async () => {
      // AC01's "decision page" half. The determination is chosen here as
      // Approved/Refused radios; Withdraw must not appear as a third route.
      await decision.gotoFor(workItemId)
      await decision.assertOnPage()
      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
      expect(await decision.hasOutcomeRadio('refused')).toBe(true)
      await assertNoWithdrawAffordance()
    })
  })

  describe('AC03 — an operator withdrawal still shows in case management', () => {
    let workItemId

    before(async () => {
      const created = await workItems.createWorkItem({
        organisationName: 'RA-317 Operator Withdrawn Ltd',
        siteAddressLine1: '1 Operator Way',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AU',
        material: 'plastic',
        tonnageBand: '0-500'
      })
      workItemId = created.id
      // The operator withdraws it through the backend — the only route now.
      await withdrawAsOperatorOrThrow(
        workItemId,
        'Withdrawn by the operator (RA-317 AC03)'
      )
    })

    it('shows the Withdrawn status on the case-details page', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Withdrawn')
    })

    it('shows the withdrawn notice, so the regulator can see it was withdrawn', async () => {
      await workItems.openWorkItem(workItemId)
      await workItems.waitForDetailPage()
      await detail.assertWithdrawnNotice()
    })
  })
})
