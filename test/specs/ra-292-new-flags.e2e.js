import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { ORG_NAME, ORS, INTERIM, AUTHORISERS } from '../support/ra-292-seed.js'

/**
 * RA-292 (AC01, AC02, AC03): new ORS sites, new interim sites and new
 * authority-to-issue contacts are flagged as NEW on the work item overview.
 *
 * "As a Regulator, I want to be able to manage new ORS, Interim sites and
 * Authority-to-issue requests, so that I can identify, review and approve
 * these items efficiently without missing critical new data points that
 * require validation."
 *
 * The story is about a regulator NOT MISSING something, which makes the badge
 * being CONDITIONAL the real requirement rather than the badge merely
 * existing. A page that badges every site is exactly as useless to that
 * regulator as one that badges none — both leave them re-reading everything —
 * so each AC below is asserted as a pair against the same page: the new thing
 * carries the tag AND the established thing next to it does not.
 *
 * The seeded item (management-be seed key `ors-interim-authority`) is built
 * for precisely that: three ORS sites and three authorisers covering the flag
 * being true, false, and absent entirely. The absent case is not redundant
 * with false — Nunjucks resolves a missing key to undefined, so a template
 * written as `{% if site.isNewSite != false %}` passes a true/false pair and
 * still badges every site on every case submitted before this story shipped.
 *
 * AC04 (the site DETAIL fields) lives in ra-292-site-detail.e2e.js.
 */
describe('RA-292: new ORS, interim site and authority-to-issue flags', () => {
  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, and this seed item is
    // unassigned — reset to an explicit empty filter so the search is not
    // implicitly assignee-scoped and silently returns nothing.
    await workItems.resetFilters()
    await workItems.searchByOrgName(ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    // Hard gate: the search must resolve to exactly the one seeded item, so
    // "the first row" is unambiguous and every assertion below is known to be
    // reading the fixture it was written against.
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC01 — a new ORS is flagged as new', () => {
    it('renders every seeded ORS site on the overview page', async () => {
      // Establishes the baseline the conditionality assertions depend on. If
      // only one site rendered, "the established site has no tag" would pass
      // for the trivial reason that the site is not on the page at all.
      const names = await detail.flaggedBlockNames('overseasSite')
      expect(names).toHaveLength(4)
      const joined = names.join(' | ')
      for (const site of Object.values(ORS)) {
        expect(joined).toContain(site.name)
      }
    })

    it('marks as new the ORS with isNewSite true', async () => {
      expect(await detail.blockHasNewTag('overseasSite', ORS.NEW.name)).toBe(
        true
      )
    })

    it('renders the marker as a "NEW: " prefix on the site name line', async () => {
      // The AC asks for the site to be "clearly labelled or flagged", and a
      // marker element with the right testid but empty or mis-cased text
      // satisfies a bare isExisting() check while giving the regulator
      // nothing to read. This also asserts the rendered LINE, which is what
      // catches the separating space being lost — the marker element can read
      // a perfect "NEW:" while the page shows "NEW:Rotterdam".
      await detail.assertNewPrefixesWellFormed('overseasSite')
    })

    it('does NOT mark as new the ORS with isNewSite false', async () => {
      // Both halves: the conditional marker element is absent (the flag gate
      // did not fire) AND the line the user reads carries no "NEW: " prefix.
      // They fail independently — a `NEW:` hardcoded into the template text
      // outside the testid leaves the element check looking perfectly clean.
      expect(
        await detail.blockHasNewTag('overseasSite', ORS.ESTABLISHED.name)
      ).toBe(false)
      expect(
        await detail.blockLineHasNewPrefix('overseasSite', ORS.ESTABLISHED.name)
      ).toBe(false)
    })

    it('does NOT mark as new the ORS that has no isNewSite field at all', async () => {
      // The pre-RA-292 shape, on a page that also has genuinely new sites. A
      // negated-comparison bug (`!= false`) badges this one and nothing else
      // on the page would reveal it.
      expect(await detail.blockHasNewTag('overseasSite', ORS.LEGACY.name)).toBe(
        false
      )
      expect(
        await detail.blockLineHasNewPrefix('overseasSite', ORS.LEGACY.name)
      ).toBe(false)
    })

    it('does NOT mark as new the non-EU ORS, which is also not new', async () => {
      expect(await detail.blockHasNewTag('overseasSite', ORS.NON_EU.name)).toBe(
        false
      )
      expect(
        await detail.blockLineHasNewPrefix('overseasSite', ORS.NON_EU.name)
      ).toBe(false)
    })

    it('marks exactly one of the four ORS sites', async () => {
      // The whole-page counterpart to the per-site assertions above: catches a
      // tag rendered outside any site block, or twice inside one, neither of
      // which a per-site isExisting() can see.
      expect(await detail.newTagCount('overseasSite')).toBe(1)
    })
  })

  describe('AC02 — a new interim site is rendered and flagged as new', () => {
    it('renders the interim sites, which did not appear on this page before RA-292', async () => {
      // Interim site rendering is new in RA-292 — there was no markup for it
      // at all — so this is a genuine presence assertion rather than a
      // regression guard. Two, not four: the near-minimal Bilbao ORS and the
      // non-EU Port Klang site both deliberately carry no interimSite.
      const names = await detail.flaggedBlockNames('interimSite')
      expect(names).toHaveLength(2)
      expect(names.join(' | ')).toContain(INTERIM.NEW.name)
      expect(names.join(' | ')).toContain(INTERIM.ESTABLISHED.name)
    })

    it('marks as new the interim site with isNewSite true', async () => {
      expect(await detail.blockHasNewTag('interimSite', INTERIM.NEW.name)).toBe(
        true
      )
    })

    it('renders the marker as a "NEW: " prefix on the interim name line', async () => {
      await detail.assertNewPrefixesWellFormed('interimSite')
    })

    it('does NOT mark as new the interim site with isNewSite false', async () => {
      expect(
        await detail.blockHasNewTag('interimSite', INTERIM.ESTABLISHED.name)
      ).toBe(false)
      expect(
        await detail.blockLineHasNewPrefix(
          'interimSite',
          INTERIM.ESTABLISHED.name
        )
      ).toBe(false)
    })

    it('marks exactly one of the two interim sites', async () => {
      expect(await detail.newTagCount('interimSite')).toBe(1)
    })

    it('does not leak the interim marker onto the parent ORS site', async () => {
      // management-fe nests each interim site INSIDE its parent ORS block, so
      // the two tags share a subtree. The established Hamburg ORS holds an
      // established interim site and neither should be badged; the new
      // Rotterdam ORS holds a new interim site and the risk there is the
      // reverse — one tag being counted for both. The per-kind counts above
      // pin the totals, and this pins the pairing.
      expect(
        await detail.blockHasNewTag('overseasSite', ORS.ESTABLISHED.name)
      ).toBe(false)
      expect(
        await detail.blockHasNewTag('interimSite', INTERIM.ESTABLISHED.name)
      ).toBe(false)

      // And the string form, which is where the nesting actually bites. The
      // NEW Rotterdam ORS holds a NEW interim site, so its block text
      // contains "NEW:" twice over; the established Hamburg ORS holds an
      // established interim site and must contain it nowhere. Reading each
      // site's OWN name line rather than its block text is the only way to
      // tell a correctly-rendered page from a leak in either direction.
      expect(
        await detail.blockLineHasNewPrefix('overseasSite', ORS.NEW.name)
      ).toBe(true)
      expect(
        await detail.blockLineHasNewPrefix('interimSite', INTERIM.NEW.name)
      ).toBe(true)
      expect(
        await detail.blockLineHasNewPrefix('overseasSite', ORS.ESTABLISHED.name)
      ).toBe(false)
    })

    it('labels the interim block with the bold "Interim sites" sub-label', async () => {
      // Design change (epr-dkvh): the interim site moved from an inline
      // "Interim site: <name>" to a bold sub-label on its own line with the
      // name beneath it.
      //
      // The PLURAL is deliberate and matches the signed-off mockup, even though
      // the data model allows at most one interim site per ORS. Recorded here
      // so the next person to notice the mismatch finds an answer instead of
      // filing a bug — and so a well-meaning "fix" to the singular fails.
      //
      // The sub-label deliberately carries no testid (management-fe left a
      // comment in the template saying why), so this reads the block text. That
      // is safe here in a way it is not for the NEW: prefix: this asserts a
      // string is PRESENT somewhere in the block, whereas the prefix assertions
      // need to know which line carries it.
      const interim = await detail.flaggedBlockNamed(
        'interimSite',
        INTERIM.NEW.name
      )
      await expect(interim).toHaveText(expect.stringContaining('Interim sites'))
    })

    it('renders no interim site under the ORS that has none', async () => {
      const bilbao = await detail.flaggedBlockNamed(
        'overseasSite',
        ORS.LEGACY.name
      )
      expect(await bilbao.$('[data-testid="interim-site"]').isExisting()).toBe(
        false
      )
    })
  })

  describe('AC03 — a new authority-to-issue contact is flagged as new', () => {
    it('renders every seeded authority-to-issue contact', async () => {
      const contacts = await detail.flaggedBlockTexts('authorityToIssueContact')
      expect(contacts).toHaveLength(3)
      const joined = contacts.join(' | ')
      expect(joined).toContain(AUTHORISERS.NEW.name)
      expect(joined).toContain(AUTHORISERS.ESTABLISHED.name)
      expect(joined).toContain(AUTHORISERS.LEGACY.name)
    })

    it('marks as new the authoriser with isNew true', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.NEW.name
        )
      ).toBe(true)
    })

    it('renders the marker as a "NEW: " prefix on the contact line', async () => {
      // The contact's marker is a SIBLING of its name rather than inside it,
      // so the prefix assertion here reads the whole contact line. Same
      // user-visible guarantee, different markup shape.
      await detail.assertNewPrefixesWellFormed('authorityToIssueContact')
    })

    it('does NOT mark as new the authoriser with isNew false', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.ESTABLISHED.name
        )
      ).toBe(false)
      expect(
        await detail.blockLineHasNewPrefix(
          'authorityToIssueContact',
          AUTHORISERS.ESTABLISHED.name
        )
      ).toBe(false)
    })

    it('does NOT mark as new the authoriser that has no isNew field at all', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.LEGACY.name
        )
      ).toBe(false)
      expect(
        await detail.blockLineHasNewPrefix(
          'authorityToIssueContact',
          AUTHORISERS.LEGACY.name
        )
      ).toBe(false)
    })

    it('marks exactly one of the three authorisers', async () => {
      expect(await detail.newTagCount('authorityToIssueContact')).toBe(1)
    })

    it('still shows the contact detail alongside the flag', async () => {
      // AC03 flags the contact; AC04 requires the contact detail to be
      // visible. The flag must not have replaced the information it annotates.
      const contact = await detail.flaggedBlockNamed(
        'authorityToIssueContact',
        AUTHORISERS.NEW.name
      )
      await expect(contact).toHaveText(
        expect.stringContaining(AUTHORISERS.NEW.email)
      )
    })
  })
})
