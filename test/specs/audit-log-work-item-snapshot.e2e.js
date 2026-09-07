import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'

/**
 * Audit log — work item snapshot fields.
 *
 * Each "Show details" disclosure on the audit log page should surface a
 * consistent set of work-item context rows so reviewers can see the
 * event that triggered the entry alongside its context:
 *
 *   Org ID       — applicationReference from the submission payload
 *   Type         — work item type display name
 *   Submitted at — formatted submission timestamp
 *   Submitted by — submitter identity
 *   Last modified — formatted last-modified timestamp
 *   Assigned to  — assignee name or "Unassigned"
 *
 * State is shown per-entry as the work-item state as-of that event, NOT the
 * current live state (epr-rr9s). State-bearing events render it through
 * their own rows — the first entry here, "Work item submitted", shows it as
 * "Initial state" — while auxiliary events (assignment, notes, …) show a
 * "State" context row resolved from the entry's own stateId, and older
 * entries with no recorded state omit it entirely.
 *
 * RA-526: `routed-to-nation` (and `nation-corrected`) are the one exception
 * to ALL of the above — they show NONE of this context block, not even
 * Assigned to. They are a system-derived side effect of submission, not a
 * caseworker action against the item's own workflow, so none of this
 * context has anything to do with why a nation was chosen or corrected.
 * `assigned` is used below as the auxiliary-action example instead, since
 * routed-to-nation no longer carries a State row to assert against — which
 * also means every entry's "Assigned to" now reads "Stub Caseworker One"
 * rather than "Unassigned" (a LIVE snapshot value, not a per-entry
 * historical one, so assigning the item after creation changes it on every
 * entry already in the timeline too, not just ones added afterwards).
 */
describe('Audit log — work item snapshot fields', () => {
  before(async () => {
    await login.login()
    await workItems.goto()
    await workItems.createWorkItem({
      organisationName: 'Snapshot Test Ltd',
      siteAddressLine1: '1 Audit Road',
      siteAddressTown: 'Manchester',
      siteAddressPostcode: 'M1 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    })
    // A second auxiliary (non-state-bearing) entry, needed since RA-526 took
    // routed-to-nation out of the running as an example of one that still
    // carries a State row.
    await detail.assignTo('stub-caseworker-1')
    await detail.gotoAudit()
  })

  after(async () => {
    await login.logout()
  })

  it('shows a "Show details" disclosure on the submitted audit entry', async () => {
    const disclosures = await $$(
      '[data-testid="work-item-audit-entry-details"]'
    )
    expect(disclosures.length).toBeGreaterThan(0)
  })

  describe('work item snapshot rows inside the first disclosure', () => {
    before(async () => {
      await detail.expandAllAuditEntryDetails()
    })

    it('includes an Org ID row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Org ID"]'
        )
      ).toExist()
    })

    it('includes a Type row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Type"]'
        )
      ).toExist()
    })

    // epr-rr9s: "Work item submitted" is a state-bearing event. It conveys
    // its state as-of the event through its own "Initial state" row rather
    // than a current-state "State" context row (which used to be stamped,
    // incorrectly, from the live work-item state). There must therefore be an
    // "Initial state" row and no stale "State" row on it.
    //
    // These two scope by the entry's `data-action` rather than the
    // `[@data-testid="work-item-audit-entry-details"][1]` form used above.
    // That predicate is positional PER PARENT, and every entry renders its
    // disclosure as the only such element inside its own <li>, so it matches
    // EVERY entry rather than the first. A `.not.toExist()` written that way
    // silently asserts "no entry anywhere has a State row" — which passed
    // only while the backend stamped no per-entry state at all, and is the
    // opposite of what this spec means to check.
    const submittedEntry =
      '//li[@data-action="work-item-submitted"]//*[@data-testid="work-item-audit-entry-details"]'

    it('shows the submitted entry state as an "Initial state" row', async () => {
      await expect(
        $(`${submittedEntry}//dt[normalize-space(.)="Initial state"]`)
      ).toExist()
    })

    it('does not stamp a current-state "State" row on the submitted entry', async () => {
      await expect(
        $(`${submittedEntry}//dt[normalize-space(.)="State"]`)
      ).not.toExist()
    })

    // epr-rr9s: the other half of the contract. Auxiliary actions carry no
    // state in their own rows, so they DO get the context-block "State" row,
    // resolved from that entry's own stateId. Without this the suite would
    // pass with the backend stamping nothing at all.
    //
    // RA-526: assigned, not routed-to-nation — the latter is now one of the
    // two actions that gets NO context-block rows at all (see the file
    // header), so it can no longer stand in as "the" auxiliary example.
    it('shows a per-entry "State" row on the auxiliary assigned entry', async () => {
      await expect(
        $(
          '//li[@data-action="assigned"]//*[@data-testid="work-item-audit-entry-details"]//dt[normalize-space(.)="State"]'
        )
      ).toExist()
    })

    // Assert the VALUE, not just the row's presence. An existence-only check
    // passes even when the backend stamps the WRONG state -- which is exactly
    // how a seeder bug stamping each entry with the item's terminal state got
    // through review once already. This fixture is freshly submitted, so the
    // as-of state is the initial one: "Not started" (state id `submitted`),
    // the very value the original bug replaced with the live current state.
    it('renders the assigned State as the as-of value, not a state id', async () => {
      await expect(
        $(
          '//li[@data-action="assigned"]//*[@data-testid="work-item-audit-entry-details"]//dt[normalize-space(.)="State"]/following-sibling::dd'
        )
      ).toHaveText('Not started')
    })

    it('includes a Submitted at row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Submitted at"]'
        )
      ).toExist()
    })

    it('includes a Submitted by row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Submitted by"]'
        )
      ).toExist()
    })

    it('includes a Last modified row', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Last modified"]'
        )
      ).toExist()
    })

    // Assigned to is a LIVE snapshot value, not a per-entry historical one —
    // every entry shows the CURRENT assignee, including one (like this,
    // "Work item submitted") created before the assignment happened.
    it('shows the current assignee for Assigned to, even on an entry that predates the assignment', async () => {
      await expect(
        $(
          '//*[@data-testid="work-item-audit-entry-details"][1]//dt[normalize-space(.)="Assigned to"]/following-sibling::dd'
        )
      ).toHaveText('Stub Caseworker One')
    })

    // RA-526: routed-to-nation/nation-corrected are excluded here — they are
    // the one pair of actions that gets no context-block rows at all (see
    // the file header), so this loop only covers entries where the
    // "consistent set of rows" claim actually applies.
    it('snapshot rows appear on every other disclosure in the timeline', async () => {
      const otherDisclosures = await $$(
        '//li[not(@data-action="routed-to-nation") and not(@data-action="nation-corrected")]//*[@data-testid="work-item-audit-entry-details"]'
      )
      expect(otherDisclosures.length).toBeGreaterThan(0)
      for (const disclosure of otherDisclosures) {
        await expect(disclosure.$('dt=Assigned to')).toExist()
      }
    })

    it('routed-to-nation itself has no Assigned to row', async () => {
      await expect(
        $(
          '//li[@data-action="routed-to-nation"]//*[@data-testid="work-item-audit-entry-details"]//dt[normalize-space(.)="Assigned to"]'
        )
      ).not.toExist()
    })
  })
})
