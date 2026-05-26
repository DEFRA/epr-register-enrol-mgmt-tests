import { browser, $, expect } from '@wdio/globals'
import login from 'page-objects/login.page.js'
import workItems from 'page-objects/work-items.page.js'

/**
 * RA-172 — Create work item page improvements.
 *
 * Acceptance criteria exercised here:
 *   • Application reference is auto-generated on page load.
 *   • Application reference is displayed as read-only (the user cannot
 *     edit it).
 *   • Email field exists and is pre-filled with `test@defra.gov.uk`.
 *   • Email field validates format on submit and shows an inline error
 *     for an invalid address.
 *   • Both fields are submitted to the backend on a valid POST.
 *
 * The full happy-path submission is covered by the existing
 * `management.e2e.js` journey (which reads the auto-generated reference
 * via the page object after RA-172); this spec focuses on field-level
 * behaviour and the negative validation path.
 */
describe('RA-172 create work item: application reference + email fields', () => {
  before(async () => {
    await login.loginAs('assign')
  })

  after(async () => {
    await login.logout()
  })

  it('auto-generates a read-only application reference and seeds the default email', async () => {
    await workItems.goto()
    await workItems.clickCreateWorkItem()

    const refInput = await $('#field-applicationReference')
    const refValue = await refInput.getValue()
    expect(refValue).toMatch(/^RA-\d{9}$/)

    // Read-only inputs are tagged with the `readonly` attribute; the
    // browser exposes this via the DOM `readOnly` property, so the
    // simplest cross-driver check is the attribute itself.
    const readOnlyAttr = await refInput.getAttribute('readonly')
    expect(readOnlyAttr).not.toBeNull()

    const emailInput = await $('#field-email')
    expect(await emailInput.getValue()).toBe('test@defra.gov.uk')
  })

  it('regenerates the application reference on each visit to the form', async () => {
    await workItems.goto()
    await workItems.clickCreateWorkItem()
    const first = await $('#field-applicationReference').getValue()

    await workItems.goto()
    await workItems.clickCreateWorkItem()
    const second = await $('#field-applicationReference').getValue()

    expect(first).toMatch(/^RA-\d{9}$/)
    expect(second).toMatch(/^RA-\d{9}$/)
    // 9-digit random — collisions across two clicks are vanishingly
    // rare. If this ever flakes we can mock the generator.
    expect(first).not.toBe(second)
  })

  it('rejects an invalid email address with an inline error', async () => {
    await workItems.goto()
    await workItems.clickCreateWorkItem()

    // Replace the seeded default with something obviously bad.
    const emailInput = await $('#field-email')
    await emailInput.setValue('not-an-email')

    await $('#field-organisationName').setValue('RA-172 Test Co')
    await $('#field-siteAddress-line1').setValue('1 Validation Way')
    await $('#field-siteAddress-town').setValue('Testville')
    await $('#field-siteAddress-postcode').setValue('TS1 1AA')
    await $('#field-material').selectByAttribute('value', 'plastic')
    await $('#field-tonnageBand').selectByAttribute('value', '0-500')
    await $('[data-testid="create-work-item-submit"]').click()

    // The page should re-render with the error summary still mounted
    // and the email-specific message visible somewhere on the page.
    const summary = await $('[data-testid="create-work-item-error-summary"]')
    await expect(summary).toBeDisplayed()
    await expect(summary).toHaveText(
      expect.stringContaining(
        'Enter an email address in the correct format, like name@example.com'
      )
    )

    // We must still be on the create page (no redirect on validation
    // failure) and the auto-generated reference should survive the
    // round-trip.
    expect(await browser.getUrl()).toEqual(
      expect.stringContaining('/work-items/re-accreditation/new')
    )
    expect(await $('#field-applicationReference').getValue()).toMatch(
      /^RA-\d{9}$/
    )
  })
})
