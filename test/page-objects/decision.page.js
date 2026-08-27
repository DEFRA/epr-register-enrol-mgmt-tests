import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-410 — the "Log decision" page.
 *
 * Replaces the task-driven route to a determination. The
 * `assessment-in-progress` tasks and the `record-decision-rationale` task
 * that used to gate `submit-for-decision` / `approve` are deleted, so the
 * ONLY way a caseworker records an outcome is:
 *
 *   1. Green "Log decision" CTA on the detail page (assessment-in-progress only)
 *   2. GET  /work-items/re-accreditation/{id}/decision
 *   3. Pick Approved or Refused
 *   4. POST /work-items/re-accreditation/{id}/decision
 *
 * Same path for GET and POST, and NOTE THE `re-accreditation` SEGMENT: like
 * duly making, this is a module-specific route namespaced under
 * `/work-items/<type-id>/`, not a generic framework one.
 *
 * `awaiting-decision` still exists in the backend state machine but is an
 * internal hop applied server-side within this one call — the caseworker
 * never sees it and there is no affordance that parks an item there. A spec
 * asserting a visible `Awaiting decision` state is asserting the old design.
 *
 * "REFUSED" IS A LABEL CHANGE ONLY. The underlying state id is still
 * `rejected`, so backend/API assertions keep the old id while anything
 * user-visible reads "Refused". Do not "fix" one to match the other.
 *
 * RA-447 (CM8): copy-only changes throughout this page relabel "decision" as
 * "determination" — heading, warning text, radio legend, note label/hint and
 * submit button. No `data-testid` exists for the warning text or the note
 * hint; both are selected by the GOV.UK component's own class/id convention
 * (see warningText() / noteHint() below), same approach as
 * work-item-detail.page.js's ra98ReferenceBanner().
 *
 * RA-505 (CM): the last of that rename to land — the final BREADCRUMB read
 * "Log decision", the label of the CTA that navigates here, rather than
 * matching the page's own H1. See breadcrumbItems() at the foot of this file.
 */
class DecisionPage extends Page {
  path(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/decision`
  }

  /**
   * Navigate straight to the page, bypassing the CTA.
   *
   * Hiding a CTA is not a control — used by the guard specs to prove the
   * route itself refuses from the wrong state.
   */
  async gotoFor(workItemId) {
    await this.open(this.path(workItemId))
  }

  async assertOnPage() {
    await expect($('[data-testid="log-decision-submit"]')).toBeDisplayed()
  }

  /**
   * The outcome radios, keyed by the logical outcome name.
   *
   * SELECTED BY TESTID, NOT BY `value=`. management-fe holds the value
   * attributes open pending management-be's payload contract, so selecting
   * by value would need re-pointing the moment that lands; the testids are
   * firm. This is also why there is no `selectByAttribute('value', ...)`
   * anywhere in this file.
   *
   * `refused` maps to the radio whose visible label reads "Refused" and
   * whose underlying state is `rejected` — see the class comment.
   */
  outcomeRadio(outcome) {
    const testIds = {
      approved: 'decision-approved',
      refused: 'decision-refused'
    }
    const testId = testIds[outcome]
    if (!testId) {
      throw new Error(
        `Unknown decision outcome "${outcome}" (expected "approved" or "refused")`
      )
    }
    return $(`[data-testid="${testId}"]`)
  }

  async hasOutcomeRadio(outcome) {
    return this.outcomeRadio(outcome).isExisting()
  }

  /**
   * Select an outcome.
   *
   * GOV.UK radios hide the real `<input>` behind a styled label, so a plain
   * `.click()` on the input can land on an element the browser considers
   * obscured. `.click()` on the input still works in headless Chrome because
   * the input is only visually hidden rather than `display: none`, but the
   * selection is verified afterwards rather than assumed — a silently
   * unselected radio would otherwise surface as a confusing validation error
   * several steps later, which is the exact failure this page's negative
   * spec is meant to produce deliberately.
   */
  async selectOutcome(outcome) {
    const radio = this.outcomeRadio(outcome)
    await radio.waitForExist({
      timeout: 10000,
      timeoutMsg: `Expected a "${outcome}" radio on the Log decision page`
    })
    await radio.click()
    await browser.waitUntil(async () => radio.isSelected(), {
      timeout: 10000,
      timeoutMsg: `Expected the "${outcome}" radio to be selected after clicking it`
    })
  }

  async isOutcomeSelected(outcome) {
    return this.outcomeRadio(outcome).isSelected()
  }

  /**
   * The visible label text for an outcome, so a spec can assert the RA-410
   * rename ("Refused", not "Rejected") on the control the caseworker reads
   * rather than on the state id underneath it.
   */
  async outcomeLabelText(outcome) {
    const testIds = {
      approved: 'decision-approved',
      refused: 'decision-refused'
    }
    return $(`label[for="${testIds[outcome]}"]`).getText()
  }

  // ── RA-203 / RA-410: the decision note ───────────────────────────────────── //

  /**
   * The optional decision-note textarea (a `govukCharacterCount`, 2000 chars).
   *
   * THIS IS NOT COSMETIC AND MUST NOT BE DROPPED AGAIN. management-be's
   * notification hook builds the Decision email's `decision_notes`
   * personalisation from the work item's LATEST note, falling back to an empty
   * string when there is none. That fallback means a missing note never errors
   * — Notify only rejects an ABSENT key, never a blank one — so the email
   * simply sends with a blank rationale and nothing anywhere reports it.
   *
   * RA-410 briefly removed this field with the approve interstitial, and
   * because the withdraw note is the only other note source in the service
   * (and a withdrawn item never reaches a Decision email), that left no path
   * at all that put a note on a work item before a decision. `decision_notes`
   * was silently dead. This page object is the e2e guard against a repeat.
   *
   * ORDERING IS LOAD-BEARING: management-fe posts the note to the notes
   * endpoint BEFORE `/decision`, because the notification hook fires during
   * the decision write and reads the latest note. Posted after, the email
   * would carry the previous note or none — which is why the spec asserts the
   * audit ordering rather than merely that both entries exist.
   */
  noteField() {
    return $('[data-testid="log-decision-note"]')
  }

  async hasNoteField() {
    return this.noteField().isExisting()
  }

  /**
   * Value operations go through the `id`, not the testid.
   *
   * `govukCharacterCount` wraps its textarea in a div that carries the
   * component's own markup, so depending on where the testid is stamped
   * `getValue()` on it may resolve to the wrapper and return an empty string —
   * a silent false pass for the "note survives validation" assertion, which is
   * precisely the case that needs to be trustworthy. The id is the textarea
   * itself and is also what the error-summary links target, so it is the
   * stabler handle. Same reasoning as the duly-making date inputs.
   */
  noteInput() {
    return $('#field-decisionNote')
  }

  /**
   * RA-447 (CM8). The note field's hint text, auto-id'd by GOV.UK's
   * `govukCharacterCount` macro as `${id}-hint` — same convention as the
   * `field-decisionNote` id itself above.
   */
  noteHint() {
    return $('#field-decisionNote-hint')
  }

  async noteHintText() {
    return this.noteHint().getText()
  }

  /**
   * RA-447 (CM8). The GOV.UK warning text above the outcome radios ("This
   * determination is final..."). Selected by the component's own class,
   * not a testid — none exists for it.
   */
  warningText() {
    return $('.govuk-warning-text__text')
  }

  /**
   * Confirmed against a live run: govukWarningText renders a visually-hidden
   * "Warning" prefix (`.govuk-warning-text__assistive`) INSIDE this element
   * for screen readers, so `getText()` returns "Warning\n<the real copy>".
   * Stripped here so callers can assert the visible copy exactly rather than
   * every caller having to know about the assistive prefix.
   */
  async warningTextText() {
    const text = await this.warningText().getText()
    return text.replace(/^Warning\s*/, '').trim()
  }

  async setNote(text) {
    await this.noteInput().setValue(text)
  }

  async noteText() {
    return this.noteInput().getValue()
  }

  async submit() {
    await $('[data-testid="log-decision-submit"]').click()
  }

  /**
   * The submit button's visible label — renamed from "Log decision" to
   * "Make Determination" (RA-447 CM7), then sentence-cased to
   * "Make determination" (RA-447 CM8) for GOV.UK style consistency. The
   * `data-testid` is unchanged, so this reads text rather than existence to
   * guard the rename itself.
   */
  async submitButtonText() {
    return $('[data-testid="log-decision-submit"]').getText()
  }

  async cancel() {
    await $('[data-testid="log-decision-cancel"]').click()
  }

  // ── RA-505: the breadcrumb trail ─────────────────────────────────────────── //

  /**
   * RA-505. Every breadcrumb, in order, as `{ text, href }`.
   *
   * NO `data-testid` EXISTS HERE and none is expected to: the trail is
   * rendered by GOV.UK's own `govukBreadcrumbs` macro from the `breadcrumbs`
   * array the controller hands to `layouts/page.njk`, so the component's
   * documented class convention (`.govuk-breadcrumbs__list-item`) IS the
   * stable handle — same reasoning as warningText() and noteHint() above.
   *
   * `href` is `null` for the current-page crumb, which govukBreadcrumbs
   * renders as bare text inside the `<li>` rather than as a link. That is not
   * incidental: it is how a caller tells the FINAL crumb apart from a
   * same-labelled link earlier in the trail.
   *
   * Returned as an ordered list rather than a joined string because the point
   * of the RA-505 assertion is POSITION — "the last crumb reads X" is a
   * different claim from "X appears somewhere in the trail", and only the
   * first catches a crumb that is right but in the wrong slot.
   */
  async breadcrumbItems() {
    const crumbs = await $$('.govuk-breadcrumbs__list-item')
    const items = []
    for (const crumb of crumbs) {
      const link = await crumb.$('a')
      items.push({
        text: (await crumb.getText()).trim(),
        href: (await link.isExisting()) ? await link.getAttribute('href') : null
      })
    }
    return items
  }

  /** RA-505. Just the crumb labels, in order — the common assertion shape. */
  async breadcrumbTexts() {
    return (await this.breadcrumbItems()).map((item) => item.text)
  }

  /**
   * RA-505. The application reference this page is showing, read off the
   * `appHeading` caption ("Work item {ref}") rather than threaded in from the
   * detail page.
   *
   * Reading it HERE keeps the breadcrumb assertion self-contained: the middle
   * crumb has to match the reference on the page the user is actually looking
   * at, and a spec carrying a reference over from an earlier step could agree
   * with itself while both were wrong.
   */
  async applicationRefFromCaption() {
    const caption = await $('[data-testid="app-heading-caption"]').getText()
    return caption.replace(/^Work item\s*/, '').trim()
  }

  /**
   * Selected by testid, not by `.govuk-error-summary`, so this cannot latch
   * onto some other error summary that happens to be on the page — and so a
   * restyle of the GOV.UK component does not silently break the assertion.
   * Mirrors the duly-making page object for the same reason.
   */
  errorSummary() {
    return $('[data-testid="log-decision-error-summary"]')
  }

  async hasErrorSummary() {
    return this.errorSummary().isExisting()
  }

  /**
   * Wait for the error summary rather than reading it straight away: the
   * POST re-renders the page, so a bare read can race the navigation and
   * return the pre-submit DOM.
   */
  async assertErrorSummary(expectedMessage) {
    await browser.waitUntil(async () => this.hasErrorSummary(), {
      timeout: 10000,
      timeoutMsg:
        'Expected a GOV.UK error summary after submitting the Log decision form'
    })
    await expect(this.errorSummary()).toHaveText(
      expect.stringContaining('There is a problem')
    )
    if (expectedMessage) {
      await expect(this.errorSummary()).toHaveText(
        expect.stringContaining(expectedMessage)
      )
    }
  }

  /** The inline error message rendered against the radio group itself. */
  inlineError() {
    return $('[data-testid="decision-error"]')
  }

  async hasInlineError() {
    return this.inlineError().isExisting()
  }

  /**
   * Every error link's href. GOV.UK convention points the summary link at the
   * FIRST radio in the group (`#decision-approved`), so asserting it stops a
   * regression where the summary renders but its links go nowhere useful.
   */
  async errorSummaryLinkHrefs() {
    const links = await $$('[data-testid="log-decision-error-summary"] a')
    const hrefs = []
    for (const link of links) {
      hrefs.push(await link.getAttribute('href'))
    }
    return hrefs
  }

  /**
   * `timeout` defaults to 10s, which is right for a decision that lands
   * quickly — the happy path, where the OJ push is acknowledged at once. The
   * OJ-FAILURE path is different: the push is a pre-commit gate that retries
   * (5 retries / ~28s worst case per management-be) BEFORE the request returns
   * 500 and management-fe PRG-redirects here, so that caller passes a longer
   * timeout. Kept as one method rather than two so the redirect target stays
   * defined in a single place.
   */
  async waitForDetailUrl(workItemId, { timeout = 10000 } = {}) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after logging a decision`
      }
    )
  }

  async waitForDecisionUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === this.path(workItemId)
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to stay on ${this.path(workItemId)}`
      }
    )
  }
}

export default new DecisionPage()
