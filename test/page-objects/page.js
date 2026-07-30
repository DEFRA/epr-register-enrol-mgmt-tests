import { browser, $ } from '@wdio/globals'

/**
 * RA-295 (AC05). Viewports the responsive assertions are run at. "mobile" is
 * the GOV.UK Design System's smallest supported width (320px — iPhone SE and
 * equivalent), which is the width at which the two-column detail layout has to
 * collapse to a single column; "tablet" is the GOV.UK `tablet` breakpoint
 * (641px) where the collapse begins. Held here rather than in a spec so every
 * responsive assertion exercises the same widths.
 */
export const VIEWPORTS = {
  mobile: { width: 320, height: 720 },
  tablet: { width: 641, height: 900 },
  desktop: { width: 1280, height: 1024 }
}

class Page {
  get pageHeading() {
    return $('h1')
  }

  open(path) {
    return browser.url(path)
  }

  /**
   * RA-324 (AC01/AC03). The service navigation is part of the shared page
   * layout, so these hooks are present on every authenticated page (the
   * Applications list, a work-item detail page, etc.). Exposed on the base
   * Page so any page object can assert the nav persists across the journey.
   */
  navWorkItemsLink() {
    return $('[data-testid="nav-work-items"]')
  }

  navSignOut() {
    return $('[data-testid="nav-sign-out"]')
  }

  /**
   * RA-335. Only rendered in the service nav for a signed-in support user —
   * absent for a caseworker or a signed-out visitor.
   */
  navBackendStatusLink() {
    return $('[data-testid="nav-backend-status"]')
  }

  /**
   * RA-335. A number of case-panel affordances (reassign, unassign,
   * change/override due date, query, withdraw, approve, create work item)
   * have no native disabled state to lean on — neither a plain `<a>` nor a
   * govukButton-styled `<a href>` supports `disabled`, and the app renders
   * no JavaScript to intercept a click. For a read-only support user they
   * render as an inert `<span>` with no `href` instead (see
   * `action-link/macro.njk` in management-fe) — this is true whenever the
   * element at `testId` is a `<span>` rather than an `<a>`.
   */
  async isActionDisabled(testId) {
    const tagName = await $(`[data-testid="${testId}"]`).getTagName()
    return tagName.toLowerCase() === 'span'
  }

  /**
   * RA-295 (AC05). Resize the browser window to one of the VIEWPORTS above.
   *
   * `setWindowSize` sets the OUTER window size, so the usable viewport ends up
   * slightly smaller than the number asked for (chrome, scrollbars). The
   * responsive assertions below therefore all measure against the actual
   * `window.innerWidth` read back from the page rather than the requested
   * width — otherwise they would report phantom overflow on every run.
   *
   * Specs that resize MUST restore the desktop viewport in an `after` hook:
   * the window size is per-session, not per-spec, so a spec that leaves the
   * browser at 320px silently breaks every spec that runs after it.
   */
  async setViewport(name) {
    const { width, height } = VIEWPORTS[name]
    if (!width) {
      throw new Error(`Unknown viewport "${name}"`)
    }
    await browser.setWindowSize(width, height)
    // Layout is recalculated asynchronously after a resize; poll until the
    // page reports a viewport at (or below) the requested width so callers
    // never measure a half-applied layout.
    await browser.waitUntil(async () => (await this.viewportWidth()) <= width, {
      timeout: 5000,
      timeoutMsg: `Expected the viewport to resize to ${width}px`
    })
  }

  async resetViewport() {
    await this.setViewport('desktop')
  }

  viewportWidth() {
    return browser.execute(() => window.innerWidth)
  }

  /**
   * RA-295 (AC05). Whether the page body overflows horizontally — the classic
   * "responsive layout is broken" symptom, where content is pushed off the
   * right edge and can only be reached by scrolling sideways.
   *
   * A 1px allowance absorbs sub-pixel rounding in the layout engine, which
   * otherwise reports a fractional overflow on a perfectly fine page.
   */
  async hasHorizontalOverflow() {
    return browser.execute(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
    )
  }

  /**
   * RA-295 (AC05). Whether an element is fully inside the horizontal bounds of
   * the viewport, i.e. rendered without being clipped or pushed off-screen.
   *
   * `isDisplayed()` alone is NOT sufficient for the AC: an element positioned
   * at x=900 on a 320px viewport is still "displayed" as far as WebDriver is
   * concerned, but the user cannot read it. This measures the real box.
   */
  async isWithinViewport(element) {
    return browser.execute((el) => {
      if (!el) return false
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      return rect.left >= -1 && rect.right <= window.innerWidth + 1
    }, element)
  }
}

export { Page }
