import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'

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

  it('drives a re-accreditation to awaiting-decision', async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'Decision Notify Test Ltd',
        siteAddressLine1: '4 Decision Road',
        siteAddressTown: 'London',
        siteAddressPostcode: 'SW1A 1AQ',
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

    // RA-410 removed the approve interstitial that carried the optional
    // decision-note textarea (`approval-decision-note` / `approval-submit`).
    // The determination is now the Log decision page, which management-fe's
    // contract describes as radios and a submit button only.
    //
    // COVERAGE NOTE: this case therefore no longer exercises the
    // `decision_notes` placeholder — it proves the decision notification
    // fires and is audited, which is the AC01 half of RA-203, but not that a
    // caseworker's note reaches the email. Raised with management-fe; if a
    // note field lands on the Log decision page, add it here rather than
    // leaving the placeholder covered only at unit level. Tracked as
    // follow-up work.
    await logDecision(workItemId, 'approved')
    await detail.assertState('Granted')

    // The notification hook fired and the send succeeded, so the audit
    // log carries the "Decision recorded: approved email sent" entry —
    // proving the approval wires through to a notification end-to-end.
    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
    await detail.assertAuditEntry('Decision recorded: approved email sent')

    await login.logout()
  })
})
