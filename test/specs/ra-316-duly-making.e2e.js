import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import { createReAccreditation } from '../support/re-accreditation-journey.js'
import { ukDateParts } from '../support/uk-time.js'

/**
 * RA-316 — CM: Duly making alignment.
 *
 * The task-driven route into `duly-made` is replaced by an explicit CTA and
 * a payment-date page. The `submitted`-state tasks
 * (`verify-organisation-details`, `confirm-application-completeness`) and
 * the hook that auto-transitioned off their completion are deleted, so
 * `submitted` now has an EMPTY task list and the CTA is the only way
 * through. `test/specs/ra-auto-duly-made.e2e.js` covered the deleted
 * behaviour and is retired by this change.
 *
 * Covered here:
 *   AC01 — "Duly make" CTA on the detail page, navigating to the page.
 *   AC02 — charge amount, payment reference, payment date; NO note fields.
 *   AC03 — the completion button reads "Complete duly making".
 *   AC04 — Cancel returns to the summary, status still "Not started".
 *   AC05 — after completion the status reads "Duly made".
 *   AC08 — the audit history records the duly-making.
 *
 * Validation and guard paths live in
 * `ra-316-duly-making-validation.e2e.js`.
 *
 * ORDERING IS LOAD-BEARING. AC04 (cancel changes nothing) has to run before
 * AC05 (completion) on the same item, because duly making is one-way — the
 * item stays in `duly-made` and nothing in this story moves it on.
 */
describe('RA-316 duly making', () => {
  let workItemId

  before(async () => {
    await login.login()
    workItemId = await createReAccreditation('Duly Making Ltd', 'SW1A 1DM')
    await login.logout()
  })

  describe('AC01 — the Duly make call to action', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('offers a "Duly make" CTA on a submitted work item', async () => {
      await workItems.openWorkItem(workItemId)
      // `submitted` displays as "Not started" — the display name is
      // unchanged by this story.
      await detail.assertState('Not started')
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })

    it('no longer offers submitted-state tasks to drive the transition', async () => {
      await workItems.openWorkItem(workItemId)
      // The two submitted tasks are deleted AND the panel comes out with
      // them — an empty panel would point the regulator at a tasks page with
      // nothing on it, right beside the CTA that is the real next step. So
      // this asserts absence of the whole affordance, not an empty state.
      //
      // Deliberately not navigating to the tasks page first: there is no
      // longer a link to it from `submitted`, so `gotoTasks()` would fail
      // here for the right reason but with a useless message.
      expect(await detail.hasTasksPanel()).toBe(false)
      expect(await detail.hasTasksLink()).toBe(false)
      expect(await detail.hasTaskProgress()).toBe(false)
    })

    it('navigates to the duly-making page when the CTA is clicked', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickDulyMake()
      await dulyMaking.waitForDulyMakingUrl(workItemId)
      await dulyMaking.assertOnPage()
    })
  })

  describe('AC02/AC03 — what the duly-making page shows', () => {
    before(async () => {
      await login.login()
      await dulyMaking.gotoFor(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    /**
     * THESE TWO ASSERT THE VALUE, NOT THE ELEMENT — deliberately.
     *
     * `chargeAmountPence` and `paymentReference` have no consumer anywhere
     * in management-fe: nothing has ever read a real byte of either, so the
     * key names are assumed rather than verified on both sides. A sibling
     * field (`isTaskWaypoint`) was assumed the same way and turned out never
     * to be sent at all.
     *
     * If the keys differ from what management-be emits, the frontend renders
     * "Not provided" for both. No error, no crash — a payment panel showing
     * nothing, on the page whose entire purpose is confirming a payment. A
     * presence-only assertion passes cleanly against that, which is why
     * these read the text and reject the placeholder explicitly.
     */
    it('AC02: pre-populates the charge amount with a real figure', async () => {
      const charge = await dulyMaking.chargeAmountText()
      expect(charge).not.toContain('Not provided')
      // A currency symbol followed by digits. No literal amount: it comes
      // from the application payload, so pinning a figure would assert the
      // fixture rather than the behaviour — but "£" plus a number is the
      // difference between a rendered charge and an empty panel.
      expect(charge).toMatch(/£\s*\d/)
    })

    it('AC02: pre-populates the payment reference with a real value', async () => {
      const reference = await dulyMaking.paymentReferenceText()
      // "Not provided" is non-empty, so the old non-empty check passed on
      // exactly the failure this is here to catch.
      expect(reference).not.toContain('Not provided')
      expect(reference.trim()).not.toBe('')
      // Some alphanumeric content, which a placeholder or a stray separator
      // would not have.
      expect(reference).toMatch(/[A-Za-z0-9]/)
    })

    it('AC02: offers a day/month/year payment date entry', async () => {
      await expect(dulyMaking.dayInput()).toBeDisplayed()
      await expect(dulyMaking.monthInput()).toBeDisplayed()
      await expect(dulyMaking.yearInput()).toBeDisplayed()
    })

    it('AC02: shows no note or comment fields', async () => {
      // Their absence is part of the AC, not incidental: the route this
      // replaces carried note affordances and the replacement deliberately
      // does not.
      expect(await dulyMaking.hasAnyNoteField()).toBe(false)
    })

    it('AC03: labels the completion button "Complete duly making"', async () => {
      expect((await dulyMaking.submitButtonText()).trim()).toBe(
        'Complete duly making'
      )
    })
  })

  describe('AC04 — Cancel makes no change', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('returns to the summary page with the status still "Not started"', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickDulyMake()
      await dulyMaking.assertOnPage()

      await dulyMaking.cancel()
      await dulyMaking.waitForDetailUrl(workItemId)
      await detail.assertState('Not started')
    })

    it('leaves the CTA available so the caseworker can start again', async () => {
      // The cancel path is only genuinely non-destructive if the journey is
      // still open afterwards — a cancel that stranded the item would
      // otherwise pass the status assertion above.
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasDulyMakeCta()).toBe(true)
    })
  })

  describe('AC05/AC08 — completing duly making', () => {
    before(async () => {
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('AC05: moves the work item to "Duly made"', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.clickDulyMake()
      await dulyMaking.assertOnPage()
      // Today is a VALID payment date — the rule is "today or in the past",
      // so this is the boundary case that must pass.
      await dulyMaking.setPaymentDate(ukDateParts(new Date()))
      await dulyMaking.submit()

      await dulyMaking.waitForDetailUrl(workItemId)
      await detail.assertState('Duly made')
    })

    it('AC05: withdraws the CTA once the item has left submitted', async () => {
      await workItems.openWorkItem(workItemId)
      // management-fe removes the CTA from the DOM outside `submitted`
      // rather than hiding it, so presence is the meaningful assertion.
      expect(await detail.hasDulyMakeCta()).toBe(false)
    })

    it('AC05: starts the SLA clock', async () => {
      await workItems.openWorkItem(workItemId)
      // hasRealDueOn() rather than a presence check: the case-header field
      // renders either way, showing an em dash when no clock has started,
      // so presence alone would pass even if the clock never started.
      //
      // The date itself is not asserted here. The clock now runs from the
      // ENTERED payment date at midnight UTC rather than from completion
      // time, and this item was duly made with today's date, so the target
      // is only incidentally "12 weeks from now" — pinning it would be
      // asserting the fixture's date choice.
      expect(await detail.hasRealDueOn()).toBe(true)
    })

    it('AC08: records the duly-making in the audit history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Action applied')
      expect(await detail.appliedTransitions()).toContain(
        'submitted → duly-made'
      )
    })

    it('AC05: stays in "Duly made" — nothing in this story moves it on', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Duly made')
    })
  })
})
