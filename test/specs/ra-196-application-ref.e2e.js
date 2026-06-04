import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-196: Replace ID with Application Ref across pages.
 *
 * The management UI must show the user-facing application reference
 * (payload.applicationReference, format `RA-<9 digits>`) instead of the
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
    await login.loginAs('assign')
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
    expect(applicationReference).toMatch(/^RA-\d{9}$/)
    expect(applicationReference).not.toBe(createdId)
  })

  describe('work items list page', () => {
    before(async () => {
      await workItems.goto()
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

    it('shows the application reference in the page caption', async () => {
      const caption = await detail.getCaption()
      expect(caption).toBe(`Work item ${applicationReference}`)
    })

    it('shows the application reference in the "Application ref" summary row', async () => {
      const value = await detail.getSummaryValueByKey('Application ref')
      expect(value).toBe(applicationReference)
    })

    it('does not label the summary row as "Id"', async () => {
      const idRow = await detail.hasSummaryKey('Id')
      expect(idRow).toBe(false)
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
