import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision,
  startAssessment
} from '../support/standard-lifecycle-journey.js'
import { getWorkItem } from '../support/decision-api.js'
import { describeIfMonorepoMongo } from '../support/operator-journey-store.js'
import {
  statusPushes,
  waitForStatusPushes
} from '../support/status-push-audit.js'
import { UPDATE_ORS_TYPE_ID } from '../support/update-overseas-site-api.js'
import {
  GDANSK,
  PORTO,
  findInYearUpdateAccreditation,
  getOrsUpdateItem,
  resetInYearUpdateOrganisation,
  submitOrsUpdateChangeRequest,
  waitForOrsUpdateItemStatus
} from '../support/operator-ors-updates.js'

const NEW_NAME = 'Gdansk Recycling Centre'
const NEW_TOWN = 'Vila Nova de Gaia'

// How long a step that should push nothing is watched for a push.
const NO_PUSH_WATCH_MS = 5000

/**
 * RA-782. An ORS update submitted in the operator journey, decided in Case
 * Management, and applied in the operator journey (org 50025, see
 * support/operator-ors-updates.js):
 *
 *   grant    ORS 001 renamed: duly made with no payment date (pushed, so
 *            the operator's item reads Duly made), approved with no valid
 *            from date (not pushed: the ORS keeps its name), then applicant
 *            contact confirmed: the case closes as Granted, the item is
 *            Approved and the ORS has its new name
 *   refusal  ORS 002's town changed: duly made, refused and applicant
 *            contact confirmed: the case closes as Refused, the item is
 *            Rejected and the ORS is unchanged and free to change again
 *
 * The fe-tests @monorepo spec review-ors-update covers the same journey
 * through the operator's own pages.
 *
 * Runs only against the monorepo's root stack with MONOREPO_MONGO_URL set;
 * skipped anywhere else. ORDERING IS LOAD-BEARING: each step is one-way.
 */
describeIfMonorepoMongo(
  'RA-782: an ORS update from the operator journey, granted and refused',
  () => {
    let applicationId

    async function reset() {
      await resetInYearUpdateOrganisation({
        applicationId,
        sites: [GDANSK, PORTO]
      })
    }

    before(async function () {
      applicationId = await findInYearUpdateAccreditation()
      if (!applicationId) {
        // Not the monorepo's root stack: no seeded in-year update accreditation.
        this.skip()
      }
      await reset()
      await login.login()
    })

    after(async () => {
      if (applicationId) {
        await reset()
        await login.logout()
      }
    })

    describe('grant', () => {
      let update

      before(async () => {
        update = await submitOrsUpdateChangeRequest({
          applicationId,
          site: GDANSK,
          details: { siteName: NEW_NAME }
        })
      })

      it('raises an ORS update work item showing the change', async () => {
        const workItem = await getWorkItem(update.id)
        expect(workItem.typeId).toBe(UPDATE_ORS_TYPE_ID)
        expect(workItem.payload.applicationReference).toBe(update.reference)

        await workItems.openWorkItem(update.id)
        await expect(detail.updateOverseasSiteDetail()).toExist()
        expect(await detail.updateOrsRow('site-name')).toEqual({
          changed: 'true',
          current: GDANSK.siteName,
          requested: NEW_NAME,
          tagged: true
        })
      })

      it('duly making, with no payment date, reaches the operator journey', async () => {
        await dulyMake(update.id, { paymentDate: false })
        const { site } = await waitForOrsUpdateItemStatus(update, 'DulyMade')
        expect(site.pendingRequestId).toEqual(expect.any(String))
        expect(site.site.siteName).toBe(GDANSK.siteName)
      })

      it('approving, with no valid from date, is not pushed: the ORS keeps its name', async () => {
        // Only the duly made push, which the operator journey applied.
        const [dulyMade] = await waitForStatusPushes(update.id, 1)
        expect(dulyMade.action).toBe('status-push-sent')
        await startAssessment(update.id)
        await logDecision(update.id, 'approved')

        // A push runs in the background after the response, so check that
        // none follows the decision for a while rather than read once.
        let pushes
        const watchUntil = Date.now() + NO_PUSH_WATCH_MS
        await browser.waitUntil(
          async () => {
            pushes = await statusPushes(update.id)
            return pushes.length > 1 || Date.now() >= watchUntil
          },
          { timeout: NO_PUSH_WATCH_MS * 4, interval: 500 }
        )
        expect(pushes.map((entry) => entry.details.actionId)).toEqual([
          'duly-make'
        ])
        const { item, site } = await getOrsUpdateItem(update)
        expect(item.status).toBe('DulyMade')
        expect(site.site.siteName).toBe(GDANSK.siteName)
      })

      it('confirming contact grants it: the item is Approved and the ORS renamed', async () => {
        await confirmApplicantContact(update.id)
        await workItems.openWorkItem(update.id)
        await detail.assertReadOnlyOutcomePanel('Granted')

        const { item, site } = await getOrsUpdateItem(update)
        expect(item.status).toBe('Approved')
        expect(site.accreditationStatus).toBe('Accredited')
        expect(site.pendingRequestId).toBeNull()
        expect(site.site.siteName).toBe(NEW_NAME)
      })
    })

    describe('refusal', () => {
      let update

      before(async () => {
        update = await submitOrsUpdateChangeRequest({
          applicationId,
          site: PORTO,
          details: { townOrCity: NEW_TOWN }
        })
      })

      it('duly making reaches the operator journey', async () => {
        await dulyMake(update.id, { paymentDate: false })
        await waitForOrsUpdateItemStatus(update, 'DulyMade')
      })

      it('confirming contact on a refusal: the item is Rejected and the ORS unchanged', async () => {
        await startAssessment(update.id)
        await logDecision(update.id, 'refused')
        await confirmApplicantContact(update.id)
        await workItems.openWorkItem(update.id)
        await detail.assertReadOnlyOutcomePanel('Refused')

        const { item, site } = await getOrsUpdateItem(update)
        expect(item.status).toBe('Rejected')
        expect(site.accreditationStatus).toBe('Accredited')
        expect(site.pendingRequestId).toBeNull()
        expect(site.site.townOrCity).toBe(PORTO.townOrCity)
      })
    })
  }
)
