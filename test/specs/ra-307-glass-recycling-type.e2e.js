import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-307: glassRecyclingProcess had no typed representation in management-be
 * at all (raw BsonDocument passthrough, never projected onto
 * ReAccreditationPayload) and materialLabel() in management-fe had no way to
 * show it — every glass work item rendered as plain "Glass" regardless of
 * remelt/other. Proves the fix against the seeded riverside-glass
 * (glass_re_melt) and swansea-textiles (glass_other) fixtures — see
 * ReAccreditationSeeder.cs in epr-register-enrol-management-be — on both
 * display locations that share the work item detail template: the case
 * header and the application-summary "Material" row.
 */
describe('RA-307: Glass recycling type shown on the work item detail page', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  async function openSeededWorkItem(organisationName) {
    await workItems.goto()
    await workItems.resetFilters()
    await workItems.searchByOrgName(organisationName)
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
  }

  it('shows "Glass - Remelt" for the riverside-glass fixture (glass_re_melt)', async () => {
    await openSeededWorkItem('Riverside Glass Recovery')

    await expect(detail.caseHeaderField('material')).toHaveText(
      expect.stringContaining('Glass - Remelt')
    )
    await expect(detail.applicationDetailRow('material')).toHaveText(
      expect.stringContaining('Glass - Remelt')
    )
  })

  it('shows "Glass - Other" for the swansea-textiles fixture (glass_other)', async () => {
    await openSeededWorkItem('Swansea Textiles Recovery')

    await expect(detail.caseHeaderField('material')).toHaveText(
      expect.stringContaining('Glass - Other')
    )
    await expect(detail.applicationDetailRow('material')).toHaveText(
      expect.stringContaining('Glass - Other')
    )
  })
})
