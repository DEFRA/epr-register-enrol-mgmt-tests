import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import { dulyMake } from '../support/re-accreditation-journey.js'
import { createWorkItemViaApi } from '../support/work-item-api.js'
import {
  createOperatorBackedWorkItem,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'

/**
 * RA-606 — a query must reach the operator backend however the request goes.
 *
 * Raising a query moves the work item to `queried` and then, in the same
 * request, pushes the query to the operator backend so the operator's own
 * record says the same. On ext-test the push was lost: the request was
 * cancelled while the slow email ahead of it was still running, so the work
 * item was `queried` here and `Duly made` there.
 *
 * The push now runs ahead of the email and is no longer cancelled by the
 * caller. The audit log records the outcome of the push as `query-push-sent`
 * or `query-push-failed`, and in both cases the query itself stands.
 *
 * Both outcomes come from the real Registration & Accreditation (operator)
 * backend, with no stand-in:
 *
 *   - ACCEPTED: the item is created through that backend (Path B,
 *     `createOperatorBackedWorkItem`), so it knows the work item id and takes
 *     the query. Its own copy of the application then reads `Queried`.
 *   - REFUSED: the item is created in case management only (Path A,
 *     `createWorkItemViaApi`). The operator backend has never seen that work
 *     item id and answers 404. management-be treats any non-2xx as a failed
 *     push, retrying only a 5xx, so it records `query-push-failed` and keeps
 *     the query.
 */

const raiseQueryThroughTheUi = async (workItemId) => {
  await query.gotoFor(workItemId)
  await query.selectSection('business-plan')
  await query.fillReason('Please confirm the figures.')
  await query.submit()
  await query.waitForDetailUrl(workItemId)
  await detail.assertState('Queried')
}

const openAudit = async (workItemId) => {
  await workItems.openWorkItem(workItemId)
  await detail.gotoAudit()
}

describe('RA-606 query push to the operator backend', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('when the operator backend accepts the push', () => {
    let application
    let dulyMadeAt

    before(async () => {
      application = await createOperatorBackedWorkItem()
      await dulyMake(application.id)
      // The duly-made status push runs on a background queue. Wait for it to
      // land before querying, so it cannot arrive after the query and so the
      // query's own watermark has a value to move on from.
      dulyMadeAt = (
        await waitForOperatorApplicationStatus(application, 'DulyMade')
      ).caseManagementStatusUpdatedAt
    })

    it('queries the application and records that the query was pushed', async () => {
      await raiseQueryThroughTheUi(application.id)

      await openAudit(application.id)
      const sent = await detail.waitForAuditEntryCount('query-push-sent', 1)
      expect(sent.length).toBe(1)
      expect(
        (await detail.auditEntriesForAction('query-push-failed')).length
      ).toBe(0)
    })

    it("moves the operator backend's application to Queried", async () => {
      const queried = await waitForOperatorApplicationStatus(
        application,
        'Queried'
      )
      expect(Date.parse(queried.caseManagementStatusUpdatedAt)).toBeGreaterThan(
        Date.parse(dulyMadeAt)
      )
    })
  })

  describe('when the operator backend refuses the push', () => {
    let workItemId

    before(async () => {
      workItemId = (
        await createWorkItemViaApi({
          organisationNamePrefix: 'RA-606 Query Push Refused'
        })
      ).id
      await dulyMake(workItemId)
    })

    it('still queries the application, and records that the push failed', async () => {
      await raiseQueryThroughTheUi(workItemId)

      await openAudit(workItemId)
      const failed = await detail.waitForAuditEntryCount('query-push-failed', 1)
      expect(failed.length).toBe(1)
      expect(
        (await detail.auditEntriesForAction('query-push-sent')).length
      ).toBe(0)
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
    })
  })
})
