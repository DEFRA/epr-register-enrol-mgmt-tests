import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import {
  createReAccreditation,
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  raiseQuery,
  resumeFromQuery,
  continueReviewViaApi
} from '../support/query-resubmission.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import { utcDateParts } from '../support/uk-time.js'

/**
 * Open the item's Application history and wait for exactly `count`
 * `status-push-sent` entries, reloading between reads. The status push runs
 * on a background queue (RA-519) and the history page does not update itself,
 * so a push that lands after the page loaded is only seen on a reload.
 */
async function waitForStatusPushesSent(workItemId, count) {
  await workItems.openWorkItem(workItemId)
  await detail.gotoAudit()
  await browser.waitUntil(
    async () => {
      if (
        (await detail.auditEntriesForAction('status-push-sent')).length ===
        count
      ) {
        return true
      }
      await browser.refresh()
      return false
    },
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: `Expected ${count} status-push-sent entries for ${workItemId}`
    }
  )
}

/**
 * RA-454 — Case Management service: Query before Duly Made — "Continue review" wrongly duly-makes
 * and shows "Not started".
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 *
 * A caseworker raises a query on a re-accreditation application BEFORE it is
 * duly made — i.e. while it is still in `submitted` (displayed "Not started").
 * The operator answers, and the item comes back in `updated` carrying
 * `originStateId: 'submitted'` (the state the query was raised from).
 *
 * The detail page then rendered BOTH a green "Duly make" CTA AND a "Continue
 * review" control. "Continue review" is the affordance for an item queried
 * DURING review (origin assessment/decision) — resuming review is exactly the
 * right next step there. But offering it here, before the application had ever
 * been duly made, dropped it back to `submitted` / "Not started": there is no
 * review to continue, so "continuing" it is a hop backwards to the start.
 *
 * ── The fix these specs verify ───────────────────────────────────────────────
 *
 * management-be (epr-nkpi.1): Continue review returns to the queried-from
 * state rather than duly-making. management-fe (epr-nkpi.2): for an `updated`
 * re-accreditation item whose `originStateId === 'submitted'`, the "Continue
 * review" control is SUPPRESSED — only "Duly make" is offered, so the sole
 * route forward is the correct one (submitted → duly-made). "Continue review"
 * still appears for items queried AFTER duly-making (origin assessment /
 * decision / duly-made), which the second block below pins so the suppression
 * cannot over-reach into the states that legitimately need it.
 *
 * ── Why `assertStateId`, not the visible status ──────────────────────────────
 *
 * `assessment-in-progress` and `updated` BOTH display as "Updated" (RA-324),
 * and `assessment-started` and `duly-made` BOTH display as "Duly made"
 * (RA-527's follow-up), so a spec built on the label could assert against the
 * wrong item entirely.
 * Every state assertion here uses the raw `data-state-id` (`assertStateId`),
 * the contract management-fe added for exactly this.
 *
 * ── Why the Continue-review assertions are panel-scoped counts ────────────────
 *
 * "Continue review" is not a bespoke CTA; it is the generic `continue-review`
 * action, rendered `data-testid="action-continue-review"` in the actions
 * panel. `hasContinueReviewCta()` derives from the SAME panel-scoped counter
 * (`countActionsWithId`) RA-364 established, so a control leaking in from the
 * assignment panel cannot satisfy it, and asserting the count is `1` in the
 * positive block also guards RA-364's four-duplicate regression.
 */
describe('RA-454 Continue review after a query raised before duly making', () => {
  describe('queried BEFORE duly making (origin submitted)', () => {
    let workItemId

    before(async () => {
      await login.login()
      // Reaches `updated` with `originStateId: 'submitted'` — the exact shape
      // the bug is about — the same way ra-316-duly-making-from-updated does:
      // query while still pre-duly-made, then let the operator backend resume.
      ;({ id: workItemId } = await createReAccreditation(
        'RA454 Query Before Duly Ltd'
      ))
      await raiseQuery(workItemId, {
        reason:
          'RA-454: please resend the business plan before we duly make this.'
      })
      await resumeFromQuery(workItemId)
      await login.logout()
    })

    describe('the detail page after the operator resumes', () => {
      before(async () => {
        await login.login()
        await workItems.openWorkItem(workItemId)
      })

      after(async () => {
        await login.logout()
      })

      it('lands in updated, not assessment-in-progress', async () => {
        // Both render "Updated"; only the raw id tells the queried-before-duly
        // waypoint apart from an item genuinely mid-assessment.
        await detail.assertStateId('updated')
      })

      it('offers the "Duly make" CTA', async () => {
        // Duly making is the one correct next step for this item, and the CTA
        // survives the query round trip. Also the positive anchor for the
        // absence assertion below: it proves the CTA region rendered, so a
        // "Continue review is absent" pass cannot come from a page that failed
        // to load.
        expect(await detail.hasDulyMakeCta()).toBe(true)
      })

      it('does NOT offer "Continue review" — the heart of the bug', async () => {
        await workItems.openWorkItem(workItemId)

        // Anchor first: the re-accreditation template rendered (guards the
        // template-version fallback that would drop this type's actions
        // override and make every absence below pass for the wrong reason),
        // and the item is in `updated`.
        await expect(
          $('[data-testid="re-accreditation-detail"]')
        ).toBeDisplayed()
        await detail.assertStateId('updated')

        // The suppression. Pre-fix each of these read a present control:
        // `hasContinueReviewCta` true, the id count and the label count both
        // non-zero. All three must now be empty for an origin-`submitted`
        // waypoint.
        expect(await detail.hasContinueReviewCta()).toBe(false)
        expect(await detail.countActionsWithId('continue-review')).toBe(0)
        expect(await detail.countActionsLabelled('Continue review')).toBe(0)
      })
    })

    describe('duly making proceeds, and never drops back to Not started', () => {
      before(async () => {
        await login.login()
      })

      after(async () => {
        await login.logout()
      })

      it('reaches "Duly made" — not "Not started" — via the Duly make CTA', async () => {
        await workItems.openWorkItem(workItemId)
        await detail.clickDulyMake()
        await dulyMaking.waitForDulyMakingUrl(workItemId)
        await dulyMaking.setPaymentDate(utcDateParts(new Date()))
        await dulyMaking.submit()
        await dulyMaking.waitForDetailUrl(workItemId)

        // The bug's smoking gun was the opposite outcome: the item flipping
        // back to `submitted` / "Not started". Assert the destination on the
        // raw id AND the label, and pin explicitly that it did NOT land in
        // `submitted`, so a regression that reinstated the backward hop fails
        // here loudly rather than only on a later state assertion.
        await detail.assertStateId('duly-made')
        await detail.assertState('Duly made')
        expect(await detail.stateId()).not.toBe('submitted')
      })
    })

    // The blocks above prove the FE hides the affordance. This one pins the
    // BACKEND half of RA-454 (management-be, epr-nkpi.1) the suppression rests
    // on: `POST …/continue-review` for an application queried before duly
    // making returns it to the state it was queried FROM (`submitted`) and
    // does NOT duly-make it — the "wrongly duly-makes" half of the ticket
    // title. The FE never lets a caseworker reach this endpoint for such an
    // item, so a direct call is the only way to prove the endpoint itself is
    // safe; without this, CI's `management-be:latest` image could regress the
    // transition and every FE-suppression assertion above would still pass.
    describe('the continue-review endpoint, called directly', () => {
      // A dedicated item — calling continue-review moves it out of `updated`,
      // so it must not share the waypoint item the blocks above assert against.
      let apiWorkItemId

      before(async () => {
        await login.login()
        ;({ id: apiWorkItemId } = await createReAccreditation(
          'RA454 Continue API Ltd'
        ))
        await raiseQuery(apiWorkItemId, {
          reason:
            'RA-454: endpoint guard — queried before duly making, please resend the business plan.'
        })
        await resumeFromQuery(apiWorkItemId)
        await login.logout()
      })

      it('returns the item to the queried-from state (submitted), never duly-making it', async () => {
        const result = await continueReviewViaApi(apiWorkItemId)

        // 200, not a 409: the endpoint accepts the call for a pre-duly-made
        // waypoint (the resume-during-duly-making audit entry resolves the
        // continue-review-during-duly-making action) — it just must not
        // duly-make.
        expect(result.status).toBe(200)
        // The heart of epr-nkpi.1: back to `submitted`, the state the query was
        // raised from, and specifically NOT `duly-made` — the destination the
        // ticket title calls out.
        expect(result.body.stateId).toBe('submitted')
        expect(result.body.stateId).not.toBe('duly-made')
      })
    })
  })

  describe('queried AFTER duly making (a started case, "Duly made")', () => {
    // The positive contrast: the state that Continue review is FOR. Suppressing
    // it here too would strand a genuinely-under-review application, so this
    // block guards the fix against over-reaching.
    //
    // RA-527 follow-up (coverage d): "Assign to yourself and start" now leaves
    // the case in `assessment-started`, which still reads "Duly made" on both
    // sides. Querying it takes the journey a started case always took:
    // Queried -> the operator responds -> `updated` (Updated, turquoise) ->
    // Continue review -> `assessment-in-progress` (Updated, blue). It never
    // goes back to `assessment-started` / "Duly made". The item is
    // operator-backed so the operator side can be read at every step.
    let application
    let workItemId
    let dulyMadePushedAt
    let pushedAtBeforeContinue

    before(async () => {
      await login.login()
      await workItems.resetFilters()
      application = await createOperatorBackedWorkItem()
      workItemId = application.id
      await dulyMake(workItemId)
      // Let the duly-make push land (operator side AND its audit entry)
      // before starting, so the push count across the start is deterministic.
      const pushed = await waitForOperatorApplicationStatus(
        application,
        'DulyMade'
      )
      dulyMadePushedAt = pushed.caseManagementStatusUpdatedAt
      await waitForStatusPushesSent(workItemId, 1)
      await startAssessment(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('pushes nothing for the start: the operator stays DulyMade', async () => {
      // Still only the duly-make push in the history...
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Assessment started')
      expect(
        (await detail.auditEntriesForAction('status-push-sent')).length
      ).toBe(1)
      // ...and the operator's copy was not touched again: still DulyMade, and
      // its last Case Management update is still the duly-make one.
      const operatorApplication = await getOperatorApplication(
        application.operatorOrganisationId,
        application.operatorApplicationId
      )
      expect(operatorApplication.applicationStatus).toBe('DulyMade')
      expect(operatorApplication.caseManagementStatusUpdatedAt).toBe(
        dulyMadePushedAt
      )
    })

    it('offers Query on the started case, which still reads "Duly made"', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('assessment-started')
      await detail.assertState('Duly made')
      expect(await detail.hasAction('query')).toBe(true)
    })

    it('querying it moves both sides to Queried', async () => {
      await raiseQuery(workItemId, {
        reason: 'RA-454: please clarify the sampling plan while we assess this.'
      })
      await detail.assertStateId('queried')
      await waitForOperatorApplicationStatus(application, 'Queried')
    })

    it("the operator's response moves both sides to Updated (turquoise in the Case Management service)", async () => {
      await resumeFromQuery(workItemId)
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('updated')
      await detail.assertState('Updated')
      await detail.assertStateTagClass('govuk-tag--turquoise')
      await waitForOperatorApplicationStatus(application, 'Updated')
    })

    it('offers exactly one "Continue review" control', async () => {
      // Present, and present ONCE — the count guards both the RA-454
      // over-suppression (which would read 0) and the RA-364 duplication
      // (which read 4).
      await expect($('[data-testid="re-accreditation-detail"]')).toBeDisplayed()
      expect(await detail.hasContinueReviewCta()).toBe(true)
      expect(await detail.countActionsWithId('continue-review')).toBe(1)
    })

    it('does NOT offer "Duly make" — that would send it back past assessment', async () => {
      // The mirror of the first block: an item queried after duly making has
      // no route back to duly making, so the Duly make CTA must be absent
      // here exactly as Continue review is absent there.
      expect(await detail.hasDulyMakeCta()).toBe(false)
    })

    it('Continue review moves it to assessment-in-progress (Updated, blue), never back to Duly made', async () => {
      // Baseline for the push assertions below: duly make and the operator's
      // response have been pushed (the start was not, and the query has its
      // own push), and the operator's last Case Management update is the
      // response's.
      await waitForStatusPushesSent(workItemId, 2)
      ;({ caseManagementStatusUpdatedAt: pushedAtBeforeContinue } =
        await getOperatorApplication(
          application.operatorOrganisationId,
          application.operatorApplicationId
        ))

      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('continue-review')
      await detail.assertStateId('assessment-in-progress')
      await detail.assertState('Updated')
      await detail.assertStateTagClass('govuk-tag--blue')
      expect(await detail.stateId()).not.toBe('assessment-started')
    })

    it('pushes Continue review to the operator, who stays Updated', async () => {
      // Exactly one push more than before Continue review, and it is the
      // Continue review one: from `updated`, under that action.
      await waitForStatusPushesSent(workItemId, 3)
      await detail.expandAllAuditEntryDetails()
      await detail.assertAuditDetailRow(
        'status-push-sent',
        'Action',
        'Continue review'
      )
      await detail.assertAuditDetailRow(
        'status-push-sent',
        'Previous state',
        'updated'
      )
      // The operator received it — its last Case Management update moved on —
      // and still reads Updated.
      const operatorApplication = await getOperatorApplication(
        application.operatorOrganisationId,
        application.operatorApplicationId
      )
      expect(operatorApplication.applicationStatus).toBe('Updated')
      expect(operatorApplication.caseManagementStatusUpdatedAt).not.toBe(
        pushedAtBeforeContinue
      )
    })

    it('records the whole journey in the history', async () => {
      await detail.gotoAudit()
      const transitions = await detail.appliedTransitions()
      expect(transitions).toContain('duly-made → assessment-started')
      expect(transitions).toContain('assessment-started → queried')
      expect(transitions).toContain('queried → updated')
      expect(transitions).toContain('updated → assessment-in-progress')
      expect(transitions).not.toContain('updated → assessment-started')
    })
  })
})
