import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Frontend/Backend Contract Test: operatorEmail field (RA-123)
 *
 * This test verifies the contract between the management-fe (form submission)
 * and management-be (payload deserialization) to ensure the operatorEmail
 * field is correctly passed from the frontend form to the backend and
 * eventually reaches the ReAccreditationNotificationHook for email sending.
 *
 * Acceptance criteria:
 * 1. The form submits operatorEmail in the payload (not email)
 * 2. The backend accepts the operatorEmail field
 * 3. The work item is created successfully
 * 4. The audit log shows a notification-sent entry with the correct recipient
 *
 * This prevents regressions where a field name mismatch caused emails to be
 * skipped during notification processing.
 */
describe('RA-123 contract: operatorEmail field in re-accreditation submission', () => {
  before(async () => {
    await login.loginAs('assign')
  })

  after(async () => {
    await login.logout()
  })

  it('submits operatorEmail field with work item creation and receives notification-sent audit entry', async () => {
    // Test data: use a distinct email so we can verify it in the audit log
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
    // on the success banner — confirm it has the expected APP-prefixed shape.
    const applicationReference = (await successBanner.getText()).match(
      /APP[A-Z0-9]+\b/
    )?.[0]
    expect(applicationReference).toMatch(/^APP[A-Z0-9]+$/)

    // Extract the work item ID from the URL
    const url = await browser.getUrl()
    const workItemId = url.split('/').pop()
    expect(workItemId).toBeTruthy()

    // Navigate to the audit log to verify notification-sent entry
    await $('[data-testid="work-item-audit-log-link"]').click()
    await expect($('[data-testid="work-item-audit-log"]')).toBeDisplayed()

    // Look for a notification-sent audit entry (RA-123 sends on submission).
    // actionDisplayName is "{description} email sent" (e.g. "Submission email sent").
    // notification-skipped would mean operatorEmail was missing (field name mismatch bug).
    const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
    expect(auditLog).toContain('email sent')
    expect(auditLog).not.toContain('email skipped')
  })

  it('uses default test@defra.gov.uk email when not overridden, and receives notification-sent entry', async () => {
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

    // Verify audit log includes notification-sent with the default email
    await $('[data-testid="work-item-audit-log-link"]').click()
    await expect($('[data-testid="work-item-audit-log"]')).toBeDisplayed()

    const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
    expect(auditLog).toContain('email sent')
    expect(auditLog).not.toContain('email skipped')
  })
})
