import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  driveToAssessmentStarted
} from '../support/re-accreditation-journey.js'
import { raiseQuery } from '../support/query-resubmission.js'
import {
  applyActionViaApi,
  createWorkItemViaApi
} from '../support/work-item-api.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'

/**
 * RA-000 — an application can only be queried through the query page.
 *
 * Raising a query is more than a state change. The query service assigns the
 * case to the caseworker, stamps the query's sections and reason on the work
 * item and writes the `application-queried` history entry, and the push to
 * the operator backend and the Queried email both read that stamp. The
 * generic `POST /work-items/{id}/actions/{actionId}` route used to accept the
 * `query-during-*` ids too, so a caseworker with a valid crumb could move a
 * case to Queried with none of that: the operator was sent an empty query,
 * or the previous one.
 *
 * Both tiers now refuse those ids on the generic route. management-fe rejects
 * them up front, as it does `withdraw`, and re-renders the detail page with a
 * 409 and "This action is not available.". management-be declares them
 * `CallerInvocable: false` (template v19, plus a snapshot migration for
 * existing cases) and answers its own generic endpoint with a 400 "Invalid
 * action". The browser POST below only ever reaches management-fe, which
 * never forwards these ids, so management-be's refusal is asserted with a
 * direct call from the test runner as well.
 *
 * Each case is posted from the state its id leaves, because the template
 * keys each query transition on its source state and a guard covering one
 * would not prove the others. `query-during-assessment` leaves two states
 * and is posted from both. `query-during-decision` is not covered here: its
 * source state, `awaiting-decision`, is never a resting state a browser can
 * reach (Make Determination applies `-> awaiting-decision -> <outcome>` in
 * one call, see `logDecision` in `re-accreditation-journey.js`).
 *
 * management-fe's prefix rule also covers `resume` / `resume-*`. The
 * `resume-during-*` transitions out of Queried were already
 * `CallerInvocable: false` in management-be, so their refusal there is not
 * new, but management-fe now refuses them before calling it. One is posted
 * from Queried below; all four leave `queried`, so one id exercises the same
 * guard as the others.
 *
 * The positive path, a query raised on the query page moving the case to
 * Queried, is covered end to end by `ra-291-query-application.e2e.js` (AC05)
 * and its push by `ra-606-query-push-to-operator.e2e.js`. It is repeated
 * here in each source state, on the case that has just refused the crafted
 * POST, to show the refusal leaves the real route working on that same case.
 *
 * The resume case keeps its own `describe` rather than a `CASES` row because
 * its "nothing changed" check is the inverse of theirs on three counts: a
 * queried case offers no Query link, and the real query that put it there
 * left one `application-queried` entry and one push outcome. The refusal
 * checks themselves are shared through `itIsRefused`.
 */

const NOT_AVAILABLE = 'This action is not available.'

/** Duly made -> started -> Updated, via the deadline change (RA-527). */
async function driveToAssessmentInProgress(workItemId) {
  await driveToAssessmentStarted(workItemId)
  await slaExtend.changeDeadline(workItemId, {
    reason: 'Moving the case to Updated for the query guard check',
    date: farFutureDeadline()
  })
  await detail.assertStateId('assessment-in-progress')
}

/**
 * The two refusal checks every crafted POST here must pass: management-fe's
 * 409 with its own message as the error summary's item, and management-be's
 * 400 to the same id posted to it directly. `getWorkItemId` is read when the
 * `it` runs, after the caller's `before` has created the case.
 */
function itIsRefused(actionId, getWorkItemId) {
  it('is refused with the not-available message', async () => {
    const { status, errorSummaryItems } = await detail.postFromPage(
      `/work-items/${getWorkItemId()}/actions/${actionId}`
    )

    expect(status).toBe(409)
    // An exact item, not a substring of the summary's text. `toContain`
    // rather than `toEqual` because the page renders a second, unrelated
    // summary item whenever the case carries an unresolved
    // `notification-failed` entry.
    expect(errorSummaryItems).toContain(NOT_AVAILABLE)
  })

  it('is refused by management-be when called directly', async () => {
    const { status, body } = await applyActionViaApi(getWorkItemId(), actionId)

    expect(status).toBe(400)
    expect(body?.title).toBe('Invalid action')
    expect(body?.detail).toBe(
      `Action '${actionId}' is not declared by work item type 're-accreditation'.`
    )
  })
}

const CASES = [
  {
    stateId: 'submitted',
    actionId: 'query-during-duly-making',
    drive: async () => {}
  },
  {
    stateId: 'duly-made',
    actionId: 'query-during-duly-made',
    drive: (id) => dulyMake(id)
  },
  {
    stateId: 'assessment-started',
    actionId: 'query-during-assessment',
    drive: (id) => driveToAssessmentStarted(id)
  },
  {
    stateId: 'assessment-in-progress',
    actionId: 'query-during-assessment',
    drive: (id) => driveToAssessmentInProgress(id)
  }
]

describe('RA-000 query only through the query service', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  for (const { stateId, actionId, drive } of CASES) {
    describe(`a crafted POST to ${actionId} from ${stateId}`, () => {
      let workItemId

      before(async () => {
        workItemId = (
          await createWorkItemViaApi({
            organisationNamePrefix: `RA-000 Crafted Query ${stateId}`
          })
        ).id
        await drive(workItemId)
        await workItems.openWorkItem(workItemId)
        await detail.assertStateId(stateId)
      })

      itIsRefused(actionId, () => workItemId)

      it('leaves the case where it was after both, with no query recorded', async () => {
        await workItems.openWorkItem(workItemId)
        await detail.assertStateId(stateId)
        // Positive control: the case still offers the real Query link, so
        // the state check above is not passing on a page that lost its
        // actions panel.
        expect(await detail.countActionsWithId('query')).toBe(1)

        await detail.gotoAudit()
        expect(
          (await detail.auditEntriesForAction('application-queried')).length
        ).toBe(0)
        expect((await detail.auditEntriesForAction(actionId)).length).toBe(0)
        expect(
          (await detail.auditEntriesForAction('query-push-sent')).length
        ).toBe(0)
        expect(
          (await detail.auditEntriesForAction('query-push-failed')).length
        ).toBe(0)
      })

      it('still queries the case through the query page', async () => {
        await raiseQuery(workItemId)
        await detail.assertStateId('queried')

        await detail.gotoAudit()
        const queried = await detail.waitForAuditEntryCount(
          'application-queried',
          1
        )
        expect(queried.length).toBe(1)
      })
    })
  }

  describe('a crafted POST to resume-during-duly-made from queried', () => {
    const actionId = 'resume-during-duly-made'
    let workItemId

    before(async () => {
      workItemId = (
        await createWorkItemViaApi({
          organisationNamePrefix: 'RA-000 Crafted Resume'
        })
      ).id
      await dulyMake(workItemId)
      await raiseQuery(workItemId)
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('queried')
    })

    itIsRefused(actionId, () => workItemId)

    it('leaves the case queried after both, with no resume recorded', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('queried')

      await detail.gotoAudit()
      // Positive control: the history does carry the query that put the
      // case here, so the zero below is not read off an empty log.
      expect(
        (await detail.auditEntriesForAction('application-queried')).length
      ).toBe(1)
      expect((await detail.auditEntriesForAction(actionId)).length).toBe(0)
    })
  })
})
