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
 *  2. That omission rule has a trap in it. The BOOLEAN fields —
 *     `registeredNowAccredited`, `isEu`, `isOecd` — are real booleans on the
 *     wire, so `false` is genuinely falsy and a truthiness-based omission
 *     check deletes those rows. "Not yet accredited" is an answer a regulator
 *     needs, and its absence reads as "not asked" while the page still looks
 *     complete. Those get dedicated tests below.
 *
 *     Note the boundary: `repatriatedLoads` and `coordinates` cross the wire
 *     as STRINGS (verified against serialised legacy-be output), so `"0"` is
 *     truthy and is NOT part of this trap. It is asserted below as a value,
 *     not as omission-logic coverage — the distinction is recorded so nobody
 *     later mistakes that test for a guarantee it does not provide.
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

  describe('AC04 — the two lines the design mock prescribes', () => {
    // These two are the HIGH-CONFIDENCE core of AC04 and are pinned hard.
    //
    // The design mock shows an ORS as name + address, in that order, directly
    // under one another. management-fe additionally renders twelve detail
    // fields, and whether the mock is abbreviated or prescriptive is an open
    // question with design. Whichever way that lands, THESE two lines survive
    // — so they are asserted separately from the twelve, and a decision to
    // strip the detail should not be able to take the whole AC's coverage
    // down with it.
    it('shows the site name and the full address beneath it', async () => {
      const name = await detail.flaggedBlockNamed('overseasSite', ORS.NEW.name)
      await expect(name).toHaveText(expect.stringContaining(ORS.NEW.name))

      const address = await detail.blockFieldAllText(
        'overseasSite',
        ORS.NEW.name,
        'overseas-site-address'
      )
      // Every line of it, not just the first. The address is the only piece
      // of ORS identity the mock keeps besides the name, so a truncated one
      // is a real loss even though it looks populated.
      expect(address).toContain(ORS.NEW.address)
      expect(address).toContain(ORS.NEW.town)
      expect(address).toContain(ORS.NEW.country)
    })

    it('shows the interim site name under its parent ORS', async () => {
      const interim = await detail.flaggedBlockNamed(
        'interimSite',
        INTERIM.NEW.name
      )
      await expect(interim).toHaveText(
        expect.stringContaining(INTERIM.NEW.name)
      )
    })
  })

  describe('AC04 — ORS site data', () => {
    // ⚠ PROVISIONAL, by agreement with management-fe and the ticket lead.
    // The twelve detail fields below go beyond the design mock, which shows
    // name + address only. AC04's wording ("the specific site data details
    // clearly displayed") is what justifies them, and design has been asked
    // to confirm. If it comes back "name and address only", these rows get
    // deleted in management-fe and this describe block goes with them — the
    // mock's two lines are pinned separately above so that removal cannot
    // quietly gut AC04's coverage.
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
        'overseas-site-coordinates',
        'overseas-site-contact-name',
        'overseas-site-contact-email',
        'overseas-site-contact-phone',
        'overseas-site-operation-code'
      ])
      expect(values['overseas-site-ors-id']).toBe(site.orsId)
      // The address is read across ALL its elements: design moved it under
      // the site name as one <p> per line, so a single-element read returns
      // only "1 Havenstraat" and a town assertion fails against a page that
      // is rendering perfectly.
      const address = await detail.blockFieldAllText(
        'overseasSite',
        site.name,
        'overseas-site-address'
      )
      expect(address).toContain(site.address)
      expect(address).toContain(site.town)
      expect(values['overseas-site-coordinates']).toBe(site.coordinates)
      expect(values['overseas-site-contact-name']).toBe(site.contactName)
      expect(values['overseas-site-contact-email']).toBe(site.contactEmail)
      expect(values['overseas-site-contact-phone']).toBe(site.contactPhone)
      expect(values['overseas-site-operation-code']).toBe(site.operationCode)
    })

    it('renders conditionsOfExport across all three of its states', async () => {
      // A nullable boolean, so it has three observable states and each one is
      // a different answer to the regulator: yes, no, and "not supplied".
      // Asserted together because the value that matters most is the one that
      // ISN'T there — a field rendering "No" when the operator never answered
      // would be a fabricated compliance statement, and the two are one line
      // apart in a template.
      //
      // The type here was genuinely disputed across three repos for part of
      // this story (prose vs nullable boolean). It is pinned now only because
      // legacy-be's model settles it — `public bool? ConditionsOfExport` —
      // and management-be's seed and management-fe's rendering both agree.
      expect(
        await detail.blockFieldText(
          'overseasSite',
          ORS.NEW.name,
          'overseas-site-conditions-of-export'
        )
      ).toBe(ORS.NEW.conditionsOfExport)

      expect(
        await detail.blockFieldText(
          'overseasSite',
          ORS.ESTABLISHED.name,
          'overseas-site-conditions-of-export'
        )
      ).toBe(ORS.ESTABLISHED.conditionsOfExport)

      // Absent, not "No". This is the assertion the sparse-site fixture cannot
      // reach: Port Klang is complete in every other respect, so a template
      // that defaulted a missing nullable to false would look entirely
      // plausible here and be wrong.
      expect(
        await detail.blockFieldText(
          'overseasSite',
          ORS.NON_EU.name,
          'overseas-site-conditions-of-export'
        )
      ).toBeNull()
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
      // "No loads were repatriated" and "we were never told" are materially
      // different facts when assessing a site, and only one of them is good
      // news. The row has to appear.
      //
      // This one is a weaker test than it looks, and deliberately kept anyway:
      // `repatriatedLoads` crosses the wire as a STRING, so `"0"` is truthy
      // and would survive even a truthiness-based omission check. It pins the
      // value, not the omission logic. The booleans below are what actually
      // hold that line.
      const loads = await detail.blockFieldText(
        'overseasSite',
        ORS.ESTABLISHED.name,
        'overseas-site-repatriated-loads'
      )
      expect(loads).toBe(ORS.ESTABLISHED.repatriatedLoads)
    })

    it('renders a false boolean as "No" rather than omitting the row', async () => {
      // THIS is the real falsy-omission test. `registeredNowAccredited` is a
      // true boolean on the wire, so `false` is genuinely falsy and a
      // `{% if value %}` omission check deletes the row outright.
      //
      // The new Rotterdam site is NOT already registered-and-now-seeking-
      // accreditation. "No" is the answer the regulator needs; silence reads
      // as "not asked" and the page looks complete either way, which is what
      // makes the failure mode worth a dedicated test rather than a comment.
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

    it('renders isEu false and isOecd false as "No" on the non-EU site', async () => {
      // `registeredNowAccredited` covers the falsy-boolean branch only if
      // management-fe renders every boolean through one shared helper. If the
      // rows are per-field conditionals, `isEu` and `isOecd` have their own
      // untested branches — so these are asserted on their own rather than
      // assumed to be covered by proxy.
      //
      // Port Klang is in Malaysia — genuinely neither EU nor OECD, rather than
      // a European site flipped to false to reach the branch.
      //
      // Asserted across ALL sites rather than by reading Port Klang alone: the
      // failure being guarded is a row that VANISHES, and "the field is absent
      // here" is indistinguishable from "the field is absent everywhere"
      // unless the other three sites are in the comparison.
      for (const field of [
        'overseas-site-eu-country',
        'overseas-site-oecd-country'
      ]) {
        const rows = await detail.flaggedBlockFieldValues('overseasSite', field)
        const saidNo = rows.filter((row) => row.value === 'No')

        // The row must RENDER as "No", not vanish. A truthiness-based omission
        // check yields zero here, and a regulator cannot tell "not an OECD
        // country" from "we were never told" — the difference between a
        // shipment needing Annex VII controls and one that does not.
        expect(saidNo).toHaveLength(1)
        expect(saidNo[0].name).toContain(ORS.NON_EU.name)
      }
    })
  })

  describe('AC04 — a nullable field absent from an otherwise-complete site', () => {
    it('renders every other data point for the non-EU site', async () => {
      // Port Klang is fully populated EXCEPT conditionsOfExport. That is the
      // shape the sparse-site test below cannot reach: a site with nothing
      // missing except one nullable field. A template that decided how to
      // render a site by branching on "is this site complete?" rather than
      // per-field would fall into the sparse branch here and drop everything.
      const expected = ORS_DETAIL_FIELDS.filter(
        (key) => key !== 'overseas-site-conditions-of-export'
      )
      const values = await detail.blockFields(
        'overseasSite',
        ORS.NON_EU.name,
        expected
      )
      const missing = expected.filter((key) => values[key] === null)
      expect(missing).toEqual([])
    })

    it('omits only the nullable field it lacks', async () => {
      // conditionsOfExport is the one nullable field among the flags, so
      // "absent on an otherwise-complete site" is a legitimate production
      // shape rather than bad data — and it must not drag its neighbours out
      // of the summary list with it.
      const value = await detail.blockFieldText(
        'overseasSite',
        ORS.NON_EU.name,
        'overseas-site-conditions-of-export'
      )
      expect(value).toBeNull()
    })
  })

  describe('AC04 — a sparsely populated ORS omits rows rather than inventing them', () => {
    it('shows the fields the near-minimal site does have', async () => {
      const values = await detail.blockFields('overseasSite', ORS.LEGACY.name, [
        'overseas-site-ors-id'
      ])
      expect(values['overseas-site-ors-id']).toBe(ORS.LEGACY.orsId)

      const address = await detail.blockFieldAllText(
        'overseasSite',
        ORS.LEGACY.name,
        'overseas-site-address'
      )
      expect(address).toContain(ORS.LEGACY.town)
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
      expect(await detail.flaggedBlockCount('overseasSite')).toBe(4)
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

    it('is still offered no USABLE assignment control on the page', async () => {
      // RA-335's read-only shape renders the assignment controls present but
      // inert (self-assign disabled, reassign/unassign without an href) rather
      // than replacing the panel with a closed notice — that closed-notice
      // shape is RA-358's terminal-state case, a different thing entirely.
      //
      // So this asserts the property that actually matters and holds for both
      // shapes: none of the three controls is USABLE. Asserting the markup
      // shape instead would make this test a duplicate of RA-335's own, and
      // it would fail whenever that shape changed for reasons unrelated to
      // RA-292 — which is not what a spec in this file is for. What RA-292
      // needs to know is narrower: adding the ORS/interim/authority section
      // did not hand the support user an action alongside it.
      for (const control of ['selfAssign', 'reassign', 'unassign']) {
        expect(await detail.hasUsableAssignmentControl(control)).toBe(false)
      }
    })
  })
})
