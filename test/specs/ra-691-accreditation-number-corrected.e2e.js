import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { ACCREDITATION_CORRECTED_WORK_ITEM } from '../support/seeded-fixtures.js'

/**
 * RA-691 — Migrate incorrectly generated references.
 *
 * Three approved 2027 renewals were issued the wrong accreditation reference.
 * A one-off management-be migration rewrote `payload.accreditationId` on
 * those three work items and recorded an `accreditation-number-corrected`
 * audit entry ({ from, to, reason: "RA-691" }) without changing state. It ran
 * once on prod on 2026-11-02 and was removed afterwards, but the entries it
 * wrote are permanent, so management-fe still renders them on the
 * Application history tab.
 *
 * AC under test: each corrected work item's Application history shows an
 * "Accreditation number corrected" entry with the old and new reference.
 *
 * No item this suite creates can carry such an entry. management-be's
 * `ReAccreditationTestOrganisationFixtures` instead seeds
 * `ACCREDITATION_CORRECTED_WORK_ITEM` in its corrected state, with an entry
 * carrying the same fields the migration wrote on prod, and resets it on
 * every start.
 * See test/support/seeded-fixtures.js. Nothing here changes the item, so the
 * spec passes on any number of runs between management-be restarts.
 *
 * Negative paths pinned, both visible to a regulator:
 *   - the incorrect reference no longer shows on the work item itself: the
 *     "Accreditation ID" row and the "Accreditation issued" panel both read
 *     `payload.accreditationId` live, so they must show only the corrected one;
 *   - the entry carries none of the work-item context rows (Org ID, Type,
 *     State, ...). management-fe excludes this action from that block, like
 *     `nation-corrected`, because the item's live state and assignee say
 *     nothing about a system correction and would misdescribe it.
 *
 * Not pinned: an entry missing `from` or `to`. management-fe guards each row
 * individually, but the migration always wrote all three fields and the seeded
 * fixture does the same, so no stored entry can take that branch;
 * management-fe's audit-log unit tests ("omits rows for absent fields") cover
 * it.
 */

const ACTION = 'accreditation-number-corrected'

const { id, incorrectAccreditationId, correctedAccreditationId } =
  ACCREDITATION_CORRECTED_WORK_ITEM

/**
 * The work-item context rows management-fe appends to most entries' "Show
 * details" disclosure (see audit-log-work-item-snapshot.e2e.js), and leaves off
 * this one.
 */
const CONTEXT_ROW_KEYS = [
  'Org ID',
  'Type',
  'State',
  'Submitted at',
  'Submitted by',
  'Last modified',
  'Assigned to'
]

describe('RA-691 accreditation number corrected', () => {
  before(async () => {
    // No nation role: a multi-nation user, so the seeded item is visible
    // whatever nation it routes to.
    await login.login()
    await workItems.openWorkItem(id)
  })

  after(async () => {
    await login.logout()
  })

  it('shows only the corrected accreditation number on the work item', async () => {
    const idRow = await detail.getAccreditationIdRow()
    const issuedPanelId = await detail.getAccreditationId()

    expect(idRow).toContain(correctedAccreditationId)
    expect(idRow).not.toContain(incorrectAccreditationId)
    expect(issuedPanelId).toContain(correctedAccreditationId)
    expect(issuedPanelId).not.toContain(incorrectAccreditationId)
  })

  describe('Application history', () => {
    before(async () => {
      await detail.gotoAudit()
      await detail.expandAllAuditEntryDetails()
    })

    it('shows one "Accreditation number corrected" entry', async () => {
      expect(await detail.auditEntryHeadings(ACTION)).toEqual([
        'Accreditation number corrected'
      ])
    })

    it('summarises the correction as old → new reference', async () => {
      expect(await detail.auditEntrySummaryLines(ACTION)).toEqual([
        `Accreditation number corrected — ${incorrectAccreditationId} → ${correctedAccreditationId}`
      ])
    })

    it('shows the previous and corrected references and the reason', async () => {
      await detail.assertAuditDetailRow(
        ACTION,
        'Previous accreditation number',
        incorrectAccreditationId
      )
      await detail.assertAuditDetailRow(
        ACTION,
        'Corrected accreditation number',
        correctedAccreditationId
      )
      await detail.assertAuditDetailRow(ACTION, 'Reason', 'RA-691')
    })

    it('shows no work-item context rows on the correction entry', async () => {
      await detail.assertNoAuditDetailRowKeys(ACTION, CONTEXT_ROW_KEYS)
    })
  })
})
