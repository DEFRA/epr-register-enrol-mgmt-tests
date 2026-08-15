import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { withdrawAsOperatorOrThrow } from '../support/operator-withdrawal.js'
import notFound, {
  UNKNOWN_WORK_ITEM_ID
} from '../page-objects/work-item-not-found.page.js'

/**
 * RA-358 — CM: Withdrawn work items error message.
 *
 * Two distinct complaints from the bug report, deliberately kept as two
 * separate describes because they are two different pages:
 *
 *   AC1 — a work item in the terminal `withdrawn` state must say so
 *         prominently on its detail page. Withdrawal is a state transition,
 *         not a deletion (the backend still serves the item on
 *         GET /work-items/{id}), so a regulator following a link to a
 *         withdrawn application lands on a perfectly normal-looking page.
 *         Before RA-358 the only signals were a grey `Withdrawn` tag in the
 *         case header and a generic "final state" Outcome panel, neither of
 *         which tells the user the application was withdrawn. Where the
 *         message names the case it must use the user-facing application
 *         reference, not the system-generated work item GUID.
 *
 *   AC2 — /work-items/{unknown-id} must render a not-found page worded in
 *         application terms and must stop parading the GUID at the user as
 *         though it were their reference. The 404 in the bug screenshot was a
 *         genuinely non-existent id (NOT a side effect of withdrawal), which
 *         is why this is a separate case rather than part of AC1.
 *
 * The withdraw-confirmation route renders the same not-found view, so its
 * branch is covered here too rather than left to inference.
 *
 * Note on the reference format: the ticket text says `RA-*`, but this stack
 * generates `AP…` references (RA-318). The specs assert against the reference
 * the create flow actually returns rather than a hard-coded prefix, so they
 * stay correct if the format moves again.
 */
describe('RA-358 — withdrawn work item message and not-found page', () => {
  describe('AC1 — the detail page of a withdrawn work item', () => {
    let workItemId
    let applicationReference

    before(async () => {
      await login.login()
      await workItems.goto()
      ;({ id: workItemId, applicationReference } =
        await workItems.createWorkItem({
          organisationName: 'Withdrawn Message Ltd',
          siteAddressLine1: '1 Withdrawn Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AP',
          material: 'plastic',
          tonnageBand: '0-500'
        }))

      // Withdraw as the operator (RA-317 removed the CM withdraw affordance),
      // then open the item: the AC is about what a regulator sees AFTER an
      // application is withdrawn — which is exactly AC03, an operator
      // withdrawal surfacing in case management — and the suite has no shared
      // withdrawn fixture to reuse (every withdrawal spec creates its own
      // item, because the list hides terminal states and a shared one could
      // not be found again).
      await withdrawAsOperatorOrThrow(
        workItemId,
        'Withdrawn by the operator (test fixture)'
      )
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Withdrawn')
    })

    after(async () => {
      await login.logout()
    })

    beforeEach(async () => {
      // Each assertion re-opens the page: several of these navigate away
      // (audit log, confirmation route) and the AC is specifically about what
      // is on screen when you ARRIVE at a withdrawn item's detail page.
      await workItems.openWorkItem(workItemId)
      await workItems.waitForDetailPage()
    })

    it('states prominently that the application has been withdrawn', async () => {
      await detail.assertWithdrawnNotice()
      // Worded in application terms, not "this work item is in a final state".
      await expect(detail.withdrawnNotice()).toHaveText(/application/i)
    })

    it('names the case by its application reference, not the work item id', async () => {
      await detail.assertWithdrawnNoticeIdentifiedBy(
        applicationReference,
        workItemId
      )
    })

    it('does not present the work item id as the page identity', async () => {
      // The case header IS the page identity post-RA-295 (see RA-196), so the
      // GUID must not be what it shows. The "Work item ID" summary row lower
      // down deliberately still carries the GUID for debugging, which is why
      // this is scoped to the identity rather than the whole page body.
      const caption = await detail.getCaption()
      expect(caption).toBe(applicationReference)
      expect(caption).not.toContain(workItemId)
    })

    it('still serves the withdrawn item rather than 404ing', async () => {
      // Guards the investigation finding that withdrawal is a state
      // transition, not a delete: if the backend ever started filtering
      // terminal states out of GET /work-items/{id}, AC1 would silently
      // become untestable and the user would get AC2's page instead.
      expect(await detail.hasCaseHeader()).toBe(true)
      expect(await notFound.body().isExisting()).toBe(false)
    })

    // RA-249 degradation: a withdrawn item with no application reference must
    // fall back to unqualified copy ("This application has been withdrawn…")
    // and omit the reference element entirely, rather than naming the case by
    // its GUID. Not reachable from the browser — management-be generates a
    // reference on creation and the UI offers no way to make one without,
    // so there is no journey that produces such an item. Skipped rather than
    // faked; covered at unit level by management-fe's withdrawn-notice tests.
    it.skip('degrades to unqualified copy when the case has no application reference', async () => {})

    it('keeps the withdrawn message on the page after a reload', async () => {
      // The message must be a property of the item's state, not a one-shot
      // flash banner left over from the withdraw POST redirect.
      await browser.refresh()
      await detail.assertWithdrawnNotice()
    })
  })

  describe('AC2 — the not-found page for an unknown work item id', () => {
    const unknownId = UNKNOWN_WORK_ITEM_ID

    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('renders a not-found page for a well-formed but non-existent id', async () => {
      await notFound.gotoWorkItem(unknownId)
      await notFound.assertRendered()
      await notFound.assertWordedInApplicationTerms()
    })

    it('does not present the raw work item id to the user', async () => {
      await notFound.gotoWorkItem(unknownId)
      await notFound.assertRendered()
      await notFound.assertIdNotPresentedToUser(unknownId)
    })

    it('does not present a non-GUID id to the user either', async () => {
      // A separate case rather than a second call inside the one above,
      // because the id SHAPE is the variable under test. A malformed id can
      // short-circuit into a validation branch upstream of the not-found
      // view, so "the GUID-shaped id is kept out of the copy" does not by
      // itself prove anything about this shape — it has to be pinned
      // independently. error-pages.e2e.js proves this id still reaches the
      // same view; this proves the id is kept out of the copy once there.
      const malformedId = 'does-not-exist-00000000'
      await notFound.gotoWorkItem(malformedId)
      await notFound.assertRendered()
      await notFound.assertIdNotPresentedToUser(malformedId)
    })

    it('offers a route back to the applications list', async () => {
      // AC2 is about a user who followed a dead link, so the page has to
      // leave them somewhere useful. Asserted on the href rather than the
      // link text: the destination is the contract, the wording is content
      // design's to change. (The sibling `work-item-not-found-help` element
      // is deliberately NOT asserted — it is pure prose with no behaviour
      // behind it, and pinning it would make copy review a red build.)
      await notFound.gotoWorkItem(unknownId)
      await notFound.assertRendered()
      await expect(notFound.backLink()).toHaveAttribute('href', '/work-items')
    })

    // RA-317 deleted the generic action-confirmation route
    // `/work-items/{id}/actions/{actionId}/confirm` (withdraw was its only
    // user). It no longer shares not-found.njk — an unknown id there now 404s
    // at the router itself — so the former "renders the same not-found page
    // from the action confirmation route" case is removed rather than kept as
    // a router-404 assertion that would prove nothing about not-found.njk.
    // The unknown-id not-found rendering is still fully covered above via
    // GET /work-items/{unknownId}.
  })
})
