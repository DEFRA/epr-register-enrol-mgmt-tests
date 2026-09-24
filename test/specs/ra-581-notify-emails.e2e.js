import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import slaExtend from '../page-objects/sla-extend.page.js'
import {
  dulyMake,
  startAssessment
} from '../support/re-accreditation-journey.js'
import { uniquePostcode } from '../support/unique-postcode.js'
import { farFutureDeadline } from '../support/sla-extend-date.js'

/**
 * RA-581 — GOV.UK Notify email reshape, as observed through the audit log.
 *
 * The emails themselves are not observable end to end (the e2e stack has no
 * NOTIFY_API_KEY, so the NoOpNotifyClient stands in), but every send is
 * recorded as a `notification-sent` audit entry, which is what is asserted.
 *
 *   - Paired events read differently for each audience: submission is
 *     "Operator submission confirmation" (to the operator) and "Regulator
 *     submission" (to the regulator mailbox); withdrawal is "Operator
 *     application withdrawn" and "Regulator withdrawal notification".
 *   - The SlaExtended and AssessmentInProgress emails were removed. Starting
 *     assessment and changing the determination deadline still succeed but no
 *     longer email anyone, so neither writes a notification entry.
 *   - The emails that remain are unaffected (duly made is asserted).
 *
 * Withdrawal wording is covered by ra-204; the OfficerAssignment reference by
 * ra-238 / ra-248. England is the only nation this stack configures a
 * regulator mailbox for (docker/config/management-be.env), so an England
 * item is used so the regulator sends are recorded rather than skipped.
 */
describe('RA-581 Notify email reshape', () => {
  let workItemId

  before(async () => {
    await login.login()
    await workItems.goto()
    workItemId = (
      await workItems.createWorkItem({
        organisationName: 'RA-581 Notify Emails Ltd',
        siteAddressLine1: '581 Email Road',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500',
        nation: 'England'
      })
    ).id
    await workItems.openWorkItem(workItemId)
    await detail.assertState('Not started')
  })

  after(async () => {
    await login.logout()
  })

  it('records distinct operator and regulator entries when the application is submitted', async () => {
    await detail.gotoAudit()
    await detail.assertAuditEntry('Operator submission confirmation email sent')
    await detail.assertAuditEntry('Regulator submission email sent')
  })

  it('still emails the operator when the application is marked duly made', async () => {
    await dulyMake(workItemId)
    await detail.gotoAudit()
    await detail.assertAuditEntry('Application marked duly made email sent')
  })

  it('no longer emails anyone when assessment starts or the deadline changes', async () => {
    await startAssessment(workItemId)

    await slaExtend.gotoFor(workItemId)
    await slaExtend.fillForm({
      reason: 'Operator providing additional evidence',
      date: farFutureDeadline()
    })
    await slaExtend.submitForm()
    await slaExtend.waitForDetailUrl(workItemId)
    await detail.assertFlashBanner()

    await detail.gotoAudit()
    // The deadline change itself is still recorded in the history (located by
    // its stored action value, so this does not depend on the heading wording,
    // which is being reworded on a separate branch)...
    expect((await detail.auditEntriesForAction('sla-extended')).length).toBe(1)

    // ...but neither it nor starting assessment sent an email.
    const auditLog = await $('[data-testid="work-item-audit-log"]').getText()
    expect(auditLog).not.toContain('Assessment started email')
    expect(auditLog).not.toContain('Determination deadline extended email')
    expect(auditLog).not.toContain('Determination deadline changed email')
  })
})
