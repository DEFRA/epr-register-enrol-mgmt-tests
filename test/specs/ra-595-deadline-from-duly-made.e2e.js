import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import {
  createOperatorBackedWorkItem,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import {
  farFutureDeadline,
  farFutureDeadlineDate
} from '../support/sla-extend-date.js'

/**
 * RA-595 (task 005) — change the determination deadline straight from Duly
 * made.
 *
 * "Change determination deadline" now shows on a Duly made case whoever holds
 * it. management-be still refuses `sla-extend` from `duly-made`, so
 * management-fe's submit runs "ensure assessment started" first:
 *
 *   unassigned:      assign (caller) -> start-assessment -> sla-extend
 *   already held:                       start-assessment -> sla-extend
 *
 * RA-527 follow-up: `start-assessment` now lands on `assessment-started`
 * (still "Duly made"), and the deadline change moves the case on from there
 * to `assessment-in-progress` ("Updated"), pushing Updated to the operator.
 * A case started beforehand ("Assign to yourself and start") goes the same
 * way: the last describe below.
 *
 * Opening the deadline page changes nothing. These journeys drive the real
 * link and form, and read the outcome off the detail page and its history.
 * The exact call order, validation-before-start and the partial-failure
 * paths are pinned in management-fe's route tests
 * (`sla.duly-made.route.test.js`), where the backend can be made to fail.
 */

/** The stub login identity — see `login.page.js`. */
const CALLER = 'Stub Caseworker One'

describe('RA-595 Change determination deadline from an unassigned Duly made case', () => {
  let workItemId
  let application

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await dulyMake(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('offers Change determination deadline while unassigned in Duly made', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
    await slaExtend.assertActionLinkFor(workItemId)
  })

  it('opening the deadline page and cancelling changes nothing', async () => {
    await slaExtend.actionLink().click()
    await slaExtend.assertOnInputPage()
    await slaExtend.cancelFromInputPage()
    await slaExtend.waitForDetailUrl(workItemId)

    await detail.assertStateId('duly-made')
    await detail.assertUnassigned()
  })

  it('submitting a change assigns the caller, starts assessment and moves the deadline', async () => {
    await slaExtend.changeDeadline(workItemId, {
      reason: 'RA-595: deadline changed from Duly made',
      date: farFutureDeadline()
    })

    await detail.assertFlashBanner()
    expect(await detail.flashBannerText()).toContain(
      'Determination deadline changed'
    )
    await detail.assertStateId('assessment-in-progress')
    await detail.assertState('Updated')
    await detail.assertAssignedTo(CALLER)
    await detail.assertCaseHeaderDueOn(farFutureDeadlineDate())
  })

  it('moves the operator application to Updated', async () => {
    await waitForOperatorApplicationStatus(application, 'Updated')
  })

  it('records "Assessment started" and the deadline change in the history', async () => {
    await detail.gotoAudit()
    const actions = await detail.appliedActionNames()
    expect(actions).toContain('Assessment started')
    expect(actions).not.toContain('Payment received')
    // RA-527 follow-up: through the started ("Duly made") state, then on to
    // Updated with the deadline change.
    const transitions = await detail.appliedTransitions()
    expect(transitions).toContain('duly-made → assessment-started')
    expect(transitions).toContain('assessment-started → assessment-in-progress')
    expect(await detail.auditEntryHeadings('sla-extended')).toContain(
      'Determination deadline changed'
    )
  })
})

describe('RA-595 Change determination deadline from a Duly made case held by a colleague', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    workItemId = (await createOperatorBackedWorkItem()).id
    await dulyMake(workItemId)
    await workItems.openWorkItem(workItemId)
    await detail.assignTo('stub-caseworker-2')
  })

  after(async () => {
    await login.logout()
  })

  it('offers Change determination deadline on the colleague-held Duly made case', async () => {
    await detail.assertStateId('duly-made')
    await detail.assertAssignedTo('Stub Caseworker Two')
    await slaExtend.assertActionLinkFor(workItemId)
  })

  it('submitting a change starts assessment and leaves the colleague assigned', async () => {
    await slaExtend.changeDeadline(workItemId, {
      reason: 'RA-595: deadline changed on a colleague-held case',
      date: farFutureDeadline()
    })

    await detail.assertStateId('assessment-in-progress')
    // Changing the deadline must not silently take over their case.
    await detail.assertAssignedTo('Stub Caseworker Two')
    await detail.assertCaseHeaderDueOn(farFutureDeadlineDate())
  })
})

// RA-527 follow-up (coverage c). A case already started with "Assign to
// yourself and start" reads "Duly made" on both sides. Changing its deadline
// moves both sides to Updated.
describe('RA-527 Change determination deadline on a started case', () => {
  let workItemId
  let application

  before(async () => {
    await login.login()
    await workItems.resetFilters()
    application = await createOperatorBackedWorkItem()
    workItemId = application.id
    await dulyMake(workItemId)
    await startAssessment(workItemId)
    await waitForOperatorApplicationStatus(application, 'DulyMade')
  })

  after(async () => {
    await login.logout()
  })

  it('offers Change determination deadline on the started case', async () => {
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-started')
    await detail.assertState('Duly made')
    await slaExtend.assertActionLinkFor(workItemId)
  })

  it('changing the deadline moves the case to Updated', async () => {
    await slaExtend.changeDeadline(workItemId, {
      reason: 'RA-527: deadline changed on a started case',
      date: farFutureDeadline()
    })

    await detail.assertFlashBanner()
    expect(await detail.flashBannerText()).toContain(
      'Determination deadline changed'
    )
    await detail.assertStateId('assessment-in-progress')
    await detail.assertState('Updated')
    await detail.assertAssignedTo(CALLER)
    await detail.assertCaseHeaderDueOn(farFutureDeadlineDate())
  })

  it('moves the operator application to Updated', async () => {
    await waitForOperatorApplicationStatus(application, 'Updated')
  })

  it('records the move from the started state in the history', async () => {
    await detail.gotoAudit()
    expect(await detail.appliedTransitions()).toContain(
      'assessment-started → assessment-in-progress'
    )
    expect(await detail.auditEntryHeadings('sla-extended')).toContain(
      'Determination deadline changed'
    )
  })
})
