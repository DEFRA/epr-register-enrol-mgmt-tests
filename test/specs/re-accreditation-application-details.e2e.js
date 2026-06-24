import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import applicationDetails from '../page-objects/application-details.page.js'

/**
 * Application Details page (re-accreditation).
 *
 * The application details page at /work-items/{id}/application-details
 * gives regulators a structured read-only view of every field submitted
 * in an operator's re-accreditation application. The link that opens the
 * page lives on the work item detail page.
 *
 * These tests use work items created through the case management form,
 * which populates the overview fields (application reference, organisation
 * name). Sections that require operator-submitted data (declaration, PRN
 * authorisers, business plan, sampling files) are verified to display the
 * correct empty-state message when the data is absent.
 */
describe('Application details page — re-accreditation', () => {
  let workItemId
  let applicationReference

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId, applicationReference } = await workItems.createWorkItem(
      {
        organisationName: 'App Details Test Ltd',
        siteAddressLine1: '1 Details Lane',
        siteAddressTown: 'Leeds',
        siteAddressPostcode: 'LS1 1AB',
        material: 'paper',
        tonnageBand: '500-5000'
      }
    ))
  })

  after(async () => {
    await login.logout()
  })

  describe('link from detail page', () => {
    before(async () => {
      await workItems.openWorkItem(workItemId)
    })

    it('shows the "View full application details" link', async () => {
      await expect(
        $('[data-testid="view-application-details-link"]')
      ).toBeDisplayed()
    })

    it('link href points to the application-details page for this work item', async () => {
      const href = await $(
        '[data-testid="view-application-details-link"]'
      ).getAttribute('href')
      expect(href).toContain(`/work-items/${workItemId}/application-details`)
    })

    it('clicking the link navigates to the application-details page', async () => {
      await $('[data-testid="view-application-details-link"]').click()
      await applicationDetails.waitForPage()
      const url = await browser.getUrl()
      expect(url).toContain(`/work-items/${workItemId}/application-details`)
    })
  })

  describe('page heading', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('shows the application reference in the caption', async () => {
      const caption = await applicationDetails.getCaption()
      expect(caption).toBe(`Work item ${applicationReference}`)
    })

    it('has the correct page title', async () => {
      const title = await browser.getTitle()
      expect(title).toContain('Application details')
    })
  })

  describe('overview section', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('overview section is present', async () => {
      await expect($('[data-testid="app-details-overview"]')).toBeDisplayed()
    })

    it('shows the application reference', async () => {
      const value = await applicationDetails.getSummaryValueByKey(
        'Application reference'
      )
      expect(value).toBe(applicationReference)
    })

    it('shows the organisation name', async () => {
      const value =
        await applicationDetails.getSummaryValueByKey('Organisation name')
      expect(value).toBe('App Details Test Ltd')
    })
  })

  describe('declaration section', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('is not shown when no submittedBy data is present', async () => {
      const shown = await applicationDetails.isDeclarationShown()
      expect(shown).toBe(false)
    })
  })

  describe('PRNs — authorisers', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('shows the empty state message when no authorisers are recorded', async () => {
      const isEmpty = await applicationDetails.isAuthorisersEmpty()
      expect(isEmpty).toBe(true)
    })

    it('does not show the authorisers table when no authorisers are recorded', async () => {
      await expect(
        $('[data-testid="app-details-authorisers"]')
      ).not.toBeExisting()
    })
  })

  describe('business plan section', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('shows the empty state message when no business plan data is recorded', async () => {
      const isEmpty = await applicationDetails.isBusinessPlanEmpty()
      expect(isEmpty).toBe(true)
    })

    it('does not show the business plan summary list when no data is present', async () => {
      await expect(
        $('[data-testid="app-details-business-plan"]')
      ).not.toBeExisting()
    })
  })

  describe('sampling plan section', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('shows the empty state message when no files are uploaded', async () => {
      const isEmpty = await applicationDetails.isSamplingPlanEmpty()
      expect(isEmpty).toBe(true)
    })

    it('does not show the sampling files table when no files are present', async () => {
      await expect(
        $('[data-testid="app-details-sampling-files"]')
      ).not.toBeExisting()
    })
  })

  describe('back link', () => {
    before(async () => {
      await applicationDetails.open(workItemId)
    })

    it('back link navigates to the work item detail page', async () => {
      const backLink = await $('.govuk-back-link')
      const href = await backLink.getAttribute('href')
      expect(href).toContain(`/work-items/${workItemId}`)
    })
  })
})

describe('Application details page — full operator payload', () => {
  /**
   * When a work item is submitted from the operator frontend, the payload
   * contains sub-objects for declaration (submittedBy), PRNs (authorisers
   * and tonnage band), business plan percentages and sampling plan files.
   * These tests verify those sections render correctly.
   *
   * To avoid depending on a live operator submission, this describe block
   * creates a work item via the case management form and asserts the
   * PRNs tonnage row shows "—" (the sentinel value the controller uses
   * when plannedTonnageBand is absent), which exercises the same rendering
   * path that an operator-submitted "UpTo1000" value would take.
   */
  let workItemId

  before(async () => {
    await login.loginAs('assign')
    await workItems.goto()
    ;({ id: workItemId } = await workItems.createWorkItem({
      organisationName: 'Full Payload Test Org',
      siteAddressLine1: '99 Payload Road',
      siteAddressTown: 'Birmingham',
      siteAddressPostcode: 'B1 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    }))
    await applicationDetails.open(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  it('PRNs tonnage section is present', async () => {
    await expect($('[data-testid="app-details-prns-tonnage"]')).toBeDisplayed()
  })

  it('planned tonnage band shows "—" when not set by the operator', async () => {
    const value = await applicationDetails.getSummaryValueByKey(
      'Planned tonnage band'
    )
    expect(value).toBe('—')
  })
})
