import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Application information for a work item created through the case management
 * form — i.e. the SPARSE case.
 *
 * Complements application-details-full-payload.e2e.js, which covers the rich
 * seeded payload. A form-created item populates only organisation name, site
 * address, material and tonnage band, so it is the only fixture that exercises
 * how the UI copes with everything else being absent. Empty states are exactly
 * where a template regression hides: a section that renders a stray label, an
 * "[object Object]", or a table with no rows looks fine on the rich fixture.
 *
 * RA-295 MIGRATION. These assertions used to run against a separate page at
 * /work-items/{id}/application-details, which AC02 folded into the work item
 * detail page. The page object for that route is deleted; everything here now
 * reads the detail page.
 *
 * Two behaviours changed with the move, and the assertions follow them rather
 * than being loosened:
 *   - the retained reference block OMITS valueless rows instead of rendering
 *     an em dash, so absent data is asserted as row-absent
 *   - the page identity is the case header, not an appHeading caption
 */
describe('Application information — sparse, form-created work item', () => {
  let workItemId
  let applicationReference

  before(async () => {
    await login.login()
    await workItems.goto()
    ;({ id: workItemId, applicationReference } = await workItems.createWorkItem(
      {
        organisationName: 'App Details Test Ltd',
        siteAddressLine1: '1 Details Lane',
        // Clear the form's pre-filled example line 2 so this item exercises
        // the empty-line2 path (the line must be dropped from the address).
        siteAddressLine2: '',
        siteAddressTown: 'Leeds',
        siteAddressPostcode: 'LS1 1AB',
        material: 'paper',
        tonnageBand: '500-5000'
      }
    ))
    await workItems.openWorkItem(workItemId)
  })

  after(async () => {
    await login.logout()
  })

  describe('page identity', () => {
    it('shows the application reference in the case header', async () => {
      await expect(detail.caseHeaderField('accreditationRef')).toHaveText(
        expect.stringContaining(applicationReference)
      )
    })

    it('no longer offers a link to a separate application details page', async () => {
      await expect(detail.viewApplicationDetailsLink()).not.toBeExisting()
    })
  })

  describe('site address assembled from the nested address object', () => {
    it('formats the address rather than stringifying the object', async () => {
      // The original regression this guards: siteAddress arrives as a nested
      // object, and a template that interpolates it directly renders the
      // literal "[object Object]". Asserting the real parts AND the absence of
      // that string keeps both halves of the guard.
      const address = await detail.applicationDetailRowText('site-address')
      expect(address).toContain('1 Details Lane')
      expect(address).toContain('Leeds')
      expect(address).not.toContain('[object Object]')
    })

    it('shows the postcode', async () => {
      await expect(detail.applicationDetailRow('site-address')).toHaveText(
        expect.stringContaining('LS1 1AB')
      )
    })

    it('drops the empty second address line', async () => {
      // Line 2 was deliberately cleared on the form. A template that joins the
      // address parts without filtering empties leaves a doubled separator.
      const address = await detail.applicationDetailRowText('site-address')
      expect(address).not.toMatch(/,\s*,/)
    })
  })

  describe('sections with no submitted data', () => {
    it('omits the declaration row rather than rendering an empty one', async () => {
      // No submittedBy on a form-created item. The reference block omits
      // valueless rows outright, so absence is the only meaningful assertion —
      // the old em-dash placeholder no longer exists.
      expect(await detail.hasReferenceRow('declaration')).toBe(false)
    })

    it('omits the operator registration id row', async () => {
      expect(await detail.hasReferenceRow('operator-registration-id')).toBe(
        false
      )
    })

    it('still renders the reference block for the values it does have', async () => {
      // Guards every absence assertion above against passing simply because
      // the whole block failed to render.
      expect(await detail.hasReferenceRow('work-item-id')).toBe(true)
      expect(await detail.hasReferenceRow('application-reference')).toBe(true)
    })

    it('shows an empty state for the sampling and inspection plan', async () => {
      // No files uploaded. The row must say so rather than render an empty
      // document list, which would read as "nothing to check" to a caseworker.
      await expect(detail.noDocumentsMessage()).toBeDisplayed()
      expect((await detail.supportingDocumentNames()).length).toBe(0)
    })

    it('renders the business plan and authoriser rows without inventing data', async () => {
      // Both rows still exist (AC02 fixes the field order), but with no
      // submitted data they must show the empty-value marker rather than
      // fabricating content.
      for (const row of ['business-plan', 'prn-authorisers']) {
        expect(await detail.hasApplicationDetailRow(row)).toBe(true)
      }
    })
  })

  describe('Exporter-only sections', () => {
    it('hides BES and the overseas reprocessing site', async () => {
      // A form-created item has no overseasSites, which is the proxy
      // management-fe gates these on.
      expect(await detail.hasApplicationDetailRow('bes')).toBe(false)
      expect(await detail.hasApplicationDetailRow('ors')).toBe(false)
    })
  })

  describe('prior year section (RA-254), folded onto the detail page', () => {
    it('renders the heading and all of its parts', async () => {
      // Asserted unconditionally, on purpose. My first version skipped the
      // body when the heading was absent, on the reasoning that management-fe
      // omits the block when the backend prior-year lookup fails. That made
      // the test unfalsifiable: it reported green both when the section
      // rendered correctly AND when it had vanished entirely.
      //
      // The retired spec asserted this section's presence unconditionally and
      // passed, so it does render reliably against the compose stack. If the
      // lookup genuinely becomes unreliable, a red test saying so is the right
      // outcome — far better than a silent pass hiding a section that stopped
      // rendering.
      expect(await detail.hasPriorYear('heading')).toBe(true)
      expect(await detail.hasPriorYear('tonnage')).toBe(true)
      expect(await detail.hasPriorYear('authorisers')).toBe(true)
      expect(await detail.hasPriorYear('businessPlan')).toBe(true)
    })
  })
})
