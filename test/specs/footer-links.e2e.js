import { $$, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'

/**
 * Footer links must resolve, not 404.
 *
 * The rebrand spec already asserts the footer links are *displayed*, but
 * "displayed" says nothing about where the href goes — every footer link
 * (Accessibility statement, Cookies, Feedback) once pointed at a route that
 * did not exist, so each one rendered the 404 error page while still passing
 * the "is displayed" check. This spec closes that gap: it walks every <a> in
 * the footer and proves each one actually resolves.
 *
 * Same-origin links are fetched (the session cookie rides along, since fetch
 * defaults to same-origin credentials) and must not come back 4xx/5xx.
 * Cross-origin links (e.g. a gov.uk guidance page) can't be fetched from the
 * page without tripping CORS, and following them would make the suite depend
 * on an external site staying up — so those are asserted to be well-formed
 * absolute https URLs rather than followed.
 */
describe('Footer links', () => {
  before(async () => {
    await login.login()
  })

  async function footerHrefs() {
    const links = await $$('.govuk-footer a')
    const hrefs = await Promise.all(
      [...links].map((link) => link.getAttribute('href'))
    )
    return hrefs.filter(Boolean)
  }

  it('renders at least one footer link', async () => {
    const hrefs = await footerHrefs()
    expect(hrefs.length).toBeGreaterThan(0)
  })

  it('has no broken (same-origin) footer links', async () => {
    const origin = new URL(await browser.getUrl()).origin
    const sameOrigin = (await footerHrefs())
      .map((href) => new URL(href, origin))
      .filter((url) => url.origin === origin)
      .map((url) => url.href)

    const results = await browser.execute(async (urls) => {
      const out = []
      for (const url of urls) {
        try {
          const res = await fetch(url, { redirect: 'follow' })
          out.push({ url, status: res.status })
        } catch (err) {
          out.push({ url, status: -1, error: String(err) })
        }
      }
      return out
    }, sameOrigin)

    const broken = results.filter((r) => r.status < 200 || r.status >= 400)
    // On failure Jest prints the received array, i.e. the offending
    // { url, status } pairs — enough to see which footer link is broken.
    expect(broken).toEqual([])
  })

  it('points external footer links at well-formed absolute https URLs', async () => {
    const origin = new URL(await browser.getUrl()).origin
    const external = (await footerHrefs())
      .map((href) => new URL(href, origin))
      .filter((url) => url.origin !== origin)

    for (const url of external) {
      expect(url.protocol).toBe('https:')
    }
  })
})
