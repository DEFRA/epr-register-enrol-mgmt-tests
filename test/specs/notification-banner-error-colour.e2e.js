import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'

/**
 * Error notification banners must be red, not the service green.
 *
 * Bug: core/_header.scss re-brands the service green by setting
 * `--govuk-brand-colour` on `:root`, and govuk-frontend draws the
 * notification banner's border and header from that brand colour. Both
 * "Could not reach the backend" banners (the worklist one in index.njk and
 * the 502 one in detail-error.njk) therefore rendered with a green border and
 * a green header — an error styled as a success.
 *
 * Fix (management-fe): an `.app-notification-banner--error` modifier that
 * recolours the banner with GOV.UK's error red, applied to both banners.
 *
 * What this spec covers, and why it is shaped this way: the banners only
 * render when the backend is unreachable or returns a non-2xx, which this
 * environment cannot bring about from the browser without bespoke infra —
 * the same reason error-pages.e2e.js skips its 502 case. So the modifier's
 * presence on the templates is asserted at unit level (management-fe
 * controller tests), and what is asserted HERE is the half those unit tests
 * cannot see: that the compiled stylesheet actually served to the browser
 * paints the modifier red. The banner markup is injected into a real served
 * page so the real application.css decides the colour.
 */

/** GOV.UK error red — `govuk-functional-colour(error)`. */
const ERROR_RED = '#ca3535'

/** The Defra service brand green the banner inherited before the fix. */
const BRAND_GREEN = '#00a33b'

const HARNESS_ID = 'banner-colour-harness'

/**
 * Append two notification banners to the page under test — one plain, one
 * carrying the error modifier — so their computed colours can be compared
 * against each other rather than against a hard-coded expectation alone.
 */
function injectBanners(harnessId) {
  const wrapper = document.createElement('div')
  wrapper.id = harnessId
  wrapper.innerHTML = `
    <div class="govuk-notification-banner" data-testid="banner-plain">
      <div class="govuk-notification-banner__header">
        <h2 class="govuk-notification-banner__title">Plain</h2>
      </div>
      <div class="govuk-notification-banner__content">Body</div>
    </div>
    <div class="govuk-notification-banner app-notification-banner--error" data-testid="banner-error">
      <div class="govuk-notification-banner__header">
        <h2 class="govuk-notification-banner__title">Could not reach the backend</h2>
      </div>
      <div class="govuk-notification-banner__content">Backend returned 401</div>
    </div>`
  document.querySelector('main, body').append(wrapper)
}

function removeBanners(harnessId) {
  document.getElementById(harnessId)?.remove()
}

describe('Error notification banner colour', () => {
  before(async () => {
    await login.login()
    await workItems.goto()
    await browser.execute(injectBanners, HARNESS_ID)
  })

  after(async () => {
    await browser.execute(removeBanners, HARNESS_ID)
    await login.logout()
  })

  it('paints the error banner border GOV.UK red', async () => {
    const border = await $('[data-testid="banner-error"]').getCSSProperty(
      'border-top-color'
    )
    expect(border.parsed.hex).toBe(ERROR_RED)
  })

  it('paints the error banner header GOV.UK red', async () => {
    const header = await $(
      '[data-testid="banner-error"] .govuk-notification-banner__header'
    ).getCSSProperty('background-color')
    expect(header.parsed.hex).toBe(ERROR_RED)
  })

  it('does not leave the error banner in the service green', async () => {
    // The exact bug symptom. Asserted separately from the red assertions
    // above so a future palette change that moves the red still reports the
    // green regression distinctly.
    const border = await $('[data-testid="banner-error"]').getCSSProperty(
      'border-top-color'
    )
    const header = await $(
      '[data-testid="banner-error"] .govuk-notification-banner__header'
    ).getCSSProperty('background-color')
    expect(border.parsed.hex).not.toBe(BRAND_GREEN)
    expect(header.parsed.hex).not.toBe(BRAND_GREEN)
  })

  it('leaves a banner without the modifier on the service brand colour', async () => {
    // Proves the red above comes from the modifier rather than from a global
    // change to every notification banner in the service.
    const border = await $('[data-testid="banner-plain"]').getCSSProperty(
      'border-top-color'
    )
    expect(border.parsed.hex).toBe(BRAND_GREEN)
  })
})
