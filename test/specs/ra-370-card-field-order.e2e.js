import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems, { TILE_FIELD_ORDER } from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { formatUkDateGds } from '../support/uk-time.js'

/**
 * RA-370 — "WorkItem widget not having submitted on".
 *
 * The application cards on the Applications page (/work-items) must show their
 * fields in one consistent order on every card, and must carry a "Submitted on"
 * date that RA-324 phase-2 had dropped:
 *
 *   Application ref no · Org name · Org ID · Material type · Applicant type ·
 *   Submitted on (only while the assessment has NOT started, GDS date) ·
 *   Assigned to (officer name, or "Unassigned") · Due date (only once the SLA
 *   clock has started)
 *
 * Contract confirmed with management-fe on the matching branch:
 *   - The card footer (data-testid application-card-footer) now ALWAYS renders.
 *     It holds submitted-on, assigned-to and due-on, in that order.
 *   - submitted-on and due-on are both keyed off the backend list field
 *     `slaState` — the clock starts when the assessment starts, so
 *     showSubmittedOn = !slaState and showDueDate = !!slaState. They are exact
 *     inverses: every card shows EXACTLY ONE of the two, never both, never
 *     neither. That invariant is asserted directly below.
 *   - Visibility is keyed off slaState, NOT off the state id, so this spec
 *     deliberately drives the SLA clock rather than asserting a state list.
 *   - assigned-to is no longer gated on the clock: it renders on every card.
 *   - Every field testid node holds the VALUE ONLY; the visible label sits in a
 *     sibling span outside the hook, so exact-text assertions are safe.
 *   - registration-number (RA-295 AC06) still renders, between org-id and
 *     material. It is not an RA-370 field, so it is asserted as "still there"
 *     rather than positioned by this spec's ordering contract.
 *
 * The canonical order lives in TILE_FIELD_ORDER on the page object, so the
 * ordering assertions and the page object read from one source of truth.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

/**
 * Create a fresh (Submitted / "Not started") re-accreditation work item — i.e.
 * one whose assessment has NOT started, so it has no slaState — and return its
 * id. Navigates to the Applications list first because the "Create work item"
 * link only renders there; createWorkItem leaves the browser on the new item's
 * detail page. Each caller passes a distinct postcode so the application
 * reference generator does not exhaust its collision-retry budget on items
 * sharing postcode + material.
 */
async function createFreshItem(organisationName, postcode) {
  await workItems.goto()
  const { id } = await workItems.createWorkItem({
    organisationName,
    siteAddressLine1: '1 Submitted On Way',
    siteAddressTown: 'London',
    siteAddressPostcode: postcode,
    material: 'plastic',
    tonnageBand: '0-500'
  })
  return id
}

/**
 * Start the assessment: completing the two submitted-state tasks fires the
 * auto-duly-made hook, which starts the SLA clock. That is the transition the
 * conditional fields key off — after it the card must drop Submitted on and
 * gain Due date.
 */
async function startAssessment(id) {
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')
}

/** Bound the list to one organisation token so the assertions are pagination-safe. */
async function listCardsFor(token) {
  // RA-299: a bare landing defaults to assigned-to-me, which would hide the
  // unassigned items these tests create.
  await workItems.resetFilters()
  await workItems.searchByOrgName(token)
}

/**
 * The set of GDS date strings acceptable for something submitted "just now".
 * A run that straddles UK midnight would otherwise flake, so both today and
 * tomorrow are allowed — still tight enough to catch a wrong format, a wrong
 * timezone, or a stale date.
 */
function todayGdsWindow() {
  const now = new Date()
  return [
    formatUkDateGds(now),
    formatUkDateGds(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  ]
}

/** GDS date: "4 August 2026" — no leading zero, full month name, no time. */
const GDS_DATE =
  /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/

/**
 * The RA-370 fields that render on EVERY card, whatever its state.
 *
 * org-id is deliberately NOT here even though it IS in the story's field list:
 * the template renders it only `{% if item.orgId %}`, and orgId maps to
 * payload.operatorOrganisationId — which items created through the UI "Create
 * work item" form never set. Asserting it would fail on a fixture this spec
 * builds itself, saying nothing about the ordering contract. Its POSITION is
 * still covered, because TILE_FIELD_ORDER carries it and assertCardOrder checks
 * relative order against that list — so a card that does render it must place
 * it between org-name and material.
 */
const ALWAYS_PRESENT = [
  'application-ref',
  'org-name',
  'material',
  'applicant-type',
  'assigned-to'
]

/**
 * Assert one card's field order against the canonical contract.
 *
 * Relative order rather than exact equality, because two of the fields are
 * conditional by design (submitted-on / due-on are exact inverses) and org-id
 * depends on the payload. Exact equality against TILE_FIELD_ORDER would make
 * the test a statement about the fixture rather than about the template.
 *
 * @param {string[]} order      testids as rendered, in DOM order
 * @param {string} dateField    the one date field this card must show
 */
function assertCardOrder(order, dateField) {
  // Canonical relative order: indices into TILE_FIELD_ORDER must increase.
  const indices = order.map((field) => TILE_FIELD_ORDER.indexOf(field))
  expect(indices).toEqual([...indices].sort((a, b) => a - b))
  // Every unconditional field is actually on the card...
  for (const field of ALWAYS_PRESENT) {
    expect(order).toContain(field)
  }
  // ...and exactly one of the two mutually exclusive date fields.
  const otherDate = dateField === 'submitted-on' ? 'due-on' : 'submitted-on'
  expect(order).toContain(dateField)
  expect(order).not.toContain(otherDate)
}

describe('RA-370 — application card field order and Submitted on', () => {
  // ── AC1/AC2/AC3/AC4/AC5 — cards whose assessment has not started ─────────── //

  describe('assessment not started', () => {
    const token = uniqueOrg('RA370 NotStarted')
    let firstId
    let secondId

    before(async () => {
      await login.login()
      // Two cards under a shared token: the "consistent order for EVERY case
      // item" AC cannot be proven from a single hand-picked card.
      firstId = await createFreshItem(`${token} One`, 'SW1A 9AA')
      secondId = await createFreshItem(`${token} Two`, 'SW1A 9AB')
      await listCardsFor(token)
    })

    after(async () => {
      await login.logout()
    })

    it('AC1: renders the story fields in the defined order on the card', async () => {
      await expect(workItems.tileFor(firstId)).toBeDisplayed()
      const order = await workItems.tileFieldOrder(firstId)
      // A not-started card shows Submitted on, not Due date.
      assertCardOrder(order, 'submitted-on')
    })

    it('AC1: every card on the page uses the same field order', async () => {
      const orders = await workItems.cardFieldOrders()
      expect(orders.length).toBeGreaterThan(1)
      for (const order of orders) {
        // Relative order, not mere presence: each card's field indices into the
        // canonical list must increase monotonically, tolerating a conditional
        // field being absent on some cards but not others.
        const indices = order.map((field) => TILE_FIELD_ORDER.indexOf(field))
        expect(indices).toEqual([...indices].sort((a, b) => a - b))
      }
      // ...and they must all agree with each other, so a template that ordered
      // the first card correctly and the rest differently still fails.
      const [firstOrder] = orders
      for (const order of orders) {
        expect(order).toEqual(firstOrder)
      }
    })

    it('AC2: shows Submitted on while the assessment has not started', async () => {
      // Guard: tileHasField chains off the tile, so an absent tile would report
      // every field absent and pass a visibility rule vacuously.
      await expect(workItems.tileFor(firstId)).toBeDisplayed()
      expect(await workItems.tileHasSubmittedOn(firstId)).toBe(true)
      expect(await workItems.tileHasSubmittedOn(secondId)).toBe(true)
    })

    it('AC3: formats Submitted on to the GDS date standard', async () => {
      const submittedOn = await workItems.tileSubmittedOn(firstId).getText()
      expect(submittedOn).toMatch(GDS_DATE)
      // The item was created moments ago, so the rendered date must be today in
      // Europe/London — this catches a UTC-vs-UK slip as well as a stale value.
      expect(todayGdsWindow()).toContain(submittedOn)
    })

    it('AC3: every card renders Submitted on in the GDS format', async () => {
      const values = await workItems.cardFieldValues('submitted-on')
      expect(values.length).toBeGreaterThan(1)
      for (const value of values) {
        expect(value).toMatch(GDS_DATE)
      }
    })

    it('AC4: shows "Unassigned" for a card nobody holds', async () => {
      await expect(workItems.tileFor(firstId)).toBeDisplayed()
      expect(await workItems.tileHasAssignedTo(firstId)).toBe(true)
      // Exact text, not a substring: the testid node is value-only, so a
      // regression that leaked the "Assigned to:" label into it must fail.
      await expect(workItems.tileAssignedTo(firstId)).toHaveText('Unassigned')
    })

    it('AC4: Assigned to is present on every card, not just SLA-started ones', async () => {
      const values = await workItems.cardFieldValues('assigned-to')
      expect(values.length).toBeGreaterThan(1)
      for (const value of values) {
        expect(value).not.toBeNull()
        expect(value).not.toBe('')
      }
    })

    it('AC5: omits Due date before the SLA clock starts', async () => {
      await expect(workItems.tileFor(firstId)).toBeDisplayed()
      expect(await workItems.tileHasDueOn(firstId)).toBe(false)
      expect(await workItems.tileHasDueOn(secondId)).toBe(false)
    })

    it('AC2/AC5: shows exactly one of Submitted on / Due date on every card', async () => {
      const submitted = await workItems.cardFieldValues('submitted-on')
      const due = await workItems.cardFieldValues('due-on')
      expect(submitted.length).toEqual(due.length)
      for (let index = 0; index < submitted.length; index++) {
        expect(submitted[index] === null).not.toEqual(due[index] === null)
      }
    })

    it('AC6: keeps the RA-295 registration number on the card', async () => {
      // Regression guard: RA-370 reorders the card, and the registration number
      // is not in the story's field list — it must survive the reorder.
      expect(await workItems.tileHasRegistrationNumber(firstId)).toBe(true)
    })
  })

  // ── AC4 — assigned card ──────────────────────────────────────────────────── //

  describe('assigned card', () => {
    const org = uniqueOrg('RA370 Assigned Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 9AC')
      await workItems.openWorkItem(itemId)
      await detail.selfAssign()
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    after(async () => {
      await login.logout()
    })

    it('AC4: shows the officer name on the card once assigned', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      await expect(workItems.tileAssignedTo(itemId)).toHaveText(
        'Stub Caseworker One'
      )
    })

    it('AC2: still shows Submitted on — assignment does not start the assessment', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasSubmittedOn(itemId)).toBe(true)
      expect(await workItems.tileHasDueOn(itemId)).toBe(false)
    })

    it('AC1: an assigned card keeps the canonical field order', async () => {
      await listCardsFor(org)
      const order = await workItems.tileFieldOrder(itemId)
      assertCardOrder(order, 'submitted-on')
    })
  })

  // ── AC2/AC5 — assessment started (SLA clock running) ─────────────────────── //

  describe('assessment started', () => {
    const org = uniqueOrg('RA370 Started Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 9AD')
      await startAssessment(itemId)
    })

    after(async () => {
      await login.logout()
    })

    it('AC2: hides Submitted on once the assessment has started', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasSubmittedOn(itemId)).toBe(false)
    })

    it('AC5: shows Due date, GDS-formatted, once the SLA clock has started', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasDueOn(itemId)).toBe(true)
      expect(await workItems.tileDueOn(itemId).getText()).toMatch(GDS_DATE)
    })

    it('AC4: still shows Assigned to on an SLA-started card', async () => {
      await listCardsFor(org)
      await expect(workItems.tileAssignedTo(itemId)).toHaveText('Unassigned')
    })

    it('AC1: an SLA-started card keeps the canonical field order', async () => {
      await listCardsFor(org)
      const order = await workItems.tileFieldOrder(itemId)
      // Submitted on drops out, Due date appears — the remaining fields keep
      // their relative positions.
      assertCardOrder(order, 'due-on')
    })
  })
})
