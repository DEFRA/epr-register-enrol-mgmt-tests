import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  ORG_NAME,
  LEGACY_ORG_NAME,
  ORS,
  INTERIM,
  AUTHORISERS
} from '../support/ra-292-seed.js'

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

    it('shows a New tag on the ORS with isNewSite true', async () => {
      expect(await detail.blockHasNewTag('overseasSite', ORS.NEW.name)).toBe(
        true
      )
    })

    it('renders that tag as a blue GOV.UK tag reading "New"', async () => {
      // The AC asks for the site to be "clearly labelled or flagged". A tag
      // element with the right testid but empty text, or with the default grey
      // styling, satisfies a bare isExisting() check while giving the
      // regulator nothing to see.
      await detail.assertNewTagsWellFormed('overseasSite')
    })

    it('shows NO New tag on the ORS with isNewSite false', async () => {
      expect(
        await detail.blockHasNewTag('overseasSite', ORS.ESTABLISHED.name)
      ).toBe(false)
    })

    it('shows NO New tag on the ORS that has no isNewSite field at all', async () => {
      // The pre-RA-292 shape, on a page that also has genuinely new sites. A
      // negated-comparison bug (`!= false`) badges this one and nothing else
      // on the page would reveal it.
      expect(await detail.blockHasNewTag('overseasSite', ORS.LEGACY.name)).toBe(
        false
      )
    })

    it('shows NO New tag on the non-EU ORS, which is also not new', async () => {
      expect(await detail.blockHasNewTag('overseasSite', ORS.NON_EU.name)).toBe(
        false
      )
    })

    it('tags exactly one of the four ORS sites', async () => {
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

    it('shows a New tag on the interim site with isNewSite true', async () => {
      expect(await detail.blockHasNewTag('interimSite', INTERIM.NEW.name)).toBe(
        true
      )
    })

    it('renders that tag as a blue GOV.UK tag reading "New"', async () => {
      await detail.assertNewTagsWellFormed('interimSite')
    })

    it('shows NO New tag on the interim site with isNewSite false', async () => {
      expect(
        await detail.blockHasNewTag('interimSite', INTERIM.ESTABLISHED.name)
      ).toBe(false)
    })

    it('tags exactly one of the two interim sites', async () => {
      expect(await detail.newTagCount('interimSite')).toBe(1)
    })

    it('does not leak the interim tag onto the parent ORS site', async () => {
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

    it('shows a New tag on the authoriser with isNew true', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.NEW.name
        )
      ).toBe(true)
    })

    it('renders that tag as a blue GOV.UK tag reading "New"', async () => {
      await detail.assertNewTagsWellFormed('authorityToIssueContact')
    })

    it('shows NO New tag on the authoriser with isNew false', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.ESTABLISHED.name
        )
      ).toBe(false)
    })

    it('shows NO New tag on the authoriser that has no isNew field at all', async () => {
      expect(
        await detail.blockHasNewTag(
          'authorityToIssueContact',
          AUTHORISERS.LEGACY.name
        )
      ).toBe(false)
    })

    it('tags exactly one of the three authorisers', async () => {
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

/**
 * RA-292 backwards compatibility.
 *
 * Every work item submitted before this story carries none of `isNewSite` or
 * `isNew` — and the pre-RA-292 seed items carry no `overseasSites` and no
 * `prns` at all. The new template code reaches into nested site objects that
 * simply are not there on those items.
 *
 * Nunjucks does not throw on a missing key, which is what makes this worth a
 * spec rather than a code read: the regression ships as a page that renders,
 * returns 200, and looks fine to a smoke test, while showing a regulator
 * `[object Object]` where a town should be, or a "New" badge on a case from
 * two years ago.
 *
 * This runs against a SEPARATE work item and so needs its own describe block
 * with its own navigation.
 */
describe('RA-292: a pre-RA-292 work item still renders cleanly', () => {
  before(async () => {
    await login.login()
    await workItems.resetFilters()
    await workItems.searchByOrgName(LEGACY_ORG_NAME)
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

  it('loads the overview page without erroring', async () => {
    await expect(detail.applicationDetails()).toBeDisplayed()
    await expect(detail.caseHeaderField('orgName')).toHaveText(
      expect.stringContaining(LEGACY_ORG_NAME)
    )
  })

  it('shows no New tag of any kind', async () => {
    expect(await detail.hasAnyNewTag()).toBe(false)
  })

  it('renders no ORS block and no interim block', async () => {
    // The ORS section is gated on the item having overseas sites, so on a
    // Reprocessor item the row is absent rather than empty. Interim sites are
    // nested inside ORS blocks and therefore cannot appear without one.
    expect(await detail.flaggedBlockCount('overseasSite')).toBe(0)
    expect(await detail.flaggedBlockCount('interimSite')).toBe(0)
  })

  it('renders no stray or half-built authority-to-issue contact', async () => {
    // The authority-to-issue row is ungated and renders an em dash when there
    // are no authorisers. What must NOT happen is an empty contact block: a
    // `{% for %}` over a missing `prns.authorisers` yields nothing, but a
    // template that renders one block unconditionally and fills it from
    // `authorisers[0]` produces a nameless, emailless contact.
    expect(await detail.flaggedBlockCount('authorityToIssueContact')).toBe(0)
  })

  it('renders no value as [object Object] or undefined', async () => {
    // The specific failure mode of the change under test: new template code
    // reaching into nested objects that a legacy payload does not have.
    await detail.assertNoUnrenderedValues()
  })

  it('keeps the pre-existing application information rows intact', async () => {
    // RA-292 edits a template that many other journeys read. The row keys the
    // AC does not touch must be untouched.
    for (const key of ['site-address', 'type', 'material', 'prn-tonnage']) {
      expect(await detail.hasApplicationDetailRow(key)).toBe(true)
    }
  })
})
