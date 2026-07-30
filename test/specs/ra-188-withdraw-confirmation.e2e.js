import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import withdraw from '../page-objects/withdraw.page.js'

/**
 * RA-188 — Withdraw confirmation interstitial.
 *
 * The detail-page "Withdraw" button no longer POSTs directly. Instead
 * it links to a confirmation page where the user can add an optional
 * note, back out via Cancel, or confirm the withdrawal — at which
 * point the work item moves to the terminal `withdrawn` state.
 *
 * Long notes are rejected inline by an error summary. Posting an
 * empty note still goes through (the note is optional).
 */
describe('RA-188 Withdraw confirmation', () => {
  describe('happy path with note', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw With Note Ltd',
          siteAddressLine1: '1 Withdraw Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AJ',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('links the Submitted-state Withdraw button to the confirmation page', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      // RA-335: rendered as a button-styled GET form, not an <a href> link,
      // so a read-only support user's session can disable it.
      const action = await detail.formActionFor('action-withdraw')
      expect(action).toContain(
        `/work-items/${workItemId}/actions/withdraw/confirm`
      )
    })

    it('opens the confirmation page when the Withdraw action is clicked', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.assertOnConfirmPage()
    })

    it('rejects a note longer than 500 characters inline', async () => {
      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.fillNote('x'.repeat(501))
      await withdraw.submit()
      await withdraw.assertErrorSummaryDisplayed()
      await withdraw.assertOnConfirmPage()
    })

    it('returns to the detail page when Cancel is clicked, leaving the state untouched', async () => {
      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.cancel()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Not started')
    })

    it('withdraws the work item and writes the note to the audit log on confirm', async () => {
      await withdraw.gotoFor(workItemId, 'withdraw')
      await withdraw.fillNote('Duplicate application submitted by mistake')
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')

      await detail.gotoAudit()
      await detail.assertAuditEntry('Note added')
      await detail.assertAuditEntry('Action applied')
    })
  })

  describe('happy path without note', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Without Note Ltd',
          siteAddressLine1: '2 Withdraw Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AL',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id
    })

    after(async () => {
      await login.logout()
    })

    it('withdraws without a note', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.assertOnConfirmPage()
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')
    })
  })

  describe('stale-link guard', () => {
    let workItemId

    before(async () => {
      await login.login()
      await workItems.goto()
      workItemId = (
        await workItems.createWorkItem({
          organisationName: 'Withdraw Stale Link Ltd',
          siteAddressLine1: '3 Withdraw Way',
          siteAddressTown: 'London',
          siteAddressPostcode: 'SW1A 1AN',
          material: 'plastic',
          tonnageBand: '0-500'
        })
      ).id

      // Withdraw the item first so the action becomes unavailable.
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw')
      await withdraw.submit()
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')
    })

    after(async () => {
      await login.logout()
    })

    it('redirects back to the work item when the action is no longer available', async () => {
      await browser.url(`/work-items/${workItemId}/actions/withdraw/confirm`)
      await withdraw.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')
    })
  })
})
