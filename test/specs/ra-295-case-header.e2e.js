import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  CASE_HEADER_FIELDS
} from '../page-objects/work-item-detail.page.js'
import slaOverride from '../page-objects/sla-override.page.js'
import { formatUkDateGds } from '../support/uk-time.js'

/**
 * RA-295 (AC01) — the case header on an individual work item page, plus the
 * markup the redesign removes.
 *
 * AC01: navigating from the work items list to an individual work item shows a
 * case header carrying eight things — an "Applications" link back to the list,
 * the accreditation ref/ID, the organisation name AND its ID, the material,
 * the status, who it is assigned to, the due date, and the registration
 * number. The Jira note additionally removes the RA-98 green notification
 * banner.
 *
 * Two fixtures are needed, because no single work item exercises the whole
 * header:
 *
 *   - The seeded "Full Payload Verification Ltd" item carries the rich payload
 *     (registration number, operator org id, material) that a UI-created item
 *     has no way to supply, but it sits in `submitted` with no SLA clock
 *     running, so its "Due on" has nothing to show.
 *   - A UI-created item can be driven through payment-received to start the
 *     SLA clock and then given a DETERMINISTIC clock via the SLA override
 *     flow, which is the only way to assert a real, exact "Due on" date rather
 *     than merely "something is rendered".
 *
 * Both are covered below rather than picking one and hand-waving the other.
 */
describe('RA-295 case header on the work item detail page', () => {
  before(async () => {
    // No nation → a multi-nation "see all" user, so the seeded item is visible
    // regardless of which nation it was seeded into.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('reached by navigating from the work items list', () => {
    before(async () => {
      // A bare landing defaults to "assigned to me" (RA-299), which would hide
      // this unassigned seeded item — reset to an explicit empty filter first.
      await workItems.resetFilters()
      await workItems.searchByOrgName('Full Payload Verification Ltd')
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      // Hard gate: the search must resolve to exactly the one seeded item.
      // 0 means it is absent or archived; >1 means the org name is no longer
      // unique. Failing here beats opening the wrong row and timing out
      // opaquely further down.
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
    })

    it('displays a case header', async () => {
      await expect(detail.caseHeader()).toBeDisplayed()
    })

    it('renders every field AC01 requires, none of them empty', async () => {
      // Driven off CASE_HEADER_FIELDS so adding a required field to the
      // contract automatically requires it here, rather than relying on
      // someone remembering to add an assertion.
      const missing = []
      const empty = []
      for (const name of Object.keys(CASE_HEADER_FIELDS)) {
        if (!(await detail.hasCaseHeaderField(name))) {
          missing.push(name)
          continue
        }
        const text = (await detail.caseHeaderFieldText(name)).trim()
        // An em dash is the frontend's "no value" fallback. It counts as
        // empty here: AC01 asks for the information, not a placeholder.
        if (text === '' || text === '—') {
          empty.push(`${name} ("${text}")`)
        }
      }
      expect({ missing, empty }).toEqual({ missing: [], empty: [] })
    })

    it('shows the organisation name and the organisation ID', async () => {
      // AC01 asks for "Org name and ID" — both, distinctly. Asserting only the
      // name would pass against a header that dropped the ID entirely.
      await expect(detail.caseHeaderField('orgName')).toHaveText(
        expect.stringContaining('Full Payload Verification Ltd')
      )
      await expect(detail.caseHeaderField('orgId')).toHaveText(
        expect.stringContaining('org-full-payload-001')
      )
    })

    it('shows the registration number', async () => {
      await expect(detail.caseHeaderField('registrationNumber')).toHaveText(
        expect.stringContaining('EPR-100999')
      )
    })

    it('shows the material', async () => {
      await expect(detail.caseHeaderField('material')).toHaveText(
        expect.stringContaining('Plastic')
      )
    })

    it('shows the status', async () => {
      await expect(detail.caseHeaderField('status')).toHaveText(
        expect.stringContaining('Submitted')
      )
    })

    it('shows the assignee, reading "Unassigned" when nobody holds it', async () => {
      await expect(detail.caseHeaderField('assignedTo')).toHaveText(
        expect.stringContaining('Unassigned')
      )
    })

    it('shows the accreditation ref, matching the ref retained at the bottom of the page', async () => {
      // The seeded reference is generated deterministically from the seed key
      // by the backend, so its literal value is not knowable here. Asserting
      // the header ref against the ref retained at the foot of the page is
      // both stable and a stronger check than a shape match: it proves the two
      // renderings of the same identifier have not drifted apart.
      const headerRef = (
        await detail.caseHeaderFieldText('accreditationRef')
      ).trim()
      expect(headerRef).not.toBe('')
      const footerRef = (await detail.footerApplicationRef().getText()).trim()
      expect(footerRef).toContain(headerRef)
    })

    it('navigates back to the applications list from the header link', async () => {
      // The AC is that the link takes you back to the list, so this clicks it
      // and waits for the navigation rather than inspecting the href.
      await detail.clickApplicationsLink()
      await expect(browser).toHaveUrl(expect.stringContaining('/work-items'))
    })
  })

  describe('markup the redesign removes', () => {
    before(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrgName('Full Payload Verification Ltd')
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
    })

    it('no longer shows the RA-98 reference-implementation banner', async () => {
      await expect(detail.ra98ReferenceBanner()).not.toBeExisting()
    })

    it('no longer shows the SLA tracker badge', async () => {
      // The "On track" / "At risk" / "Breached" govukTag in the old "SLA
      // status" section. Removing it is a Jira note, and it is easy to
      // reintroduce by accident when the SLA extend/override actions (which
      // survive RA-295) are touched.
      await expect(detail.slaStatusBadge()).not.toBeExisting()
    })

    it('still shows the application ref, at the bottom of the page', async () => {
      // Retained for debugging per the Jira note — but MOVED, so position in
      // the document is part of the requirement, not just presence.
      await detail.assertApplicationRefAtBottom()
    })
  })

  describe('"Due on" for an item with a running SLA clock', () => {
    // The seeded item above has no SLA clock, so its "Due on" cannot carry a
    // real date. This drives a fresh item to the state where the clock starts,
    // then pins the clock to known values so the expected due date is an exact
    // string rather than an approximation.
    let workItemId
    const targetDays = 84
    const startedAt = new Date('2026-06-01T09:00:00.000Z')

    before(async () => {
      await workItems.resetFilters()
      ;({ id: workItemId } = await workItems.createWorkItem({
        organisationName: 'RA-295 Due On Ltd',
        siteAddressLine1: '1 Deadline Drive',
        siteAddressTown: 'Bristol',
        siteAddressPostcode: 'BS1 1AA',
        material: 'plastic',
        tonnageBand: '0-500'
      }))

      // Submitted -> Duly made -> Assessment in progress; payment-received is
      // the transition that stamps the SLA clock (see RA-131).
      await workItems.openWorkItem(workItemId)
      await detail.gotoTasks()
      await detail.setTaskStatus('verify-organisation-details', 'Completed')
      await detail.setTaskStatus(
        'confirm-application-completeness',
        'Completed'
      )
      await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
      await detail.gotoDetail()
      await detail.triggerAction('payment-received')

      // Pin the clock so the due date is deterministic. Without this the
      // expected value depends on the backend's default target duration, which
      // the suite would then be silently coupled to.
      await slaOverride.gotoFor(workItemId)
      await slaOverride.fillForm({
        reason: 'Pin the SLA clock so the due date is deterministic (RA-295)',
        newTargetDays: targetDays,
        newStartedAt: startedAt.toISOString()
      })
      await slaOverride.submitForm()
      await slaOverride.waitForDetailUrl(workItemId)
    })

    it('shows the absolute due date, in UK local time', async () => {
      const expected = formatUkDateGds(
        new Date(startedAt.getTime() + targetDays * 24 * 60 * 60 * 1000)
      )
      await expect(detail.caseHeaderField('dueOn')).toHaveText(
        expect.stringContaining(expected)
      )
    })
  })
})
