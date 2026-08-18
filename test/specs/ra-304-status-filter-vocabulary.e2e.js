import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'
import {
  AWAITING_DECISION_ID,
  AWAITING_DECISION_ORG_NAME,
  BANNED_STATUS_LABEL
} from '../support/ra-304-seed.js'

/**
 * RA-304 (CM - Update decision page) — the Applications Status filter.
 *
 * THE STORY. RA-324 (AC06) fixed the user-visible status vocabulary at seven
 * labels: Not started, Duly made, Queried, Updated, Granted, Refused,
 * Withdrawn. RA-410 then turned `awaiting-decision` into an internal staging
 * hop no caseworker ever clicks through. "Awaiting decision" was the last
 * label outside the AC06 list still on screen, and the BA has ruled it out.
 *
 * management-fe's change is presentation-only — no state, transition or id
 * moves in management-be:
 *   - the "Awaiting decision" checkbox is GONE from the Status filter;
 *   - the "Duly made" checkbox now expands to BOTH `duly-made` and
 *     `awaiting-decision`, exactly as "Updated" already expands to both
 *     `assessment-in-progress` and `updated`. The URL/UI token stays
 *     `duly-made`; the expansion is server-side in the BFF.
 *
 * That expansion is the interesting half. Simply deleting the state id from
 * the filter would have made items parked in the staging hop unreachable
 * through the very checkbox whose label they now carry — visible on the list,
 * but filtered out by the only status that names them. AC2 below is the guard
 * against that regression, and it is why this file seeds an item rather than
 * settling for the option-set check alone.
 *
 * REACHING `awaiting-decision`. There is no UI route that parks an item there
 * (see docker/scripts/mongodb/30-awaiting-decision-work-item.js for the full
 * argument and ra-346-submit-for-decision-gating.e2e.js / ra-410-cta-lifecycle
 * .e2e.js for the assertions that prove it). The fixture is introduced as a raw
 * document by the compose Mongo init script, which runs only in the
 * docker-compose stack — so the AC2 tests skip, rather than fake a pass, when
 * the item is absent. AC1 holds everywhere.
 *
 * Option values/labels verified against management-fe's STATUS_FILTER_OPTIONS
 * on branch ra-304-hide-awaiting-decision-status.
 */

/**
 * The RA-324 AC06 vocabulary as the Status filter must render it, in order:
 * UI/URL token -> visible label. This is the AC, written down.
 */
const AC06_STATUS_OPTIONS = [
  { value: 'submitted', label: 'Not started' },
  { value: 'duly-made', label: 'Duly made' },
  { value: 'updated', label: 'Updated' },
  { value: 'queried', label: 'Queried' },
  { value: 'approved', label: 'Granted' },
  { value: 'rejected', label: 'Refused' },
  { value: 'withdrawn', label: 'Withdrawn' }
]

const DULY_MADE_ORG_PREFIX = `RA304Filter${Date.now()}`

describe('RA-304 Applications Status filter vocabulary', () => {
  /** A genuinely `duly-made` item, created through the real UI journey. */
  let dulyMadeId

  /** Whether the compose Mongo seed put an `awaiting-decision` item in scope. */
  let seededItemPresent = false

  before(async () => {
    // No nation role — a multi-nation "see all" user, so neither the seeded
    // England item nor the created one is filtered out by nation.
    await login.login()

    dulyMadeId = await createReAccreditation(DULY_MADE_ORG_PREFIX)
    await dulyMake(dulyMadeId)

    await workItems.resetFilters()
    await workItems.searchByOrg(AWAITING_DECISION_ORG_NAME)
    seededItemPresent = await workItems
      .tileFor(AWAITING_DECISION_ID)
      .isExisting()
  })

  after(async () => {
    await login.logout()
  })

  // ── AC1: the option set ──────────────────────────────────────────────────── //

  describe('AC1 the Status filter offers exactly the AC06 vocabulary', () => {
    it('renders the seven AC06 statuses, with their UI tokens, in order', async () => {
      await workItems.resetFilters()
      const options = await workItems.statusFilterOptions()
      // Whole-set equality rather than a series of "contains" checks: the AC is
      // that this list IS the vocabulary, so an eighth option appearing is just
      // as much a failure as one going missing, and only an equality assertion
      // catches both.
      expect(options).toEqual(AC06_STATUS_OPTIONS)
    })

    it('offers no "Awaiting decision" option, by label or by state id', async () => {
      await workItems.resetFilters()
      const options = await workItems.statusFilterOptions()

      // Belt and braces over the equality check above, and deliberately so:
      // this is the one assertion that names the thing the story removes, so
      // it should fail with an unmistakable message if the option comes back.
      // Both halves matter — a re-added checkbox could reappear under the old
      // label with a new token, or under a new label with the old token.
      expect(options.map((o) => o.label)).not.toContain(BANNED_STATUS_LABEL)
      expect(options.map((o) => o.value)).not.toContain('awaiting-decision')

      // management-fe stamps `data-testid="filter-status-<value>"` on each
      // checkbox (added for this story — the previous handle was govukCheckboxes'
      // positional id scheme, which silently re-points at a different status
      // whenever an option is added or removed, i.e. exactly what RA-304 does).
      // The hook for the retired option must therefore not exist either.
      await expect(
        $('[data-testid="filter-status-awaiting-decision"]')
      ).not.toBeExisting()
      // Render anchor: without a surviving sibling hook this absence could pass
      // against a filter that rendered no checkboxes at all.
      await expect($('[data-testid="filter-status-duly-made"]')).toBeExisting()
    })

    it('does not render the removed label anywhere else on the Applications page', async () => {
      // The checkbox is not the only place a status label surfaces: the
      // active-filter chips, the section summaries and every card badge read
      // from the same vocabulary. Scoping this to the filter inputs alone
      // would let the label survive one relocation away from the assertion.
      await workItems.resetFilters()
      // `getText()` returns rendered text only, and a collapsed <details>
      // renders none — so the Status section is opened first, otherwise this
      // check would be blind to the very section it most needs to see.
      await workItems.expandSection('status')
      expect(await workItems.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })

  // ── AC1 negative: a URL that still carries the retired token ─────────────── //

  describe('AC1 negative a bookmarked ?status=awaiting-decision URL', () => {
    it('drops the retired token and renders the list rather than erroring', async () => {
      // Caseworkers bookmark filtered worklists, so URLs carrying the retired
      // token outlive the checkbox. The BFF validates every submitted token
      // against its option map, so the unknown one is dropped like any other
      // junk value — this proves that degrades to an unfiltered page rather
      // than a 500 or an empty state.
      await workItems.open(
        '/work-items?filtersApplied=1&status=awaiting-decision'
      )

      await expect(workItems.worklistSummary()).toBeDisplayed()
      await expect(workItems.worklistErrorBanner()).not.toBeExisting()
      // The token was dropped, so no status filter is active and the
      // active-filters block is not rendered at all.
      await expect(workItems.activeFilters()).not.toBeExisting()
      expect(await workItems.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })

  // ── AC2: the Duly made option covers the internal staging hop ────────────── //

  describe('AC2 the Duly made filter covers both backend state ids', () => {
    it('returns a genuinely duly-made item', async () => {
      // Positive control. Without it, the seeded-item test below could pass
      // against a filter that had silently stopped narrowing at all — and the
      // "does not return it under another status" test could pass against a
      // filter that returned nothing for anything.
      await workItems.resetFilters()
      await workItems.searchByOrg(DULY_MADE_ORG_PREFIX)
      await workItems.checkStatus('duly-made')
      await workItems.applyFilters()

      await expect(workItems.tileFor(dulyMadeId)).toBeDisplayed()
    })

    it('also returns an item parked in awaiting-decision', async function () {
      if (!seededItemPresent) {
        // The parked item is introduced by the compose Mongo init script,
        // which runs only in the docker-compose stack. Against a plain local
        // stack the state is unreachable by any means the suite has, so this
        // proof cannot run — skip rather than fake it. See the file header.
        this.skip()
        return
      }

      await workItems.resetFilters()
      await workItems.searchByOrg(AWAITING_DECISION_ORG_NAME)
      await workItems.checkStatus('duly-made')
      await workItems.applyFilters()

      // The heart of AC2: the checkbox labelled "Duly made" must reach the
      // item whose badge now reads "Duly made", even though its backend state
      // id is `awaiting-decision`.
      await expect(workItems.tileFor(AWAITING_DECISION_ID)).toBeDisplayed()
      // The UI/URL token stays `duly-made` — the expansion to two state ids is
      // server-side. A token that had leaked the internal id into the query
      // string would re-expose the vocabulary AC1 just removed.
      expect(await browser.getUrl()).toContain('status=duly-made')
      expect(await browser.getUrl()).not.toContain('awaiting-decision')
    })

    it('does not return the parked item under a different status', async function () {
      if (!seededItemPresent) {
        this.skip()
        return
      }

      // Negative path. "Duly made returns it" only means the expansion is
      // wired correctly if some OTHER status does NOT — otherwise a filter
      // that had degraded to a no-op would satisfy the test above.
      await workItems.resetFilters()
      await workItems.searchByOrg(AWAITING_DECISION_ORG_NAME)
      await workItems.checkStatus('queried')
      await workItems.applyFilters()

      await expect(workItems.tileFor(AWAITING_DECISION_ID)).not.toBeExisting()
    })
  })
})
