import { $, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-358 — the work-item "not found" page.
 *
 * management-fe renders `routes/work-items/not-found.njk` from two places:
 *   1. GET /work-items/{id}                              — unknown work item
 *   2. GET /work-items/{id}/actions/{actionId}/confirm   — unknown work item
 *      reached via a withdraw/query confirmation link
 * Both branches share the same view, so both are exercised through this one
 * page object rather than duplicating selectors per route.
 *
 * The point of RA-358 (AC2) is that this page must be worded in APPLICATION
 * terms and must stop parading the system-generated work-item GUID at the
 * user as though it were their reference. The assertions below are therefore
 * deliberately split: "the page rendered" is keyed on a stable test id, while
 * "the GUID is not the user-facing identifier" is a separate, explicit check
 * against the heading and the body copy.
 *
 * Copy is asserted loosely (a case-insensitive "not found" match) rather than
 * byte-for-byte: the exact wording is management-fe's to own and is expected
 * to be tuned by content design, and pinning it here would turn every copy
 * tweak into a red build for no gain in what is actually under test. The
 * things RA-358 genuinely fixes — the page renders, and the GUID is gone —
 * are asserted exactly.
 *
 * A syntactically valid but non-existent work item id.
 *
 * Deliberately a well-formed GUID rather than a junk string: RA-358 (AC2) is
 * about the id that LOOKS like a real work-item id, which is what a user
 * actually sees when they follow a stale link. A malformed id can short
 * circuit into a different (validation) branch upstream, which would silently
 * stop testing the thing the AC is about.
 */
export const UNKNOWN_WORK_ITEM_ID = '3a58f000-0000-4358-8358-000000000358'

/** Page object for the work-item not-found view — see the note above. */
class WorkItemNotFoundPage extends Page {
  body() {
    return $('[data-testid="work-item-not-found"]')
  }

  async gotoWorkItem(id) {
    await this.open(`/work-items/${id}`)
  }

  async gotoActionConfirm(id, actionId = 'withdraw') {
    await this.open(`/work-items/${id}/actions/${actionId}/confirm`)
  }

  /**
   * Assert the not-found view rendered. Waits on the body test id rather than
   * the heading so a copy change to the `h1` cannot make this hang for the
   * full timeout.
   */
  async assertRendered() {
    await this.body().waitForDisplayed({
      timeout: 10000,
      timeoutMsg: 'Expected the work-item not-found page to render'
    })
    await expect(this.pageHeading).toHaveText(/not found/i)
  }

  /**
   * The whole heading block, not just the `h1`.
   *
   * management-fe's `appHeading` macro renders the caption as a SIBLING of the
   * `h1` inside `[data-testid="app-heading"]`, and the caption is exactly
   * where the old page put the GUID ("Work item {guid}"). Reading only the
   * `h1` would therefore let the very regression RA-358 fixes slip through.
   * Falls back to the `h1` if the macro is not used on this page.
   */
  async headingText() {
    const block = await $('[data-testid="app-heading"]')
    if (await block.isExisting()) {
      return block.getText()
    }
    return this.pageHeading.getText()
  }

  async bodyText() {
    return this.body().getText()
  }

  /**
   * The small, explicitly-labelled support/diagnostic line. RA-358 keeps the
   * raw id here — quotable when reporting a problem — and nowhere else. It is
   * optional by design (management-fe omits it when there is no id to show),
   * so callers must not assume it exists.
   */
  diagnostic() {
    return $('[data-testid="work-item-not-found-diagnostic"]')
  }

  /** The "Back to all applications" link — the way out of a dead link. */
  backLink() {
    return $('[data-testid="work-item-not-found-back"]')
  }

  /**
   * RA-358 (AC2). The page must talk about the user's APPLICATION rather than
   * about an internal "work item" record.
   */
  async assertWordedInApplicationTerms() {
    await expect(this.pageHeading).toHaveText(/application/i)
    await expect(this.body()).toHaveText(/application/i)
  }

  /**
   * RA-358 (AC2). The system-generated work-item id must not be presented to
   * the user as the identifier of their case.
   *
   * Scoped to the heading (including its caption) and the not-found body copy
   * — the two places the old page put the GUID in front of the user. It is
   * deliberately NOT a whole-`<body>` scan: the id legitimately survives in
   * the URL and in `data-testid` attributes, and asserting its total absence
   * from the DOM would fail on those without saying anything about what the
   * user reads.
   */
  async assertIdNotPresentedToUser(id) {
    const heading = await this.headingText()
    const body = await this.bodyText()
    expect(heading).not.toContain(id)
    expect(body).not.toContain(id)

    // If the id does survive on the page it may live ONLY in the labelled
    // support/diagnostic line. Asserted positively rather than left implicit,
    // so re-introducing it anywhere else in the visible copy fails here.
    if (await this.diagnostic().isExisting()) {
      const diagnostic = await this.diagnostic().getText()
      const elsewhere = (await this.visibleText()).replace(diagnostic, '')
      expect(elsewhere).not.toContain(id)
    }
  }

  /**
   * All visible text in the page's main content region. Scoped to `main`
   * rather than `body` so the id in the URL bar, in `data-testid` attributes
   * or in a hidden template never counts as "shown to the user".
   */
  async visibleText() {
    return $('main').getText()
  }
}

export default new WorkItemNotFoundPage()
