import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import decision from '../page-objects/decision.page.js'
import {
  createReAccreditation,
  driveToAssessmentInProgress
} from '../support/re-accreditation-journey.js'

/**
 * RA-410 — the Log decision page's own validation behaviour.
 *
 * Split out of ra-410-cta-lifecycle.e2e.js (which keeps the CTA
 * state-transition lifecycle: submitted -> duly-made -> assessment ->
 * approved/refused, and the self-assign guard) purely so wdio can schedule
 * the two halves on separate workers. See that file's header comment for the
 * CTA lifecycle's full context.
 */
/** Prose distinctive enough that a substring assertion cannot pass by accident. */
const RETAINED_NOTE = 'Capacity evidence checked against the 2024 return.'

describe('RA-410 The green CTA lifecycle', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('the Log decision page rejects a submit with no option chosen', () => {
    let workItemId

    before(async () => {
      // `SW1A 1AM` is unused elsewhere — see `createReAccreditation`.
      workItemId = await createReAccreditation('CTA Validation', 'SW1A 1AM')
      await driveToAssessmentInProgress(workItemId)
      await detail.clickLogDecision()
      await decision.assertOnPage()
    })

    it('shows an error summary rather than recording a decision', async () => {
      await decision.submit()
      await decision.assertErrorSummary()
    })

    it('links the error summary at the first radio', async () => {
      // GOV.UK convention: the summary link targets the FIRST radio in the
      // group. Asserting it stops a regression where the summary renders but
      // its link goes nowhere useful — the failure mode that makes an error
      // summary decorative rather than an accessibility feature.
      const hrefs = await decision.errorSummaryLinkHrefs()
      expect(hrefs.length).toBeGreaterThan(0)
      expect(hrefs).toContain('#decision-approved')
    })

    it('renders an inline error against the radio group', async () => {
      expect(await decision.hasInlineError()).toBe(true)
    })

    it('keeps a typed decision note across the validation error', async () => {
      // Losing a caseworker's typed rationale because they missed a radio is
      // the kind of small cruelty that makes people avoid the note field
      // altogether — and a blank note is exactly the failure RA-203 exists to
      // prevent, since management-be falls back to an empty `decision_notes`
      // rather than complaining.
      await decision.setNote(RETAINED_NOTE)
      await decision.submit()
      await decision.assertErrorSummary()

      expect(await decision.noteText()).toBe(RETAINED_NOTE)
    })

    it('does not echo a decision back after the validation error', async () => {
      // Deliberately the OPPOSITE expectation to the note above, and the
      // contrast is the point. Prose the user typed should survive a
      // re-render; a *decision* must never be reflected back, or a forged or
      // stale value could arrive pre-selected and be confirmed with one
      // unthinking click. Repopulating the whole form uniformly would pass the
      // note assertion and quietly fail this one.
      expect(await decision.isOutcomeSelected('approved')).toBe(false)
      expect(await decision.isOutcomeSelected('refused')).toBe(false)
    })

    it('stays on the Log decision page', async () => {
      await decision.waitForDecisionUrl(workItemId)
      expect(await decision.hasOutcomeRadio('approved')).toBe(true)
    })

    it('leaves the work item in assessment', async () => {
      // The assertion that makes the rest of this block matter: a validation
      // error that had nonetheless applied a transition would still be a
      // determination the caseworker never made.
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('assessment-in-progress')
      expect(await detail.hasLogDecisionCta()).toBe(true)
    })

    it('accepts the form once an option is chosen', async () => {
      // The validation must not have been implemented by breaking submit.
      await detail.clickLogDecision()
      await decision.selectOutcome('approved')
      await decision.submit()
      await decision.waitForDetailUrl(workItemId)

      await detail.assertStateId('approved')
    })
  })

  describe('the Log decision page rejects an over-long note', () => {
    // NOT REQUESTED by management-fe — added because the bug it guards was a
    // silent data-loss regression that already happened once. When the note
    // was first restored its length check lived in the service, whose failure
    // path redirects with a generic banner, so an over-run discarded the
    // caseworker's entire rationale and did not say why.
    //
    // THE SERVER CHECK IS THE ONLY ENFORCEMENT THAT EXISTS, in every browser
    // — not a fallback for the no-JS path RA-94 mandates.
    // `govukCharacterCount` passes `maxlength` through as `data-maxlength` and
    // never sets the HTML `maxlength` attribute (verified in govuk-frontend's
    // own template), so with JavaScript running the counter turns red, reports
    // how far over you are, and submits anyway.
    //
    // Stated this way round deliberately. Describing the check as covering the
    // degraded case implies a JS-enabled browser blocks the over-run, and a
    // reader who believes that could reasonably deprioritise the check — which
    // is how this regresses a second time.
    //
    // The shape matters as much as the failure: "renders in place, note
    // survives" rather than "redirects". A spec that only looked for an error
    // banner somewhere would have passed against the broken version.
    let workItemId
    const OVER_LONG_NOTE = 'x'.repeat(2001)

    before(async () => {
      // `SW1A 1AY` is unused elsewhere — see `createReAccreditation`.
      workItemId = await createReAccreditation('CTA Long Note', 'SW1A 1AY')
      await driveToAssessmentInProgress(workItemId)
      await detail.clickLogDecision()
      await decision.assertOnPage()
    })

    it('rejects the note in place rather than redirecting away', async () => {
      await decision.selectOutcome('approved')
      await decision.setNote(OVER_LONG_NOTE)
      await decision.submit()

      await decision.assertErrorSummary(
        'Decision note must be 2000 characters or fewer'
      )
      // Still on the form, not bounced to the detail page with a generic
      // banner — which is precisely what the regression did.
      await decision.waitForDecisionUrl(workItemId)
    })

    it('preserves the note the caseworker typed', async () => {
      // The whole point. Throwing away 2000 characters of reasoning because
      // the user over-ran by one is the failure being guarded.
      expect(await decision.noteText()).toBe(OVER_LONG_NOTE)
    })

    it('anchors the error at the note field', async () => {
      expect(await decision.errorSummaryLinkHrefs()).toContain(
        '#field-decisionNote'
      )
    })

    it('leaves the work item in assessment', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertStateId('assessment-in-progress')
    })

    it('reports a missing radio AND an over-long note together, in field order', async () => {
      // Both fields are validated up front, so a user who got both wrong sees
      // both problems at once rather than fixing one, resubmitting, and being
      // told about the next. GDS requires summary links in FIELD order, which
      // is an accessibility requirement rather than a nicety — a screen-reader
      // user works down the list expecting it to match the form.
      await detail.clickLogDecision()
      await decision.setNote(OVER_LONG_NOTE)
      await decision.submit()

      const hrefs = await decision.errorSummaryLinkHrefs()
      expect(hrefs).toContain('#decision-approved')
      expect(hrefs).toContain('#field-decisionNote')
      expect(hrefs.indexOf('#decision-approved')).toBeLessThan(
        hrefs.indexOf('#field-decisionNote')
      )
    })

    it('still does not echo the decision back, even with the note preserved', async () => {
      // The contrast that keeps the note-retention fix honest: prose the user
      // typed is repopulated, a decision never is.
      expect(await decision.noteText()).toBe(OVER_LONG_NOTE)
      expect(await decision.isOutcomeSelected('approved')).toBe(false)
      expect(await decision.isOutcomeSelected('refused')).toBe(false)
    })
  })
})
