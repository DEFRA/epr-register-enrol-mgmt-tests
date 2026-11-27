import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import dulyMaking from '../page-objects/duly-making.page.js'
import decision from '../page-objects/decision.page.js'
import confirmContact from '../page-objects/confirm-contact.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import { getWorkItem } from '../support/decision-api.js'
import { statusPushes } from '../support/status-push-audit.js'
import { ADD_ORS_SUBMITTED_BY } from '../support/in-year-change-api.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/standard-lifecycle-journey.js'
import {
  UPDATE_ORS_TYPE_ID as TYPE_ID,
  submitOrsUpdateRequest
} from '../support/update-overseas-site-api.js'
import { formatUkHeaderDate } from '../support/uk-time.js'

const EM_DASH = '—'

// What an ORS update shows for its charge and payment date: it is never paid
// for (RA-782 AC4(a)). A hyphen, as on the Duly make page.
const NO_PAYMENT = '-'

const TAB_KEYS = [
  'application-summary',
  'accreditation-summary',
  'related-requests',
  'application-history'
]

/**
 * RA-782 / RA-767. An ORS update in Case Management: an operator request
 * holding one add-ORS site and two ORS updates, posted straight to
 * management-be in one POST as the operator backend sends it (see
 * support/update-overseas-site-api.js).
 *
 *   list      all three cards share one SUB reference, "(3 requests)"; an
 *             update's card reads "Update ORS Accreditation"
 *   header    the site name and ORS id as the title, the application
 *             reference as the caption, the location, and no charge or
 *             payment date: an update is never paid for
 *   tabs      the four in-year change tabs; Related change requests lists
 *             the add and both updates
 *   summary   each detail's current version against the requested change,
 *             only the changed ones marked; the interim sites changed,
 *             removed and added; the BES file the update adds, marked new
 *   assign    assign it to yourself, then someone else, then unassign it
 *   duly make no payment date to enter; then change the due date
 *   decide    approve one update with no valid from date to enter, refuse
 *             the other (the determination date it is valid from goes only
 *             on the confirm contact push: see the operator-journey spec)
 *   history   each of those actions is in the Application history
 *
 * Confirming applicant contact pushes the decision to the operator journey
 * first. It holds no change request for an item posted straight to
 * management-be, so here the push fails with its 404 and the item stays
 * pending contact, on approval and on refusal alike (as
 * ra-495-add-ors-status-push shows for add-ORS); the granted and refused
 * journeys, and their "Applicant contacted" history entries, start from the
 * operator journey: ra-782-update-ors-operator-journey.e2e.js.
 *
 * ORDERING IS LOAD-BEARING: each step is one-way.
 */
describe('RA-782 / RA-767 an ORS update reviewed in Case Management', () => {
  let request
  let approval
  let refusal
  let dateAdded

  before(async () => {
    request = await submitOrsUpdateRequest({
      organisationNamePrefix: 'RA782 Update ORS Ltd',
      updateCount: 2
    })
    ;[approval, refusal] = request.updates
    dateAdded = formatUkHeaderDate(new Date())
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('RA-767: gives the whole request one SUB reference, sized for all three', async () => {
    expect(request.submissionReference).toMatch(/^SUB-\d{4}-\d{4,}$/)
    expect(request.workItems).toHaveLength(3)
    for (const { workItem } of [request.add, ...request.updates]) {
      const { typeId, payload } = await getWorkItem(workItem.id)
      expect(payload.submissionReference).toBe(request.submissionReference)
      expect(payload.submissionSize).toBe(3)
      expect(payload.operatorRequestId).toBe(request.payload.operatorRequestId)
      expect(typeId).toBe(
        workItem === request.add.workItem ? 'add-overseas-site' : TYPE_ID
      )
    }
  })

  describe('the Applications list', () => {
    before(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrgName(request.organisationName)
    })

    it('lists the add and both updates under one SUB reference', async () => {
      expect(await workItems.getTileCount()).toBe(3)
      for (const { workItem } of [request.add, ...request.updates]) {
        await expect(
          workItems.tileField(workItem.id, 'submission-reference')
        ).toHaveText(`${request.submissionReference} (3 requests)`)
      }
    })

    it('shows an update as "Update ORS Accreditation", with its site', async () => {
      const { site, workItem } = approval
      await expect(workItems.workItemLink(workItem.id)).toHaveText(
        workItem.applicationReference
      )
      await expect(
        workItems.tileField(workItem.id, 'application-site')
      ).toHaveText(`${site.siteName} (${site.orsId})`)
      await expect(workItems.tileField(workItem.id, 'request-type')).toHaveText(
        'Request type: Update ORS Accreditation'
      )
      await expect(
        workItems.tileField(request.add.workItem.id, 'request-type')
      ).toHaveText('Request type: New ORS accreditation')
    })
  })

  describe('the update’s header and tabs', () => {
    before(async () => {
      await workItems.openWorkItem(approval.workItem.id)
    })

    it('titles the header with the site and its reference, shows the location, and no charge or payment date', async () => {
      const { site, workItem } = approval
      await expect(detail.updateOverseasSiteDetail()).toExist()
      await expect(detail.caseHeaderFieldByKey('title')).toHaveText(
        `${site.siteName} (${site.orsId})`
      )
      await expect(detail.caseHeaderFieldByKey('caption')).toHaveText(
        workItem.applicationReference
      )
      await expect(detail.caseHeaderFieldByKey('accreditation-ref')).toHaveText(
        workItem.applicationReference
      )
      await expect(detail.caseHeaderFieldByKey('location')).toHaveText(
        expect.stringContaining(site.addressLine1)
      )
      await expect(detail.caseHeaderFieldByKey('location')).toHaveText(
        expect.stringContaining(site.country)
      )
      await expect(detail.caseHeaderFieldByKey('charge')).toHaveText(NO_PAYMENT)
      await expect(detail.caseHeaderFieldByKey('payment-date')).toHaveText(
        NO_PAYMENT
      )
      expect(await detail.caseHeaderMeta()).toEqual([
        'Application type: Update ORS Accreditation',
        'Status: Not started',
        'Assigned to: Unassigned',
        `Due date: ${EM_DASH}`,
        `Accreditation number: ${request.payload.accreditationReference}`,
        expect.stringMatching(/^Location: .+/),
        'Material: Plastic',
        `Charge: ${NO_PAYMENT}`,
        `Payment date: ${NO_PAYMENT}`,
        `Submitted by: ${ADD_ORS_SUBMITTED_BY.fullName}`,
        `Submitted on: ${dateAdded}`
      ])
    })

    it('shows the four tabs, Related change requests counting all three', async () => {
      expect(await detail.caseTabKeys()).toEqual(TAB_KEYS)
      expect(await detail.isActiveTab('summary')).toBe(true)
      await expect(detail.tab('relatedRequests')).toHaveText(
        'Related change requests (3)'
      )
    })

    it('lists the add and both updates as related change requests', async () => {
      await detail.gotoRelatedRequests()
      const rows = await detail.relatedRequestsRows()
      expect(rows.map((row) => row.reference).sort()).toEqual(
        [request.add, ...request.updates]
          .map(({ workItem }) => workItem.applicationReference)
          .sort()
      )
      const row = rows.find(
        (r) => r.reference === approval.workItem.applicationReference
      )
      expect(row).toEqual(
        expect.objectContaining({
          site: `${approval.site.siteName} (${approval.site.orsId})`,
          type: 'Update ORS Accreditation',
          status: 'Not started'
        })
      )
    })
  })

  describe('the update’s Application summary', () => {
    before(async () => {
      await workItems.openWorkItem(approval.workItem.id)
    })

    it('says which ORS the operator wants to change', async () => {
      await expect(detail.updateOrsIntro()).toHaveText(
        `The operator wants to change the details of ORS ${approval.site.orsId}, which is on their ${request.payload.accreditationYear} accreditation. Each changed detail is marked.`
      )
    })

    it('marks the changed name, current version against requested change', async () => {
      expect(await detail.updateOrsRow('site-name')).toEqual({
        changed: 'true',
        current: approval.site.siteName,
        requested: approval.site.proposed.siteName,
        tagged: true
      })
    })

    it('leaves the unchanged details unmarked, the same on both sides', async () => {
      for (const key of ['contact-name', 'location', 'recycling-operation']) {
        const row = await detail.updateOrsRow(key)
        expect(row.changed).toBe('false')
        expect(row.tagged).toBe(false)
        expect(row.requested).toBe(row.current)
      }
    })

    it('shows the interim sites changed, removed and added', async () => {
      expect(await detail.updateOrsInterimSites()).toEqual([
        {
          change: 'changed',
          title: 'Interim site 1: Gdynia Port Hub',
          tag: 'Changed',
          open: true
        },
        {
          change: 'removed',
          title: 'Interim site 2: Szczecin Sorting',
          tag: 'Removed',
          open: true
        },
        {
          change: 'added',
          title: 'Interim site 3: Krakow Depot',
          tag: 'New interim site',
          open: true
        }
      ])
      expect(
        await detail.updateOrsRow('contact-name', {
          prefix: 'update-ors-interim'
        })
      ).toEqual({
        changed: 'true',
        current: 'Alex Morgan',
        requested: 'Marta Kowalska',
        tagged: true
      })
    })

    it('lists the BES evidence held, then the file the update adds, marked new', async () => {
      const files = await detail.updateOrsBesFiles()
      expect(files.map((file) => file.isNew)).toEqual([false, true])
      expect(files[0].text).toContain(
        approval.site.besEvidence.files[0].filename
      )
      expect(files[1].text).toContain(
        approval.site.addedBesEvidence.files[0].filename
      )
    })
  })

  // RA-782 AC3. startAssessment below self-assigns, which management-fe
  // offers only while someone else, or nobody, holds the item: so this ends
  // unassigned.
  describe('assignment', () => {
    before(async () => {
      await workItems.openWorkItem(approval.workItem.id)
    })

    it('assigns it to yourself', async () => {
      await detail.assertUnassigned()
      await detail.selfAssign()
      await detail.assertState('Not started')
    })

    it('reassigns it to someone else', async () => {
      await detail.assignTo('stub-caseworker-2')
      await detail.assertAssignedTo('Stub Caseworker Two')
    })

    it('unassigns it', async () => {
      await detail.unassign()
      await detail.assertUnassigned()
    })

    it('records each change in Application history, newest first', async () => {
      await detail.gotoAudit()
      await detail.waitForAuditEntryCount('assigned', 2)
      await detail.waitForAuditEntryCount('unassigned', 1)
      expect(await detail.auditEntrySummaryLines('assigned')).toEqual([
        expect.stringContaining('Stub Caseworker Two'),
        expect.any(String)
      ])
      expect(await detail.auditEntrySummaryLines('unassigned')).toEqual([
        expect.stringContaining('Stub Caseworker Two')
      ])
    })
  })

  describe('duly making', () => {
    it('has no payment date to enter, and no charge', async () => {
      await workItems.openWorkItem(approval.workItem.id)
      await detail.clickDulyMake()
      await dulyMaking.assertOnPage()
      await expect(dulyMaking.paymentDateGroup()).not.toExist()
      await expect(dulyMaking.lead()).toHaveText(
        'There is no charge for this application, so there is no payment date to add.'
      )
      expect(await dulyMaking.chargeAmountText()).toBe('-')
    })

    it('duly makes it with nothing entered', async () => {
      await dulyMaking.submit()
      await dulyMaking.waitForDetailUrl(approval.workItem.id)
      await detail.assertState('Duly made')
      const { payload } = await getWorkItem(approval.workItem.id)
      expect(payload.paymentReceivedDate ?? null).toBeNull()
    })

    it('changes the due date', async () => {
      const id = approval.workItem.id
      await workItems.openWorkItem(id)
      const previous = (await detail.caseHeaderFieldText('dueOn')).trim()
      await slaExtend.changeDeadline(id, {
        reason: 'RA-782 ORS update deadline change',
        date: farFutureDeadline()
      })
      expect(await detail.waitForDueOnToChangeFrom(previous)).not.toBe(previous)
    })

    it('records duly making and the due date change in Application history', async () => {
      await workItems.openWorkItem(approval.workItem.id)
      await detail.gotoAudit()
      await detail.waitForAuditEntryCount('sla-extended', 1)
      await detail.expandAllAuditEntryDetails()
      await detail.assertAuditDetailRow('action-applied', 'Action', 'Duly make')
      await detail.assertAuditDetailRow(
        'sla-extended',
        'Reason for change',
        'RA-782 ORS update deadline change'
      )
    })
  })

  describe('approval', () => {
    before(async () => {
      await startAssessment(approval.workItem.id)
    })

    it('has no valid from date to enter', async () => {
      await workItems.openWorkItem(approval.workItem.id)
      await detail.clickLogDecision()
      await decision.waitForDecisionUrl(approval.workItem.id, TYPE_ID)
      await decision.assertOnPage()
      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
      expect(await decision.hasEffectiveDate()).toBe(false)
    })

    it('approves it, awaiting applicant contact', async () => {
      await logDecision(approval.workItem.id, 'approved', {
        note: 'RA-782 the changes are in order'
      })
      await workItems.openWorkItem(approval.workItem.id)
      expect(await detail.stateTagText()).toBe('Approved')
      expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
    })

    it('records the determination in Application history', async () => {
      await workItems.openWorkItem(approval.workItem.id)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Approved')
    })

    it('cannot confirm contact while the operator journey refuses the push', async () => {
      const id = approval.workItem.id
      await workItems.openWorkItem(id)
      await detail.clickConfirmApplicantContact()
      await confirmContact.waitForConfirmUrl(id, TYPE_ID)
      await confirmContact.tickContacted()
      await confirmContact.submit()
      await expect(confirmContact.failureBanner()).toBeDisplayed()
      expect((await getWorkItem(id)).stateId).toBe('approved-pending-contact')

      // The failure is the operator journey's 404 on its change request
      // status route (it holds no change request for this item), not some
      // other fault: see ra-495-add-ors-status-push for why a 404 there is
      // the route's own refusal.
      const pushes = (await statusPushes(id)).filter(
        (entry) => entry.details.actionId === 'confirm-contact-approved'
      )
      expect(pushes).toHaveLength(1)
      const [push] = pushes
      expect(push.action).toBe('status-push-failed')
      expect(push.details.errorMessage).toContain('returned 404 from ')
      expect(push.details.errorMessage).toContain(
        `/api/v1/accreditation-changes/case-management/${id}/status`
      )
    })
  })

  describe('refusal', () => {
    before(async () => {
      await dulyMake(refusal.workItem.id, { paymentDate: false })
      await startAssessment(refusal.workItem.id)
    })

    it('refuses the other update, awaiting applicant contact', async () => {
      await logDecision(refusal.workItem.id, 'refused')
      await workItems.openWorkItem(refusal.workItem.id)
      expect(await detail.stateTagText()).toBe('Refused')
      expect(await detail.hasConfirmApplicantContactCta()).toBe(true)
    })

    it('records the determination in Application history', async () => {
      await detail.gotoAudit()
      await detail.assertAuditEntry('Determination made: Refused')
    })

    it('cannot confirm contact while the operator journey refuses the push: it stays Refused, pending contact', async () => {
      const id = refusal.workItem.id
      await workItems.openWorkItem(id)
      await detail.clickConfirmApplicantContact()
      await confirmContact.waitForConfirmUrl(id, TYPE_ID)
      await confirmContact.tickContacted()
      await confirmContact.submit()
      await expect(confirmContact.failureBanner()).toBeDisplayed()
      expect((await getWorkItem(id)).stateId).toBe('rejected-pending-contact')
      await workItems.openWorkItem(id)
      expect(await detail.stateTagText()).toBe('Refused')
      expect(await detail.hasConfirmApplicantContactCta()).toBe(true)

      // The operator journey's 404 on its change request status route, as
      // on approval.
      const pushes = (await statusPushes(id)).filter(
        (entry) => entry.details.actionId === 'confirm-contact-rejected'
      )
      expect(pushes).toHaveLength(1)
      const [push] = pushes
      expect(push.action).toBe('status-push-failed')
      expect(push.details.errorMessage).toContain('returned 404 from ')
      expect(push.details.errorMessage).toContain(
        `/api/v1/accreditation-changes/case-management/${id}/status`
      )
    })
  })
})
