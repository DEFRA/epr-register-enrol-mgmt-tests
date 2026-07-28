import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-196: Replace ID with Application Ref across pages.
 *
 * The management UI must show the user-facing application reference
 * (payload.applicationReference, RA-318 format: `AP` + year + agency +
 * orgId + postcode suffix + material prefix) instead of the
 * internal work item id (a GUID) everywhere the identifier is shown as
 * visible text — the work items list link, the detail page caption and
 * "Application ref" summary row, and the sub-page captions. The internal
 * id is retained in URLs and data-testid attributes (which is how these
 * tests still locate the elements).
 */
describe('RA-196 — application reference shown instead of internal id', () => {
  let createdId
  let applicationReference

  before(async () => {
    await login.login()
    await workItems.goto()
    ;({ id: createdId, applicationReference } = await workItems.createWorkItem({
      organisationName: 'Reference Recyclers Ltd',
      siteAddressLine1: '1 Reference Way',
      siteAddressTown: 'Bristol',
      siteAddressPostcode: 'BS1 1AA',
      material: 'aluminium',
      tonnageBand: '0-500'
    }))
  })

  after(async () => {
    await login.logout()
  })

  it('captures an application reference that is distinct from the internal id', () => {
    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)
    expect(applicationReference).not.toBe(createdId)
  })

  describe('work items list page', () => {
    before(async () => {
      // RA-299: a bare landing now defaults to "assigned to me" — the item
      // created above is unassigned, so use the explicit empty submission
      // (shows all regardless of assignee) rather than goto() to find it.
      await workItems.resetFilters()
    })

    it('shows the application reference as the row link text', async () => {
      const linkText = await workItems.workItemLink(createdId).getText()
      expect(linkText).toBe(applicationReference)
    })

    it('does not show the internal id as the row link text', async () => {
      const linkText = await workItems.workItemLink(createdId).getText()
      expect(linkText).not.toBe(createdId)
    })

    it('still targets the work item using the internal id in the href', async () => {
      const href = await workItems.workItemLink(createdId).getAttribute('href')
      expect(href).toContain(createdId)
    })
  })

  describe('work item detail page', () => {
    before(async () => {
      await workItems.openWorkItem(createdId)
    })

    it('shows the application reference as the page identity', async () => {
      // RA-295 removed the detail page's appHeading — the case header IS the
      // page identity now, and it carries the bare reference rather than the
      // old "Work item {ref}" caption text. The RA-249 fallback rule is
      // unchanged. The tasks sub-page below still uses the caption, which is
      // why getCaption() understands both.
      const caption = await detail.getCaption()
      expect(caption).toBe(applicationReference)
    })

    it('shows the application reference in the retained reference block', async () => {
      // The envelope summary list is gone; the reference survives in the block
      // at the foot of the page, relabelled "Application reference".
      const value = await detail.getSummaryValueByKey('Application reference')
      expect(value).toBe(applicationReference)
    })

    it('does not label the reference row as "Id"', async () => {
      // The point of RA-196 is that the user-facing reference is not presented
      // as the internal id. The row is now labelled "Work item ID" and does
      // carry the internal id — deliberately, for debugging — so this asserts
      // the bare "Id" label is still absent AND that the internal id has not
      // crept into the reference row.
      expect(await detail.hasSummaryKey('Id')).toBe(false)
      const value = await detail.getSummaryValueByKey('Application reference')
      expect(value).not.toBe(createdId)
    })
  })

  describe('tasks sub-page', () => {
    before(async () => {
      await workItems.openWorkItem(createdId)
      await detail.gotoTasks()
    })

    it('shows the application reference in the caption', async () => {
      const caption = await detail.getCaption()
      expect(caption).toContain(`Work item ${applicationReference}`)
    })

    it('does not show the internal id in the caption', async () => {
      const caption = await detail.getCaption()
      expect(caption).not.toContain(createdId)
    })
  })
})
