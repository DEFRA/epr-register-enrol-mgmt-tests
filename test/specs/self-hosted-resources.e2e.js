import { browser, expect } from '@wdio/globals'

import login from '../page-objects/login.page.js'

/**
 * Every page asset is served from our own origin. Loading a font, stylesheet,
 * script or image from somewhere else (Google Fonts, a CDN) sends each
 * caseworker's IP address to that third party on every page load, which is a
 * personal-data transfer under UK GDPR. Roboto used to come from Google Fonts
 * for exactly this reason; it is now bundled by the frontend build.
 *
 * Google Analytics is the one sanctioned exception, and only behind cookie
 * consent. This suite runs with consent seeded as "rejected" (see
 * support/cookie-consent.js), so no third-party request is acceptable here.
 */

// The GA4 origins management-fe's CSP adds when analytics is switched on
// (src/server/common/analytics/origins.js). Nothing else may appear.
const ANALYTICS_ORIGINS = {
  'connect-src': [
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.googletagmanager.com'
  ],
  'img-src': ['https://*.google-analytics.com'],
  'script-src': ['https://www.googletagmanager.com']
}

const PAGES = [
  { name: 'logged-out page', path: '/auth/logged-out', signedIn: false },
  { name: 'cookies page', path: '/cookies', signedIn: false },
  { name: 'work items list', path: '/work-items', signedIn: true }
]

/**
 * Every URL the page loaded or points the browser at: requests the browser
 * actually made, resource-bearing elements in the DOM (a <link rel=preconnect>
 * to a third party leaks the IP address too, so every <link> counts), and
 * the url()s inside @font-face and @import rules. Fonts are read from the
 * stylesheets rather than from requests because the suite's Chrome runs with
 * --disable-remote-fonts, so it never downloads them.
 */
function collectResourceUrls() {
  return browser.execute(() => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name)

    const selectors = {
      'link[href]': 'href',
      'script[src]': 'src',
      'img[src]': 'src',
      'iframe[src]': 'src',
      'source[src]': 'src',
      'video[src]': 'src',
      'audio[src]': 'src',
      'embed[src]': 'src',
      'object[data]': 'data'
    }
    for (const [selector, attribute] of Object.entries(selectors)) {
      for (const el of document.querySelectorAll(selector)) {
        urls.push(new URL(el.getAttribute(attribute), document.baseURI).href)
      }
    }

    const fontFaces = []
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        // A cross-origin stylesheet hides its rules. Its own href is already
        // in `urls` above, which is what fails the assertion.
        continue
      }
      const base = sheet.href || document.baseURI
      for (const rule of rules) {
        if (rule instanceof window.CSSImportRule) {
          urls.push(new URL(rule.href, base).href)
        }
        if (rule instanceof window.CSSFontFaceRule) {
          const src = rule.style.getPropertyValue('src')
          for (const [, raw] of src.matchAll(
            /url\(\s*["']?([^"')]+)["']?\s*\)/g
          )) {
            const href = new URL(raw, base).href
            urls.push(href)
            fontFaces.push({
              family: rule.style
                .getPropertyValue('font-family')
                .replace(/["']/g, ''),
              weight: rule.style.getPropertyValue('font-weight'),
              style: rule.style.getPropertyValue('font-style'),
              href
            })
          }
        }
      }
    }

    return { origin: window.location.origin, urls, fontFaces }
  })
}

function thirdParty({ origin, urls }) {
  return [
    ...new Set(
      urls.filter((url) => {
        const { protocol } = new URL(url)
        if (protocol === 'data:' || protocol === 'blob:') {
          return false
        }
        return new URL(url).origin !== origin
      })
    )
  ]
}

async function contentSecurityPolicy() {
  const header = await browser.execute(async () => {
    const response = await fetch(window.location.href, {
      credentials: 'same-origin'
    })
    return response.headers.get('content-security-policy')
  })
  return Object.fromEntries(
    header
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources])
  )
}

describe('Self-hosted resources', () => {
  for (const { name, path, signedIn } of PAGES) {
    describe(name, () => {
      before(async () => {
        if (signedIn) {
          await login.login()
        }
        await browser.url(path)
      })

      after(async () => {
        if (signedIn) {
          await login.logout()
        }
      })

      it('loads nothing from a third-party origin', async () => {
        const resources = await collectResourceUrls()
        expect(resources.urls.length).toBeGreaterThan(0)
        expect(thirdParty(resources)).toEqual([])
      })

      it('serves Roboto from our own origin', async () => {
        const { origin, fontFaces } = await collectResourceUrls()
        const roboto = fontFaces.filter((f) => f.family === 'Roboto')

        // The three styles the layout uses: regular, italic and bold.
        const styles = new Set(roboto.map((f) => `${f.weight} ${f.style}`))
        expect([...styles].sort()).toEqual([
          '400 italic',
          '400 normal',
          '700 normal'
        ])

        // The build inlines the smallest subset files as data: URIs, which
        // make no request at all; every other file must be ours.
        const fetched = roboto.filter((f) => !f.href.startsWith('data:'))
        expect(fetched.length).toBeGreaterThan(0)
        for (const { href } of fetched) {
          expect(new URL(href).origin).toBe(origin)
        }

        // A same-origin url() that 404s would silently fall back to Arial,
        // so fetch the Latin files (the subset English text uses).
        const latin = roboto
          .map((f) => f.href)
          .filter((href) => /roboto-latin-\d+-(normal|italic)/.test(href))
        expect(latin.length).toBeGreaterThan(0)
        const statuses = await browser.execute(
          async (hrefs) =>
            Promise.all(hrefs.map(async (href) => (await fetch(href)).status)),
          latin
        )
        expect(statuses.every((status) => status === 200)).toBe(true)
      })
    })
  }

  describe('Content-Security-Policy header', () => {
    let csp

    before(async () => {
      await browser.url('/auth/logged-out')
      csp = await contentSecurityPolicy()
    })

    it('allows no third-party origin beyond the consent-gated analytics ones', () => {
      const unexpected = Object.entries(csp).flatMap(([directive, sources]) =>
        sources
          .filter((source) =>
            /^(https?:)?\/\/|^[\w*-]+(\.[\w*-]+)+/.test(source)
          )
          .filter(
            (source) => !(ANALYTICS_ORIGINS[directive] ?? []).includes(source)
          )
          .map((source) => `${directive} ${source}`)
      )
      expect(unexpected).toEqual([])
    })

    it('restricts fonts and stylesheets to our own origin', () => {
      expect(csp['font-src']).toEqual(["'self'", 'data:'])
      expect(csp['style-src']).toEqual(["'self'"])
    })
  })
})
