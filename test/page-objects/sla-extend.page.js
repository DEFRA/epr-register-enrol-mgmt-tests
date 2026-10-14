import { $, browser, expect } from '@wdio/globals'
import { Page } from './page.js'
import { gdsDateFromParts } from '../support/sla-extend-date.js'

/**
 * RA-611. The two floor rejections, as MESSAGE BUILDERS rather than literals.
 *
 * They live here, in the page object, for the reason every other copy getter on
 * this class does: three spec files assert them (ra-611, ra-601 and ra-131), and
 * the AC requires the SAME sentence in the error summary and against the field.
 * Six literals spread over three files is six chances for the copy to drift out
 * of step with management-fe, and a drifted literal fails in a way that looks
 * like a broken build.
 *
 * NO TRAILING FULL STOP, and every assertion on them is `toContain` rather than
 * `toBe`. That is deliberate, not laziness. management-fe's own validator
 * renders these without a terminal period; management-be's 422 `detail` for the
 * same two rejections renders them WITH one. The wording, the `d MMMM yyyy`
 * date rendering and the tie-break are identical in both layers — only the
 * punctuation differs, and which layer a given rejection is caught by is
 * management-fe's business, not this suite's. Matching the shorter form with
 * `toContain` holds against both, so the discrepancy cannot fail these specs
 * whichever way the two repos settle it. (Both authors have been told; neither
 * is changing on this suite's account.)
 *
 * The field-level getter's text additionally carries GOV.UK's visually-hidden
 * "Error:" prefix, which is a second, independent reason `toBe` would be wrong.
 */
const belowDulyMadeError = (dulyMadeOn) =>
  `The new determination deadline cannot be earlier than ${gdsDateFromParts(
    dulyMadeOn
  )}, when the application was duly made`

const beforeYearStartError = (year) =>
  `The new determination deadline cannot be earlier than 1 January ${year}`

/**
 * RA-611. The 1-January bound the SECOND revision shipped, and which QA rejected
 * on 5-Oct-2026.
 *
 * Asserted ABSENT by `assertDeadlineError`, alongside the two withdrawn bounds,
 * because the wording of the correct message and the broken one is IDENTICAL
 * apart from the year — so a spec that checked only "an error naming 1 January
 * appeared" passed against the build that refused every date in the current
 * year. The year is the whole defect, and the only way to assert it is to assert
 * the year.
 *
 * Built from the current year rather than written down: the broken bound read the
 * payload's `accreditationYear`, which is the year the accreditation is VALID FOR
 * and always AHEAD of determination, so the sentence to refuse is the one naming
 * 1 January of ANY year after this one.
 */
const aheadOfCurrentYearFloorError = (currentYear) =>
  `cannot be earlier than 1 January ${currentYear + 1}`

/**
 * RA-611. The floor the FIRST revision of RA-611 shipped, before Anthony Moody
 * corrected the spec on 29-Sep-2026.
 *
 * Asserted ABSENT, not present. Backdating is legal again, so a build still
 * carrying this sentence has kept the superseded rule — and it would fail the
 * acceptance cases in a way that is easy to misread as an unrelated regression.
 * Naming the retired copy and checking it is gone says what actually happened.
 *
 * Matched on the distinctive tail rather than the whole sentence so it still
 * catches the message if its opening clause is reworded.
 */
const RETIRED_TODAY_FLOOR_ERROR = 'cannot be earlier than today'

/** The bound RA-601 removed. It must not return as a side effect of RA-611. */
const REMOVED_EXTENSION_ONLY_ERROR = 'must be after the current deadline'

/**
 * RA-131 — SLA extend.
 *
 * Single-step flow:
 *   1. GET  /work-items/{id}/sla/extend  — input page (form)
 *   2. POST /work-items/{id}/sla/extend  — apply via the backend and
 *                                          redirect back to the work
 *                                          item with a flash banner.
 *
 * Cancel from the input page returns to the detail page without
 * changes. Inputs and buttons are tagged with stable data-testids —
 * see the matching .njk template.
 *
 * RA-447 (CM5/CM6), implemented together per the signed-off plan since both
 * land in the same fe files:
 *   - CM5: relabelled "SLA" -> "Determination Deadline" on this page (page
 *     title/heading/breadcrumb, hint, button, success banner).
 *   - CM6: the `additionalDays` count input is replaced with a GOV.UK date
 *     input for the new due date — no upper limit, and the date must be
 *     strictly AFTER the current due date (extension only, never a
 *     reduction). Copied from the duly-making page's existing
 *     govukDateInput + validator pattern (see duly-making.page.js).
 *
 * RA-601 removed CM6's extension-only lower bound, so the deadline may be
 * moved in either direction: earlier than the current deadline is valid. At
 * the time it left NO floor at all — earlier than today and earlier than the
 * SLA clock's `startedAt` were valid too, and the no-op was the only rejection
 * left. RA-611 has since withdrawn that part; read the paragraph below before
 * relying on any of it. The route, the form and every `sla-extend-*` testid
 * were unchanged, so RA-601 only added the error-text getter needed to tell
 * the surviving rejection from the removed one.
 *
 * RA-611 reinstates a floor, but not the one RA-601 removed. Its first revision
 * floored the deadline at TODAY; Anthony Moody corrected the spec on
 * 29-Sep-2026 and BACKDATING IS LEGAL AGAIN. What the deadline may not fall
 * below is
 *
 *   the LATER of (a) the SLA clock's start date — the duly-made anchor — and
 *                (b) 1 January of the CURRENT calendar year,
 *
 * compared as Europe/London calendar dates, strictly below, so a deadline
 * landing exactly on the floor is accepted. Moving the deadline earlier than the
 * current deadline stays valid; so does moving it into the past, provided it
 * clears the floor.
 *
 * The form therefore has THREE rejections, which is why the getters below reach
 * the summary's title and link and the field-level message separately, and why
 * the two floor messages are built rather than hard-coded: asserting merely that
 * "an error summary appeared" cannot tell the duly-made bound from the
 * 1-January bound, nor either from the no-op guard, nor any of them from the
 * extension-only bound if it ever came back. Both floor messages NAME A DATE,
 * so they are not guessable and were confirmed with management-fe and
 * management-be rather than inferred.
 *
 * The route, the form and every `sla-extend-*` testid are unchanged once more;
 * the field error is read off govukDateInput's own generated
 * `#new-deadline-error` id.
 *
 * The date input's ids are `new-deadline-{day,month,year}`, confirmed
 * against management-fe's CM6 implementation once it landed (this repo
 * originally guessed `field-newDueDate-*`, following the `field-<name>`
 * convention used elsewhere on this page — the real markup uses its own
 * `new-deadline` prefix instead).
 *
 * RA-572 retires the sibling Override flow and makes THIS the single route
 * for amending a determination deadline, reworded from "extend" to "change".
 * The route and every `sla-extend-*` testid are deliberately unchanged —
 * management-fe treated it as a content + removal change, not a rename — so
 * only the copy getters below are affected. The override-absence helpers at
 * the end of this class live here rather than in a page object of their own
 * precisely because there is no Override page left to model.
 */
class SlaExtendPage extends Page {
  /**
   * RA-351 — the "Change the due date" entry point in the work-item detail
   * page's assignment panel.
   *
   * This link lives in the ASSIGNMENT panel, gated on `canChangeDueDate`, and
   * is deliberately filtered out of the actions panel's `availableActions`
   * (see work-item-detail.page.js `availableActionIds()`), so it never passes
   * through the workflow engine's action gate. RA-351 makes `canChangeDueDate`
   * true in the `queried` state, where it was previously hidden.
   */
  actionLink() {
    return $('[data-testid="action-sla-extend"]')
  }

  /**
   * RA-351 (AC1). Assert the assignment-panel "Change the due date" link is
   * present and points at the extend flow for this work item.
   */
  async assertActionLinkFor(workItemId) {
    await expect(this.actionLink()).toBeDisplayed()
    const href = await this.actionLink().getAttribute('href')
    expect(href).toContain(`/work-items/${workItemId}/sla/extend`)
  }

  async gotoFor(workItemId) {
    await this.open(`/work-items/${workItemId}/sla/extend`)
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  async fillForm({ reason, date } = {}) {
    if (reason !== undefined) {
      await $('#field-reason').setValue(reason)
    }
    if (date !== undefined) {
      await this.setDate(date)
    }
  }

  dayInput() {
    return $('#new-deadline-day')
  }

  monthInput() {
    return $('#new-deadline-month')
  }

  yearInput() {
    return $('#new-deadline-year')
  }

  /**
   * Fill the new-due-date parts. Any part may be omitted to exercise the
   * incomplete-date branch; parts are cleared first so a re-submit after a
   * validation error does not inherit the previous attempt's digits — same
   * reasoning as duly-making's setPaymentDate().
   */
  async setDate({ day, month, year } = {}) {
    const parts = [
      [this.dayInput(), day],
      [this.monthInput(), month],
      [this.yearInput(), year]
    ]
    for (const [field, value] of parts) {
      await field.setValue('')
      if (value !== undefined && value !== null && value !== '') {
        await field.setValue(String(value))
      }
    }
  }

  async submitForm() {
    await $('[data-testid="sla-extend-submit"]').click()
  }

  /**
   * CM5 renamed this away from "Extend SLA"; RA-572 renames it again to
   * "Change determination deadline".
   */
  async submitButtonText() {
    return $('[data-testid="sla-extend-submit"]').getText()
  }

  /**
   * RA-572 (AC02). The reason field's label, now "Reason for change".
   *
   * Selected by GOV.UK's own `label[for=]` convention rather than a testid,
   * since management-fe does not tag the label — same approach the retired
   * override page object used, and the same one used for the hint below.
   */
  async reasonLabelText() {
    return $('label[for="field-reason"]').getText()
  }

  async cancelFromInputPage() {
    await $('[data-testid="sla-extend-cancel"]').click()
  }

  async assertOnInputPage() {
    await expect($('[data-testid="sla-extend-form"]')).toBeDisplayed()
  }

  /** CM5: the page heading, renamed from "SLA" to "Determination Deadline". */
  async pageHeadingText() {
    return this.pageHeading.getText()
  }

  /**
   * Selected by testid rather than by `.govuk-error-summary`, so this cannot
   * latch onto an error summary rendered by some other component on the page.
   */
  errorSummary() {
    return $('[data-testid="sla-extend-error-summary"]')
  }

  async assertErrorSummaryDisplayed() {
    await expect(this.errorSummary()).toBeDisplayed()
  }

  /**
   * RA-601. The error summary's rendered text, so a spec can pin WHICH
   * rejection fired rather than merely that one did.
   *
   * RA-601 leaves exactly one rejection on this form (the no-op) where there
   * were previously two (the no-op and the extension-only lower bound). A
   * spec that only asserted "an error summary appeared" would still pass if
   * the removed lower bound came back, because the wrong guard firing looks
   * identical to the right one.
   */
  async errorSummaryText() {
    return this.errorSummary().getText()
  }

  /**
   * RA-611. The error summary's TITLE, so a spec can pin the GOV.UK
   * "There is a problem" heading the AC names rather than inferring it from
   * the body text.
   *
   * Scoped inside the summary's testid: `.govuk-error-summary__title` on its
   * own would match any error summary on the page.
   */
  async errorSummaryTitleText() {
    return this.errorSummary().$('.govuk-error-summary__title').getText()
  }

  /**
   * RA-611. Where the error summary's link points.
   *
   * GOV.UK requires the summary link to move focus to the offending field, and
   * for this three-box date input management-fe anchors it at the DAY box
   * (`EXTEND_DEADLINE_ANCHOR` in sla.controller.js) so focus lands on the first
   * field of the group. Worth pinning: a summary whose link goes nowhere is an
   * accessibility defect that renders identically to a correct one.
   */
  async errorSummaryLinkHref() {
    return this.errorSummary().$('a').getAttribute('href')
  }

  /**
   * RA-611. The FIELD-LEVEL error message on the new-deadline date input.
   *
   * The AC asks for the message in two places — the summary at the top and
   * against the field itself — and only the summary was previously reachable
   * from this page object, so a build that rendered the summary alone would
   * have passed.
   *
   * `#new-deadline-error` is govukDateInput's own generated id for the
   * `errorMessage` it is passed (`{id}-error`), where `new-deadline` is the
   * `dateInputId` the controller supplies. No testid exists because the
   * element is generated inside the GOV.UK macro rather than written by
   * management-fe — adding one would mean forking the macro.
   *
   * The returned text carries GOV.UK's visually-hidden "Error:" prefix, so
   * callers must use `toContain` rather than `toBe`.
   */
  deadlineFieldError() {
    return $('#new-deadline-error')
  }

  async deadlineFieldErrorText() {
    return this.deadlineFieldError().getText()
  }

  /**
   * RA-611. Assert BOTH renderings of the same rejection: the summary at the
   * top of the page and the message against the date input.
   *
   * Kept as one helper because the AC treats them as one requirement and
   * because every caller wants the same text in both places — letting a spec
   * assert one and forget the other is the failure mode this exists to close.
   */
  async assertDeadlineError(message) {
    await this.assertErrorSummaryDisplayed()
    await this.assertOnInputPage()
    expect(await this.errorSummaryTitleText()).toBe('There is a problem')
    expect(await this.errorSummaryText()).toContain(message)
    await expect(this.deadlineFieldError()).toBeDisplayed()
    expect(await this.deadlineFieldErrorText()).toContain(message)
    // Whatever rejection fired, it must not be either of the two bounds that
    // have been withdrawn. Folded in here rather than left to each caller
    // because it is true of EVERY rejection this form can produce — the no-op
    // included — and a guard that only the floor specs remember to apply is a
    // guard that stops being applied. Neither retired sentence is a substring
    // of any surviving one, so this cannot fire spuriously.
    const summary = await this.errorSummaryText()
    expect(summary).not.toContain(RETIRED_TODAY_FLOOR_ERROR)
    expect(summary).not.toContain(REMOVED_EXTENSION_ONLY_ERROR)
  }

  /**
   * RA-611 (AC3). Submit `date` and expect it refused for falling below the
   * DULY-MADE ANCHOR, with the message naming `dulyMadeOn`.
   *
   * `dulyMadeOn` is day/month/year parts, not a formatted string, so the caller
   * passes the same value it fed to the payment-date field during duly-making
   * and the rendering happens in one place. A caller that formatted the date
   * itself would be free to format it differently from management-fe, and the
   * spec would then fail for a punctuation reason dressed up as a floor bug.
   *
   * WHICH BOUND FIRES MATTERS, so use this rather than the generic
   * `expectDeadlineRejected` wherever the duly-made bound is the one under
   * test: only the later of the two bounds binds, and a build that got the
   * `max()` backwards would still reject this date — just with the other
   * sentence. Naming the expected message is what tells the two apart.
   */
  async expectRejectedBelowDulyMade(workItemId, { reason, date, dulyMadeOn }) {
    await this.expectDeadlineRejected(workItemId, {
      reason,
      date,
      message: belowDulyMadeError(dulyMadeOn)
    })
    // NOTHING FURTHER IS ASSERTED HERE, and the obvious extra check is a trap
    // worth naming. The two floor messages share their first eight words, so it
    // is tempting to add `not.toContain('1 January')` to prove the sibling bound
    // did not fire. It would be redundant at best and misleading at worst: the
    // clause "when the application was duly made" is the real discriminator, it
    // is absent from the 1-January message by construction, and `toContain` on
    // the full built message above already requires it. (An anchor landing on
    // 1 January cannot reach this helper at all — both layers tie-break a shared
    // date to the 1-January wording.)
  }

  /**
   * RA-611 (AC4). Submit `date` and expect it refused for falling below
   * 1 January of the CURRENT calendar year, where that is the LATER bound.
   *
   * `year` is the run's own Europe/London calendar year — the caller passes it
   * from `ukCalendarYear`, which is where management-fe takes it from too. It is
   * NOT the work item's accreditation year: that was the defect, the field means
   * the year the accreditation is valid for, and it is always ahead of
   * determination.
   *
   * REACHABLE ON ANY WORK ITEM whose duly-made anchor falls before 1 January,
   * which the ordinary journey can arrange by back-dating the payment date — see
   * `preYearStartAnchorDaysAgo`. The previous revision needed a seeded fixture
   * because the bound read a payload field that nothing created through the
   * case-management UI carries; the current year is always resolvable, so it
   * no longer does.
   */
  async expectRejectedBeforeYearStart(workItemId, { reason, date, year }) {
    await this.expectDeadlineRejected(workItemId, {
      reason,
      date,
      message: beforeYearStartError(year)
    })
    // THE DEFECT QA FOUND, ASSERTED GONE. `assertDeadlineError` already requires
    // the message to name 1 January of `year`; this additionally requires it not
    // to name 1 January of the year AFTER, which is what the accreditation-year
    // reading produced. Checked here rather than in `assertDeadlineError`
    // because only this bound can render that sentence.
    expect(await this.errorSummaryText()).not.toContain(
      aheadOfCurrentYearFloorError(year)
    )
    // The duly-made bound must not be what fired: its message is the one that
    // carries this clause, and on a tie the 1-January wording is specified to
    // win.
    expect(await this.errorSummaryText()).not.toContain(
      'when the application was duly made'
    )
  }

  /**
   * RA-611. What the re-rendered form still holds after a rejected submit.
   *
   * GOV.UK's error pattern requires a rejected form to come back with the
   * user's own answers in it, so they can correct the one field that was wrong
   * rather than retype everything. That is invisible to an assertion on the
   * error message alone, and losing it is an easy regression to ship when a
   * validator is added.
   */
  async submittedValues() {
    return {
      reason: await $('#field-reason').getValue(),
      day: await this.dayInput().getValue(),
      month: await this.monthInput().getValue(),
      year: await this.yearInput().getValue()
    }
  }

  /**
   * RA-611. Fill the form, submit it, and assert it came back rejected with
   * `message`.
   *
   * The mirror of `changeDeadline()` for the rejection path. `changeDeadline`
   * waits for the detail URL and so cannot be used here — a rejected submit
   * re-renders the form (400) and never redirects.
   */
  async expectDeadlineRejected(workItemId, { reason, date, message }) {
    await this.gotoFor(workItemId)
    await this.fillForm({ reason, date })
    await this.submitForm()
    await this.assertDeadlineError(message)
  }

  /**
   * RA-601. Open the form, fill it, submit, and land back on the work item.
   *
   * The happy path is now driven from several specs and from other specs'
   * fixture setup; keeping the four steps together here stops each caller
   * re-deriving the wait. Callers that expect a REJECTION must not use this —
   * it waits for the detail page, which a rejected submit never reaches.
   */
  async changeDeadline(workItemId, { reason, date }) {
    await this.gotoFor(workItemId)
    await this.fillForm({ reason, date })
    await this.submitForm()
    await this.waitForDetailUrl(workItemId)
  }

  /** RA-572 (AC02). The reason field's hint, reworded to "...changed". */
  async reasonHintText() {
    return $('#field-reason-hint').getText()
  }

  /**
   * RA-572 (AC02). No visible "extend"/"extending" wording survives anywhere
   * on the change-deadline page.
   *
   * Scoped to `main` rather than `body`, and read as rendered TEXT: the word
   * legitimately survives in the URL and in the `sla-extend-*` testids, which
   * management-fe deliberately did not rename, and asserting their absence
   * would fail for a reason that has nothing to do with the content change.
   * Call this on a freshly-opened form — a reason already typed into the
   * textarea would otherwise be scanned as page copy.
   */
  async assertNoStaleDeadlineWording() {
    await this.assertOnInputPage()
    const text = await $('main').getText()
    expect(text).not.toMatch(/extend/i)
  }

  // ── RA-572: the retired Override flow ────────────────────────────────── //

  /**
   * RA-572 (AC01). The work-item detail page's assignment panel used to carry
   * an "Override the due date" sibling to the change link. It is gone from the
   * DOM entirely, so this is `toBeExisting` rather than a visibility check —
   * a hidden-but-present link would still be reachable and is not what the AC
   * asks for.
   */
  overrideActionLink() {
    return $('[data-testid="action-sla-override"]')
  }

  async assertNoOverrideAction() {
    await expect(this.overrideActionLink()).not.toBeExisting()
  }

  /**
   * RA-572 (AC01). The override screen is unreachable by typing its URL, not
   * merely unlinked.
   *
   * management-fe 404s `GET /work-items/{id}/sla/override`. What that 404
   * renders is management-fe's to own and is not pinned here; what IS pinned
   * is that no override FORM comes back, so a regression that restores the
   * route fails regardless of how the error page is styled.
   */
  async assertOverrideRouteUnreachable(workItemId) {
    await this.open(`/work-items/${workItemId}/sla/override`)
    await expect($('[data-testid="sla-override-form"]')).not.toBeExisting()
    await expect($('[data-testid="sla-override-submit"]')).not.toBeExisting()
  }

  async waitForDetailUrl(workItemId) {
    await browser.waitUntil(
      async () => {
        const url = new URL(await browser.getUrl())
        return url.pathname === `/work-items/${workItemId}`
      },
      {
        timeout: 10000,
        timeoutMsg: `Expected to land on /work-items/${workItemId} after the SLA extend flow`
      }
    )
  }
}

export default new SlaExtendPage()
