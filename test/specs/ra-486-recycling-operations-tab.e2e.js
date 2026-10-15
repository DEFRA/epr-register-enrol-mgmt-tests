import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { ORG_NAME, ORS, INTERIM } from '../support/ra-292-seed.js'

/**
 * RA-469 / RA-486: the "Recycling operations" tab.
 *
 * RA-469 added a bookmarkable `/work-items/{id}/recycling-operations` page
 * listing every overseas reprocessing site on an application alongside its
 * recycling operation code(s) (R3/R4/R5/R12/R13) — this repo had NO e2e
 * coverage of it at all until this spec. RA-486 then decoupled the page's
 * "Associated interim site" line from the ORS's own R12/R13 codes: before
 * RA-486 an ORS could show R12/R13 only if it had an interim site, so the
 * line and the codes were correlated by construction; RA-486 lets an
 * interim site carry its own independent codes (see
 * ra-292-site-detail-interim-and-access.e2e.js for that half, on the
 * Application summary tab), so the line is now shown whenever the site HAS
 * an interim site, full stop — regardless of what the ORS's own codes are.
 * That is the specific regression this spec is written to catch (see the
 * "Hamburg" test below), not merely "the tab renders".
 *
 * IMPORTANT — the tab is currently HIDDEN from the case-tabs bar. A RA-469
 * follow-up added it to `HIDDEN_TAB_KEYS` in management-fe's case-header.js
 * (product asked for it to stay hidden until the copy is finalised); the
 * route/controller/page are fully live for anyone who has the URL. So this
 * spec reaches the page via detail.gotoRecyclingOperations() (a direct
 * navigation, mirroring the URL the controller builds) rather than clicking
 * a tab link, and asserts the hidden state explicitly in the first test —
 * so the moment product turns the tab back on, THIS suite is what notices
 * the click-through path needs adding, rather than the gap going unnoticed.
 *
 * Fixture: reuses ra-292-seed.js's four-site ORS_INTERIM_AUTHORITY item —
 * Bilbao (LEGACY, no codes, no interim site), Hamburg (ESTABLISHED, R4 only,
 * HAS an interim site), Port Klang (NON_EU, no codes, no interim site) and
 * Rotterdam (NEW, R3+R12, HAS an interim site). See that module's own header
 * for why some of the fields this spec asserts on are not yet seeded by
 * management-be — the specs below are expected to fail against a live
 * environment until that backend work lands, same as every other field
 * added there ahead of the backend.
 */
describe('RA-469 / RA-486: Recycling operations tab', () => {
  before(async () => {
    await login.login()
    // RA-299: a bare landing defaults to assigned-to-me, and this seed item
    // is unassigned — reset filters first or the search returns nothing.
    await workItems.resetFilters()
    await workItems.searchByOrgName(ORG_NAME)
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('filtersApplied=1'),
      { timeoutMsg: 'org-name filter did not apply (no filtersApplied=1)' }
    )
    expect(await workItems.getRowCount()).toBe(1)
    await workItems.openFirstListedWorkItem()
    await detail.gotoRecyclingOperations()
  })

  after(async () => {
    await login.logout()
  })

  it('is reachable directly, even though its tab link stays hidden from the tab bar', async () => {
    // The negative first: proves this suite would notice product turning
    // the tab bar entry back on (see the file header), rather than that
    // decision silently going unexercised.
    expect(await detail.hasRecyclingOperationsTabLink()).toBe(false)
    // The positive: the page itself renders regardless.
    await expect(detail.recyclingOperationsSiteList()).toBeDisplayed()
  })

  it('AC2: lists every overseas site, sorted alphabetically by name', async () => {
    // Sites are ALWAYS sorted by name, independent of the seed's siteId /
    // backend order (Rotterdam=1, Hamburg=2, Bilbao=3, Port Klang=4) — so
    // the expected order below is alphabetical, not seed order, and a
    // template that merely rendered backend order would fail this.
    expect(await detail.recyclingOperationsSiteOrder()).toEqual([
      String(ORS.LEGACY.siteId),
      String(ORS.ESTABLISHED.siteId),
      String(ORS.NON_EU.siteId),
      String(ORS.NEW.siteId)
    ])
  })

  it('shows the site name for each row', async () => {
    expect(await detail.recyclingOperationsSiteName(ORS.NEW.siteId)).toBe(
      ORS.NEW.name
    )
    expect(await detail.recyclingOperationsSiteName(ORS.LEGACY.siteId)).toBe(
      ORS.LEGACY.name
    )
  })

  describe('AC6/AC7: recycling operation codes', () => {
    it('lists the full label for every code a site carries', async () => {
      // codeLabels renders the FULL human-readable label (per
      // recyclingOperationLabel() in management-fe), not the bare code —
      // asserted with a starts-with check so this suite pins the CODE the
      // label is for, not the label's exact wording, which belongs to
      // management-fe / content design.
      const labels = await detail.recyclingOperationsSiteCodeLabels(
        ORS.NEW.siteId
      )
      for (const code of ORS.NEW.operationCodes) {
        expect(labels.some((label) => label.startsWith(code))).toBe(true)
      }
      expect(labels).toHaveLength(ORS.NEW.operationCodes.length)
      expect(
        await detail.hasRecyclingOperationsNoCodesMessage(ORS.NEW.siteId)
      ).toBe(false)
    })

    it('states clearly when a site has no codes set, rather than an empty list', async () => {
      // Port Klang: empty operationCodes array. Bilbao: no operationCodes
      // KEY at all. Both are the same user-facing state and must render the
      // same message — the template branches on hasCodes (codes.length > 0),
      // not on the key's presence.
      for (const site of [ORS.NON_EU, ORS.LEGACY]) {
        expect(
          await detail.hasRecyclingOperationsNoCodesMessage(site.siteId)
        ).toBe(true)
        const labels = await detail.recyclingOperationsSiteCodeLabels(
          site.siteId
        )
        expect(labels).toEqual([])
      }
    })
  })

  describe('AC6 (RA-486): the "Associated interim site" line', () => {
    it('is shown for a site with R12/R13 among its own codes', async () => {
      // Rotterdam: operationCodes includes R12, and has an interim site.
      // The unambiguous case both before and after RA-486.
      expect(
        await detail.hasRecyclingOperationsInterimLine(ORS.NEW.siteId)
      ).toBe(true)
      const text = await detail.recyclingOperationsInterimLineText(
        ORS.NEW.siteId
      )
      expect(text).toContain(INTERIM.NEW.name)
      expect(text).toContain(INTERIM.NEW.fullAddress)
    })

    it('RA-486: is shown for a site with an interim site but NO R12/R13 of its own', async () => {
      // Hamburg: operationCodes is ['R4'] only — no R12/R13 — but it DOES
      // have an interim site (Bremen). Before RA-486 the line was gated on
      // the ORS's own R12/R13, so this fixture would have hidden it despite
      // Hamburg genuinely having an interim site. This is the one seeded
      // site that can tell the two implementations apart; Rotterdam's R12
      // would pass under either.
      expect(
        await detail.hasRecyclingOperationsInterimLine(ORS.ESTABLISHED.siteId)
      ).toBe(true)
      const text = await detail.recyclingOperationsInterimLineText(
        ORS.ESTABLISHED.siteId
      )
      expect(text).toContain(INTERIM.ESTABLISHED.name)
      expect(text).toContain(INTERIM.ESTABLISHED.fullAddress)
    })

    it('is absent for a site with no associated interim site', async () => {
      // Port Klang and Bilbao both have no interimSite at all — neither's
      // own codes are relevant to this assertion, only the absence of the
      // child site.
      expect(
        await detail.hasRecyclingOperationsInterimLine(ORS.NON_EU.siteId)
      ).toBe(false)
      expect(
        await detail.hasRecyclingOperationsInterimLine(ORS.LEGACY.siteId)
      ).toBe(false)
    })

    it('shows the interim site name and address, not its own recycling operation codes', async () => {
      // The interim site's OWN codes (interim-site-operation-code, RA-486)
      // are display-only on the Application summary tab and are
      // deliberately NOT surfaced anywhere on this list view — confirmed
      // with the management-fe implementer. This is the negative half of
      // that: the interim line's text is bounded to name + address, so a
      // regression that started leaking the interim site's codes onto this
      // page would show up as extra text this assertion does not expect.
      const text = await detail.recyclingOperationsInterimLineText(
        ORS.NEW.siteId
      )
      expect(text).toBe(
        `Associated interim site: ${INTERIM.NEW.name}, ${INTERIM.NEW.fullAddress}`
      )
    })
  })

  describe('AC9: the "Change" link', () => {
    it('is offered against every site', async () => {
      for (const site of [ORS.NEW, ORS.ESTABLISHED, ORS.NON_EU, ORS.LEGACY]) {
        await expect(
          detail.recyclingOperationsChangeLink(site.siteId)
        ).toBeDisplayed()
      }
    })
  })

  it('AC3: does not offer the search box for a fixture under the one-page threshold', async () => {
    // showSearch gates on the TOTAL site count exceeding 20 (one page) —
    // this fixture seeds four, so the box must not render. The complementary
    // AC4 filtering coverage below deliberately does NOT depend on this box
    // being present; see that describe block's own comment.
    await expect(detail.recyclingOperationsSearchForm()).not.toBeExisting()
  })

  describe('AC4: search filters the list (via the query string)', () => {
    // AC3 gates the search BOX itself on the total site count exceeding one
    // page (20 sites) — this fixture has four, so the box does not render.
    // The filter behaviour it drives is independent of the box's own
    // visibility (filterRecyclingOperationsSites runs on `?q=` regardless of
    // `showSearch`), so these reach it directly through the query string
    // rather than needing a 21-site fixture just to click a button.
    afterEach(async () => {
      // Restore the unfiltered page so subsequent describe blocks in this
      // file are not left reading a filtered URL.
      await detail.gotoRecyclingOperations()
    })

    it('matches case-insensitively on a substring of the site name', async () => {
      await detail.gotoRecyclingOperationsSearch('rotterdam')
      expect(await detail.recyclingOperationsSiteOrder()).toEqual([
        String(ORS.NEW.siteId)
      ])
    })

    it('shows a distinct "no results" message for a search that matches nothing', async () => {
      // Distinct from the AC7 per-site "no codes" message and from the
      // whole-application "no sites at all" empty state — three different
      // facts that must not collapse onto the same testid.
      await detail.gotoRecyclingOperationsSearch('no-such-site-xyz')
      await expect(detail.recyclingOperationsNoSearchResults()).toBeDisplayed()
      await expect(detail.recyclingOperationsSiteList()).not.toBeExisting()
    })
  })
})
