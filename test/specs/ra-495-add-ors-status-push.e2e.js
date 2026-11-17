import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'

const TYPE_ID = 'add-overseas-site'

/** The operator journey's change-request status route for a work item. */
const changeRequestRoute = (workItemId) =>
  `/api/v1/accreditation-changes/case-management/${workItemId}/status`

const FAILED_HISTORY_HEADING =
  'Status failed to send to the Registration & Accreditation service'

/** The work item's status-push audit entries, oldest first. */
async function statusPushes(workItemId) {
  const { auditLog } = await getWorkItem(workItemId)
  return auditLog
    .filter((entry) => entry.action.startsWith('status-push'))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
}

/**
 * Polls until the work item holds `count` status-push entries: the
 * post-commit push runs in the background, after the response.
 */
async function waitForStatusPushes(workItemId, count) {
  let pushes = []
  await browser.waitUntil(
    async () => {
      pushes = await statusPushes(workItemId)
      return pushes.length >= count
    },
    {
      timeout: 15000,
      timeoutMsg: `Expected ${count} status push entries on ${workItemId}`
    }
  )
  return pushes
}

/** One push entry: sent to the change-request route, for this transition. */
function expectChangeRequestPush(entry, workItemId, { toStateId, actionId }) {
  expect(entry.details.toStateId).toBe(toStateId)
  expect(entry.details.actionId).toBe(actionId)
  // The operator journey holds no change request for an item submitted
  // straight to case management, so the route answers 404 (not found, rather
  // than an auth or validation refusal), and the failure names the route.
  expect(entry.action).toBe('status-push-failed')
  expect(entry.details.errorMessage).toContain(`returned 404 from `)
  expect(entry.details.errorMessage).toContain(changeRequestRoute(workItemId))
}

/**
 * Confirm applicant contact in the UI when the push is expected to fail: the
 * confirm page comes back with its error banner.
 */
async function confirmContactExpectingFailure(workItemId) {
  await workItems.openWorkItem(workItemId)
  expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
  await detail.clickConfirmApplicantContact()
  await confirmContact.waitForConfirmUrl(workItemId, TYPE_ID)
  await confirmContact.tickContacted()
  await confirmContact.submit()
  await expect(confirmContact.failureBanner()).toBeDisplayed()
}

/**
 * RA-495 task 008. Case management tells the operator journey about add-ORS
 * progress on its change-request status route
 * (`POST api/v1/accreditation-changes/case-management/{workItemId}/status`),
 * never the accreditation-application route re-accreditation uses. Mirrors
 * ra-368 (status push to the operator journey) and ra-527 (confirm-contact
 * retry):
 *
 *   - Duly making is pushed after it commits, in the background.
 *   - Starting the assessment and the determination (step 1) push nothing.
 *   - Confirm applicant contact (step 2) pushes the final status first and
 *     writes nothing unless the operator journey applies it. On failure the
 *     caseworker sees an error, the case stays pending contact and the
 *     failed push is in Application history; confirming again retries.
 *
 * Path A: the items are submitted straight to management-be, so the operator
 * journey holds no change request for them and refuses every push. That is
 * the failure this spec drives. The journey where the operator journey
 * applies the push (Granted / Refused there too) starts from an operator's
 * submission in the operator journey, which also covers a successful retry:
 * ra-495-add-ors-operator-journey.e2e.js.
 *
 * ORDERING IS LOAD-BEARING: each step is one-way.
 */
describe('RA-495 add-ORS status push to the operator journey', () => {
  let approval
  let refusal

  before(async () => {
    const submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA495 Add ORS Status Push Ltd',
      siteCount: 2
    })
    ;[approval, refusal] = submission.workItems
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('pushes duly making to the change-request status route', async () => {
    await dulyMake(approval.id)

    const [pushed] = await waitForStatusPushes(approval.id, 1)
    expectChangeRequestPush(pushed, approval.id, {
      toStateId: 'duly-made',
      actionId: 'duly-make'
    })

    await workItems.openWorkItem(approval.id)
    await detail.gotoAudit()
    await detail.assertAuditEntry(FAILED_HISTORY_HEADING)
  })

  it('pushes nothing for starting the assessment or the determination', async () => {
    await startAssessment(approval.id)
    await logDecision(approval.id, 'approved')

    await workItems.openWorkItem(approval.id)
    await detail.assertStateId('approved-pending-contact')
    // Nothing is queued for either step, so nothing can arrive later.
    expect(await statusPushes(approval.id)).toHaveLength(1)
  })

  describe('confirm applicant contact', () => {
    before(async () => {
      await confirmContactExpectingFailure(approval.id)
    })

    it('shows an error and changes nothing when the operator journey refuses the push', async () => {
      await expect(confirmContact.failureBanner()).toHaveText(
        expect.stringContaining(
          'There was a problem confirming applicant contact. Nothing has been changed. Try again.'
        )
      )

      const workItem = await getWorkItem(approval.id)
      expect(workItem.stateId).toBe('approved-pending-contact')
      expect(
        workItem.auditLog.some(
          (entry) => entry.action === 'applicant-contacted'
        )
      ).toBe(false)
    })

    it('records the failed push of the grant in Application history', async () => {
      const pushes = await statusPushes(approval.id)
      expect(pushes).toHaveLength(2)
      expectChangeRequestPush(pushes[1], approval.id, {
        toStateId: 'approved',
        actionId: 'confirm-contact-approved'
      })

      await workItems.openWorkItem(approval.id)
      await detail.gotoAudit()
      await detail.waitForAuditEntryCount('status-push-failed', 2)
    })

    it('can be retried: confirming again pushes again and still changes nothing', async () => {
      await confirmContactExpectingFailure(approval.id)

      const pushes = await statusPushes(approval.id)
      expect(pushes).toHaveLength(3)
      expectChangeRequestPush(pushes[2], approval.id, {
        toStateId: 'approved',
        actionId: 'confirm-contact-approved'
      })
      expect((await getWorkItem(approval.id)).stateId).toBe(
        'approved-pending-contact'
      )
    })
  })

  it('pushes a refusal at confirm contact, not at the determination', async () => {
    await dulyMake(refusal.id)
    await waitForStatusPushes(refusal.id, 1)
    await startAssessment(refusal.id)
    await logDecision(refusal.id, 'refused')
    expect(await statusPushes(refusal.id)).toHaveLength(1)

    await confirmContactExpectingFailure(refusal.id)

    const pushes = await statusPushes(refusal.id)
    expect(pushes).toHaveLength(2)
    expectChangeRequestPush(pushes[1], refusal.id, {
      toStateId: 'rejected',
      actionId: 'confirm-contact-rejected'
    })
    expect((await getWorkItem(refusal.id)).stateId).toBe(
      'rejected-pending-contact'
    )
  })
})
