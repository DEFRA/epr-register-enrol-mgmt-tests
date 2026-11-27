import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  continueAddOrsReviewViaApi,
  raiseAddOrsQuery,
  resumeAddOrsFromQuery
} from '../support/query-resubmission.js'

/**
 * RA-698 (AC10 to AC12) — raise a query on an in-year "Accreditation: new
 * ORS" work item, the query reaches the operator, the operator answers it
 * (resume-from-query) and the caseworker is offered Duly make. Mirrors
 * ra-291 (raise a query), ra-606 (push to the operator) and ra-454
 * (continue review) for add-ORS.
 *
 * The item is submitted straight to management-be (Path A, RA-739), so the
 * operator journey backend holds no change request for it and refuses the
 * query push: management-be records `query-push-failed` and the query still
 * stands, exactly as ra-606's "refuses the push" case. The operator's own
 * record taking the query (the push accepted, the item reading Queried
 * there) needs an item the operator journey raised, which only the root
 * stack's seeded organisation 50019 provides; that belongs to the fe-tests
 * @monorepo spec, not this suite.
 *
 * The operator's answer is the `resume-from-query` call the operator backend
 * makes (a caseworker cannot resubmit on the operator's behalf), made here as
 * the operator service.
 *
 * ORDERING IS LOAD-BEARING: the `it`s share one work item and each step is
 * one-way. Do not reorder or run one in isolation with `.only`.
 */
const REASON = 'Please confirm the ORS address and upload the BES certificate.'
const NEW_NAME = 'RA-698 Renamed ORS'
const NEW_CONTACT = 'Pierre Martin'
const REPLAY_CONTACT_PHONE = '+34 600 698 698'
const ROUND_TWO_REASON =
  'Please update the rejected loads arrangements and the interim site.'
const ROUND_TWO_REJECTED_LOADS =
  'Rejected loads are returned to the exporter within 14 days.'
const ROUND_TWO_INTERIM_NAME = 'RA-698 Renamed Interim Hub'
const NEW_BES_FILE = {
  fileId: 'ra-698-bes-file',
  filename: 'ra-698-bes-evidence.pdf',
  contentType: 'application/pdf',
  s3Key: 'bes-evidence/ra-698-bes-file',
  s3Bucket: 'bes-evidence',
  besEvidenceValidFromDate: '2026-02-01',
  besEvidenceExpiryDate: '2027-12-31'
}
const FIRST_RESPONSE = {
  site: { siteName: NEW_NAME, contactName: NEW_CONTACT },
  besEvidenceFiles: [NEW_BES_FILE]
}
const ROUND_TWO_BES_FILE = {
  ...NEW_BES_FILE,
  fileId: 'ra-698-bes-file-2',
  filename: 'ra-698-bes-evidence-round-2.pdf',
  s3Key: 'bes-evidence/ra-698-bes-file-2'
}

describe('RA-698 add-ORS query, response and duly make', () => {
  let submission
  let workItemId
  let siblingId
  let originalName

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA698 Add ORS Query Ltd',
      siteCount: 2
    })
    workItemId = submission.workItems[0].id
    siblingId = submission.workItems[1].id
    originalName = submission.sites[0].siteName
    await login.login()
    // Query while still submitted: resume-from-query lands on Updated with originStateId 'submitted' (an item queried after duly made resumes straight to assessment).
    await workItems.openWorkItem(workItemId)
    await detail.selfAssign()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC11 — the regulator raises the query', () => {
    it('raises a reason-only query and moves the item to Queried', async () => {
      await raiseAddOrsQuery(workItemId, { reason: REASON })
      await detail.assertStateId('queried')
    })

    it('records the query and its reason in the application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Application queried')
      await detail.expandAllAuditEntryDetails()
      await expect(
        $(
          '//*[@data-testid="work-item-audit-log"]//li[@data-action="application-queried"]' +
            '//dt[normalize-space(.)="Reason"]/following-sibling::dd'
        )
      ).toHaveText(expect.stringContaining(REASON))
    })

    it('stores the note on the work item and no section keys', async () => {
      const { payload } = await getWorkItem(workItemId)
      expect(payload.currentQuery.reason).toBe(REASON)
      expect(payload.currentQuery.sections ?? []).toEqual([])
    })

    it('pushes the query to the operator backend, which refuses an item it does not hold', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      const failed = await detail.waitForAuditEntryCount('query-push-failed', 1)
      expect(failed.length).toBe(1)
      expect(
        (await detail.auditEntriesForAction('query-push-sent')).length
      ).toBe(0)
      // The query stands.
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Queried')
    })

    it('withdraws "Raise a query" so a second query cannot be raised', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasAddOrsRaiseQueryCta()).toBe(false)
      await browser.url(`/work-items/${workItemId}/query`)
      await query.waitForDetailUrl(workItemId)
      await expect($('[data-testid="query-form"]')).not.toExist()
    })

    it('leaves the sibling ORS from the same submission untouched', async () => {
      await workItems.openWorkItem(siblingId)
      await detail.assertStateId('submitted')
    })

    it('refuses continue review while the item is still queried', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasAddOrsContinueReviewCta()).toBe(false)
      const refused = await continueAddOrsReviewViaApi(workItemId)
      expect(refused.status).toBe(409)
    })
  })

  describe('AC10/AC12 — the operator responds', () => {
    it('refuses a response that changes a locked field, leaving the item Queried', async () => {
      await expect(
        resumeAddOrsFromQuery(workItemId, { site: { country: 'Spain' } })
      ).rejects.toThrow(
        /returned 400.*site contains a field that cannot be changed in a query response/
      )
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('queried')
    })

    it('moves the item to Updated when the operator resubmits', async () => {
      await resumeAddOrsFromQuery(workItemId, FIRST_RESPONSE)
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Updated')
      await detail.assertStateId('updated')
    })

    it('shows the operator response: changed values old to new, who sent it and the new BES file', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasOperatorResponse()).toBe(true)
      expect(await detail.operatorResponseChange('siteName')).toEqual({
        oldValue: originalName,
        newValue: NEW_NAME
      })
      expect(
        (await detail.operatorResponseChange('contactName')).newValue
      ).toBe(NEW_CONTACT)
      expect(await detail.operatorResponseSubmittedBy()).toContain(
        'Olivia Operator'
      )
      expect((await detail.operatorResponseBesFileNames()).join(' ')).toContain(
        NEW_BES_FILE.filename
      )
    })

    it('records the response in the application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Query responded')
    })

    it('treats an identical repeated response (a retry) as a no-op', async () => {
      await resumeAddOrsFromQuery(workItemId, FIRST_RESPONSE)
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('updated')
      expect((await detail.operatorResponseChange('siteName')).newValue).toBe(
        NEW_NAME
      )
      await detail.gotoAudit()
      expect(
        (await detail.auditEntriesForAction('query-responded')).length
      ).toBe(1)
    })

    it('applies and audits a differing repeated response without changing state', async () => {
      // A field the first response did not touch, so the later rounds' site
      // assertions (siteName, contactName) are unaffected.
      await resumeAddOrsFromQuery(workItemId, {
        site: { contactPhone: REPLAY_CONTACT_PHONE }
      })
      const { payload } = await getWorkItem(workItemId)
      expect(payload.site.contactPhone).toBe(REPLAY_CONTACT_PHONE)
      expect(payload.site.siteName).toBe(NEW_NAME)
      expect(payload.site.contactName).toBe(NEW_CONTACT)
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('updated')
      await detail.gotoAudit()
      await detail.assertAuditEntry('Query response updated')
      expect(
        (await detail.auditEntriesForAction('query-responded')).length
      ).toBe(2)
    })
  })

  describe('AC10 — the caseworker is offered Duly make', () => {
    // Queried from Submitted, the item reports originStateId 'submitted'
    // (AddOverseasSiteOriginStateResolver): it was never duly made, so Duly
    // make is the way on and "Continue review" is withdrawn (RA-454).
    // "Continue review" only appears for an item queried from assessment or
    // decision, which land on Updated with that origin; a query from
    // duly-made resumes straight to assessment-in-progress.
    it('offers "Duly make", not "Continue review", on the Updated item queried from Submitted', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasDulyMakeCta()).toBe(true)
      expect(await detail.hasAddOrsContinueReviewCta()).toBe(false)
    })

    it('still accepts continue review over the API, returning the item to Submitted', async () => {
      const response = await continueAddOrsReviewViaApi(workItemId)
      expect(response.status).toBe(200)
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('submitted')
      expect(await detail.hasAddOrsContinueReviewCta()).toBe(false)
    })

    it('treats a repeated continue review as an idempotent replay', async () => {
      const replay = await continueAddOrsReviewViaApi(workItemId)
      expect(replay.status).toBe(200)
      expect(replay.headers.get('x-idempotent-replay')).toBe('true')
    })
  })

  // The management-be#268 review found data bugs on these paths (a
  // rejected-loads answer, an interim site edit, BES files across a second
  // round). Written against the correct behaviour.
  describe('AC10/AC12 — a second query round', () => {
    it('raises a second query on the continued item', async () => {
      await workItems.openWorkItem(workItemId)
      await raiseAddOrsQuery(workItemId, { reason: ROUND_TWO_REASON })
      await detail.assertStateId('queried')
    })

    it('moves the item to Updated on a rejected-loads change, an interim site edit and a second BES file', async () => {
      await resumeAddOrsFromQuery(workItemId, {
        site: { rejectedLoadsArrangements: ROUND_TWO_REJECTED_LOADS },
        interimSites: [
          { siteNumber: '001', changes: { siteName: ROUND_TWO_INTERIM_NAME } }
        ],
        besEvidenceFiles: [ROUND_TWO_BES_FILE]
      })
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('updated')
    })

    it('updates the rejected loads arrangements on the case', async () => {
      const { payload } = await getWorkItem(workItemId)
      expect(payload.site.repatriatedLoads).toBe(ROUND_TWO_REJECTED_LOADS)
      // The legacy wire key is not written onto the case.
      expect(payload.site).not.toHaveProperty('rejectedLoadsArrangements')
    })

    it('updates the interim site and keeps the first round changes', async () => {
      const { payload } = await getWorkItem(workItemId)
      expect(payload.site.interimSites[0].siteName).toBe(ROUND_TWO_INTERIM_NAME)
      expect(payload.site.siteName).toBe(NEW_NAME)
      expect(payload.site.contactName).toBe(NEW_CONTACT)
    })

    it('accumulates BES files across rounds instead of replacing them', async () => {
      const { payload } = await getWorkItem(workItemId)
      const filenames = payload.site.besEvidence.files.map((f) => f.filename)
      expect(filenames).toEqual(
        expect.arrayContaining([
          submission.sites[0].besEvidence.files[0].filename,
          NEW_BES_FILE.filename,
          ROUND_TWO_BES_FILE.filename
        ])
      )
    })

    it('shows the second response and records every response in the application history', async () => {
      await workItems.openWorkItem(workItemId)
      expect((await detail.operatorResponseBesFileNames()).join(' ')).toContain(
        ROUND_TWO_BES_FILE.filename
      )
      await detail.gotoAudit()
      // Round one's response, the differing replay's "Query response
      // updated" entry and round two's response.
      expect(
        (await detail.auditEntriesForAction('query-responded')).length
      ).toBe(3)
    })
  })
})
