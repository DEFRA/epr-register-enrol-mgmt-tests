import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Audit log — work item snapshot fields.
 *
 * Each "Show details" disclosure on the audit log page should surface a
 * consistent set of work-item context rows so reviewers can see the
 * current state of the item alongside the event that triggered the entry:
 *
 *   Org ID       — applicationReference from the submission payload
 *   Type         — work item type display name
 *   State        — current state display name
 *   Submitted at — formatted submission timestamp
 *   Submitted by — submitter identity
 *   Last modified — formatted last-modified timestamp
 *   Assigned to  — assignee name or "Unassigned"
 */
describe('Audit log — work item snapshot fields', () => {
  let workItemId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Snapshot Test Ltd',
      siteAddressLine1: '1 Audit Road',
      siteAddressTown: 'Manchester',
      siteAddressPostcode: 'M1 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    }))
    await detail.gotoAudit()
  })

  after(async () => {
    await login.logout()
  })

  it('shows a "Show details" disclosure on the submitted audit entry', async () => {
    const disclosures = await $$(
      '[data-testid="work-item-audit-entry-details"]'
    )
    expect(disclosures.length).toBeGreaterThan(0)
  })

  describe('work item snapshot rows inside the first disclosure', () => {
    before(async () => {
      await detail.expandAllAuditEntryDetails()
    })

    it('includes an Org ID row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Org ID"]'
        )
      ).toExist()
    })

    it('includes a Type row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Type"]'
        )
      ).toExist()
    })

    it('includes a State row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="State"]'
        )
      ).toExist()
    })

    it('includes a Submitted at row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Submitted at"]'
        )
      ).toExist()
    })

    it('includes a Submitted by row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Submitted by"]'
        )
      ).toExist()
    })

    it('includes a Last modified row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Last modified"]'
        )
      ).toExist()
    })

    it('shows "Unassigned" for Assigned to when no assignee set', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Assigned to"]/following-sibling::dd'
        )
      ).toHaveText('Unassigned')
    })

    it('snapshot rows appear on every disclosure in the timeline', async () => {
      const allDisclosures = await $$(
        '[data-testid="work-item-audit-entry-details"]'
      )
      for (const disclosure of allDisclosures) {
        await expect(disclosure.$('dt=Assigned to')).toExist()
      }
    })
  })
})
