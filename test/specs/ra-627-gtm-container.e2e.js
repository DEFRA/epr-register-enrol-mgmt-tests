import { browser, $, expect } from '@wdio/globals'

import {
  ANALYTICS_CONSENT_COOKIE,
  setCookieConsentSeeding
} from '../support/cookie-consent.js'
import {
  skipUnlessAnalyticsIsOn,
  takeCspViolations
} from '../support/analytics.js'

// The logged-out page needs neither a session nor the backend.
const PAGE = '/auth/logged-out'
const GTM_LIBRARY = 'https://www.googletagmanager.com/gtm.js?id='

// The compose stack runs a placeholder container; a deployed environment runs
// its own, so there only the shape of the id can be checked.
const expectedContainerId = process.env.ENVIRONMENT
  ? expect.stringMatching(/^GTM-[A-Z0-9]+$/)
  : 'GTM-LOCAL0000'

// Read in one go so the meta, the bundle and the tag are from the same page.
function readTag() {
  return browser.execute(() => {
    const meta = document.querySelector(
      'meta[name="analytics-gtm-container-id"]'
    )
    const srcsInHead = (selector) =>
      [...document.head.querySelectorAll(selector)].map((s) => s.src)

    return {
      containerId: meta?.getAttribute('content') ?? null,
      bundles: srcsInHead('script[type="module"][src*="/analytics"]'),
      tags: srcsInHead(
        'script[src^="https://www.googletagmanager.com/gtm.js"]'
      ),
      tagsOutsideHead: document.querySelectorAll(
        'body script[src^="https://www.googletagmanager.com/"]'
      ).length
    }
  })
}

async function expectNoTag() {
  expect(await readTag()).toEqual({
    containerId: null,
    bundles: [],
    tags: [],
    tagsOutsideHead: 0
  })
}

async function startUnanswered() {
  await browser.url(PAGE)
  await browser.deleteCookies({ name: ANALYTICS_CONSENT_COOKIE })
  await browser.url(PAGE)
}

async function accept() {
  await startUnanswered()
  await $('[data-testid="cookie-banner-accept"]').click()
  await expect($('[data-testid="cookie-banner-confirmation"]')).toBeDisplayed()
}

async function saveOnCookiesPage(choice) {
  await browser.url('/cookies')
  await $(`input[name="analytics"][value="${choice}"]`).click()
  await $('[data-testid="cookies-save"]').click()
  await expect($('[data-testid="cookies-saved"]')).toBeDisplayed()
}

describe('Google Tag Manager container', () => {
  before(async function () {
    setCookieConsentSeeding(false)
    await skipUnlessAnalyticsIsOn(this)
  })

  beforeEach(async () => {
    // Drop anything logged by earlier tests, so each sees only its own pages.
    await takeCspViolations()
  })

  after(() => {
    setCookieConsentSeeding(true)
  })

  it('is not loaded before the visitor answers', async () => {
    await startUnanswered()

    await expect($('[data-testid="cookie-banner"]')).toBeDisplayed()
    await expectNoTag()
  })

  it('loads once, from the built bundle, after the visitor accepts', async () => {
    await accept()

    // The bundle injects the tag after the page has parsed.
    await browser.waitUntil(async () => (await readTag()).tags.length > 0, {
      timeoutMsg: 'gtm.js was never added to the page'
    })
    const tag = await readTag()

    expect(tag.containerId).toEqual(expectedContainerId)
    expect(tag.tags).toEqual([`${GTM_LIBRARY}${tag.containerId}`])
    expect(tag.tagsOutsideHead).toBe(0)
    // Resolved through the Vite manifest, not the source path dev mode serves.
    expect(tag.bundles).toEqual([
      expect.stringMatching(/\/public\/assets\/analytics-[\w-]+\.js$/)
    ])
    expect(await takeCspViolations()).toEqual([])
  })

  it('keeps loading on later pages for a visitor who accepted', async () => {
    await accept()

    await browser.url('/cookies')

    await browser.waitUntil(async () => (await readTag()).tags.length > 0, {
      timeoutMsg: 'gtm.js was not added on the next page'
    })
    expect((await readTag()).tags).toHaveLength(1)
    expect(await takeCspViolations()).toEqual([])
  })

  it('is never loaded for a visitor who rejects', async () => {
    await startUnanswered()

    await $('[data-testid="cookie-banner-reject"]').click()
    await expectNoTag()

    await browser.url(PAGE)
    await expectNoTag()
  })

  it('stops loading once consent is withdrawn on the cookies page', async () => {
    await accept()

    await saveOnCookiesPage('rejected')
    await expectNoTag()

    await browser.url(PAGE)
    await expectNoTag()
  })
})
