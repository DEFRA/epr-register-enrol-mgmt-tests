import { $, $$, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { submitAddOverseasSiteRequest } from '../support/in-year-change-api.js'

/**
 * RA-739 / RA-495. An add-ORS application's Application summary, from the
 * Figma "Application page - Summary" frame: the site being added, its BES
 * evidence with valid-from and expiry dates, and its interim sites. RA-495:
 * the values the operator supplied on the request (`suppliedFields`) carry
 * the "NEW: " prefix, the BES evidence row on its first file (3bb.13). The
 * layout follows re-accreditation's: an "Application details" heading, its
 * labels, and collapsed interim sites. The
 * assignment panel is there; the actions panel (Duly
 * make, Query, decisions) is not until later RA-495 tasks.
 *
 * Submitted straight to management-be with the operator backend's full site
 * shape (see `buildAddOverseasSiteRequest`).
 */

/** Text of the element with `data-testid="{testId}"`, inside `scope`. */
async function textOf(testId, scope = $('body')) {
  return (await scope.$(`[data-testid="${testId}"]`).getText()).trim()
}

describe('RA-739 / RA-495 add-ORS Application summary', () => {
  let submission
  let site
  let workItemId

  before(async () => {
    submission = await submitAddOverseasSiteRequest({
      organisationNamePrefix: 'RA739 Add ORS Summary Ltd',
      siteCount: 2,
      // The operator answered these two and uploaded the BES evidence
      // (3bb.13); the rest are the registration's.
      suppliedFields: ['coordinates', 'operationCodes', 'besEvidence']
    })
    ;[site] = submission.sites
    workItemId = submission.workItems[0].id
    await login.login()
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('shows the site summary rows under Application details, in order', async () => {
    expect(await textOf('application-details-heading')).toBe(
      'Application details'
    )

    const rows = await $$(
      '[data-testid="application-details"] > .govuk-summary-list__row'
    ).map(async (row) => [
      (await row.$('.govuk-summary-list__key').getText()).trim(),
      (await row.$('.govuk-summary-list__value').getText()).trim()
    ])

    expect(rows.slice(0, 11)).toEqual([
      ['Site name', site.siteName],
      ['Location', '1 Rue du Port, Zone Industrielle, Lyon, France'],
      ['ORS ID', site.orsId],
      ['Coordinates', `NEW: ${site.coordinates}`],
      ['Contact name', site.contactName],
      ['Contact email', site.contactEmail],
      ['Contact phone', site.contactPhone],
      ['Operation code', 'NEW: R3'],
      ['Basel/OECD codes', 'B3011, B3020'],
      ['Arrangements for rejected or returned loads', site.repatriatedLoads],
      ['Conditions of export', 'Yes']
    ])
    expect(rows[11][0]).toBe('Evidence of broadly equivalent standards')
    expect(rows).toHaveLength(12)
  })

  it('marks only the values the operator supplied', async () => {
    const flag = (key) =>
      $(
        `[data-testid="app-detail-value-${key}"] [data-testid="app-detail-supplied-${key}"]`
      )

    await expect(flag('coordinates')).toHaveText('NEW:')
    await expect(flag('recycling-operation')).toHaveText('NEW:')
    await expect(flag('location')).not.toExist()
    await expect(flag('conditions-of-export')).not.toExist()
    await expect(
      $$('[data-testid="application-details"] .app-new-flag')
    ).toBeElementsArrayOfSize(3)
  })

  // 3bb.13: evidence uploaded on the request is marked once, before its
  // first file, as a supplied value is on its first line.
  it('marks the BES evidence the operator uploaded on the request', async () => {
    const [file] = site.besEvidence.files
    const entry = $('[data-testid="app-detail-value-bes-evidence"] li')

    await expect(
      entry.$('[data-testid="app-detail-supplied-bes-evidence"]')
    ).toHaveText('NEW:')
    expect(
      (await entry.getText()).trim().startsWith(`NEW: ${file.filename}`)
    ).toBe(true)
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

  it('lists the interim sites, each collapsed under its name', async () => {
    const section = $('[data-testid="interim-sites"]')
    expect(await textOf('interim-sites-heading', section)).toBe(
      'Interim sites (1)'
    )

    const interimSite = section.$('[data-testid="interim-site"]')
    expect(await interimSite.getTagName()).toBe('details')
    expect(await interimSite.getAttribute('open')).toBeNull()
    expect(await textOf('interim-site-name', interimSite)).toBe(
      'Antwerp Transfer Hub'
    )
    // Its name is unique, so the heading has no address.
    await expect(
      interimSite.$('[data-testid="interim-site-summary-address"]')
    ).not.toExist()

    await detail.expandAllInterimSiteDetails()
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
    expect(await textOf('interim-site-contact-phone', interimSite)).toBe(
      '0123456789'
    )
    expect(await textOf('interim-site-operation-code', interimSite)).toBe('R13')
  })

  it('has the assignment panel and only the Duly make action', async () => {
    const panel = $('[data-testid="case-assignment-panel"]')
    await expect(panel).toExist()
    await expect(panel.$('[data-testid="self-assign-submit"]')).toHaveText(
      'Assign to yourself and start'
    )
    await expect(panel.$('[data-testid="reassign-link"]')).toExist()
    await expect(panel.$('[data-testid="unassign-link"]')).toExist()

    // RA-495: a Not started application offers Duly make (its own CTA, not
    // a generic action) and nothing else.
    await expect($('[data-testid="duly-make-cta"]')).toExist()
    await expect($('[data-testid="log-decision-cta"]')).not.toExist()
    await expect($('[data-testid="work-item-actions"]')).not.toExist()
    await expect($('[data-testid="action-duly-make"]')).not.toExist()
    await expect($('[data-testid="action-query"]')).not.toExist()
  })
})
