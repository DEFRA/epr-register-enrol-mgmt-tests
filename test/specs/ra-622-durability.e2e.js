import { readFile, writeFile } from 'node:fs/promises'
import { createHmac, randomBytes } from 'node:crypto'
import { browser, $, expect } from '@wdio/globals'
import LoginPage from '../page-objects/login.page.js'

async function readCase(id) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const nonce = randomBytes(16).toString('base64')
  const clientId = 'frontend'
  const userId = 'spike-durability-caseworker'
  const role = 'standard'
  const signature = createHmac(
    'sha256',
    process.env.MANAGEMENT_FRONTEND_SECRET || 'ra-622-spike-management-frontend'
  )
    .update(['v3', clientId, userId, '', role, '', timestamp, nonce].join('\n'))
    .digest('base64')
  const response = await fetch(
    `${process.env.MANAGEMENT_BACKEND_URL || 'http://localhost:8085'}/work-items/${id}`,
    {
      headers: {
        'x-cdp-client-id': clientId,
        'x-cdp-user-id': userId,
        'x-cdp-user-role': role,
        'x-cdp-auth-timestamp': timestamp,
        'x-cdp-auth-nonce': nonce,
        'x-cdp-auth-signature': signature
      }
    }
  )
  expect(response.status).toBe(200)
  return response.json()
}

describe('RA-622 retained real cases across an all-service restart', () => {
  before(async function () {
    if (process.env.RA_622_SPIKE_TESTS !== 'true') {
      this.skip()
    }
    await browser.deleteCookies()
    await LoginPage.login()
  })

  it('reads the same correlated terminal cases, frozen version and audit through public interfaces', async () => {
    const file = process.env.RA_622_SPIKE_RECEIPT_FILE
    if (!file) {
      throw new Error(
        'Set RA_622_SPIKE_RECEIPT_FILE to the completed connected-flow receipt.'
      )
    }
    const receipt = JSON.parse(await readFile(file, 'utf8'))
    expect(receipt.approvedRequests).toHaveLength(2)
    expect(receipt.finalRead.activeRequest).toBe(null)
    const snapshotFile = file + '.management.json'
    const restarting = process.env.RA_622_SPIKE_PHASE === 'restart-readback'
    const previous = restarting
      ? JSON.parse(await readFile(snapshotFile, 'utf8'))
      : null
    const cases = []
    const labels = {
      approved: 'Granted',
      rejected: 'Refused',
      withdrawn: 'Withdrawn'
    }
    for (const request of receipt.finalRead.history) {
      const item = await readCase(request.caseId)
      expect(item.id).toBe(request.caseId)
      expect(item.typeId).toBe('add-overseas-site')
      expect(item.templateVersion).toBe('v1')
      expect(item.stateId).toBe(request.status)
      expect(item.payload.operatorRequestId).toBe(request.requestId)
      expect(item.payload.proposedSiteId).toBe(request.proposedSiteId)
      expect(item.payload.target).toEqual(receipt.target)
      expect(item.auditLog.length).toBeGreaterThan(0)
      if (request.status !== 'withdrawn') {
        expect(item.payload.outcomeDeliveryConfirmed).toBe(true)
      }
      cases.push(item)
      await browser.url(`/work-items/${request.caseId}`)
      const detail = $('[data-testid="add-ors-detail"]')
      expect(await detail.getAttribute('data-request-id')).toBe(
        request.requestId
      )
      expect(await detail.getAttribute('data-site-id')).toBe(
        request.proposedSiteId
      )
      expect(await detail.getAttribute('data-template-version')).toBe('v1')
      await expect($('[data-testid="add-ors-state"]')).toHaveText(
        labels[request.status]
      )
      for (const action of [
        'start-assessment',
        'approve',
        'refuse',
        'retry-outcome'
      ]) {
        await expect($(`[data-testid="add-ors-${action}"]`)).not.toExist()
      }
    }
    if (restarting) {
      expect(cases).toEqual(previous)
    } else {
      await writeFile(snapshotFile, JSON.stringify(cases, null, 2) + '\n')
    }
  })
})
