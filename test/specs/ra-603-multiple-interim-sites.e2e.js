import { browser, $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  INTERIM_DETAIL_FIELDS
} from '../page-objects/work-item-detail.page.js'
import {
  ORG_NAME,
  ORS_NAME,
  ACTIVE_INTERIM_SITES,
  WITHDRAWN_INTERIM_SITE
} from '../support/ra-603-seed.js'

/**
 * RA-603 AC10b: an overseas reprocessing site can carry several interim sites, and a regulator
 * folds each one down on its own to read that site's details and R codes.
 *
 * Runs against the `multiple-interim-sites` seed item, whose single ORS carries three interim
 * sites: two active and one withdrawn. That mix is deliberate — a fixture of identical, all-active
 * interim sites would pass just as well against a page that rendered only the first, badged every
 * site as new, or ignored `removedAt` entirely.
 *
 * Depends on MULTIPLE_INTERIM_SITES_ENABLED being true, which
 * `docker/config/management-fe.env` sets for this stack. The flag is off by default in
 * management-fe, so without it this spec would legitimately see only one interim site.
 */
describe('RA-603: several interim sites on one overseas reprocessing site', () => {
  before(async () => {
    await login.login()
    // A bare landing defaults to assigned-to-me and this seed item is unassigned (RA-299).
    await workItems.resetFilters()
    await workItems.searchByOrgName(ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
    // Each ORS is a collapsed <details> (RA-486) and each interim site is now a <details> nested
    // inside it (RA-603). The parent has to open first — a nested disclosure inside a collapsed
    // parent cannot be clicked.
    await detail.expandAllOverseasSiteDetails()
    await detail.expandAllInterimSiteDetails()
  })

  after(async () => {
    await login.logout()
  })

  describe('AC10b — one fold-down per interim site', () => {
    it('renders a fold-down for every interim site the operator still has', async () => {
      const names = await detail.flaggedBlockNames('interimSite')

      expect(names).toHaveLength(ACTIVE_INTERIM_SITES.length)
      for (const site of ACTIVE_INTERIM_SITES) {
        expect(names.some((name) => name?.includes(site.name))).toBe(true)
      }
    })

    // The assertion that makes the rest of this file mean something. Without it a page that
    // rendered whatever the list held, withdrawn entries included, would look correct.
    it('leaves out an interim site the operator has withdrawn', async () => {
      const names = await detail.flaggedBlockNames('interimSite')
      expect(
        names.every((name) => !name?.includes(WITHDRAWN_INTERIM_SITE.name))
      ).toBe(true)

      // Absent from the DOM entirely, not merely hidden or rendered empty:
      // every disclosure on this page is already expanded by the before hook,
      // so anything still missing from the source is genuinely not rendered.
      const source = await browser.getPageSource()
      expect(source).not.toContain(WITHDRAWN_INTERIM_SITE.name)
      expect(source).not.toContain(WITHDRAWN_INTERIM_SITE.siteNumber)
    })

    it('counts only the interim sites it actually shows', async () => {
      const label = await $('[data-testid="interim-sites-label"]')

      expect(await label.getText()).toContain(
        `Interim sites (${ACTIVE_INTERIM_SITES.length})`
      )
    })

    it('nests the interim sites inside their parent overseas site', async () => {
      const ors = await detail.flaggedBlockNamed('overseasSite', ORS_NAME)
      const nested = await ors.$$('[data-testid="interim-site"]')

      expect([...nested]).toHaveLength(ACTIVE_INTERIM_SITES.length)
    })
  })

  describe('AC10b — each fold-down carries its own detail and R codes', () => {
    for (const site of ACTIVE_INTERIM_SITES) {
      it(`shows the details and R codes belonging to ${site.name}`, async () => {
        const values = await detail.blockFields(
          'interimSite',
          site.name,
          INTERIM_DETAIL_FIELDS
        )

        expect(values['interim-site-site-number']).toBe(site.siteNumber)
        expect(values['interim-site-address']).toContain(site.townOrCity)
        expect(values['interim-site-address']).toContain(site.country)
        for (const code of site.operationCodes) {
          expect(values['interim-site-operation-code']).toContain(code)
        }
      })
    }

    // Two sites with different R codes on one page: the point is that the codes do not bleed
    // between fold-downs, which a single shared block would not reveal.
    it('keeps each interim site R codes to itself', async () => {
      const [established, added] = ACTIVE_INTERIM_SITES

      const establishedCodes = (
        await detail.blockFields('interimSite', established.name, [
          'interim-site-operation-code'
        ])
      )['interim-site-operation-code']
      const addedCodes = (
        await detail.blockFields('interimSite', added.name, [
          'interim-site-operation-code'
        ])
      )['interim-site-operation-code']

      expect(establishedCodes).not.toBe(addedCodes)
      expect(establishedCodes).not.toContain('R13')
      expect(addedCodes).toContain('R13')
    })
  })

  describe('AC10b — the "new" badge is per interim site', () => {
    it('badges only the interim site that is new', async () => {
      const newSites = ACTIVE_INTERIM_SITES.filter((site) => site.isNew)

      expect(await detail.newTagCount('interimSite')).toBe(newSites.length)
      for (const site of newSites) {
        expect(await detail.blockHasNewTag('interimSite', site.name)).toBe(true)
      }
    })

    it('does not badge an established interim site', async () => {
      for (const site of ACTIVE_INTERIM_SITES.filter((s) => !s.isNew)) {
        expect(await detail.blockHasNewTag('interimSite', site.name)).toBe(
          false
        )
      }
    })
  })
})
