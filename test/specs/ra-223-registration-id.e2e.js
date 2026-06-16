import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-223: Show the Registration ID on the management UI work item.
 *
 * Regulators need the registration id (payload.registrationNumber, e.g.
 * `EPR-100023`) visible on the work item detail page so they can carry
 * out further checks against the registration system. The detail page
 * now renders a "Registration ID" row in the envelope summary list,
 * immediately after "Application ref".
 *
 * Work items created through the management UI do not carry a
 * registrationNumber (that field originates from the upstream
 * registration submission), so for a UI-created item the row renders the
 * em-dash fallback. This spec proves the row is wired up end-to-end and
 * degrades gracefully; the positive value-rendering case is covered by
 * the management-fe integration tests against a payload that carries a
 * registrationNumber.
 */
describe('RA-223 — Registration ID shown on the work item detail page', () => {
  let createdId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: createdId } = await workItems.createWorkItem({
      organisationName: 'Registration Id Recyclers Ltd',
      siteAddressLine1: '1 Registry Road',
      siteAddressTown: 'Sheffield',
      siteAddressPostcode: 'S1 1AA',
      material: 'paper',
      tonnageBand: '0-500'
    }))
    await workItems.openWorkItem(createdId)
  })

  after(async () => {
    await login.logout()
  })

  it('renders a "Registration ID" summary row', async () => {
    const hasRow = await detail.hasSummaryKey('Registration ID')
    expect(hasRow).toBe(true)
  })

  it('falls back to an em-dash when the work item has no registration number', async () => {
    const value = await detail.getSummaryValueByKey('Registration ID')
    expect(value).toBe('—')
  })
})
