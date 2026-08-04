import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'
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

      // Drive the item through the real RA-188 withdraw journey rather than
      // seeding a withdrawn fixture: the AC is about what a regulator sees
      // AFTER withdrawing, and the suite has no shared withdrawn fixture to
      // reuse (every withdrawal spec creates its own item, because the list
      // hides terminal states and a shared one could not be found again).
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.assertOnConfirmPage()
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
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

    it('renders the same not-found page from the action confirmation route', async () => {
      // /work-items/{id}/actions/{actionId}/confirm shares not-found.njk, so
      // a reworded page has to be reworded for this entry point too — this is
      // the route a regulator hits by following a stale "Withdraw" link.
      await notFound.gotoActionConfirm(unknownId, 'withdraw')
      await notFound.assertRendered()
      await notFound.assertIdNotPresentedToUser(unknownId)
    })
  })
})
