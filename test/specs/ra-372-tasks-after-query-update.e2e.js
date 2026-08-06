import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import {
  createApplication,
  continueReviewViaApi,
  driveToAssessment,
  driveToDulyMade,
  raiseQuery,
  resumeFromQuery
} from '../support/query-resubmission.js'

/**
 * RA-372 — the regulator can finish the review after a query response.
 *
 * The bug: once an operator answered a query the application moved to
 * `updated`, and the tasks page went blank — "No tasks are required for this
 * work item in its current state." The caseworker had nothing left to do and
 * the work already done had vanished from view, so the case dead-ended.
 *
 * The fix projects the tasks of the state the query was raised FROM, with
 * the progress made before the query intact, and lets the remaining ones be
 * completed while the application sits in `updated`.
 *
 * Two things about this journey are worth knowing before reading the specs.
 *
 * 1. `assessment-in-progress` and `updated` BOTH display as "Updated"
 *    (RA-324 AC06 — an accepted clash, deliberately not reconciled). So
 *    `assertState('Updated')` cannot tell the two apart, and telling them
 *    apart is the whole subject of this story. Every assertion that has to
 *    distinguish them reads the status badge colour instead: `updated` is
 *    turquoise, `assessment-in-progress` is blue.
 *
 * 2. The `queried` → `updated` leg has no case-management UI. It is the
 *    OPERATOR backend calling `resume-from-query` on management-be, and the
 *    operator's service is not in this stack — see
 *    `support/query-resubmission.js` for why the test makes that call
 *    itself.
 */

const UPDATED_TAG = 'govuk-tag--turquoise'
const ASSESSMENT_TAG = 'govuk-tag--blue'
const DULY_MADE_TAG = 'govuk-tag--purple'

const SUBMITTED_TASKS = [
  'verify-organisation-details',
  'confirm-application-completeness'
]
const DULY_MADE_TASKS = ['confirm-registration-fee-paid']
const ASSESSMENT_TASKS = [
  'review-compliance-history',
  'assess-technical-capacity',
  'assess-financial-capacity'
]
const AWAITING_DECISION_TASKS = ['record-decision-rationale']

const uniqueOrg = (label) => `${label} ${Date.now()}`

/**
 * The tasks page groups by status, so the DOM order of the task list changes
 * as tasks are completed. Compare as sets — the assertions care about which
 * tasks are offered, never about which heading they currently sit under.
 */
const sorted = (ids) => [...ids].sort()

const continueReviewCta = () =>
  $('[data-testid="re-accreditation-continue-review-cta"]')

const continueReviewButton = () => $('[data-testid="action-continue-review"]')

// The `it`s inside each describe below run IN ORDER against one shared work
// item: the journey to `updated` is expensive, and several of the ACs are
// about what survives the step before. Do not reorder them and do not run one
// in isolation with `.only`.

describe('RA-372 Tasks after a query response', () => {
  describe('AC01–AC04 — queried from assessment-in-progress', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createApplication({
        organisationName: uniqueOrg('Resubmission Assessment Ltd'),
        postcode: 'SW1A 3AA'
      })
      await driveToDulyMade(workItemId)
      await driveToAssessment(workItemId)

      // The "previously completed task" the AC is about. One of the three
      // assessment tasks is done BEFORE the query goes out, so the spec can
      // tell "the tasks came back" apart from "the tasks came back empty".
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.setTaskStatus('review-compliance-history', 'Completed')

      await raiseQuery(workItemId)
      await resumeFromQuery(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('lands the application in Updated rather than back in assessment', async () => {
      // Guards the premise of everything below. Both states render the word
      // "Updated", so the badge colour is what actually proves the operator's
      // resubmission parked the case in `updated` rather than returning it
      // straight to `assessment-in-progress`.
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Updated')
      await detail.assertStateTagClass(UPDATED_TAG)
    })

    it('AC01: offers the tasks of the state the query was raised from', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()

      // The literal regression. Before RA-372 this message was the ONLY
      // thing on the page for an `updated` application.
      expect(await detail.hasNoTasksMessage()).toBe(false)
      expect(sorted(await detail.taskIds())).toEqual(sorted(ASSESSMENT_TASKS))
    })

    it('AC01: does not leak the tasks of any other state', async () => {
      // Asserted separately from the set comparison above because the two
      // fail for different reasons and a reader of a red build should be
      // able to tell "nothing came back" from "everything came back".
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()

      for (const task of [
        ...SUBMITTED_TASKS,
        ...DULY_MADE_TASKS,
        ...AWAITING_DECISION_TASKS
      ]) {
        expect(await detail.hasTask(task)).toBe(false)
      }
    })

    it('AC02: counts the pre-query progress on the detail page', async () => {
      // The detail page's own summary of the same projection. Asserted
      // because it is what a caseworker sees FIRST — a "0 of 3" here would
      // send them away believing the work was lost even if the tasks page
      // were right.
      await workItems.openWorkItem(workItemId)
      expect(await detail.taskProgressText()).toContain('1 of 3 tasks complete')
    })

    it('AC02: still shows the task completed before the query as completed', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.assertTaskStatus('review-compliance-history', 'Completed')
      // The other two are untouched — proving the projection carried the real
      // progress across rather than defaulting everything to complete.
      await detail.assertTaskStatus('assess-technical-capacity', 'Not started')
      await detail.assertTaskStatus('assess-financial-capacity', 'Not started')
    })

    it('AC03: completes a remaining task while the application is updated', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.completeTask('assess-technical-capacity')
      await detail.assertTaskStatus('assess-technical-capacity', 'Completed')
    })

    it('AC03: keeps that completion after leaving and returning to the page', async () => {
      // A task that only looks complete on the redirect response is no use to
      // a caseworker who comes back tomorrow, so this re-reads the page from
      // the detail view rather than trusting the post-submit render.
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.assertTaskStatus('review-compliance-history', 'Completed')
      await detail.assertTaskStatus('assess-technical-capacity', 'Completed')
      await detail.assertTaskStatus('assess-financial-capacity', 'Not started')
    })

    it('AC03: leaves the application in Updated while tasks are worked', async () => {
      // Completing an assessment task must not itself advance the case —
      // only Continue review does that.
      //
      // Note this is specific to the assessment origin. Had the query been
      // raised from `submitted`, completing the LAST outstanding task here
      // would fire the duly-made hook and move the item on its own; that is
      // intended (there is no caller-invocable duly-make action, so the item
      // would otherwise dead-end) and is why `submitted` is not used as an
      // origin anywhere in this file.
      await workItems.openWorkItem(workItemId)
      await detail.assertStateTagClass(UPDATED_TAG)
    })

    it('offers Continue review as the way out of Updated', async () => {
      await workItems.openWorkItem(workItemId)
      await expect(continueReviewCta()).toBeDisplayed()
      await expect(continueReviewButton()).toBeEnabled()
    })

    it('AC04: Continue review returns the application to the state it was queried from', async () => {
      // Deliberately run with `assess-financial-capacity` still outstanding.
      // Continue review is NOT gated on task completion — gating it would
      // recreate the dead end this story exists to remove — so the
      // outstanding task is part of the assertion, not an oversight.
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('continue-review')
      await detail.waitForDetailUrl()
      await detail.assertStateTagClass(ASSESSMENT_TAG)
    })

    it('AC04: confirms the continuation with a flash banner', async () => {
      const banner = await detail.flashBannerText()
      expect(banner).toContain('Review continued')
      expect(banner).toContain(
        'The application has returned to the stage it was queried from.'
      )
    })

    it('AC04: keeps the tasks completed while updated complete in the originating state', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      expect(sorted(await detail.taskIds())).toEqual(sorted(ASSESSMENT_TASKS))
      await detail.assertTaskStatus('review-compliance-history', 'Completed')
      await detail.assertTaskStatus('assess-technical-capacity', 'Completed')
      await detail.assertTaskStatus('assess-financial-capacity', 'Not started')
    })

    it('withdraws the Continue review affordance once the review has been continued', async () => {
      await workItems.openWorkItem(workItemId)
      await expect(continueReviewCta()).not.toExist()
    })

    it('treats a repeat continue-review call as an idempotent replay, not an error', async () => {
      // Defence in depth for the double-submit / back-button case. The UI has
      // already withdrawn the affordance by now, so the only way to prove the
      // endpoint itself is safe is to call it directly.
      const result = await continueReviewViaApi(workItemId)
      expect(result.status).toBe(200)
      expect(result.idempotentReplay).toBe(true)
    })
  })

  describe('AC01/AC04 — queried from duly-made', () => {
    let workItemId

    // Run against a SECOND origin state on purpose. With one origin, a
    // hard-coded "always show the assessment tasks" implementation would pass
    // every assertion above. Only a second origin with a different task list
    // proves the projection actually follows the state the query came from.
    before(async () => {
      await login.login()
      workItemId = await createApplication({
        organisationName: uniqueOrg('Resubmission Duly Made Ltd'),
        postcode: 'SW1A 3AB'
      })
      await driveToDulyMade(workItemId)
      await raiseQuery(workItemId, {
        sections: ['prn-tonnage'],
        reason: 'Please confirm the PRN tonnage figures before we proceed.'
      })
      await resumeFromQuery(workItemId, { sectionKeys: ['prn-tonnage'] })
    })

    after(async () => {
      await login.logout()
    })

    it('AC01: offers the duly-made task list, not the assessment one', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateTagClass(UPDATED_TAG)
      await detail.gotoTasks()

      expect(await detail.hasNoTasksMessage()).toBe(false)
      expect(sorted(await detail.taskIds())).toEqual(sorted(DULY_MADE_TASKS))
      for (const task of ASSESSMENT_TASKS) {
        expect(await detail.hasTask(task)).toBe(false)
      }
    })

    it('refuses Continue review to a read-only support user', async () => {
      // RA-335: a support user may read every case but modify none. The CTA
      // still renders — hiding it would tell them the affordance does not
      // exist — but the control is inert.
      await login.logout()
      await login.loginAsSupportUser()
      await workItems.openWorkItem(workItemId)

      await expect(continueReviewCta()).toBeDisplayed()
      await expect(continueReviewButton()).toBeDisabled()

      await login.logout()
      await login.login()
    })

    it('AC04: Continue review returns the application to duly-made', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('continue-review')
      await detail.waitForDetailUrl()
      await detail.assertState('Duly made')
      await detail.assertStateTagClass(DULY_MADE_TAG)
    })
  })

  describe('guards — Continue review is not offered before a resubmission', () => {
    let queriedId

    before(async () => {
      await login.login()
      queriedId = await createApplication({
        organisationName: uniqueOrg('Resubmission Guard Ltd'),
        postcode: 'SW1A 3AC'
      })
      await driveToDulyMade(queriedId)
      await driveToAssessment(queriedId)
    })

    after(async () => {
      await login.logout()
    })

    it('does not offer Continue review on an application that was never queried', async () => {
      await workItems.openWorkItem(queriedId)
      await detail.assertStateTagClass(ASSESSMENT_TAG)
      await expect(continueReviewCta()).not.toExist()
    })

    it('does not offer Continue review while the application is still queried', async () => {
      // The operator has not answered yet — continuing here would skip the
      // response the query exists to collect.
      await raiseQuery(queriedId)
      await workItems.openWorkItem(queriedId)
      await expect(continueReviewCta()).not.toExist()
    })

    it('refuses a direct continue-review call on a queried application', async () => {
      // Defence in depth: the missing CTA is a UI decision, so the endpoint
      // has to refuse the same request on its own account.
      const result = await continueReviewViaApi(queriedId)
      expect(result.status).toBe(409)
      expect(result.body?.title).toBe(
        'Could not continue re-accreditation review'
      )
      expect(result.body?.detail).toContain("is in state 'queried'")
    })

    it('leaves the queried application untouched after the refused call', async () => {
      await workItems.openWorkItem(queriedId)
      await detail.assertState('Queried')
      await detail.gotoTasks()
      // A queried application deliberately projects no tasks — RA-372
      // changes `updated` only. Asserted so a future over-broad fix that
      // starts projecting tasks for `queried` too is caught here.
      expect(await detail.hasNoTasksMessage()).toBe(true)
    })

    it('turns away a direct visit to the query page once already queried', async () => {
      // The existing one-open-query-at-a-time rule has to survive the
      // resubmission work: continue-review resolves its transition from the
      // same audit history the query wrote, so a second open query would
      // make that resolution ambiguous.
      await browser.url(`/work-items/${queriedId}/query`)
      await query.waitForDetailUrl(queriedId)
      await expect($('[data-testid="query-form"]')).not.toExist()
      await detail.assertState('Queried')
    })

    it('returns 404 for a continue-review call against an unknown application', async () => {
      const result = await continueReviewViaApi(
        '11111111-1111-1111-1111-111111111111'
      )
      expect(result.status).toBe(404)
    })
  })
})
