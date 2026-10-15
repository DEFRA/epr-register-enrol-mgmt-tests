import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { createWorkItemViaApi } from '../support/work-item-api.js'

/**
 * RA-307: glassRecyclingProcess had no typed representation in management-be
 * at all (raw BsonDocument passthrough, never projected onto
 * ReAccreditationPayload) and materialLabel() in management-fe had no way to
 * show it — every glass work item rendered as plain "Glass" regardless of
 * remelt/other. Proves the fix against two glass applications submitted
 * through the API, one `glass_re_melt` and one `glass_other`, on both display
 * locations that share the work item detail template: the case header and
 * the application-summary "Material" row.
 */
describe('RA-307: Glass recycling type shown on the work item detail page', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  async function openGlassWorkItem(glassRecyclingProcess) {
    const { id } = await createWorkItemViaApi({
      organisationNamePrefix: 'RA307 Glass Recovery Ltd',
      fields: { material: 'glass', glassRecyclingProcess }
    })
    await workItems.openWorkItem(id)
    await workItems.waitForDetailPage()
  }

  it('shows "Glass - Remelt" for a glass_re_melt application', async () => {
    await openGlassWorkItem('glass_re_melt')

    await expect(detail.caseHeaderField('material')).toHaveText(
      expect.stringContaining('Glass - Remelt')
    )
    await expect(detail.applicationDetailRow('material')).toHaveText(
      expect.stringContaining('Glass - Remelt')
    )
  })

  it('shows "Glass - Other" for a glass_other application', async () => {
    await openGlassWorkItem('glass_other')

    await expect(detail.caseHeaderField('material')).toHaveText(
      expect.stringContaining('Glass - Other')
    )
    await expect(detail.applicationDetailRow('material')).toHaveText(
      expect.stringContaining('Glass - Other')
    )
  })
})
