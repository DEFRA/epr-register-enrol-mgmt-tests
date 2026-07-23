import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import {
  resumeFromQuery,
  MGT4_TEST_USER_ID
} from '../support/management-be-api.js'

/**
 * MGT-4 — query raised → resubmit → resume-from-query.
 *
 * Part of RA-311 ("Ability to respond to query"); see the RA-311
 * implementation plan, §8. Covers the management-be side of the
 * query/resubmit lifecycle that RA-291's own e2e coverage
 * (ra-291-query-application.e2e.js) does not: what happens once an
 * operator resubmits a queried application (RA-311/MBE-1's
 * `resume-from-query`), which has no management-fe UI at all — RA-311
 * keeps the case management frontend entirely out of scope — so it is
 * called directly (see test/support/management-be-api.js) rather than
 * driven through a page object, mirroring how the real caller (the
 * operator backend, RA-311/OBE-2) invokes it.
 *
 * Assertions here are against the raw JSON the endpoint returns —
 * `payload.latestSections` and the `query-responded` audit entry's
 * `details` — not against rendered management-fe copy. audit-log.js has no
 * decorator for `query-responded`/`query-push-failed` yet (a follow-up
 * ticket owns that per the RA-311 plan's AC08 note), so the case-worker
 * audit log page only ever surfaces these as bare, undecorated entries;
 * `assertAuditEntry` (contains-text) is used only to confirm that much.
 *
 * NOTE ON CI: this spec exercises `resume-from-query`, which lives on the
 * management-be `feature/RA-337-query-resubmit-push` branch and is not yet
 * merged to that repo's main. Per run-journey-tests/action.yml, management-be
 * is only built from source when a branch of the identical name exists in
 * that repo — this branch is named after the RA-311 plan's MGT-4 assignment
 * instead, so CI will pull the published `latest` management-be image and
 * these specs will fail until MBE-1 merges (or the two branch names are
 * aligned).
 *
 * Since MGT-F1 (see mgt-f1-query-raise.e2e.js), this spec's "never-throw
 * push hook" describe block below also depends on epr-register-enrol-
 * backend's `feature/RA-338-query-resubmit-endpoint` branch (OBE-2) for the
 * 404 its assertion relies on — run-journey-tests/action.yml has no
 * branch-matching logic for that repo at all, so it always pulls `latest`
 * regardless of this branch's name, and will only pick up OBE-2 once that
 * branch merges to epr-register-enrol-backend's main.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

const createSubmittedWorkItem = async (organisationName, postcode) => {
  await workItems.goto()
  return (
    await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Resume Street',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material: 'plastic',
      tonnageBand: '0-500'
    })
  ).id
}

const raiseQuery = async (workItemId, sections, reason) => {
  await query.gotoFor(workItemId)
  await query.selectSections(sections)
  await query.fillReason(reason)
  await query.submit()
  await query.waitForDetailUrl(workItemId)
}

describe('MGT-4 — query resubmit / resume-from-query', () => {
  describe('resume-from-query happy path — audit trail and payload.latestSections', () => {
    let workItemId
    let resumeResponse

    const responderContactDetails = {
      fullName: 'Jane Doe',
      email: 'jane@deltagreen.co.uk',
      role: 'Manager'
    }
    const sectionKeys = [
      'sampling-and-inspection-plan',
      'broadly-equivalent-standards'
    ]
    const sections = {
      'sampling-and-inspection-plan': {
        tonnage: 500,
        notes: 'updated tonnage figures'
      },
      'broadly-equivalent-standards': {
        standard: 'ISO 9001',
        notes: 'renewed certificate'
      }
    }
    // Both file-bearing sections RA-311 §5 calls out: sampling-plan uploads
    // and (nested, per overseas site, in the real operator payload) BES
    // evidence uploads. The operator backend flattens both into this same
    // opaque fileReferences shape before calling resume-from-query.
    const fileReferences = [
      {
        sectionKey: 'sampling-and-inspection-plan',
        fileId: 'file-samp-1',
        filename: 'sampling-plan.pdf',
        s3Key: 's3/sampling-plan.pdf'
      },
      {
        sectionKey: 'broadly-equivalent-standards',
        fileId: 'file-bes-1',
        filename: 'bes-evidence.pdf',
        s3Key: 's3/bes-evidence.pdf'
      }
    ]

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(
        uniqueOrg('Resume Happy Path Ltd'),
        'SW1A 1RA'
      )
      await raiseQuery(
        workItemId,
        sectionKeys,
        'Please confirm the sampling plan tonnage and BES certificate.'
      )
      await detail.assertState('Queried')

      resumeResponse = await resumeFromQuery(workItemId, {
        responderContactDetails,
        sectionKeys,
        sections,
        fileReferences
      })
    })

    after(async () => {
      await login.logout()
    })

    it('succeeds and returns the work item to the state it was queried from', () => {
      expect(resumeResponse.status).toBe(200)
      expect(resumeResponse.body.stateId).toBe('submitted')
    })

    it('appends a query-responded audit entry carrying the raw responder/section/file-link details', () => {
      const entry = resumeResponse.body.auditLog.find(
        (e) => e.action === 'query-responded'
      )
      expect(entry).toBeDefined()
      expect(entry.actionDisplayName).toBe('Query responded')
      expect(entry.details.sectionKeys).toBe(sectionKeys.join(','))
      expect(entry.details.responderFullName).toBe(
        responderContactDetails.fullName
      )
      expect(entry.details.responderEmail).toBe(responderContactDetails.email)
      expect(entry.details.responderRole).toBe(responderContactDetails.role)
      expect(entry.details.fileReferences).toBe(
        'sampling-and-inspection-plan:file-samp-1:sampling-plan.pdf;' +
          'broadly-equivalent-standards:file-bes-1:bes-evidence.pdf'
      )
    })

    it('patches payload.latestSections with the pushed section values and file identifiers for both sections', () => {
      const latestSections = resumeResponse.body.payload.latestSections
      expect(latestSections.sectionKeys).toEqual(sectionKeys)
      expect(latestSections.sections['sampling-and-inspection-plan']).toEqual(
        sections['sampling-and-inspection-plan']
      )
      expect(latestSections.sections['broadly-equivalent-standards']).toEqual(
        sections['broadly-equivalent-standards']
      )
      expect(latestSections.respondedBy).toBe(MGT4_TEST_USER_ID)

      const bySectionKey = Object.fromEntries(
        latestSections.fileReferences.map((f) => [f.sectionKey, f])
      )
      expect(bySectionKey['sampling-and-inspection-plan']).toMatchObject({
        fileId: 'file-samp-1',
        filename: 'sampling-plan.pdf',
        s3Key: 's3/sampling-plan.pdf'
      })
      expect(bySectionKey['broadly-equivalent-standards']).toMatchObject({
        fileId: 'file-bes-1',
        filename: 'bes-evidence.pdf',
        s3Key: 's3/bes-evidence.pdf'
      })
    })

    it('surfaces the query-responded entry in the case worker-facing audit log', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Query responded')
    })
  })

  describe('never-throw push hook — a failed operator-backend push does not block the query transition', () => {
    // Since MGT-F1, OperatorBackendApi is enabled stack-wide (see
    // docker/config/management-be.env) and HttpOperatorBackendPushAdapter is
    // always selected — this work item is deliberately never seeded into
    // epr-register-enrol-backend (see operator-backend-db.js /
    // mgt-f1-query-raise.e2e.js, which does seed one), so the real adapter's
    // push gets a genuine 404 back. This exercises
    // ReAccreditationQueryPushHook's documented "never throws" contract
    // against a real failure rather than the no-op adapter's synthetic one.
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(
        uniqueOrg('Push Failure Ltd'),
        'SW1A 1RB'
      )
      await raiseQuery(
        workItemId,
        ['business-plan'],
        'Please clarify the business plan figures.'
      )
    })

    after(async () => {
      await login.logout()
    })

    it('still transitions the application to Queried despite the outbound push failing', async () => {
      await detail.assertState('Queried')
    })

    it('records a query-push-failed audit entry rather than silently swallowing the failure', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.assertAuditEntry('Query push to operator backend failed')
    })
  })

  describe('idempotent resume — a duplicate resubmit (e.g. a double-click) does not fail the retry', () => {
    let workItemId
    const resumeBody = {
      responderContactDetails: {
        fullName: 'Jane Doe',
        email: 'jane@deltagreen.co.uk',
        role: 'Manager'
      },
      sectionKeys: ['prn-tonnage'],
      sections: { 'prn-tonnage': { tonnage: 750 } },
      fileReferences: []
    }

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(
        uniqueOrg('Resume Idempotent Ltd'),
        'SW1A 1RC'
      )
      await raiseQuery(
        workItemId,
        ['prn-tonnage'],
        'Please confirm the PRN tonnage figures.'
      )
      await detail.assertState('Queried')
    })

    after(async () => {
      await login.logout()
    })

    it('the first resume-from-query call transitions the application back out of Queried', async () => {
      const response = await resumeFromQuery(workItemId, resumeBody)
      expect(response.status).toBe(200)
      expect(response.body.stateId).toBe('submitted')
    })

    it('a duplicate resume-from-query call against the same, already-resumed work item succeeds as a no-op replay rather than a conflict', async () => {
      const response = await resumeFromQuery(workItemId, resumeBody)
      expect(response.status).toBe(200)
      expect(response.body.stateId).toBe('submitted')

      // The replay must not re-run the resume side effects: exactly one
      // query-responded entry should exist, from the first call, not two.
      const queryRespondedEntries = response.body.auditLog.filter(
        (e) => e.action === 'query-responded'
      )
      expect(queryRespondedEntries.length).toBe(1)
    })
  })
})
