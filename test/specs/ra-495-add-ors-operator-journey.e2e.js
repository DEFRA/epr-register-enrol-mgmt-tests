import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision
} from '../support/standard-lifecycle-journey.js'
import {
  expectStatus,
  isCaseManagementPushEnabled
} from '../support/backend-api.js'
import { getWorkItem } from '../support/decision-api.js'
import { pushChangeRequestConfirmContactStatusAsCaseManagement } from '../support/operator-backend-api.js'
import {
  ROTTERDAM,
  findInYearChangeAccreditation,
  getChangeRequestItem,
  describeIfMonorepoMongo,
  itemStatusWatermark,
  resetInYearChangeOrganisation,
  submitAddOverseasSiteChangeRequest,
  waitForChangeRequestItemStatus
} from '../support/operator-change-requests.js'

const TYPE_ID = 'add-overseas-site'

// AC6: the grant's effective date, 10 days after today (the submission date),
// so the operator side cannot be granting from the submission date instead.
const EFFECTIVE_DATE = new Date(
  Date.parse(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date()
    )
  ) +
    10 * 86400000
)
  .toISOString()
  .slice(0, 10)
const [effectiveYear, effectiveMonth, effectiveDay] = EFFECTIVE_DATE.split('-')

/** A closed case: the Outcome panel, no actions, no assignment controls. */
async function assertClosed(label) {
  await detail.assertReadOnlyOutcomePanel(label)
  expect(await detail.hasConfirmApplicantContactCta()).toBe(false)
  expect(await detail.hasLogDecisionCta()).toBe(false)
  expect(await detail.hasDulyMakeCta()).toBe(false)
  expect(await detail.hasPendingContactBanner()).toBe(false)
  await detail.assertNoUsableAssignmentAffordances()
}

/**
 * Duly made's post-commit push and confirm contact's decision push were
 * both sent, and nothing failed. Making the determination pushes nothing.
 */
async function assertPushesSent(workItemId) {
  await workItems.openWorkItem(workItemId)
  await detail.gotoAudit()
  await detail.assertAuditEntry('Applicant contacted')
  await detail.waitForAuditEntryCount('status-push-sent', 2)
  expect(
    (await detail.auditEntriesForAction('status-push-failed')).length
  ).toBe(0)
}

async function assertAssignRefused(workItemId, label) {
  await browser.url(`/work-items/${workItemId}/assign`)
  await detail.assertAssignRefused()
  await workItems.openWorkItem(workItemId)
  await detail.assertState(label)
}

/**
 * RA-495 task 009. An add-ORS change request submitted in the operator
 * journey, decided in case management, and applied in the operator journey:
 *
 *   refusal  duly made (pushed, so the operator's item reads Duly made),
 *            refused (not pushed: the site stays locked), then applicant
 *            contact confirmed: the case closes as Refused, the item is
 *            Rejected and the site is registered and free to request again
 *   grant    the site requested again, duly made and approved; the decision
 *            push is delivered before the caseworker confirms contact (as
 *            when management-be's write failed after it), so confirming is
 *            a retry the operator side accepts with no change: the case
 *            closes as Granted, the item is Approved from its submission
 *            date and the site is accredited
 *
 * Mirrors ra-527-confirm-contact-retry, reject-terminal-flow and ra-358
 * terminal assignment gating for re-accreditation. The fe-tests @monorepo
 * spec add-ors-case-management-decision covers the same journey through the
 * operator's own pages.
 *
 * Runs only against the monorepo's root stack with MONOREPO_MONGO_URL set
 * (see support/operator-change-requests.js); skipped anywhere else. The
 * delivered-push step needs CASE_MANAGEMENT_PUSH_ENABLED too: without it the
 * grant is confirmed the ordinary way. ORDERING IS LOAD-BEARING: each step is
 * one-way.
 */
describeIfMonorepoMongo(
  'RA-495: an add-ORS change request from the operator journey',
  () => {
    let applicationId
    const site = ROTTERDAM

    before(async function () {
      applicationId = await findInYearChangeAccreditation()
      if (!applicationId) {
        // Not the monorepo's root stack: no seeded in-year change accreditation.
        this.skip()
      }
      await resetInYearChangeOrganisation({ siteId: site.siteId })
      await login.login()
    })

    after(async () => {
      if (applicationId) {
        await resetInYearChangeOrganisation({ siteId: site.siteId })
        await login.logout()
      }
    })

    describe('refusal', () => {
      let refusal

      before(async () => {
        refusal = await submitAddOverseasSiteChangeRequest({
          applicationId,
          site
        })
      })

      it('duly making reaches the operator journey, and the site stays locked', async () => {
        await dulyMake(refusal.id)
        const { site: ors } = await waitForChangeRequestItemStatus(
          refusal,
          'DulyMade'
        )
        expect(ors.accreditationStatus).toBe('Registered')
        expect(ors.pendingRequestId).toBeTruthy()
      })

      it('the determination alone changes nothing for the operator', async () => {
        await logDecision(refusal.id, 'refused')
        const { item, site: ors } = await getChangeRequestItem(refusal)
        expect(item.status).toBe('DulyMade')
        expect(ors.pendingRequestId).toBeTruthy()
      })

      it('confirming applicant contact closes the case as Refused', async () => {
        await confirmApplicantContact(refusal.id)
        await detail.assertState('Refused')
        await detail.assertFlashBanner()
        expect(await detail.flashBannerText()).toContain('Applicant contacted')
        await assertClosed('Refused')
      })

      it('the operator item is Rejected, and the site is registered and free to request again', async () => {
        const { item, site: ors } = await getChangeRequestItem(refusal)
        expect(item.status).toBe('Rejected')
        expect(ors.accreditationStatus).toBe('Registered')
        expect(ors.pendingRequestId).toBeNull()
      })

      it('records the contact and both pushes in Application history', async () => {
        await assertPushesSent(refusal.id)
      })

      it('refuses an assign on the closed case', async () => {
        await assertAssignRefused(refusal.id, 'Refused')
      })

      it('refuses the Confirm applicant contact page once closed', async () => {
        await confirmContact.gotoFor(refusal.id, TYPE_ID)
        await confirmContact.waitForDetailUrl(refusal.id)
        await detail.assertStateId('rejected')
      })
    })

    describe('grant, confirmed after its decision push was delivered', () => {
      let grant
      let watermarkAfterFirstPush = null

      before(async () => {
        grant = await submitAddOverseasSiteChangeRequest({
          applicationId,
          site
        })
        await dulyMake(grant.id)
        await waitForChangeRequestItemStatus(grant, 'DulyMade')
        await logDecision(grant.id, 'approved', {
          effectiveDate: {
            day: String(Number(effectiveDay)),
            month: String(Number(effectiveMonth)),
            year: effectiveYear
          }
        })
      })

      it('the operator side already holds the grant while the work item awaits contact', async function () {
        if (!isCaseManagementPushEnabled()) {
          this.skip()
        }
        // Just after the operator side's watermark (duly made's push), so the
        // first push is applied and management-be's retry, stamped later by its
        // own clock, is newer still.
        const watermark = await itemStatusWatermark(grant.itemId)
        expectStatus(
          await pushChangeRequestConfirmContactStatusAsCaseManagement(
            grant.id,
            'approved',
            {
              occurredAt: new Date(watermark.getTime() + 1),
              effectiveDate: EFFECTIVE_DATE
            }
          ),
          200,
          `first confirm-contact push for ${grant.id}`
        )
        const { item, site: ors } = await getChangeRequestItem(grant)
        expect(item.status).toBe('Approved')
        expect(ors.accreditationStatus).toBe('Accredited')
        watermarkAfterFirstPush = await itemStatusWatermark(grant.itemId)

        expect((await getWorkItem(grant.id)).stateId).toBe(
          'approved-pending-contact'
        )
        await workItems.openWorkItem(grant.id)
        expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
      })

      it('confirming applicant contact completes the case as Granted', async () => {
        await confirmApplicantContact(grant.id)
        await detail.assertState('Granted')
        await detail.assertFlashBanner()
        expect(await detail.flashBannerText()).toContain('Applicant contacted')
        await assertClosed('Granted')
      })

      it('the operator item is Approved from the entered effective date, and the site is accredited', async () => {
        const { item, site: ors } = await getChangeRequestItem(grant)
        expect(item.status).toBe('Approved')
        expect(new Date(item.validFrom).toISOString()).toBe(
          `${EFFECTIVE_DATE}T00:00:00.000Z`
        )
        expect(ors.accreditationStatus).toBe('Accredited')
        expect(ors.pendingRequestId).toBeNull()
        if (watermarkAfterFirstPush) {
          // The repeat wrote nothing.
          expect(await itemStatusWatermark(grant.itemId)).toEqual(
            watermarkAfterFirstPush
          )
        }
      })

      it('records the contact and both pushes in Application history', async () => {
        await assertPushesSent(grant.id)
      })

      it('refuses an assign on the closed case', async () => {
        await assertAssignRefused(grant.id, 'Granted')
      })

      it('refuses the Confirm applicant contact page once closed', async () => {
        await confirmContact.gotoFor(grant.id, TYPE_ID)
        await confirmContact.waitForDetailUrl(grant.id)
        await detail.assertStateId('approved')
      })
    })
  }
)
