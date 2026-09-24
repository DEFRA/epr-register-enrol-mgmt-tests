import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { uniquePostcode } from '../support/unique-postcode.js'

/**
 * RA-248 — lifecycle emails carry the human application reference, not the
 * internal work-item Guid.
 *
 * The bug: every re-accreditation lifecycle email put `workItem.Id` — a UUID
 * like `9c6bb177-fb91-4d5a-9c80-8ebac1123943` — into the GOV.UK Notify
 * `((reference))` placeholder, so readers saw a UUID under "Reference
 * number". It must instead be the server-generated application reference
 * `payload.applicationReference` (RA-318 format: `AP` + year + agency + orgId
 * + postcode suffix + material prefix).
 *
 * The email body itself is not observable through the case-management UI —
 * in the e2e stack NOTIFY_API_KEY is absent so the NoOpNotifyClient stands
 * in and discards the personalisation. The reference each send used IS
 * observable, though: it is recorded on the notification's audit entry, and
 * it must equal the application reference shown as the work-item detail page
 * caption (RA-196).
 *
 * RA-581 removed the SlaExtended and AssessmentInProgress emails, which this
 * spec used to drive (via extend-SLA). It now observes the same contract on a
 * regulator email that still exists — the OfficerAssignment send fired when a
 * caseworker is assigned — which RA-581 switched to the human-facing
 * reference as well. The management-be ReAccreditation*HookTests assert the
 * `((reference))` personalisation for every template.
 */
describe('RA-248 lifecycle email reference is the application reference', () => {
  let workItemId

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Reference Number Test Ltd',
        siteAddressLine1: '248 Reference Road',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'test@defra.gov.uk',
        // England is the nation this stack configures a regulator mailbox
        // for, so the assignment send is recorded rather than skipped.
        nation: 'England'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')
    await detail.assertUnassigned()
  })

  after(async () => {
    await login.logout()
  })

  it('surfaces the RA-######### application reference and the notification carries it', async () => {
    // The detail-page caption reads "Work item AP..." (RA-196); the bare
    // reference after the "Work item " prefix is the exact value the emails
    // put in the ((reference)) placeholder. It must be the human application
    // reference, not the internal work-item Guid.
    const applicationReference = (await detail.getCaption())
      .replace(/^Work item\s+/, '')
      .trim()

    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)
    expect(applicationReference).not.toMatch(UUID_RE)
    expect(applicationReference).not.toBe(workItemId)

    // Assigning an officer fires the regulator OfficerAssignment email; its
    // audit entry records the reference the send used.
    await detail.assignTo('stub-caseworker-2')
    await detail.assertAssignedTo('Stub Caseworker Two')

    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
    await detail.assertNotificationDetailRowForTemplate(
      'notification-sent',
      'OfficerAssignment',
      'Reference',
      applicationReference
    )
  })
})
