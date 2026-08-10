import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  ORS_DETAIL_FIELDS,
  INTERIM_DETAIL_FIELDS
} from '../page-objects/work-item-detail.page.js'
import { ORG_NAME, ORS, INTERIM, AUTHORISERS } from '../support/ra-292-seed.js'

/**
 * RA-292 (AC04): the site data behind the flag.
 *
 * "Given I am viewing a case flagged as containing a new ORS, a new Interim
 * site, or a new authority-to-issue: when I open the case/work item details,
 * then I should see the specific site data details clearly displayed (ORS &
 * Interim), and I should see the authority-to-issue contacts if included."
 *
 * The flag is only half the story — it tells a regulator WHERE to look, and
 * this AC is about there being something to look at when they get there. The
 * badge specs live in ra-292-new-flags.e2e.js; everything here is about the
 * data points themselves.
 *
 * Two things drive the shape of this file:
 *
 *  1. management-fe OMITS a detail row entirely when its source value is
 *     absent, rather than rendering an em-dash placeholder. So "present" and
 *     "absent" are both meaningful, assertable outcomes, and the near-minimal
 *     Bilbao site is as much a part of the AC as the fully-populated Rotterdam
 *     one — it is what proves the omission is driven by the data rather than
 *     by a field the template never learned to render.
 *
 *  2. That omission rule has a trap in it. `repatriatedLoads: 0` and
 *     `registeredNowAccredited: false` are FALSY but not absent, and "0 loads
 *     repatriated" / "not yet accredited" are answers a regulator needs. A
 *     truthiness-based omission check drops them, and the page still looks
 *     complete. Those two get their own tests below.
 */
describe('RA-292: ORS and interim site detail on the work item overview', () => {
  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, and this seed item is
    // unassigned — reset filters first or the search returns nothing.
    await workItems.resetFilters()
    await workItems.searchByOrgName(ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC04 — ORS site data', () => {
    it('displays every ORS data point for the fully-populated new site', async () => {
      // Asserted as one map rather than thirteen separate expects so a
      // regression reports every field it dropped at once. Thirteen expects
      // would stop at the first and hide the other twelve behind it.
      const values = await detail.blockFields(
        'overseasSite',
        ORS.NEW.name,
        ORS_DETAIL_FIELDS
      )
      const missing = ORS_DETAIL_FIELDS.filter((key) => values[key] === null)
      expect(missing).toEqual([])
    })

    it('displays the correct values, not just populated rows', async () => {
      // A row rendered from the wrong source field is invisible to a
      // presence check but wrong on screen — and with two sites on the page
      // carrying the same field names, rendering site[1]'s contact under
      // site[0] is a plausible bug.
      const site = ORS.NEW
      const values = await detail.blockFields('overseasSite', site.name, [
        'overseas-site-ors-id',
        'overseas-site-address',
        'overseas-site-coordinates',
        'overseas-site-contact-name',
        'overseas-site-contact-email',
        'overseas-site-contact-phone',
        'overseas-site-operation-code',
        'overseas-site-conditions-of-export'
      ])
      expect(values['overseas-site-ors-id']).toBe(site.orsId)
      expect(values['overseas-site-address']).toContain(site.address)
      expect(values['overseas-site-address']).toContain(site.town)
      expect(values['overseas-site-coordinates']).toBe(site.coordinates)
      expect(values['overseas-site-contact-name']).toBe(site.contactName)
      expect(values['overseas-site-contact-email']).toBe(site.contactEmail)
      expect(values['overseas-site-contact-phone']).toBe(site.contactPhone)
      expect(values['overseas-site-operation-code']).toBe(site.operationCode)
      expect(values['overseas-site-conditions-of-export']).toBe(
        site.conditionsOfExport
      )
    })

    it('lists all three Basel/OECD waste codes for the new site', async () => {
      // The seed carries three codes in separate fields. A template that
      // renders the first and stops passes a "waste codes are shown" check
      // while losing two thirds of the data — the same failure mode RA-295
      // found in the supporting-documents list.
      const codes = await detail.blockFieldText(
        'overseasSite',
        ORS.NEW.name,
        'overseas-site-waste-codes'
      )
      for (const code of ORS.NEW.wasteCodes) {
        expect(codes).toContain(code)
      }
    })

    it('shows the country on the site name line', async () => {
      const name = await detail.flaggedBlockNamed('overseasSite', ORS.NEW.name)
      await expect(name).toHaveText(expect.stringContaining(ORS.NEW.country))
    })

    it('displays the established site data independently of the new one', async () => {
      // Proves the detail rendering is per-site rather than the first site's
      // data repeated down the page.
      const site = ORS.ESTABLISHED
      const values = await detail.blockFields('overseasSite', site.name, [
        'overseas-site-ors-id',
        'overseas-site-contact-name',
        'overseas-site-operation-code'
      ])
      expect(values['overseas-site-ors-id']).toBe(site.orsId)
      expect(values['overseas-site-contact-name']).toBe(site.contactName)
      expect(values['overseas-site-operation-code']).toBe(site.operationCode)
    })
  })

  describe('AC04 — falsy values are data, not absence', () => {
    it('renders "0" repatriated loads rather than omitting the row', async () => {
      // The established site's `repatriatedLoads` is a real JSON zero. If the
      // omission check is `{% if value %}` this row disappears and the
      // regulator cannot tell "no loads were repatriated" from "we were never
      // told" — a materially different fact when assessing a site.
      const loads = await detail.blockFieldText(
        'overseasSite',
        ORS.ESTABLISHED.name,
        'overseas-site-repatriated-loads'
      )
      expect(loads).toBe(ORS.ESTABLISHED.repatriatedLoads)
    })

    it('renders a false boolean as "No" rather than omitting the row', async () => {
      // Same trap, different type. The new Rotterdam site is NOT already
      // registered-and-now-seeking-accreditation, and "No" is the answer the
      // regulator needs to see.
      const registered = await detail.blockFieldText(
        'overseasSite',
        ORS.NEW.name,
        'overseas-site-registered-now-accredited'
      )
      expect(registered).toBe(ORS.NEW.registeredNowAccredited)
    })

    it('renders true booleans as "Yes"', async () => {
      const values = await detail.blockFields('overseasSite', ORS.NEW.name, [
        'overseas-site-eu-country',
        'overseas-site-oecd-country'
      ])
      expect(values['overseas-site-eu-country']).toBe(ORS.NEW.euCountry)
      expect(values['overseas-site-oecd-country']).toBe(ORS.NEW.oecdCountry)
    })
  })

  describe('AC04 — a sparsely populated ORS omits rows rather than inventing them', () => {
    it('shows the fields the near-minimal site does have', async () => {
      const values = await detail.blockFields('overseasSite', ORS.LEGACY.name, [
        'overseas-site-ors-id',
        'overseas-site-address'
      ])
      expect(values['overseas-site-ors-id']).toBe(ORS.LEGACY.orsId)
      expect(values['overseas-site-address']).toContain(ORS.LEGACY.town)
    })

    it('omits the rows it has no data for', async () => {
      // The complement of the "every field renders" test above, and the half
      // that actually proves the rendering is data-driven. Without it, a
      // template hardcoding every row with a placeholder would pass the
      // fully-populated case and quietly show a regulator empty contact
      // details for a site that never supplied any.
      const absent = [
        'overseas-site-coordinates',
        'overseas-site-contact-name',
        'overseas-site-contact-email',
        'overseas-site-contact-phone',
        'overseas-site-operation-code',
        'overseas-site-waste-codes',
        'overseas-site-conditions-of-export'
      ]
      const values = await detail.blockFields(
        'overseasSite',
        ORS.LEGACY.name,
        absent
      )
      const unexpectedlyPresent = absent.filter((key) => values[key] !== null)
      expect(unexpectedlyPresent).toEqual([])
    })
  })

  describe('AC04 — interim site data', () => {
    it('displays every interim data point for the new interim site', async () => {
      const values = await detail.blockFields(
        'interimSite',
        INTERIM.NEW.name,
        INTERIM_DETAIL_FIELDS
      )
      const missing = INTERIM_DETAIL_FIELDS.filter(
        (key) => values[key] === null
      )
      expect(missing).toEqual([])
    })

    it('displays the correct interim values', async () => {
      const site = INTERIM.NEW
      const values = await detail.blockFields('interimSite', site.name, [
        'interim-site-site-number',
        'interim-site-address',
        'interim-site-contact-name',
        'interim-site-contact-email',
        'interim-site-contact-phone'
      ])
      expect(values['interim-site-site-number']).toBe(site.siteNumber)
      expect(values['interim-site-address']).toContain(site.address)
      expect(values['interim-site-address']).toContain(site.town)
      expect(values['interim-site-contact-name']).toBe(site.contactName)
      expect(values['interim-site-contact-email']).toBe(site.contactEmail)
      expect(values['interim-site-contact-phone']).toBe(site.contactPhone)
    })

    it('displays the established interim site independently', async () => {
      // The established interim site has no addressLine2 in the seed, which
      // is the case a naive address join renders as "8 Speicherstrasse, ,
      // Bremen". Asserting on the composed string is what catches that.
      const site = INTERIM.ESTABLISHED
      const values = await detail.blockFields('interimSite', site.name, [
        'interim-site-site-number',
        'interim-site-address',
        'interim-site-contact-name'
      ])
      expect(values['interim-site-site-number']).toBe(site.siteNumber)
      expect(values['interim-site-address']).toContain(site.address)
      expect(values['interim-site-address']).toContain(site.town)
      expect(values['interim-site-address']).not.toContain(', ,')
      expect(values['interim-site-contact-name']).toBe(site.contactName)
    })

    it('renders each interim site under its own ORS site', async () => {
      // AC04 says the interim detail must be "clearly displayed", and an
      // interim site shown against the wrong ORS is worse than one not shown
      // at all. The nesting is the only thing on the page that says which
      // reprocessing site a holding site belongs to.
      const rotterdam = await detail.flaggedBlockNamed(
        'overseasSite',
        ORS.NEW.name
      )
      await expect(rotterdam.$('[data-testid="interim-site-name"]')).toHaveText(
        expect.stringContaining(INTERIM.NEW.name)
      )

      const hamburg = await detail.flaggedBlockNamed(
        'overseasSite',
        ORS.ESTABLISHED.name
      )
      await expect(hamburg.$('[data-testid="interim-site-name"]')).toHaveText(
        expect.stringContaining(INTERIM.ESTABLISHED.name)
      )
    })
  })

  describe('AC04 — authority-to-issue contacts', () => {
    it('shows the contact detail for every authoriser, not just the new one', async () => {
      // "I should see the authority-to-issue contacts if included" — all of
      // them. The flag decides which are highlighted, not which are shown.
      // The email is asserted alongside the name because the name alone is
      // not a contact. AC04 asks for the "authority-to-issue contacts", and a
      // regulator who has to go and look someone up has not been given one.
      for (const authoriser of Object.values(AUTHORISERS)) {
        const contact = await detail.flaggedBlockNamed(
          'authorityToIssueContact',
          authoriser.name
        )
        await expect(contact).toHaveText(
          expect.stringContaining(authoriser.name)
        )
        await expect(contact).toHaveText(
          expect.stringContaining(authoriser.email)
        )
      }
    })

    it('shows an email address against the new authoriser', async () => {
      const contact = await detail.flaggedBlockNamed(
        'authorityToIssueContact',
        AUTHORISERS.NEW.name
      )
      await expect(contact).toHaveText(
        expect.stringContaining(AUTHORISERS.NEW.email)
      )
    })
  })

  describe('AC04 — the page as a whole', () => {
    it('renders no value as [object Object] or undefined', async () => {
      // RA-292 adds template code that reaches into nested site objects.
      // Nunjucks stringifies rather than throwing, so this class of bug ships
      // as a 200 that looks fine until someone reads it.
      await detail.assertNoUnrenderedValues()
    })

    it('keeps the pre-existing application information rows intact', async () => {
      for (const key of [
        'site-address',
        'type',
        'material',
        'prn-tonnage',
        'prn-authorisers',
        'authority-to-issue',
        'ors'
      ]) {
        expect(await detail.hasApplicationDetailRow(key)).toBe(true)
      }
    })

    it('keeps the AC-prescribed row order', async () => {
      // RA-295 fixed this order and RA-292 edits the same template. Reordering
      // it as a side effect of adding site markup is a silent regression of
      // another story's AC.
      const order = await detail.applicationDetailRowOrder()
      expect(order.indexOf('bes')).toBeLessThan(order.indexOf('ors'))
      expect(order.indexOf('business-plan')).toBeLessThan(order.indexOf('bes'))
    })
  })
})

/**
 * RA-292 access guards.
 *
 * The overview page is where this data now lives, so the story inherits that
 * page's access rules. Neither is new behaviour — which is exactly why they
 * need asserting: a new section added to a template is the easiest place to
 * accidentally render data outside the guard that protects the rest of it.
 */
describe('RA-292: access to the new site data', () => {
  it('is not reachable without a session', async () => {
    await browser.url('/work-items')
    await expect($('h1=Stub Login')).toBeDisplayed()
  })

  describe('as the read-only support user', () => {
    before(async () => {
      // RA-335: the support user sees case data but can take no action on it.
      // The new site detail is case data, so it must be visible — a guard
      // that hid it would be a regression of RA-335's read access, and one
      // that exposed an action alongside it a regression of its read-ONLY
      // half.
      await login.loginAsSupportUser()
      await workItems.resetFilters()
      await workItems.searchByOrgName(ORG_NAME)
      await browser.waitUntil(
        async () => (await browser.getUrl()).includes('filtersApplied=1'),
        { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
      )
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
    })

    after(async () => {
      await login.logout()
    })

    it('can read the ORS and interim site detail', async () => {
      expect(await detail.flaggedBlockCount('overseasSite')).toBe(3)
      expect(await detail.flaggedBlockCount('interimSite')).toBe(2)
    })

    it('sees the same New flags a caseworker sees', async () => {
      expect(await detail.blockHasNewTag('overseasSite', ORS.NEW.name)).toBe(
        true
      )
      expect(await detail.blockHasNewTag('interimSite', INTERIM.NEW.name)).toBe(
        true
      )
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.NEW.name
        )
      ).toBe(true)
    })

    it('is still offered no assignment affordances on the page', async () => {
      await detail.assertNoUsableAssignmentAffordances()
    })
  })
})
