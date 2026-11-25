import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import changeValidFrom from '../page-objects/change-valid-from.page.js'
import {
  confirmApplicantContact,
  dulyMake,
  logDecision
} from '../support/standard-lifecycle-journey.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  ROTTERDAM,
  describeIfMonorepoMongo,
  findInYearChangeAccreditation,
  getChangeRequestItem,
  resetInYearChangeOrganisation,
  submitAddOverseasSiteChangeRequest,
  waitForChangeRequestItemStatus
} from '../support/operator-change-requests.js'

const TYPE_ID = 'add-overseas-site'
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

const pad = (n) => String(n).padStart(2, '0')

/** `{ day, month, year }` as `YYYY-MM-DD`. */
const isoDate = ({ day, month, year }) => `${year}-${pad(month)}-${pad(day)}`

/** `{ day, month, year }` as the Change page and audit log write it. */
const slashDate = ({ day, month, year }) => `${pad(day)}/${pad(month)}/${year}`

/** `{ day, month, year }` as the Application summary writes it: `15 Jun 2026`. */
const summaryDate = ({ day, month, year }) =>
  `${pad(day)} ${MONTHS[month - 1]} ${year}`

const REASON_LINES = [
  'Typed the wrong month.',
  'Corrected after escalation to the team leader.'
]

/** The Application summary's "Valid from date" row value. */
async function summaryValidFrom() {
  return (
    await $('[data-testid="app-detail-value-valid-from"]').getText()
  ).trim()
}

/** The text of the first `action` audit entry, with its details expanded. */
async function auditEntryText(action) {
  await detail.expandAllAuditEntryDetails()
  const [entry] = await detail.auditEntriesForAction(action)
  expect(entry).toBeDefined()
  return entry.getText()
}

/** The link is the first one in the assignment panel, above Reassign. */
async function linkLeadsThePanel() {
  return $(
    '.app-case-panel__links li:first-child [data-testid="change-valid-from-link"]'
  ).isExisting()
}

/**
 * RA-795 / RA-800. An approved add-ORS determination awaiting applicant
 * contact can have its valid from date corrected, with a mandatory reason.
 * The correction replaces the date on the Application summary, changes
 * neither the status nor the due date, and is recorded in Application
 * history. Once contact is confirmed the date is pushed to the operator and
 * the link goes.
 *
 * Submitted straight to management-be for the page, validation and audit
 * checks; the closing journey (contact confirmed, link gone, the operator's
 * item carries the corrected date) needs the operator backend and so runs
 * against the monorepo's root stack only.
 */
describe('RA-800 add-ORS change valid from date', () => {
  let accreditationYear
  let original
  let corrected
  let change
  let refusal
  let dueOnBefore

  before(async () => {
    const submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA800 Add ORS Change Valid From Ltd',
      siteCount: 2
    })
    ;[change, refusal] = submission.workItems
    accreditationYear = submission.payload.accreditationYear
    original = { day: 15, month: 6, year: accreditationYear }
    corrected = { day: 20, month: 7, year: accreditationYear }

    await login.login()
    await dulyMake(change.id)
    await dulyMake(refusal.id)
    await logDecision(change.id, 'approved', {
      note: 'RA-800 site meets the conditions',
      effectiveDate: original
    })
    await logDecision(refusal.id, 'refused')
  })

  after(async () => {
    await login.logout()
  })

  describe('the link', () => {
    it('is offered first in the assignment panel while the approval awaits contact', async () => {
      await workItems.openWorkItem(change.id)
      await detail.assertStateId('approved-pending-contact')
      expect(await changeValidFrom.hasLink()).toBe(true)
      expect((await changeValidFrom.link().getText()).trim()).toBe(
        'Change valid from date'
      )
      expect(await linkLeadsThePanel()).toBe(true)
    })

    it('shows the valid from date set at determination on the summary', async () => {
      expect(await summaryValidFrom()).toBe(summaryDate(original))
      dueOnBefore = (await detail.caseHeaderFieldText('dueOn')).trim()
    })

    it('is absent on a refusal, which has no valid from date', async () => {
      await workItems.openWorkItem(refusal.id)
      await detail.assertStateId('rejected-pending-contact')
      expect(await changeValidFrom.hasLink()).toBe(false)
    })

    it('refuses the Change page for a refusal', async () => {
      await changeValidFrom.gotoFor(refusal.id, TYPE_ID)
      await changeValidFrom.waitForDetailUrl(refusal.id)
      await detail.assertStateId('rejected-pending-contact')
    })
  })

  describe('the Change page', () => {
    it('shows the current valid from date and an empty form', async () => {
      await workItems.openWorkItem(change.id)
      await changeValidFrom.clickLink()
      await changeValidFrom.waitForChangeValidFromUrl(change.id, TYPE_ID)
      await changeValidFrom.assertOnPage()
      expect((await changeValidFrom.currentValidFromText()).trim()).toBe(
        `The current valid from date is ${slashDate(original)}`
      )
      expect(await changeValidFrom.readDate()).toEqual({
        day: '',
        month: '',
        year: ''
      })
      expect(await changeValidFrom.readReason()).toBe('')
    })

    it('asks for a reason, and keeps what was entered', async () => {
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setValidFromDate(corrected)
      await changeValidFrom.submit()
      await changeValidFrom.assertErrorSummary(
        'Enter a reason for the valid from date change'
      )
      expect(await changeValidFrom.readDate()).toEqual({
        day: String(corrected.day),
        month: String(corrected.month),
        year: String(corrected.year)
      })
      expect(await changeValidFrom.errorSummaryLinkHrefs()).toContain('#reason')
    })

    it('asks for a date', async () => {
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setReason('A reason')
      await changeValidFrom.submit()
      await changeValidFrom.assertErrorSummary('Enter the valid from date')
      expect(await changeValidFrom.readReason()).toBe('A reason')
    })

    it('rejects a date before 1 January of the accreditation year', async () => {
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setValidFromDate({
        day: 31,
        month: 12,
        year: accreditationYear - 1
      })
      await changeValidFrom.setReason('A reason')
      await changeValidFrom.submit()
      await changeValidFrom.assertErrorSummary(
        `Valid from date must be on or after 1 January ${accreditationYear}`
      )
    })

    it('rejects a date after 31 December of the accreditation year', async () => {
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setValidFromDate({
        day: 1,
        month: 1,
        year: accreditationYear + 1
      })
      await changeValidFrom.setReason('A reason')
      await changeValidFrom.submit()
      await changeValidFrom.assertErrorSummary(
        `Valid from date must be on or before 31 December ${accreditationYear}`
      )
    })

    it('changes nothing after the rejections, or on Cancel', async () => {
      expect((await getWorkItem(change.id)).payload.effectiveDate).toBe(
        isoDate(original)
      )
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setValidFromDate(corrected)
      await changeValidFrom.setReason('Abandoned')
      await changeValidFrom.cancel()
      await changeValidFrom.waitForDetailUrl(change.id)
      await detail.assertNoFlashBanner()
      expect((await getWorkItem(change.id)).payload.effectiveDate).toBe(
        isoDate(original)
      )
    })
  })

  describe('saving a correction', () => {
    before(async () => {
      await changeValidFrom.gotoFor(change.id, TYPE_ID)
      await changeValidFrom.setValidFromDate(corrected)
      await changeValidFrom.setReason(REASON_LINES.join('\n'))
      await changeValidFrom.submit()
      await changeValidFrom.waitForDetailUrl(change.id)
    })

    it('returns to the summary with the Updated banner', async () => {
      await detail.assertFlashBanner()
      const banner = await detail.flashBannerText()
      expect(banner).toContain('Updated')
      expect(banner).toContain(
        `Valid from date updated to ${slashDate(corrected)}. You now need to contact the applicant about the decision.`
      )
    })

    it('shows only the new valid from date', async () => {
      expect(await summaryValidFrom()).toBe(summaryDate(corrected))
      expect((await getWorkItem(change.id)).payload.effectiveDate).toBe(
        isoDate(corrected)
      )
    })

    it('leaves the status and due date unchanged, with Confirm applicant contact next', async () => {
      await detail.assertStateId('approved-pending-contact')
      expect(await detail.stateTagText()).toBe('Approved')
      expect((await detail.caseHeaderFieldText('dueOn')).trim()).toBe(
        dueOnBefore
      )
      expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
      expect(await changeValidFrom.hasLink()).toBe(true)
    })

    it('records the determination valid from date and the correction in Application history', async () => {
      await workItems.openWorkItem(change.id)
      await detail.gotoAudit()

      const determination = await auditEntryText('determination-made')
      expect(determination).toContain('Valid from date')
      expect(determination).toContain(slashDate(original))

      const correction = await auditEntryText('valid-from-changed')
      expect(correction).toContain(
        `${slashDate(original)} → ${slashDate(corrected)}`
      )
      expect(correction).toContain('Previous valid from date')
      expect(correction).toContain('New valid from date')
      expect(correction).toContain('Changed by')
      for (const line of REASON_LINES) {
        expect(correction).toContain(line)
      }
    })
  })
})

/**
 * RA-800, closing the journey. Needs the operator backend to hold the change
 * request so that contact can be confirmed (see ra-495-add-ors-operator-
 * journey.e2e.js): approved with one date, corrected, then contact confirmed,
 * after which the link is gone and the operator's item is valid from the
 * corrected date.
 */
describeIfMonorepoMongo(
  'RA-800: a corrected valid from date reaches the operator',
  () => {
    let applicationId
    let request
    let original
    let corrected
    const site = ROTTERDAM

    before(async function () {
      applicationId = await findInYearChangeAccreditation()
      if (!applicationId) {
        // Not the monorepo's root stack: no seeded in-year change accreditation.
        this.skip()
      }
      await resetInYearChangeOrganisation({ siteId: site.siteId })
      await login.login()

      request = await submitAddOverseasSiteChangeRequest({
        applicationId,
        site
      })
      await dulyMake(request.id)
      await waitForChangeRequestItemStatus(request, 'DulyMade')
      const { payload } = await getWorkItem(request.id)
      original = { day: 15, month: 6, year: payload.accreditationYear }
      corrected = { day: 20, month: 7, year: payload.accreditationYear }
      await logDecision(request.id, 'approved', { effectiveDate: original })
    })

    after(async () => {
      if (applicationId) {
        await resetInYearChangeOrganisation({ siteId: site.siteId })
        await login.logout()
      }
    })

    it('corrects the date while awaiting contact', async () => {
      await workItems.openWorkItem(request.id)
      await changeValidFrom.clickLink()
      await changeValidFrom.assertOnPage()
      await changeValidFrom.setValidFromDate(corrected)
      await changeValidFrom.setReason('RA-800 e2e correction')
      await changeValidFrom.submit()
      await changeValidFrom.waitForDetailUrl(request.id)
      expect(await summaryValidFrom()).toBe(summaryDate(corrected))
    })

    it('confirming applicant contact grants it and removes the link', async () => {
      await confirmApplicantContact(request.id)
      await detail.assertState('Granted')
      expect(await changeValidFrom.hasLink()).toBe(false)
      expect(await summaryValidFrom()).toBe(summaryDate(corrected))
    })

    it('refuses the Change page once granted', async () => {
      await changeValidFrom.gotoFor(request.id, TYPE_ID)
      await changeValidFrom.waitForDetailUrl(request.id)
      await detail.assertStateId('approved')
      expect((await getWorkItem(request.id)).payload.effectiveDate).toBe(
        isoDate(corrected)
      )
    })

    it('the operator item is Approved from the corrected date', async () => {
      const { item, site: ors } = await getChangeRequestItem(request)
      expect(item.status).toBe('Approved')
      expect(new Date(item.validFrom).toISOString()).toBe(
        `${isoDate(corrected)}T00:00:00.000Z`
      )
      expect(ors.accreditationStatus).toBe('Accredited')
    })
  }
)
