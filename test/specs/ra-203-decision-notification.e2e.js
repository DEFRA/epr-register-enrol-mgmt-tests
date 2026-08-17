import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'

/**
 * The decision rationale. Distinctive prose rather than "test note": it is
 * asserted as a substring of an audit entry, so a generic phrase risks
 * matching boilerplate elsewhere on the page and passing vacuously.
 */
const DECISION_NOTE =
  'Application meets all re-accreditation criteria; capacity evidence verified.'

/**
 * RA-203 — Approving a re-accreditation sends the operator the decision
 * email.
 *
 * Regression cover for the bug where decision emails never sent: the
 * Decision GOV.UK Notify template requires a ((decision_notes))
 * placeholder that the notification hook never supplied, so Notify
 * rejected the send with "Missing personalisation: decision_notes".
 *
 * Observed through the UI: after a decision maker approves with a
 * decision note, the audit log gains a "Decision recorded: approved
 * email sent" entry. In the e2e stack NOTIFY_API_KEY is absent so the
 * NoOpNotifyClient stands in and reports success, which exercises the
 * same notification-sent audit path as production. The decision_notes
 * placeholder-contract regression itself is guarded by the management-be
 * NotifyTemplateContractTests, which the real GovukNotifyClient would
 * otherwise have 400'd on.
 */
describe('RA-203 Approval sends operator decision notification', () => {
  let workItemId

  it('drives a re-accreditation to assessment-in-progress', async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Decision Notify Test Ltd',
        siteAddressLine1: '4 Decision Road',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500',
        operatorEmail: 'operator@decision-notify-test.example'
      })
    ).id

    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')

    // Submitted -> Duly made. RA-316 replaced the submitted tasks and
    // the auto-transition hook with the "Duly make" CTA and a payment
    // date; the shared helper owns that journey.
    await dulyMake(workItemId)

    // Duly made -> Assessment in progress
    await startAssessment(workItemId)
    // `assessment-in-progress` displays as "Updated" (RA-324), so the
    // raw id is what pins the state. RA-410 removed the
    // `submit-for-decision` step that used to follow: `awaiting-decision`
    // is now an internal hop inside the Log decision call, so this is
    // where the item waits.
    await detail.assertStateId('assessment-in-progress')

    await login.logout()
  })

  it('records a "Decision recorded: approved email sent" audit entry after approval with a note', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-in-progress')

    // RA-410 moved the decision note from the approve interstitial onto the
    // Log decision page. The field is what feeds `decision_notes`, so a
    // decision WITHOUT one is not the case this spec is about.
    await logDecision(workItemId, 'approved', { note: DECISION_NOTE })
    await detail.assertState('Granted')

    // The notification hook fired and the send succeeded, so the audit
    // log carries the "Decision recorded: approved email sent" entry —
    // proving the approval wires through to a notification end-to-end.
    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
    await detail.assertAuditEntry('Decision recorded: approved email sent')

    // The note reached the work item as a note in its own right. This is the
    // link in the chain the e2e can actually see: management-be builds
    // `decision_notes` from the work item's LATEST note, so "the note was
    // recorded before the decision" is the observable precondition for the
    // email carrying it. The personalisation value itself is not surfaced in
    // the audit log, so that last hop stays management-be's unit-level
    // concern (NotifyTemplateContractTests) — asserted here as far as the UI
    // honestly reaches, and no further.
    await detail.assertAuditEntry('Note added')
    await detail.assertAuditEntry(DECISION_NOTE)

    await login.logout()
  })

  it('records the note BEFORE the decision, not after', async () => {
    // ORDERING IS THE WHOLE MECHANISM, not an implementation detail. The
    // notification hook fires DURING the decision write and reads whatever is
    // then the latest note. A note posted after the decision would leave the
    // email carrying the previous note or a blank rationale — and because
    // management-be falls back to an empty string rather than failing, that
    // regression sends silently: no error, no failed notification, nothing in
    // the audit log to notice. Exactly how `decision_notes` came to be dead
    // before RA-410 restored the field.
    //
    // So the ONLY thing standing between a correct email and a silently blank
    // one is the order of two writes, which makes it worth an explicit
    // assertion rather than trusting the happy path above.
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.gotoAudit()

    const noteIndex = await detail.auditEntryIndex('Note added')
    const decisionIndex = await detail.auditEntryIndex(
      'Decision recorded: approved email sent'
    )

    expect(noteIndex).toBeGreaterThanOrEqual(0)
    expect(decisionIndex).toBeGreaterThanOrEqual(0)
    // The audit log arrives from the backend already sorted OLDEST-FIRST and
    // is rendered as a top-to-bottom timeline (see `decorateAuditLog` in
    // management-fe), so "written first" means a LOWER index. Checked against
    // that source rather than assumed — the first draft of this assertion had
    // it backwards on a guess that the log was newest-first, which would have
    // failed in CI looking like a product bug rather than a test bug.
    expect(noteIndex).toBeLessThan(decisionIndex)

    await login.logout()
  })
})
