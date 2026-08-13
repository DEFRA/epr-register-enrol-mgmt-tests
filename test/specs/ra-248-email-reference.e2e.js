import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * RA-248 — lifecycle emails carry the human application reference, not the
 * internal work-item Guid.
 *
 * The bug: every re-accreditation lifecycle email (Extend SLA, Duly made,
 * Assessment in progress, Decision, Withdrawn, Submission confirmation)
 * put `workItem.Id` — a UUID like `9c6bb177-fb91-4d5a-9c80-8ebac1123943` —
 * into the GOV.UK Notify `((reference))` placeholder, so operators saw a
 * UUID under "Reference number". It must instead be the server-generated
 * application reference `payload.applicationReference` (RA-318 format:
 * `AP` + year + agency + orgId + postcode suffix + material prefix).
 *
 * The email body itself is not observable through the case-management UI, and
 * since RA-422 disabled Case Management emails behind the Notify:Enabled flag
 * (default false) no notification is even sent from the e2e stack. The value
 * the email WOULD use is observable independently, though: it is exactly the
 * application reference shown as the work-item detail page caption (RA-196).
 * This spec proves that reference is the human `AP`-prefixed form (never a
 * Guid) while the extend-SLA lifecycle journey still succeeds. The
 * management-be ReAccreditation*HookTests / PaymentService tests assert the
 * `((reference))` personalisation itself carries this same reference.
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
        siteAddressPostcode: 'SW1A 1AT',
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'test@defra.gov.uk'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress. payment-received stamps the SLA
    // clock, without which the extend below would fail with "clock not started".
    await startAssessment(workItemId)
    await detail.assertState('Updated')

    await login.logout()
  })

  after(async () => {
    await login.logout()
  })

  it('surfaces the AP application reference on the detail caption', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)

    // The detail-page caption reads "Work item AP..." (RA-196); the
    // bare reference after the "Work item " prefix is the exact value the
    // lifecycle emails put in the ((reference)) placeholder. It must be
    // the human application reference, not the internal work-item Guid.
    const applicationReference = (await detail.getCaption())
      .replace(/^Work item\s+/, '')
      .trim()

    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)
    expect(applicationReference).not.toMatch(UUID_RE)
    expect(applicationReference).not.toBe(workItemId)

    // Extend the SLA — the reference-bearing lifecycle action still runs and
    // succeeds (success banner). With emails disabled (RA-422) it no longer
    // writes a notification audit row, and the email body was never observable
    // here anyway, so the reference is asserted via the caption above.
    await slaExtend.gotoFor(workItemId)
    await slaExtend.fillForm({
      reason: 'Operator providing additional evidence',
      additionalDays: 7
    })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)

    await detail.assertFlashBanner()
  })
})
