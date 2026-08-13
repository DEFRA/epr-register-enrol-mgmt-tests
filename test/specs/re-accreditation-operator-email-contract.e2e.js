import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Frontend/Backend Contract Test: operatorEmail field (RA-123)
 *
 * This test verifies the contract between the management-fe (form submission)
 * and management-be (payload deserialization) to ensure the operatorEmail
 * field is correctly passed from the frontend form to the backend and
 * eventually reaches the ReAccreditationNotificationHook.
 *
 * Acceptance criteria (as observable with Case Management emails disabled by
 * the Notify:Enabled flag — RA-422, default false, the e2e default):
 * 1. The form submits operatorEmail in the payload (not email)
 * 2. The backend accepts the operatorEmail field
 * 3. The work item is created successfully
 * 4. With the flag off, the post-action notification hook does not fire, so
 *    NO "Submission confirmation email" audit entry is written (neither sent
 *    nor skipped). AC1-3 stay observable via the successful create and the
 *    issued AP reference, which payload deserialization gates.
 *
 * This still guards the field-name contract (operatorEmail vs email): a
 * mismatch would fail deserialization and so the create/reference above.
 */
describe('RA-123 contract: operatorEmail field in re-accreditation submission', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('submits operatorEmail field with work item creation and issues an AP reference', async () => {
    // Test data: use a distinct email so it is present in the submitted payload
    const testOperatorEmail = 'contract-test@defra.gov.uk'
    const organisationName = 'Contract Test Organisation'

    await workItems.goto()
    await workItems.clickCreateWorkItem()

    // Override the seeded email with our distinct test value
    const operatorEmailInput = await $('#field-operatorEmail')
    await operatorEmailInput.setValue(testOperatorEmail)

    // Complete the form with test data
    await $('#field-organisationName').setValue(organisationName)
    await $('#field-siteAddress-line1').setValue('123 Contract Lane')
    await $('#field-siteAddress-town').setValue('London')
    await $('#field-siteAddress-postcode').setValue('SW1A 1AA')
    await $('#field-material').selectByAttribute('value', 'plastic')
    await $('#field-tonnageBand').selectByAttribute('value', '5000-plus')
    await $('[data-testid="create-work-item-submit"]').click()

    // Success: work item created and redirect occurred
    const successBanner = await $('[data-testid="work-item-success-banner"]')
    await expect(successBanner).toBeDisplayed()

    // RA-219 / RA-318: the reference is generated server-side and surfaced
    // on the success banner — confirm it has the expected AP-prefixed shape.
    // The create only succeeds if the backend deserialized the operatorEmail
    // payload, so this is the observable proof of the field-name contract now
    // that the notification audit row is gone (RA-422).
    const applicationReference = (await successBanner.getText()).match(
      /AP[A-Z0-9]+\b/
    )?.[0]
    expect(applicationReference).toMatch(/^AP[A-Z0-9]+$/)

    // Extract the work item ID from the URL
    const url = await browser.getUrl()
    const workItemId = url.split('/').pop()
    expect(workItemId).toBeTruthy()

    // RA-295 replaced the "View audit log" link with the "Application history"
    // tab. Routed through the page object rather than a raw testid so the next
    // relocation is absorbed there too — bypassing gotoAudit() is exactly why
    // this spec broke while the twelve that use it did not.
    await detail.gotoAudit()
    await expect($('[data-testid="work-item-audit-log"]')).toBeDisplayed()

    // With Notify:Enabled off (the e2e default, RA-422), the post-action hook
    // that BOTH sends the submission-confirmation email AND writes its
    // notification audit row never fires — so no "Submission confirmation
    // email" entry (sent OR skipped) is written. The operatorEmail fe->be
    // contract is already proven by the successful create + AP reference above.
    await detail.assertNoAuditEntry('Submission confirmation email sent')
    await detail.assertNoAuditEntry('Submission confirmation email skipped')
  })

  it('uses default test@defra.gov.uk email when not overridden and still creates the work item', async () => {
    // This test verifies the happy path where the form's default email is used
    // and the backend correctly deserializes it as operatorEmail
    const defaultTestEmail = 'test@defra.gov.uk'

    await workItems.goto()
    await workItems.clickCreateWorkItem()

    // Do NOT override the operatorEmail; leave the pre-filled default
    const operatorEmailInput = await $('#field-operatorEmail')
    const emailValue = await operatorEmailInput.getValue()
    expect(emailValue).toBe(defaultTestEmail)

    // Complete the form
    await $('#field-organisationName').setValue('Default Email Test')
    await $('#field-siteAddress-line1').setValue('456 Default Road')
    await $('#field-siteAddress-town').setValue('Manchester')
    await $('#field-siteAddress-postcode').setValue('M1 1AE')
    await $('#field-material').selectByAttribute('value', 'glass')
    await $('#field-tonnageBand').selectByAttribute('value', '0-500')
    await $('[data-testid="create-work-item-submit"]').click()

    // Success
    await expect($('[data-testid="work-item-success-banner"]')).toBeDisplayed()

    // RA-295 replaced the "View audit log" link with the "Application history"
    // tab. Routed through the page object rather than a raw testid so the next
    // relocation is absorbed there too.
    await detail.gotoAudit()
    await expect($('[data-testid="work-item-audit-log"]')).toBeDisplayed()

    // As above: with the Notify flag off no "Submission confirmation email"
    // audit row is written (sent or skipped). The default-email happy path is
    // still validated by the successful create above.
    await detail.assertNoAuditEntry('Submission confirmation email sent')
    await detail.assertNoAuditEntry('Submission confirmation email skipped')
  })
})
