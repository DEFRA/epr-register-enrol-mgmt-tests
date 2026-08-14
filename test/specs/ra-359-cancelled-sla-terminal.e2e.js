import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createDulyMadeWorkItem,
  createWithdrawnWorkItemWithRunningSla
} from '../support/terminal-states.js'

/**
 * RA-359 (part 2) — terminal work items must not advertise a running SLA.
 *
 * A withdrawn application is closed, but the backend still serves it (RA-358)
 * and its SLA due date sits in the payload. Before this story a withdrawn item
 * kept parading that date — a "Due on 24 August 2026" on a case no one is
 * working — as though a clock were still ticking down. RA-359 makes the SLA
 * state `Cancelled` for terminal items and suppresses the due date wherever it
 * would otherwise read as live.
 *
 * The fixtures matter as much as the assertions. The withdrawn item is driven
 * to `Duly made` — the point at which the SLA clock STARTS and a real due date
 * is set — BEFORE it is withdrawn. An item withdrawn straight from `submitted`
 * never had a running SLA, so hiding its due date would prove nothing and pass
 * identically against the pre-RA-359 build. See
 * `createWithdrawnWorkItemWithRunningSla` in support/terminal-states.js.
 *
 * Two frontend surfaces, per the split in the management-fe change:
 *   AC1 — the applications LIST card of a withdrawn item drops `due-on`
 *         (`showDueDate` now also requires `slaState !== 'Cancelled'`), while
 *         the rest of the card still renders.
 *   AC3 — the DETAIL page case header keeps `case-header-due-on` present (the
 *         layout is stable) but shows the em-dash "no value" fallback rather
 *         than a formatted date.
 *
 * AC2 is the regression guard: a NON-terminal item whose clock is genuinely
 * running must still show its due date on both surfaces. Gating on "Cancelled"
 * is one predicate away from gating on "terminal or not", and every RA-359
 * assertion above is a negative — the positive complement is what stops an
 * over-broad suppression from silently hiding live SLAs.
 *
 * Postcodes/materials are chosen for distinct RA-318 reference tuples (last-3
 * postcode + first-2 material); `9SL`/`9SR` are unused elsewhere in the suite.
 */
const uniqueOrg = (label) => `${label} ${Date.now()}`

describe('RA-359 — terminal work items do not advertise a running SLA', () => {
  const withdrawnOrg = uniqueOrg('SLA Cancelled Withdrawn Ltd')
  const liveOrg = uniqueOrg('SLA Running Open Ltd')
  let withdrawnId
  let liveId

  before(async () => {
    await login.login()

    // A withdrawn item that HAD a live SLA (driven to Duly made first).
    ;({ id: withdrawnId } = await createWithdrawnWorkItemWithRunningSla({
      organisationName: withdrawnOrg,
      material: 'plastic',
      postcode: 'SW1A 9SL'
    }))

    // A non-terminal item with a genuinely running SLA (the regression guard).
    liveId = await createDulyMadeWorkItem({
      organisationName: liveOrg,
      material: 'paper',
      postcode: 'SW1A 9SR'
    })
  })

  after(async () => {
    await login.logout()
  })

  describe('AC1 — the applications list card of a withdrawn item', () => {
    beforeEach(async () => {
      // includeArchived=true reveals terminal items, bounded by the org search
      // so the presence check stays pagination-safe (RA-224 reveal journey).
      await workItems.searchArchivedByOrgName(withdrawnOrg)
      await expect(workItems.tileFor(withdrawnId)).toBeDisplayed()
    })

    it('does not show the SLA due date', async () => {
      // The substantive assertion: a closed case must not advertise a running
      // SLA. Pre-RA-359 this card carried a live "Due on" date.
      expect(await workItems.tileHasField(withdrawnId, 'due-on')).toBe(false)
    })

    it('still renders the rest of the card', async () => {
      // Guards against the assertion above passing vacuously because the whole
      // card (or its footer) failed to render — `assigned-to` renders on every
      // card post-RA-370, so its presence proves the footer is there and it is
      // specifically `due-on` that has been suppressed.
      expect(await workItems.tileHasField(withdrawnId, 'assigned-to')).toBe(
        true
      )
    })
  })

  describe('AC3 — the case header on a withdrawn item detail page', () => {
    before(async () => {
      await workItems.openWorkItem(withdrawnId)
      await detail.assertState('Withdrawn')
    })

    it('keeps the Due on field in the header for a stable layout', async () => {
      // The field is not removed — the redesign keeps the header layout
      // stable; only its VALUE changes. Asserting absence here would be the
      // wrong contract and would mask a real date leaking back in.
      expect(await detail.hasCaseHeaderField('dueOn')).toBe(true)
    })

    it('shows the em-dash fallback rather than a date', async () => {
      // U+2014 EM DASH — the case header's "no value" fallback. The retained
      // SlaDueDate is deliberately NOT rendered for a Cancelled item.
      await expect(detail.caseHeaderField('dueOn')).toHaveText('—')
      expect(await detail.hasRealDueOn()).toBe(false)
    })
  })

  describe('AC2 — regression guard: a non-terminal item with a running SLA', () => {
    it('still shows the SLA due date on its list card', async () => {
      // RA-299: a bare landing defaults to assigned-to-me, which would hide
      // this unassigned item — reset to an explicit empty filter first.
      await workItems.resetFilters()
      await workItems.searchByOrgName(liveOrg)
      await expect(workItems.tileFor(liveId)).toBeDisplayed()
      expect(await workItems.tileHasField(liveId, 'due-on')).toBe(true)
    })

    it('still shows a real due date in its case header', async () => {
      await workItems.openWorkItem(liveId)
      await detail.assertState('Duly made')
      // A running clock renders a formatted date, not the em-dash fallback.
      expect(await detail.hasRealDueOn()).toBe(true)
    })
  })
})
