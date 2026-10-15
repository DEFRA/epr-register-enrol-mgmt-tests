import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import { LEGACY_SNAPSHOT_WORK_ITEM } from '../support/seeded-fixtures.js'

/**
 * RA-342 — worklist tolerates legacy template-snapshot fields.
 *
 * Bug: a stored work item's frozen `templateSnapshot` could carry BSON
 * elements the current model no longer declares (the role-tiered
 * `templateSnapshot.transitions[].requiredRoles` dropped in RA-323). Mongo
 * deserialisation threw System.FormatException, which crashed the ENTIRE
 * `GET /work-items` query rather than just the offending row — so every
 * caseworker saw "Backend returned 500" and the worklist would not load.
 *
 * Fix (management-be): [BsonIgnoreExtraElements] on the frozen-snapshot value
 * types (WorkItemTemplateSnapshot / WorkItemTransition / WorkItemState /
 * WorkItemTask), so a legacy document deserialises with the stray element
 * ignored.
 *
 * No API can create such a document, so management-be seeds one
 * (`LEGACY_SNAPSHOT_WORK_ITEM`, written as raw BSON with four undeclared
 * snapshot elements) and resets it at every startup. See
 * test/support/seeded-fixtures.js.
 *
 * The first test bounds the worklist to that item by its fixed operator
 * organisation id, so the legacy document is guaranteed to be in the batch
 * the query deserialises, then asserts the results summary — which the
 * template emits only when the backend query succeeds — its row, and no
 * "Could not reach the backend" banner. Because one legacy document crashed
 * the whole batch before the fix, that is the exact bug symptom, not a proxy
 * for it. The second test opens the item by id, proving `GET /work-items/{id}`
 * tolerates the stray elements too.
 *
 * Neither test changes the item, so both pass on any number of runs between
 * management-be restarts.
 */

describe('RA-342 legacy template-snapshot worklist', () => {
  before(async () => {
    // Log in with no nation role — a multi-nation "see all" user — so the
    // worklist is unfiltered by nation and the seeded item is visible.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  it('lists the legacy-snapshot work item without a "Backend returned 500" error', async () => {
    // resetFilters() rather than goto(): a bare landing defaults to "Your
    // applications" (RA-299), and the legacy item is unassigned, so a search
    // on top of that default would never find it.
    await workItems.resetFilters()
    await workItems.searchByOrgId(
      LEGACY_SNAPSHOT_WORK_ITEM.operatorOrganisationId
    )

    await expect(workItems.worklistSummary()).toBeDisplayed()
    await expect(workItems.worklistErrorBanner()).not.toBeExisting()
    await expect(
      workItems.workItemLink(LEGACY_SNAPSHOT_WORK_ITEM.id)
    ).toBeDisplayed()
  })

  it('opens the legacy-snapshot work item by id', async () => {
    await workItems.openWorkItem(LEGACY_SNAPSHOT_WORK_ITEM.id)
    await workItems.waitForDetailPage()
  })
})
