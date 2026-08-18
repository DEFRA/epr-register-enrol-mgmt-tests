import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  driveToApproved
} from '../support/re-accreditation-journey.js'
import {
  AWAITING_DECISION_ID,
  AWAITING_DECISION_ORG_NAME,
  AWAITING_DECISION_LABEL,
  AWAITING_DECISION_TAG_CLASS,
  BANNED_STATUS_LABEL
} from '../support/ra-304-seed.js'

/**
 * RA-304 (AC3) — "Awaiting decision" is never rendered as a status anywhere a
 * caseworker can reach.
 *
 * The companion file (ra-304-status-filter-vocabulary.e2e.js) covers the
 * Applications filter. This one covers the three places a work item's own
 * status is rendered: the worklist card, the work item detail page, and the
 * audit log / Application history.
 *
 * WHAT IS AND IS NOT BANNED. AC3 is about the human-readable vocabulary, so
 * the banned string is the display name "Awaiting decision". The raw state id
 * `awaiting-decision` is a different string and is deliberately NOT banned:
 * management-be is untouched by this story, the id still identifies the state
 * in `data-state-id` and in the audit log's `from -> to` edge trace, and the
 * detail page's `data-state-id` hook is asserted below precisely BECAUSE it
 * must not have moved. RA-304 is presentation, not a rename — a change that
 * renamed the id would break every state assertion in the suite while
 * satisfying a naive "the word is gone" check.
 *
 * TWO POPULATIONS, BOTH NEEDED:
 *   1. An item PARKED in `awaiting-decision`. This is what the presentation
 *      rules exist for, and only a seeded fixture can produce one — see
 *      docker/scripts/mongodb/30-awaiting-decision-work-item.js for why no UI
 *      route can. That script runs only in the docker-compose stack, so these
 *      tests skip rather than fake a pass when the item is absent.
 *   2. An item that PASSED THROUGH the hop on a real decision journey. Its
 *      audit log is the one page where the internal edge can legitimately
 *      surface, and it is reachable everywhere — so the audit assertion has
 *      cover even where the seed is missing.
 *
 * The seed's own frozen `templateSnapshot` deliberately declares the state's
 * displayName as "Awaiting decision". management-fe resolves the label from
 * its module declaration and not from the snapshot, so this is a live trap: if
 * that resolution ever fell back to the stored snapshot, the banned label
 * would render and these tests would fail — which is exactly what they are for.
 */

const JOURNEY_ORG_PREFIX = `RA304Decision${Date.now()}`

describe('RA-304 awaiting-decision presents as Duly made', () => {
  let seededItemPresent = false

  before(async () => {
    // No nation role — a multi-nation "see all" user, so the seeded England
    // item is not filtered out of the worklist.
    await login.login()

    await workItems.resetFilters()
    await workItems.searchByOrg(AWAITING_DECISION_ORG_NAME)
    seededItemPresent = await workItems
      .tileFor(AWAITING_DECISION_ID)
      .isExisting()
  })

  after(async () => {
    await login.logout()
  })

  // ── The worklist card ────────────────────────────────────────────────────── //

  describe('on the Applications worklist', () => {
    beforeEach(async function () {
      if (!seededItemPresent) {
        this.skip()
        return
      }
      await workItems.resetFilters()
      await workItems.searchByOrg(AWAITING_DECISION_ORG_NAME)
    })

    it('badges the parked item "Duly made"', async () => {
      await expect(workItems.tileStatusBadge(AWAITING_DECISION_ID)).toHaveText(
        AWAITING_DECISION_LABEL
      )
    })

    it('gives that badge the duly-made colour', async () => {
      // AC: `awaiting-decision` takes `duly-made`'s purple. Without this, two
      // differently-coloured badges would read the same word — which is the
      // specific confusion the colour change exists to remove, and is
      // invisible to a text-only assertion.
      const badgeClass = await workItems
        .tileStatusBadge(AWAITING_DECISION_ID)
        .getAttribute('class')
      expect(badgeClass.split(/\s+/)).toContain(AWAITING_DECISION_TAG_CLASS)
    })

    it('renders the removed label nowhere on the page', async () => {
      expect(await workItems.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })

  // ── The work item detail page ────────────────────────────────────────────── //

  describe('on the work item detail page', () => {
    beforeEach(async function () {
      if (!seededItemPresent) {
        this.skip()
        return
      }
      await workItems.openWorkItem(AWAITING_DECISION_ID)
    })

    it('shows the status as "Duly made"', async () => {
      await detail.assertState(AWAITING_DECISION_LABEL)
    })

    it('gives the status badge the duly-made colour', async () => {
      await detail.assertStateTagClass(AWAITING_DECISION_TAG_CLASS)
    })

    it('leaves the backend state id untouched', async () => {
      // The load-bearing negative. RA-304 is presentation-only: management-be
      // moves no state, transition or id, so the raw id must still be
      // `awaiting-decision` behind the "Duly made" label. Asserting only the
      // label would pass just as well against a change that actually MOVED the
      // item into `duly-made` — a data migration masquerading as a rename,
      // which would silently discharge the staging hop for every parked case.
      await detail.assertStateId('awaiting-decision')
    })

    it('renders the removed label nowhere on the page', async () => {
      expect(await detail.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })

  // ── The audit log / Application history ──────────────────────────────────── //

  describe('on the audit log of the parked item', () => {
    beforeEach(async function () {
      if (!seededItemPresent) {
        this.skip()
        return
      }
      await workItems.openWorkItem(AWAITING_DECISION_ID)
      await detail.gotoAudit()
    })

    it('shows "Duly made" in the case header and never the removed label', async () => {
      // The history tab carries the same case header as the summary tab, and
      // that header's Status field is rendered from the same resolved display
      // name — so it is a second, independent site the label could leak from.
      await detail.assertState(AWAITING_DECISION_LABEL)
      await detail.expandAllAuditEntryDetails()
      expect(await detail.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })

  describe('on the audit log of an item that passed through the hop', () => {
    // Runs everywhere, seed or no seed: a real decision journey drives
    // `assessment-in-progress -> awaiting-decision -> approved` inside one
    // backend call, so this item's history is the one page where the internal
    // edge can surface for an ordinary case.
    let journeyId

    before(async () => {
      journeyId = await createReAccreditation(JOURNEY_ORG_PREFIX)
      await driveToApproved(journeyId)
      await workItems.openWorkItem(journeyId)
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
    })

    it('renders its transition history', async () => {
      // Positive control. "The label is absent" is worthless if the page did
      // not render its entries at all — a blank history would satisfy every
      // absence check in this file.
      const transitions = await detail.appliedTransitions()
      expect(transitions.length).toBeGreaterThan(0)
      expect(transitions.join(' | ')).toContain('→ approved')
    })

    it('never renders the removed label, including inside expanded details', async () => {
      // Whether management-be surfaces the internal hop as its own audit edge
      // is its call (see ra-410-cta-lifecycle.e2e.js), and the edge trace uses
      // raw state ids either way. What AC3 requires is that the DISPLAY NAME
      // never appears — in a summary line, in a "State" snapshot row, or
      // anywhere else on the page.
      expect(await detail.bodyText()).not.toContain(BANNED_STATUS_LABEL)
    })
  })
})
