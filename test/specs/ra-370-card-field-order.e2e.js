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
 *   Submitted on · Assigned to (officer name, or "Unassigned") · Due date
 *
 * Contract confirmed with management-fe on the matching branch:
 *   - The card footer (data-testid application-card-footer) now ALWAYS renders.
 *     It holds submitted-on, assigned-to and due-on, and that internal order
 *     holds even when all three render.
 *   - showSubmittedOn is keyed off the STATE, not the SLA clock:
 *     PRE_ASSESSMENT_STATE_IDS = {'submitted', 'duly-made'}.
 *   - showDueDate is keyed off the SLA clock: Boolean(item.slaState).
 *   - The two are therefore NOT inverses and NOT mutually exclusive. A card may
 *     legitimately show two dates, one, or none, so this spec asserts no
 *     "exactly one date" invariant. The only safe rule is the one being tested
 *     here: Submitted on is present exactly when the state is submitted or
 *     duly-made.
 *   - assigned-to is no longer gated on the clock: it renders on every card.
 *   - Every field testid node holds the VALUE ONLY; the visible label sits in a
 *     sibling span outside the hook, so exact-text assertions are safe.
 *   - registration-number (RA-295 AC06) still renders, between org-id and
 *     material. It is not an RA-370 field, so it is asserted as "still there"
 *     rather than positioned by this spec's ordering contract.
 *
 * The three date combinations reachable through the UI, all verified against a
 * running stack and all covered below:
 *
 *   state                  | Submitted on | Due on
 *   -----------------------|--------------|-------
 *   submitted              | yes          | no
 *   duly-made              | yes          | YES     <- both
 *   assessment-in-progress | no           | yes
 *
 * NB the both-dates row is reached by the ORDINARY journey, not only by the
 * ReAccreditationDulyMadeSnapshotMigration back-fill that prompted the fix:
 * ReAccreditationDulyMadeHook starts the SLA clock on the auto-duly-made
 * transition, so completing the two submitted-state tasks lands an item in
 * duly-made WITH a running clock. That is why it is covered end-to-end here.
 *
 * NOT covered here, deliberately:
 *   - NEITHER date. Reachable only when ReAccreditationSlaStampHook swallows a
 *     WorkItemConcurrencyException and leaves an assessment-in-progress item
 *     with no clock. There is no way to provoke that through the UI, so it is
 *     covered by management-fe unit tests only.
 *   - The `queried` and `updated` states. Both are reachable from pre- AND
 *     post-assessment transitions, so stateId alone cannot disambiguate them
 *     and such items lose Submitted on even when assessment never started.
 *     That is a known, accepted partial miss tracked as bead epr-r2s4 — this
 *     spec asserts nothing either way about them.
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
 * Drive submitted -> duly-made. Completing the two submitted-state tasks fires
 * the auto-duly-made hook, which ALSO starts the SLA clock
 * (ReAccreditationDulyMadeHook) — so this lands the item in the one state that
 * satisfies both conditions at once: still pre-assessment (Submitted on shows)
 * and clock running (Due on shows). This is the both-dates fixture.
 */
async function driveToDulyMade(id) {
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('verify-organisation-details', 'Completed')
  await detail.setTaskStatus('confirm-application-completeness', 'Completed')
  await detail.gotoDetail()
  await detail.assertState('Duly made')
}

/**
 * Drive duly-made -> assessment-in-progress via payment-received. This moves
 * the item OUT of PRE_ASSESSMENT_STATE_IDS while the clock keeps running, so
 * the card must drop Submitted on and keep Due date.
 *
 * The state's display name is "Updated" but its stateId is
 * `assessment-in-progress` (verified against the running stack) — so this is
 * NOT the `updated` state that RA-370 deliberately leaves uncovered.
 */
async function driveToAssessmentInProgress(id) {
  await driveToDulyMade(id)
  await workItems.openWorkItem(id)
  await detail.gotoTasks()
  await detail.setTaskStatus('confirm-registration-fee-paid', 'Completed')
  await detail.gotoDetail()
  await detail.triggerAction('payment-received')
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

/** The two conditionally-rendered date fields in the card footer. */
const DATE_FIELDS = ['submitted-on', 'due-on']

/**
 * Assert one card's fields appear in the canonical RELATIVE order: each field's
 * index into TILE_FIELD_ORDER must be greater than the last.
 *
 * Relative order rather than exact equality, because several fields are
 * conditional by design (org-id depends on the payload; submitted-on and due-on
 * depend on the item's state). Exact equality against TILE_FIELD_ORDER would
 * make the test a statement about the fixture rather than about the template.
 *
 * Shared by the single-card and every-card assertions so the two cannot drift.
 *
 * @param {string[]} order  testids as rendered, in DOM order
 */
function assertRelativeOrder(order) {
  const indices = order.map((field) => TILE_FIELD_ORDER.indexOf(field))
  expect(indices).toEqual([...indices].sort((a, b) => a - b))
}

/**
 * Assert one card's full field contract: canonical relative order, every
 * unconditional field present, and the expected date field(s).
 *
 * Self-guarding against a missing tile, unlike a bare tileHasField negative: an
 * absent card yields an empty `order`, which passes every absence check but
 * fails the ALWAYS_PRESENT ones loudly. So call sites need no separate
 * tile-displayed precondition — the presence half supplies it.
 *
 * @param {string[]} order       testids as rendered, in DOM order
 * @param {string[]} dateFields  the date testids this card must show; any of
 *                               DATE_FIELDS not listed must be absent. All four
 *                               combinations are legal, including `[]` (no date
 *                               at all) and both — the two are not inverses.
 */
function assertCardOrder(order, dateFields) {
  assertRelativeOrder(order)
  // Every unconditional field is actually on the card...
  for (const field of ALWAYS_PRESENT) {
    expect(order).toContain(field)
  }
  // ...and exactly the expected date fields, no more.
  for (const field of DATE_FIELDS) {
    if (dateFields.includes(field)) {
      expect(order).toContain(field)
    } else {
      expect(order).not.toContain(field)
    }
  }
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
      assertCardOrder(order, ['submitted-on'])
    })

    it('AC1: every card on the page uses the same field order', async () => {
      const orders = await workItems.cardFieldOrders()
      expect(orders.length).toBeGreaterThan(1)
      // Relative order, not mere presence: tolerates a conditional field being
      // absent on some cards but not others. Same helper the single-card
      // assertions use, so the two checks cannot drift apart.
      for (const order of orders) {
        assertRelativeOrder(order)
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
      // Guard EVERY card before its negative assertion: tileHasDueOn chains
      // isExisting() off the tile, so a card that dropped out of the filtered
      // list entirely would report the field absent and pass this vacuously.
      // One guard per id — guarding only the first would leave the second
      // assertion able to pass on a missing card.
      await expect(workItems.tileFor(firstId)).toBeDisplayed()
      expect(await workItems.tileHasDueOn(firstId)).toBe(false)
      await expect(workItems.tileFor(secondId)).toBeDisplayed()
      expect(await workItems.tileHasDueOn(secondId)).toBe(false)
    })

    it('AC6: keeps the RA-295 registration number on the card', async () => {
      // Regression guard: RA-370 reorders the card, and the registration number
      // is not in the story's field list — it must survive the reorder.
      expect(await workItems.tileHasRegistrationNumber(firstId)).toBe(true)
    })

    it('AC1: renders the reworded card title sentence', async () => {
      // The rest of this spec pins the contract through testids and their DOM
      // order, which the copy change does NOT affect — material and
      // applicant-type keep the same order inside any surrounding wording. So
      // assert the user-visible sentence directly, or RA-370's rename from
      // "Reprocessor reaccreditation: {Material}" could silently revert.
      await expect(workItems.tileTitle(firstId)).toHaveText(
        'Plastic reaccreditation (Reprocessor)'
      )
    })

    it('AC1: always renders the card footer, even before the SLA clock starts', async () => {
      // Pre-RA-370 the footer appeared only once the clock had started. Both
      // fresh cards must now carry it.
      await expect(workItems.tileFooter(firstId)).toBeDisplayed()
      await expect(workItems.tileFooter(secondId)).toBeDisplayed()
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
      assertCardOrder(order, ['submitted-on'])
    })
  })

  // ── AC2/AC5 — duly-made: pre-assessment AND clock running, so BOTH dates ─── //

  describe('duly made (clock running)', () => {
    const org = uniqueOrg('RA370 DulyMade Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 9AD')
      await driveToDulyMade(itemId)
    })

    after(async () => {
      await login.logout()
    })

    it('AC2/AC5: shows BOTH Submitted on and Due date', async () => {
      // The regression RA-370 fixes. duly-made is still pre-assessment, so
      // Submitted on must stay; the auto-duly-made hook has started the clock,
      // so Due date appears too. Under the old `showSubmittedOn = !slaState`
      // rule this card lost its Submitted on entirely.
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasSubmittedOn(itemId)).toBe(true)
      expect(await workItems.tileHasDueOn(itemId)).toBe(true)
    })

    it('AC3/AC5: GDS-formats both dates', async () => {
      await listCardsFor(org)
      expect(await workItems.tileSubmittedOn(itemId).getText()).toMatch(
        GDS_DATE
      )
      expect(await workItems.tileDueOn(itemId).getText()).toMatch(GDS_DATE)
    })

    it('AC1: keeps the canonical field order with all three footer fields', async () => {
      // The footer's internal order (submitted-on -> assigned-to -> due-on) has
      // to hold in the three-way case too, which is the only case that can
      // distinguish it from a two-field footer.
      await listCardsFor(org)
      const order = await workItems.tileFieldOrder(itemId)
      assertCardOrder(order, ['submitted-on', 'due-on'])
    })
  })

  // ── AC2/AC5 — assessment in progress: past pre-assessment, clock running ─── //

  describe('assessment in progress', () => {
    const org = uniqueOrg('RA370 InProgress Ltd')
    let itemId

    before(async () => {
      await login.login()
      itemId = await createFreshItem(org, 'SW1A 9AE')
      await driveToAssessmentInProgress(itemId)
    })

    after(async () => {
      await login.logout()
    })

    it('AC2: hides Submitted on once the state leaves pre-assessment', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasSubmittedOn(itemId)).toBe(false)
    })

    it('AC5: shows Due date, GDS-formatted, while the SLA clock runs', async () => {
      await listCardsFor(org)
      await expect(workItems.tileFor(itemId)).toBeDisplayed()
      expect(await workItems.tileHasDueOn(itemId)).toBe(true)
      expect(await workItems.tileDueOn(itemId).getText()).toMatch(GDS_DATE)
    })

    it('AC4: still shows Assigned to', async () => {
      await listCardsFor(org)
      await expect(workItems.tileAssignedTo(itemId)).toHaveText('Unassigned')
    })

    it('AC1: keeps the canonical field order', async () => {
      await listCardsFor(org)
      const order = await workItems.tileFieldOrder(itemId)
      // Submitted on drops out, Due date stays — the remaining fields keep
      // their relative positions.
      assertCardOrder(order, ['due-on'])
    })
  })
})
