import { $, $$, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-739. An add-ORS application's Application summary, from the Figma
 * "Application page - Summary" frame: the site being added, its BES evidence
 * with valid-from and expiry dates, and its interim sites. The assignment
 * panel is there; the actions panel (Duly make, Query, decisions) is not
 * until RA-495.
 *
 * Submitted straight to management-be with the operator backend's full site
 * shape (see `buildAddOverseasSiteRequest`).
 */

/** Text of the element with `data-testid="{testId}"`, inside `scope`. */
async function textOf(testId, scope = $('body')) {
  return (await scope.$(`[data-testid="${testId}"]`).getText()).trim()
}

describe('RA-739 add-ORS Application summary', () => {
  let submission
  let site
  let workItemId

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA739 Add ORS Summary Ltd',
      siteCount: 2
    })
    ;[site] = submission.sites
    workItemId = submission.workItems[0].id
    await login.login()
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('shows the site summary rows with their Figma labels, in order', async () => {
    const rows = await $$(
      '[data-testid="application-details"] > .govuk-summary-list__row'
    ).map(async (row) => [
      (await row.$('.govuk-summary-list__key').getText()).trim(),
      (await row.$('.govuk-summary-list__value').getText()).trim()
    ])

    expect(rows.slice(0, 10)).toEqual([
      ['Site name', site.siteName],
      ['Location', '1 Rue du Port, Zone Industrielle, Lyon, France'],
      ['Coordinates', site.coordinates],
      ['Contact name', site.contactName],
      ['Contact email', site.contactEmail],
      ['Contact phone number', site.contactPhone],
      ['Recycling operation', 'R3'],
      ['Basel convention codes', 'B3011, B3020'],
      ['Arrangements for rejected or returned loads', site.repatriatedLoads],
      ['Conditions of export', 'Yes']
    ])
    expect(rows[10][0]).toBe('Evidence of broadly equivalent standards')
    expect(rows).toHaveLength(11)
  })

  it('links the Clean BES file and shows its dates', async () => {
    const [file] = site.besEvidence.files
    const entry = $('[data-testid="app-detail-value-bes-evidence"] li')

    const link = entry.$('a[data-testid="app-detail-document"]')
    await expect(link).toHaveText(file.filename)
    await expect(link).toHaveAttribute(
      'href',
      `/work-items/${workItemId}/files/${file.fileId}/download`
    )
    expect(await textOf('app-detail-document-valid-from', entry)).toBe(
      'Valid from: 01 Jan 2026'
    )
    expect(await textOf('app-detail-document-expiry-date', entry)).toBe(
      'Expiry date: 31 Dec 2027'
    )
  })

  it('lists the interim sites', async () => {
    const section = $('[data-testid="interim-sites"]')
    expect(await textOf('interim-sites-heading', section)).toBe(
      'Interim sites (1)'
    )

    const interimSite = section.$('[data-testid="interim-site"]')
    expect(await textOf('interim-site-name', interimSite)).toBe(
      'Antwerp Transfer Hub'
    )
    expect(await textOf('interim-site-summary-address', interimSite)).toBe(
      '1 Quay Street, Belgium'
    )
    expect(await textOf('interim-site-site-number', interimSite)).toBe('001')
    expect(await textOf('interim-site-location', interimSite)).toBe(
      '1 Quay Street, Antwerp, Belgium'
    )
    expect(await textOf('interim-site-contact-name', interimSite)).toBe(
      'Alex Morgan'
    )
    expect(await textOf('interim-site-contact-email', interimSite)).toBe(
      'alex.morgan@example.com'
    )
    expect(await textOf('interim-site-operation-code', interimSite)).toBe('R13')
  })

  it('has the assignment panel and no actions panel', async () => {
    const panel = $('[data-testid="case-assignment-panel"]')
    await expect(panel).toExist()
    await expect(panel.$('[data-testid="self-assign-submit"]')).toHaveText(
      'Assign to yourself and start'
    )
    await expect(panel.$('[data-testid="reassign-link"]')).toExist()
    await expect(panel.$('[data-testid="unassign-link"]')).toExist()

    await expect($('[data-testid="actions-panel"]')).not.toExist()
    await expect($('[data-testid="action-duly-make"]')).not.toExist()
    await expect($('[data-testid="action-query"]')).not.toExist()
  })
})
