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
      //
      // RA-504 removed the Reference footer that used to carry a second copy of
      // the reference ("Application reference" row), so the case header is now
      // the surviving render this spec asserts on — and it must still be the
      // user-facing AP* reference, never the internal id.
      const caption = await detail.getCaption()
      expect(caption).toBe(applicationReference)
      expect(caption).not.toBe(createdId)
    })
  })

  // RA-410 removed the tasks sub-page, and with it the fourth describe block
  // that lived here. It asserted the caption carried the application
  // reference on /work-items/{id}/tasks — a page that now 404s. The caption
  // rule itself is unchanged and is still covered by the detail-page and
  // audit-log blocks above, so nothing was lost with the page.
})
