import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import { createReAccreditation } from '../support/re-accreditation-journey.js'
import { utcDateParts } from '../support/uk-time.js'

/**
 * RA-316 — Case Management service: Duly making alignment.
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
    // £546.00. Each RA-316 spec creates its item with a DIFFERENT real fee
    // band, so no two render the same figure — see the AC02 charge test for
    // why that matters, and `createReAccreditation` for the 50000-pence
    // floor any new value has to clear.
    workItemId = await createReAccreditation('Duly Making Ltd', 'SW1A 1DM', {
      chargeAmountPence: 54600
    })
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
      // RA-316 removed the panel from `submitted`; RA-410 then removed Tasks
      // outright, so these three now hold in EVERY state rather than just
      // this one. Kept here rather than folded into
      // ra-410-tasks-removed.e2e.js because this file owns the `submitted`
      // shape of the duly-making screen, and a revert that restored the panel
      // beside the Duly make CTA is exactly the dead end RA-316 fixed.
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
     * THIS ASSERTS THE VALUE, NOT THE ELEMENT — deliberately.
     *
     * `chargeAmountPence` is read from the work item payload by key. A
     * sibling field (`isTaskWaypoint`) was assumed the same way and turned
     * out never to be sent at all.
     *
     * If the key differs from what management-be emits, the frontend renders
     * "Not provided". No error, no crash — a payment panel showing nothing,
     * on the page whose entire purpose is confirming a payment. A
     * presence-only assertion passes cleanly against that, which is why this
     * reads the text and rejects the placeholder explicitly.
     *
     * There is deliberately NO equivalent assertion for the payment
     * reference. It has no fallback (RA-316, Tom's ruling): it renders only
     * from `payload.paymentReference`, which no created item carries and no
     * real submission carries either, so "Not provided" is the correct and
     * near-universal result. Asserting a real value there would assert the
     * fallback that was deliberately removed.
     */
    it('AC02: pre-populates the charge amount with a real figure', async () => {
      const charge = await dulyMaking.chargeAmountText()
      expect(charge).not.toContain('Not provided')
      // A currency symbol followed by digits. No literal amount: it comes
      // from the application payload, so pinning a figure would assert the
      // fixture rather than the behaviour — but "£" plus a number is the
      // difference between a rendered charge and an empty panel.
      expect(charge).toMatch(/£\s*\d/)

      // The pounds/pence boundary, which the pattern above cannot see:
      // "£546.00" and "£54,600.00" both satisfy it.
      //
      // The fee is stored as an integer number of PENCE and divided by 100
      // for display. Real bands run £546 to £3,965 plus £328 per overseas
      // reprocessing site, so anything at or above £50,000 is not a fee — it
      // is the smallest possible band (54600p) rendered without the
      // division. The ceiling deliberately sits in the wide gap between the
      // two, so it discriminates without going brittle if a band is
      // repriced. The floor catches a charge that rounded away to zero.
      const pounds = await dulyMaking.chargeAmountPounds()
      expect(pounds).toBeGreaterThan(0)
      expect(pounds).toBeLessThan(50000)
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
      await dulyMaking.setPaymentDate(utcDateParts(new Date()))
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
