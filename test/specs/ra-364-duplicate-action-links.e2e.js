import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query from '../page-objects/query.page.js'
import withdrawPage from '../page-objects/withdraw.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'

/**
 * RA-364 — CM: Work item UI showing duplicated links.
 *
 * A re-accreditation work item in `queried` rendered FOUR identical green
 * "Resume" buttons stacked in the actions panel, and an item in `updated`
 * rendered four identical "Continue review" buttons.
 *
 * Cause: management-be projected transitions marked `CallerInvocable: false`
 * into `availableActions`. The re-accreditation template has four
 * `resume-during-*` transitions — all display name "Resume", all valid from
 * `queried` — and four `continue-review-during-*` transitions — all display
 * name "Continue review", all valid from `updated`. management-fe renders one
 * control per entry, hence four of each. They were also non-functional: the
 * generic action endpoint rejects `CallerInvocable: false` transitions, so
 * clicking any of them failed. Fixed in management-be (excluded from the
 * projection) and defensively in management-fe (filtered in the detail
 * controller, BEFORE the template's empty-state length check).
 *
 * ── Why these assertions are counts, not presence ────────────────────────────
 *
 * A spec asserting "a Withdraw link exists" would have passed against the bug
 * — the Withdraw link was there the whole time, sitting under four broken
 * Resume buttons. Every assertion below is therefore count-based and would
 * have FAILED before the fix: `countActionsLabelled('Resume')` returned 4, the
 * total control count was 5 rather than 1, and the duplicate-label check
 * reported "Resume ×4".
 *
 * ── Coverage boundary: state `updated` is NOT reachable from this suite ──────
 *
 * AC3 and AC4 (zero "Continue review" controls, exactly one
 * `withdraw-during-updated` in state `updated`) are deliberately NOT covered
 * here, because `updated` cannot be reached through the case-management UI:
 *
 *  - The ONLY transitions into `updated` are the four `resume-during-*`, and
 *    all four are `CallerInvocable: false` — so the generic
 *    /work-items/{id}/actions/{actionId} route refuses them by design. That
 *    refusal is the RA-311/MBE-1 security control, not an obstacle to route
 *    around.
 *  - The real route in is management-be's
 *    `POST /work-items/re-accreditation/{id}/resume-from-query`, which the
 *    OPERATOR backend calls when an operator resubmits a queried application.
 *    management-fe does not proxy it — there is no FE route, controller or
 *    affordance for it anywhere — and compose.yml runs no operator backend and
 *    no legacy frontend, so nothing in this stack will ever call it.
 *
 * management-be confirms the endpoint could be driven directly from the compose
 * network with an `x-cdp-client-id` header. That was considered and
 * rejected, for three reasons: no spec in this suite calls management-be
 * directly (the backend publishes no host port, so it is reachable only when the
 * runner itself sits on the docker network — the spec would pass in CI and fail
 * locally and on BrowserStack); it is an API fixture rather than a user journey,
 * which is what this suite exists to exercise; and both the management-be and
 * management-fe owners independently agreed it should be reported as
 * not-coverable rather than dressed up as a journey.
 *
 * The `updated` half of the fix is pinned by unit tests in management-be and
 * management-fe instead. See the hand-off note on epr-7uaq. If an operator-side
 * service is ever added to compose.yml, AC3/AC4 become reachable and belong
 * here — the assertions would mirror the `queried` block exactly, swapping
 * "Resume" for "Continue review" and `withdraw-during-query` for
 * `withdraw-during-updated`.
 *
 * ── Trap: "Updated" is an ambiguous status label ─────────────────────────────
 *
 * Do not "fix" this spec later by driving to a page showing status "Updated"
 * and asserting there. `ReAccreditationType.cs` deliberately gives BOTH
 * `assessment-in-progress` AND `updated` the display label "Updated" (RA-324
 * AC06: "that clash is accepted, not reconciled"). `assertState('Updated')`
 * cannot tell them apart, so a spec written that way would silently assert
 * against `assessment-in-progress` and prove nothing about this bug. The
 * reliable discriminator is the withdraw action id — `withdraw-during-updated`
 * appears only in `updated`, `withdraw-during-assessment` only in
 * `assessment-in-progress`.
 *
 * "Queried" carries no such ambiguity — it belongs to `queried` alone — so
 * `assertState('Queried')` below is safe.
 */

/**
 * The four `resume-during-*` action ids, all labelled "Resume" and all valid
 * from `queried`. Mirrors `ReAccreditationType.cs`. Listed explicitly so the
 * spec pins the exact ids the bug rendered rather than only the shared label:
 * a regression that reintroduced them under changed display names would still
 * be caught by the id assertions, and one that reintroduced four distinct ids
 * sharing the label "Resume" would still be caught by the label assertions.
 */
const RESUME_ACTION_IDS = [
  'resume-during-duly-making',
  'resume-during-duly-made',
  'resume-during-assessment',
  'resume-during-decision'
]

describe('RA-364 duplicated action links on the work item detail page', () => {
  describe('AC01/AC02/AC05 — a queried application', () => {
    // These `it`s run IN ORDER and share one work item. The last one withdraws
    // it, which is terminal — do not reorder them, and do not run one in
    // isolation with `.only` expecting the later state to exist.
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createReAccreditation(
        'RA364 Queried Ltd',
        // Last 3 characters must be unique per (agency, material) — see the
        // fixture rule in support/re-accreditation-journey.js. `1AE` is unused
        // across the suite for England + plastic.
        'SW1A 1AE'
      )

      await query.gotoFor(workItemId)
      await query.selectSection('business-plan')
      await query.fillReason(
        'RA-364: please confirm the business plan figures so the actions panel can be inspected in the queried state.'
      )
      await query.submit()
      await query.waitForDetailUrl(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('is in the queried state and still renders the re-accreditation template', async () => {
      // Guards two distinct vacuous-pass routes before anything is counted.
      //
      // Template-version drift: management-be stamps its TemplateVersion onto
      // every new work item and management-fe resolves the detail template by
      // that value. An unregistered version silently falls back to the GENERIC
      // template, losing this type's actions-panel override with nothing
      // failing — so the negatives below could pass for the wrong reason.
      //
      // State: if the query had not landed, the item would sit in `submitted`,
      // where no `resume-during-*` transition is valid at all and "zero Resume
      // controls" is true regardless of the fix.
      await workItems.openWorkItem(workItemId)
      await expect($('[data-testid="re-accreditation-detail"]')).toBeDisplayed()
      await detail.assertState('Queried')
    })

    it('renders no Resume control at all', async () => {
      await workItems.openWorkItem(workItemId)

      // Positive anchor FIRST. The assertions in this test are absences, and an
      // absence is only meaningful once the panel has demonstrably rendered —
      // otherwise a detail page that failed to load, or a renamed testid, would
      // satisfy every one of them.
      await detail.assertActionsPanelWellFormed()

      expect(await detail.countActionsLabelled('Resume')).toBe(0)
      for (const actionId of RESUME_ACTION_IDS) {
        expect(await detail.countActionsWithId(actionId)).toBe(0)
      }
    })

    it('renders exactly one Withdraw link, and it is withdraw-during-query', async () => {
      await workItems.openWorkItem(workItemId)

      expect(await detail.countActionsLabelled('Withdraw')).toBe(1)
      expect(await detail.countActionsWithId('withdraw-during-query')).toBe(1)
    })

    it('renders exactly one action control in total', async () => {
      await workItems.openWorkItem(workItemId)

      // The whole-panel assertion, and the one that most directly pins the
      // ticket: pre-fix this returned five ids (four resume-during-* plus the
      // withdraw). Asserting the exact array rather than just the length means
      // a regression reports WHICH controls came back.
      expect(await detail.actionControlIds()).toEqual(['withdraw-during-query'])
    })

    it('has no duplicate action labels', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertNoDuplicateActionLabels()
    })

    it('offers no Query affordance, so the panel cannot regain a duplicate', async () => {
      // RA-291's business rule: only one query may be open at a time. Asserted
      // here too because `action-query` is the one testid management-fe
      // hardcodes rather than deriving from the action id, so it is the entry
      // most likely to slip past an id-based filter.
      await workItems.openWorkItem(workItemId)
      expect(await detail.countActionsWithId('query')).toBe(0)
    })

    it('the surviving Withdraw link actually works', async () => {
      // The four Resume buttons were not merely duplicated, they were broken —
      // the action endpoint rejects `CallerInvocable: false` transitions. So
      // "exactly one control remains" is only half the story; the control that
      // remains has to be one the caseworker can actually use. This proves the
      // filter kept the functional action rather than trimming the list to an
      // arbitrary survivor.
      await workItems.openWorkItem(workItemId)
      await detail.triggerAction('withdraw-during-query')
      await withdrawPage.submit()
      await withdrawPage.waitForDetailUrl(workItemId)
      await detail.assertState('Withdrawn')
    })

    it('shows the terminal-state panel once withdrawn, not an empty container', async () => {
      // AC06's empty-state half, for a re-accreditation item.
      //
      // Note this is `re-accreditation-readonly-actions`, NOT the generic
      // `work-item-no-actions`: detail-v1.njk overrides the whole `actionsPanel`
      // block in a terminal state. assertActionsPanelWellFormed() accepts either
      // shape but insists on exactly one of them, and rejects the regression
      // this AC is really about — a rendered-but-empty `work-item-actions`.
      await workItems.openWorkItem(workItemId)
      await detail.assertActionsPanelWellFormed()
      await expect(detail.readOnlyActionsNotice()).toBeDisplayed()
      expect(await detail.actionControlIds()).toEqual([])
    })
  })

  describe('AC05/AC06 — states whose actions are genuinely caller-invocable', () => {
    // Ordered and sharing one work item: each `it` drives the item one stage
    // further. Do not reorder.
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createReAccreditation(
        'RA364 Journey Ltd',
        // `1AG` is unused across the suite for England + plastic.
        'SW1A 1AG'
      )
      await workItems.openWorkItem(workItemId)
    })

    after(async () => {
      await login.logout()
    })

    it('renders the submitted actions once each', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      await detail.assertActionsPanelWellFormed()
      await detail.assertNoDuplicateActionLabels()

      // `submitted` has no generic primary action, so the actions panel is
      // the Query and Withdraw links alone. RA-316's "Duly make" is NOT
      // counted here: it is a type-specific CTA rendered outside the generic
      // actions list, and `duly-make` is registered CallerInvocable:false so
      // it never reaches `availableActions` at all.
      expect(await detail.countActionsWithId('query')).toBe(1)
      expect(await detail.countActionsWithId('withdraw')).toBe(1)
      expect(await detail.countActionsWithId('duly-make')).toBe(0)
    })

    it('renders the duly-made actions once each, including the primary button', async () => {
      await dulyMake(workItemId)

      await detail.assertActionsPanelWellFormed()
      await detail.assertNoDuplicateActionLabels()

      // RA-410: `payment-received` is no longer an action button at all. The
      // transition is folded into "Assign to yourself and start" — that IS
      // step 2 of the CTA lifecycle — so it must render ZERO times here. An
      // earlier draft of this spec expected 1, which was written against the
      // pre-RA-410 action panel.
      //
      // The AC06 subject is unchanged: a genuinely caller-invocable action
      // renders EXACTLY ONCE, which the `query` and `withdraw` counts below
      // still protect. Asserting 0 here also guards the regression that would
      // reintroduce the button beside the CTA and give two doors to one hop.
      expect(await detail.countActionsWithId('payment-received')).toBe(0)
      expect(await detail.countActionsLabelled('Payment received')).toBe(0)
      expect(await detail.countActionsWithId('query')).toBe(1)
      expect(await detail.countActionsWithId('withdraw-during-duly-made')).toBe(
        1
      )
    })

    it('renders the assessment actions once each', async () => {
      // Step 2 of the CTA lifecycle: self-assign applies `payment-received`.
      // The old `triggerAction('payment-received')` button no longer exists.
      await detail.selfAssignAndStart()

      // `assessment-in-progress` displays as "Updated" — see the trap note at
      // the top of this file. The state is pinned by the action id below, not
      // by this label.
      await detail.assertState('Updated')
      await detail.assertActionsPanelWellFormed()
      await detail.assertNoDuplicateActionLabels()

      // The unambiguous discriminator between `assessment-in-progress` and the
      // `updated` state that shares its label.
      expect(
        await detail.countActionsWithId('withdraw-during-assessment')
      ).toBe(1)
      expect(await detail.countActionsWithId('withdraw-during-updated')).toBe(0)

      // RA-410 removed `submit-for-decision` from `availableActions`
      // altogether — the `awaiting-decision` hop is applied server-side inside
      // the single Log decision call and is not caller-invocable. It is still
      // asserted absent, but for a stronger reason than before: it is not a
      // gated action waiting to appear, it no longer exists as one.
      expect(await detail.countActionsWithId('submit-for-decision')).toBe(0)

      // `sla-extend` is filtered out of availableActions by the detail
      // controller and renders in the ASSIGNMENT panel instead. It must not
      // leak into the actions panel — and its presence outside the panel is
      // what makes the page-wide `[data-testid^="action-"]` count unusable
      // here, which is why actionControlIds() is panel-scoped.
      expect(await detail.countActionsWithId('sla-extend')).toBe(0)
    })

    it('renders the Log decision CTA once, and no decision actions in the panel', async () => {
      // RA-410 replaced both decision actions with a single green CTA. This
      // case used to complete the assessment tasks, apply
      // `submit-for-decision`, complete the rationale task and then assert
      // that `approve` and `reject` each rendered exactly once in the actions
      // panel. Neither is in `availableActions` any more.
      //
      // The AC06 subject survives intact — "a caller-invocable affordance
      // renders exactly once" — so it re-points at the affordance that
      // actually carries the decision now. The two absence assertions are the
      // other half: a revert that put the old buttons back ALONGSIDE the CTA
      // would give a caseworker two routes to a determination, which is
      // exactly the duplication this file exists to catch.
      await detail.assertStateId('assessment-in-progress')

      await detail.assertActionsPanelWellFormed()
      await detail.assertNoDuplicateActionLabels()

      expect(await detail.hasLogDecisionCta()).toBe(true)
      expect(await detail.countActionsWithId('approve')).toBe(0)
      expect(await detail.countActionsWithId('reject')).toBe(0)
      expect(await detail.countActionsWithId('withdraw-during-decision')).toBe(
        0
      )
      expect(
        await detail.countActionsWithId('withdraw-during-assessment')
      ).toBe(1)
    })
  })
})
