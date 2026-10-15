import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import {
  armDecisionFailure,
  clearDecisionFailure
} from '../support/operator-backend-stub.js'
import { describeOnComposeStack } from '../support/compose-stack.js'

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
 * The operator backend is the compose stack's stand-in
 * (docker/stubs/operator-backend-stub.mjs): it answers 200 by default, and a
 * work item id armed through the control plane gets a 500 on its next push.
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

// The push retries a failing operator backend before giving up, so the failed
// outcome is recorded some seconds after the query itself.
const PUSH_RETRY_BUDGET_MS = 60_000

describeOnComposeStack('RA-606 query push to the operator backend', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('when the operator backend accepts the push', () => {
    let workItemId

    before(async () => {
      workItemId = await createReAccreditation('Query Push Sent')
      await dulyMake(workItemId)
    })

    it('queries the application and records that the query was pushed', async () => {
      await raiseQueryThroughTheUi(workItemId)

      await openAudit(workItemId)
      const sent = await detail.waitForAuditEntryCount('query-push-sent', 1)
      expect(sent.length).toBe(1)
      expect(
        (await detail.auditEntriesForAction('query-push-failed')).length
      ).toBe(0)
    })
  })

  describe('when the operator backend refuses the push', () => {
    let workItemId

    before(async () => {
      workItemId = await createReAccreditation('Query Push Failed')
      await dulyMake(workItemId)
      await armDecisionFailure(workItemId)
    })

    after(async () => {
      await clearDecisionFailure(workItemId)
    })

    it('still queries the application, and records that the push failed', async () => {
      await raiseQueryThroughTheUi(workItemId)

      await openAudit(workItemId)
      const failed = await detail.waitForAuditEntryCount(
        'query-push-failed',
        1,
        {
          timeout: PUSH_RETRY_BUDGET_MS
        }
      )
      expect(failed.length).toBe(1)
      expect(
        (await detail.auditEntriesForAction('query-push-sent')).length
      ).toBe(0)
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
    })
  })
})
