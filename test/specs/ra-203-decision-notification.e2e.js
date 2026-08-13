import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  dulyMake,
  logDecision,
  startAssessment
} from '../support/re-accreditation-journey.js'

/**
 * The decision rationale. Distinctive prose rather than "test note": it is
 * asserted as a substring of an audit entry, so a generic phrase risks
 * matching boilerplate elsewhere on the page and passing vacuously.
 */
const DECISION_NOTE =
  'Application meets all re-accreditation criteria; capacity evidence verified.'

/**
 * RA-203 — Approving a re-accreditation no longer emails the operator once
 * Case Management emails are disabled behind the Notify:Enabled feature flag
 * (RA-422, default false — the e2e stack runs with it off).
 *
 * The flag gates the single post-action hook that BOTH sends the decision
 * email AND writes its notification audit entry, so with the flag off the
 * approval still records the decision (state -> Granted) and keeps the
 * decision note as its own audit row, but the audit log gains NO
 * "Decision recorded: approved email" entry. This spec proves that new
 * default: the non-notification effects survive, the email row does not.
 *
 * (The decision_notes placeholder-contract that RA-203 originally guarded is
 * a management-be unit concern — NotifyTemplateContractTests — and is no
 * longer observable end-to-end now that no decision email is written.)
 */
describe('RA-203 Approval records the decision without emailing (Notify flag off)', () => {
  let workItemId

  it('drives a re-accreditation to assessment-in-progress', async () => {
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

  it('records the decision and note but NO decision email entry (emails disabled by RA-422)', async () => {
    await login.login()
    await workItems.openWorkItem(workItemId)
    await detail.assertStateId('assessment-in-progress')

    // RA-410 moved the decision note from the approve interstitial onto the
    // Log decision page. The field is what feeds `decision_notes`, so a
    // decision WITHOUT one is not the case this spec is about.
    await logDecision(workItemId, 'approved', { note: DECISION_NOTE })
    await detail.assertState('Granted')

    // With Notify:Enabled off (the e2e default, RA-422), the post-action hook
    // that BOTH sends the decision email AND writes its notification audit row
    // never fires, so the audit log gains NO "Decision recorded: approved
    // email" entry.
    await detail.gotoAudit()
    await detail.expandAllAuditEntryDetails()
    await detail.assertNoAuditEntry('Decision recorded: approved email sent')
    await detail.assertNoAuditEntry('Decision recorded: approved email skipped')
    await detail.assertNoAuditEntry('Decision recorded: approved email failed')

    // The decision note is still recorded as a note in its own right — that is
    // a lifecycle audit row, not a notification, so it survives the flag being
    // off. (It used to double as the precondition for the email carrying it;
    // with emails disabled that hop no longer exists, but the note itself
    // remains an observable effect of logging the decision.)
    await detail.assertAuditEntry('Note added')
    await detail.assertAuditEntry(DECISION_NOTE)

    await login.logout()
  })
})
