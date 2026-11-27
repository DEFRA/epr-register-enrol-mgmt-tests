import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query, {
  COMBINED_ORS_BES_KEYS,
  COMBINED_ORS_BES_LABEL,
  COMBINED_ORS_BES_SECTION
} from '../page-objects/query.page.js'
import { createExporterWorkItem } from '../support/ra-434-fixture.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'
import { getWorkItem } from '../support/decision-api.js'

/**
 * RA-698 (AC12) — the query form asks for ONE combined Overseas reprocessing
 * sites (ORS) + broadly equivalent standards (BES) scope, for both journeys.
 *
 *   AC01 — add-ORS: an in-year "Accreditation: new ORS" item is one ORS, so
 *          its query form shows that ORS and one fixed "Overseas reprocessing
 *          site and BES evidence" scope, with NO section checkboxes (and no
 *          separate BES option). The only input is the reason.
 *   AC02 — re-accreditation: the two exporter-only checkboxes are replaced by
 *          one, "Overseas reprocessing sites and BES evidence", which posts
 *          BOTH existing section keys. The backend contract is unchanged, so
 *          the stored query still carries `broadly-equivalent-standards` and
 *          `overseas-reprocessing-sites`, and the history shows the one label.
 *
 * The add-ORS item is submitted straight to management-be, as the operator
 * backend does (RA-739); the exporter re-accreditation through the API
 * (RA-434's fixture), as the "Create work item" form cannot make an exporter.
 */
describe('RA-698 combined ORS and BES query scope', () => {
  describe('AC01 — the add-ORS query form', () => {
    let submission
    let workItemId

    before(async () => {
      submission = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA698 Query Form Ltd',
        siteCount: 1
      })
      workItemId = submission.workItems[0].id
      await login.login()
    })

    after(async () => {
      await login.logout()
    })

    it('offers "Raise a query" on the add-ORS detail page', async () => {
      await workItems.openWorkItem(workItemId)
      expect(await detail.hasAddOrsRaiseQueryCta()).toBe(true)
      await detail.addOrsRaiseQueryCta().click()
      await query.waitForQueryUrl(workItemId)
      await query.assertOnQueryPage()
    })

    it('shows the ORS being queried: name, ORS ID and location', async () => {
      const [site] = submission.sites
      await query.gotoFor(workItemId)
      await expect(query.addOrsSummary()).toBeDisplayed()
      await expect(query.addOrsName()).toHaveText(site.siteName)
      await expect(query.addOrsId()).toHaveText(site.orsId)
      await expect(query.addOrsLocation()).toHaveText(
        expect.stringContaining(site.townOrCity)
      )
    })

    it('shows one combined ORS and BES scope and no section checkboxes', async () => {
      await query.gotoFor(workItemId)
      await expect(query.addOrsScope()).toHaveText(
        'Overseas reprocessing site and BES evidence'
      )
      expect(await query.hasSectionGroup()).toBe(false)
      expect(await query.countSectionOptions()).toBe(0)
      // Neither the old separate BES / ORS values nor the combined
      // re-accreditation checkbox belong on this form.
      for (const value of [
        ...COMBINED_ORS_BES_KEYS,
        COMBINED_ORS_BES_SECTION
      ]) {
        expect(await query.hasSection(value)).toBe(false)
      }
    })

    it('asks for the reason, with a Send query button and a Cancel link', async () => {
      await query.gotoFor(workItemId)
      await expect($('#field-reason')).toBeDisplayed()
      await expect($('[data-testid="query-submit"]')).toBeDisplayed()
      await expect($('[data-testid="query-cancel"]')).toBeDisplayed()
    })

    it('Cancel returns to the add-ORS detail page without querying', async () => {
      await query.gotoFor(workItemId)
      await query.cancel()
      await query.waitForDetailUrl(workItemId)
      expect(await detail.stateId()).toBe('submitted')
    })

    it('rejects a reason longer than 200 words', async () => {
      await query.gotoFor(workItemId)
      await query.fillReason('word '.repeat(201).trim())
      await query.submit()
      await query.assertErrorSummaryDisplayed()
      expect(await query.errorSummaryText()).toContain(
        'Query must be 200 words or fewer'
      )
      // The form re-renders as the add-ORS one, not the section form.
      expect(await query.hasSectionGroup()).toBe(false)
    })
  })

  describe('AC02 — the re-accreditation query form', () => {
    let workItemId

    before(async () => {
      await login.login()
      ;({ id: workItemId } = await createExporterWorkItem())
    })

    after(async () => {
      await login.logout()
    })

    it('offers one "Overseas reprocessing sites and BES evidence" checkbox, unticked', async () => {
      await query.gotoFor(workItemId)
      expect(await query.sectionLabelText(COMBINED_ORS_BES_SECTION)).toBe(
        COMBINED_ORS_BES_LABEL
      )
      expect(await query.isSectionSelected(COMBINED_ORS_BES_SECTION)).toBe(
        false
      )
    })

    it('keeps the checkbox ticked when the form is re-shown with an error', async () => {
      await query.gotoFor(workItemId)
      await query.selectSection(COMBINED_ORS_BES_SECTION)
      await query.fillReason('word '.repeat(201).trim())
      await query.submit()
      await query.assertErrorSummaryDisplayed()
      expect(await query.isSectionSelected(COMBINED_ORS_BES_SECTION)).toBe(true)
    })

    it('sends both the BES and ORS section keys when the one checkbox is ticked', async () => {
      await query.gotoFor(workItemId)
      await query.selectSection(COMBINED_ORS_BES_SECTION)
      await query.fillReason(
        'Please provide the overseas site and BES details.'
      )
      await query.submit()
      await query.waitForDetailUrl(workItemId)
      await detail.assertState('Queried')

      // The contract is unchanged: management-be stored both existing keys.
      const { payload } = await getWorkItem(workItemId)
      expect([...payload.currentQuery.sections].sort()).toEqual(
        [...COMBINED_ORS_BES_KEYS].sort()
      )
    })

    it('shows the one combined label, once, in the application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
      await expect(
        $(
          '//*[@data-testid="work-item-audit-log"]//li[@data-action="application-queried"]' +
            '//dt[normalize-space(.)="Areas queried"]/following-sibling::dd'
        )
      ).toHaveText(COMBINED_ORS_BES_LABEL)
    })
  })
})
