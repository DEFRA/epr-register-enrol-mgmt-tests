import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'

/**
 * RA-595 (task 004) — make a determination straight from Duly made.
 *
 * Make Determination now shows on a Duly made case whoever holds it. The
 * backend still refuses a decision from `duly-made`, so management-fe's
 * submit runs "ensure assessment started" first:
 *
 *   unassigned:      assign (caller) -> start-assessment -> decision
 *   already held:                       start-assessment -> decision
 *
 * Opening the decision page changes nothing. These journeys drive the real
 * CTA and page, and read the outcome off the detail page and its history.
 * The exact call order and the partial-failure paths are pinned in
 * management-fe's route tests, where the backend can be made to fail.
 *
 * State is asserted by `data-state-id` (inside `logDecision`); the status
 * tag is checked only as the label a regulator reads. RA-324 gives
 * `assessment-in-progress` and `updated` the same label.
 *
 * RA-527 follow-up: the start step now lands on `assessment-started` (still
 * "Duly made") and is never pushed, and the determination (step 1) pushes
 * nothing either. So the operator's application stays DulyMade through step
 * 1 and only moves when step 2 (confirm applicant contact) pushes the
 * outcome.
 */

/**
 * The operator's status has not moved since duly making: still DulyMade,
 * with no Case Management status update after the duly-make push.
 */
async function expectOperatorStillDulyMade(application, dulyMadePushedAt) {
  const current = await getOperatorApplication(
    application.operatorOrganisationId,
    application.operatorApplicationId
  )
  expect(current.applicationStatus).toBe('DulyMade')
  expect(current.caseManagementStatusUpdatedAt).toBe(dulyMadePushedAt)
}

/** The stub login identity — see `login.page.js`. */
const CALLER = 'Stub Caseworker One'

describe('RA-595 Make Determination from an unassigned Duly made case', () => {
  let workItemId
  let application
  let dulyMadePushedAt

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await dulyMake(workItemId)
    dulyMadePushedAt = (
      await waitForOperatorApplicationStatus(application, 'DulyMade')
    ).caseManagementStatusUpdatedAt
  })

  after(async () => {
    await login.logout()
  })

  it('offers Make Determination while unassigned in Duly made', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
    expect(await detail.hasLogDecisionCta()).toBe(true)
  })

  it('opening the decision page and cancelling changes nothing', async () => {
    await detail.clickLogDecision()
    await decision.assertOnPage()
    await decision.cancel()
    await decision.waitForDetailUrl(workItemId)

    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
  })

  it('submitting Approved assigns the caller, starts assessment and records step 1', async () => {
    // `logDecision` asserts the state id it lands on.
    await logDecision(workItemId, 'approved')
    await detail.assertAssignedTo(CALLER)
  })

  it('leaves the operator on Duly made after step 1 (RA-527 follow-up)', async () => {
    await expectOperatorStillDulyMade(application, dulyMadePushedAt)
  })

  it('grants at step 2, which moves the operator to Approved', async () => {
    // RA-527: the determination is step 1; Granted needs step 2.
    // `confirmApplicantContact` asserts the state id it lands on.
    await confirmApplicantContact(workItemId)
    await detail.assertState('Granted')
    await detail.assertAssignedTo(CALLER)
    await waitForOperatorApplicationStatus(application, 'Approved')
  })

  it('records "Assessment started" in the history, and no Payment received', async () => {
    await detail.gotoAudit()
    const actions = await detail.appliedActionNames()
    expect(actions).toContain('Assessment started')
    expect(actions).not.toContain('Payment received')
    // RA-527 follow-up: the start lands on `assessment-started`.
    expect(await detail.appliedTransitions()).toContain(
      'duly-made → assessment-started'
    )
  })
})

describe('RA-595 Make Determination from a Duly made case held by a colleague', () => {
  let workItemId
  let application
  let dulyMadePushedAt

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await dulyMake(workItemId)
    dulyMadePushedAt = (
      await waitForOperatorApplicationStatus(application, 'DulyMade')
    ).caseManagementStatusUpdatedAt
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-2')
  })

  after(async () => {
    await login.logout()
  })

  it('offers Make Determination on the colleague-held Duly made case', async () => {
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo('Stub Caseworker Two')
    expect(await detail.hasLogDecisionCta()).toBe(true)
  })

  it('submitting Refused starts assessment and records step 1, leaving the colleague assigned', async () => {
    await logDecision(workItemId, 'refused')
    // RA-527: step 1 of a refusal (`logDecision` asserts the state id), also
    // tagged "Refused". The final Refused needs step 2.
    await detail.assertState('Refused')
    // Submitting a determination must not silently take over their case.
    await detail.assertAssignedTo('Stub Caseworker Two')
  })

  it('leaves the operator on Duly made after step 1 (RA-527 follow-up)', async () => {
    await expectOperatorStillDulyMade(application, dulyMadePushedAt)
  })

  it('refuses at step 2, which moves the operator to Rejected', async () => {
    await confirmApplicantContact(workItemId)
    await detail.assertState('Refused')
    await detail.assertAssignedTo('Stub Caseworker Two')
    await waitForOperatorApplicationStatus(application, 'Rejected')
  })

  it('records "Assessment started" in the history', async () => {
    await detail.gotoAudit()
    const actions = await detail.appliedActionNames()
    expect(actions).toContain('Assessment started')
  })
})
