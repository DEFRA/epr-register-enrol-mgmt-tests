import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  INTERIM_DETAIL_FIELDS
} from '../page-objects/work-item-detail.page.js'
import { ORG_NAME, ORS, INTERIM, AUTHORISERS } from '../support/ra-292-seed.js'

/**
 * RA-292 (AC04): interim site data, authority-to-issue contacts, page-wide
 * checks, and the access guards over this data.
 *
 * Split out of ra-292-site-detail.e2e.js (which keeps the ORS-site-data half
 * of AC04) purely so wdio can schedule the two halves on separate workers —
 * see that file's header comment for the AC's full context and the design
 * rationale behind the omission-vs-em-dash behaviour being tested.
 */
describe('RA-292: interim site detail, authority-to-issue contacts and access', () => {
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
    // RA-486: each ORS now renders as a collapsed-by-default <details> —
    // expand so nested interim-site content is readable by the assertions
    // below.
    await detail.expandAllOverseasSiteDetails()
  })

  after(async () => {
    await login.logout()
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
      expect(values['interim-site-contact-name']).toBe(site.contactName)
      expect(values['interim-site-contact-email']).toBe(site.contactEmail)
      expect(values['interim-site-contact-phone']).toBe(site.contactPhone)

      // Full string, for the same reason as the ORS address: a segment dropped
      // from a comma-joined line is invisible to any substring check. The
      // interim wire shape carries stateOrRegion and postcode where the ORS
      // shape has neither, so this is six segments rather than four — and the
      // two extra ones are the likeliest to be lost.
      expect(values['interim-site-address']).toBe(site.fullAddress)
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
      expect(values['interim-site-contact-name']).toBe(site.contactName)

      // Bremen has no addressLine2, which is the case a naive join renders as
      // "8 Speicherstrasse, , Bremen". The empty-segment guard is kept
      // alongside the equality check rather than replaced by it: equality says
      // WHAT is wrong, `', ,'` says WHY, and on a six-segment string that
      // distinction is worth one extra line.
      expect(values['interim-site-address']).not.toContain(', ,')
      expect(values['interim-site-address']).toBe(site.fullAddress)
    })

    it('RA-486: shows recycling operation codes on the interim site itself', async () => {
      // Antwerp seeds an ARRAY (['R12', 'R3']) and Bremen a bare STRING
      // ('R13') — see ra-292-seed.js. `interim-site-operation-code` is a
      // single `<dd>` holding one `<p>` per value (siteDetails() in
      // detail.njk), so blockFieldText's single getText() already reads
      // every line; asserted with toContain rather than an exact multi-line
      // match, matching this file's own wasteCodes precedent, because the
      // exact join format between lines is markup detail this suite is not
      // entitled to pin.
      const antwerp = await detail.blockFieldText(
        'interimSite',
        INTERIM.NEW.name,
        'interim-site-operation-code'
      )
      for (const code of INTERIM.NEW.operationCode) {
        expect(antwerp).toContain(code)
      }

      const bremen = await detail.blockFieldText(
        'interimSite',
        INTERIM.ESTABLISHED.name,
        'interim-site-operation-code'
      )
      expect(bremen).toContain(INTERIM.ESTABLISHED.operationCode)
    })

    it('RA-486: interim recycling operation codes are display-only, no edit control', async () => {
      // The plan is explicit that interim-site codes gain NO edit capability
      // on the regulator side (unlike the ORS's own codes, which the
      // Recycling operations tab's "Change" link can edit) — this asserts
      // the negative directly rather than merely by omission, so a future
      // edit affordance added inside the interim block is caught here even
      // if no other RA-486 spec happens to look at this block.
      const interim = await detail.flaggedBlockNamed(
        'interimSite',
        INTERIM.NEW.name
      )
      const interactiveElements = await interim.$$(
        'a, button, [data-testid*="change"], [data-testid*="edit"]'
      )
      expect([...interactiveElements]).toHaveLength(0)
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
      // RA-486: each ORS now renders as a collapsed-by-default <details> —
      // expand so nested interim-site content is readable by the
      // assertions below.
      await detail.expandAllOverseasSiteDetails()
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
