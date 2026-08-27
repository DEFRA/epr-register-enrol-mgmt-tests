import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * RA-450 — CM: Application History Org ID field is incorrect for Route to
 * Nation.
 *
 * On a work item's Application History tab, each audit entry's "Show details"
 * disclosure carries a work-item snapshot with an "Org ID" row. The row was
 * wrongly built from `payload.applicationReference`; the management-fe fix
 * (audit-log.controller.js) sources it from `payload.operatorOrganisationId`
 * instead. The "Routed to nation" entry is the one called out in the ticket,
 * but the controller stamps ONE snapshot — built from the work item's current
 * payload — onto every entry, so the buggy/fixed value is observable on any
 * disclosure. This asserts it on the reliably-present submitted entry.
 *
 * The two values must be genuinely distinct for the assertion to have teeth:
 * we set a KNOWN operator Org ID on the create form (RA-448 added the field),
 * distinct from the server-generated AP-prefixed application reference, so
 * "Org ID equals the operator org id AND is not the application reference" is
 * a real regression guard rather than a vacuous one.
 */
const OPERATOR_ORG_ID = '654321'

describe('RA-450 Application History Org ID shows the operator org id', () => {
  let applicationReference

  before(async () => {
    await login.login()
    await workItems.goto()
    const created = await workItems.createWorkItem({
      operatorOrganisationId: OPERATOR_ORG_ID,
      organisationName: 'RA-450 Org ID Ltd',
      siteAddressLine1: '1 History Road',
      siteAddressTown: 'Manchester',
      siteAddressPostcode: 'M1 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    })
    applicationReference = created.applicationReference
    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
  })

  after(async () => {
    await login.logout()
  })

  it('shows the operator organisation id in the Org ID snapshot row', async () => {
    const orgId = await detail.auditSnapshotRowValue('Org ID')
    expect(orgId.trim()).toBe(OPERATOR_ORG_ID)
  })

  it('does NOT show the application reference in the Org ID row', async () => {
    // The pre-fix defect: the Org ID row echoed the application reference.
    // Guard against a regression back to that wiring.
    const orgId = await detail.auditSnapshotRowValue('Org ID')
    expect(orgId.trim()).not.toBe(applicationReference)
  })
})
