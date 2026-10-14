import { readFile } from 'node:fs/promises'
import { browser, $, $$, expect } from '@wdio/globals'
import LoginPage from '../page-objects/login.page.js'

describe('RA-622 connected management access', () => {
  before(function () {
    if (process.env.RA_622_SPIKE_TESTS !== 'true') {
      this.skip()
    }
  })
  it('signs in normally and reads the real management worklist', async () => {
    await browser.deleteCookies()
    await LoginPage.login()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
    await browser.url('/work-items?filtersApplied=1&assigneeMode=any')
    await expect($('[data-testid="applications-list"]')).toBeDisplayed()
    await expect($('[data-testid="application-tile"]')).toBeDisplayed()
    const cookies = await browser.getCookies()
    expect(
      cookies.some(
        (cookie) => cookie.name === 'ra-622-spike-management-session'
      )
    ).toBe(true)
    expect(
      cookies.some((cookie) => cookie.name === 'ra-622-spike-operator-session')
    ).toBe(false)
    await browser.refresh()
    expect(new URL(await browser.getUrl()).pathname).toBe('/work-items')
    await expect($('[data-testid="applications-list"]')).toBeDisplayed()
  })
  it('finds the actual submitted Add ORS case using Application type and its stored versioned detail', async () => {
    if (!process.env.RA_622_SPIKE_RECEIPT_FILE) {
      throw new Error(
        'Set RA_622_SPIKE_RECEIPT_FILE to the receipt written by the operator browser run.'
      )
    }
    const receipt = JSON.parse(
      await readFile(process.env.RA_622_SPIKE_RECEIPT_FILE, 'utf8')
    )
    if (process.env.RA_622_SPIKE_PHASE === 'withdrawal-readback') {
      const previous = receipt.withdrawnRequest
      expect(previous.caseId).not.toBe(receipt.caseId)
      await browser.url(`/work-items/${previous.caseId}`)
      const closed = $('[data-testid="add-ors-detail"]')
      await expect($('[data-testid="add-ors-state"]')).toHaveText('Withdrawn')
      expect(await closed.getAttribute('data-request-id')).toBe(
        previous.requestId
      )
      expect(await closed.getAttribute('data-site-id')).toBe(
        previous.proposedSiteId
      )
      for (const action of [
        'start-assessment',
        'approve',
        'refuse',
        'retry-outcome'
      ]) {
        await expect($(`[data-testid="add-ors-${action}"]`)).not.toExist()
      }
      await browser.refresh()
      await expect($('[data-testid="add-ors-state"]')).toHaveText('Withdrawn')
    }
    await browser.url(
      '/work-items?filtersApplied=1&assigneeMode=any&applicationType=add-overseas-site'
    )
    await expect(
      $('input[name="applicationType"][value="add-overseas-site"]')
    ).toBeSelected()
    const types = $$('[data-testid="application-type"]')
    expect(await types.length).toBeGreaterThan(0)
    for (const type of await types) {
      await expect(type).toHaveText('Add ORS')
    }
    const link = $(`a[href="/work-items/${receipt.caseId}"]`)
    await expect(link).toBeDisplayed()
    await link.click()
    const detail = $('[data-testid="add-ors-detail"]')
    await expect(detail).toBeDisplayed()
    expect(await detail.getAttribute('data-request-id')).toBe(receipt.requestId)
    expect(await detail.getAttribute('data-case-id')).toBe(receipt.caseId)
    expect(await detail.getAttribute('data-site-id')).toBe(
      receipt.proposedSiteId
    )
    expect(await detail.getAttribute('data-template-version')).toBe('v1')
    for (const text of [
      receipt.caseReference,
      receipt.target.organisationId,
      receipt.target.registrationId,
      receipt.target.accreditationId,
      receipt.target.materialType,
      String(receipt.target.year),
      'Spike Glass Recycling',
      '25 Example Road, Hamburg',
      'Germany'
    ]) {
      await expect(detail).toHaveText(expect.stringContaining(text))
    }
    await expect($('[data-testid="add-ors-state"]')).toHaveText('Submitted')
    await expect($('[data-testid="work-item-log-decision"]')).not.toExist()
    await expect($('[data-testid="work-item-duly-make"]')).not.toExist()
    await browser.refresh()
    expect(await detail.getAttribute('data-case-id')).toBe(receipt.caseId)
  })

  it('starts assessment and sends the recorded decision through the authenticated operator callback', async function () {
    const operation = process.env.RA_622_SPIKE_PHASE
    if (!['refuse', 'approve'].includes(operation)) {
      this.skip()
    }
    const receipt = JSON.parse(
      await readFile(process.env.RA_622_SPIKE_RECEIPT_FILE, 'utf8')
    )
    await browser.url(`/work-items/${receipt.caseId}`)
    await expect($('[data-testid="add-ors-start-assessment"]')).toBeDisplayed()
    await $('[data-testid="add-ors-start-assessment"]').click()
    await expect($('[data-testid="add-ors-state"]')).toHaveText(
      'Assessment in progress'
    )
    await expect($('[data-testid="add-ors-start-assessment"]')).not.toExist()
    await expect($('[data-testid="add-ors-approve"]')).toBeDisplayed()
    await browser.refresh()
    await expect($(`[data-testid="add-ors-${operation}"]`)).toBeDisplayed()
    await $(`[data-testid="add-ors-${operation}"]`).click()
    await expect($('[data-testid="add-ors-state"]')).toHaveText(
      operation === 'approve' ? 'Granted' : 'Refused'
    )
    await expect(
      $('[data-testid="add-ors-delivery-confirmed"]')
    ).toBeDisplayed()
    await expect($('[data-testid="add-ors-refuse"]')).not.toExist()
    await expect($('[data-testid="add-ors-approve"]')).not.toExist()
    await expect($('[data-testid="add-ors-retry-outcome"]')).not.toExist()
    await browser.refresh()
    await expect(
      $('[data-testid="add-ors-delivery-confirmed"]')
    ).toBeDisplayed()
  })
})
