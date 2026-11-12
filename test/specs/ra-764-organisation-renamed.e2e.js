import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  ORGANISATION_RENAMED_WORK_ITEM,
  isOrganisationNameMigrationEnabled
} from '../support/seeded-fixtures.js'

/**
 * RA-764 — Update org name for 500069 on 2027 accreditation data.
 *
 * Organisation 500069 was renamed in Re/Ex from "Encirc Ltd" to "VIDRALA UK &
 * IRELAND LIMITED", but its 2027 case kept a stale copy of the old name.
 * management-be adds a gated, idempotent one-off migration that rewrites the
 * case's `payload.organisationName`, the only copy case management holds and
 * the field both search paths read. It records no audit entry and changes
 * nothing else.
 *
 * ACs under test, as a regulator sees them:
 *   - AC1: searching the Applications page for the new name finds the case,
 *     and the case shows the new name;
 *   - AC2: status, references and history are as they were: "Not started",
 *     unassigned, the same application reference, registration number and
 *     Org ID, and still no history entries;
 *   - AC3 (the part visible here): the migration has run on every start of
 *     the stack before the suite, so the case is in its re-run state.
 *
 * management-be seeds `ORGANISATION_RENAMED_WORK_ITEM` under the OLD name and
 * resets it on every start; on the compose stack the migration is enabled
 * (docker/config/management-be.env) and runs after that reset. See
 * test/support/seeded-fixtures.js. Nothing here changes the item, so the spec
 * passes on any number of runs between restarts. Skipped where the migration
 * is not enabled (CDP test), where the item still carries the old name.
 *
 * Negative paths pinned:
 *   - searching for the old name, whole or in part, no longer finds the case;
 *   - the old name appears nowhere on the case;
 *   - the rename added no history entry (the fixture is seeded with none).
 *
 * Not pinned here: that other organisations are untouched. The migration is
 * keyed to 500069's organisation and registration numbers, which nothing else
 * this suite seeds or creates carries; management-be's unit tests cover the
 * non-matching cases.
 */

const describeIfMigrated = isOrganisationNameMigrationEnabled()
  ? describe
  : describe.skip

const {
  id,
  applicationReference,
  organisationId,
  registrationNumber,
  previousOrganisationName,
  organisationName,
  status,
  stateId
} = ORGANISATION_RENAMED_WORK_ITEM

describeIfMigrated('RA-764 organisation renamed for 500069', () => {
  before(async () => {
    // No nation role: a multi-nation user, so the seeded Northern Ireland
    // item is visible.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('Applications page search', () => {
    beforeEach(async () => {
      // An explicit empty filter state, so no default ("assigned to me") or
      // earlier search can exclude the unassigned seeded item.
      await workItems.resetFilters()
    })

    it('finds the case by its new name, ampersand included', async () => {
      await workItems.searchByOrgName(organisationName)

      await expect(workItems.workItemLink(id)).toBeDisplayed()
      expect(await workItems.getWorkItemCount()).toBe(1)
      await expect(workItems.tileField(id, 'org-name')).toHaveText(
        organisationName
      )
    })

    it('lists the case with its Org ID and registration number unchanged', async () => {
      await workItems.searchByOrgName(organisationName)

      await expect(workItems.tileField(id, 'org-id')).toHaveText(organisationId)
      await expect(workItems.tileRegistrationNumber(id)).toHaveText(
        registrationNumber
      )
    })

    it('finds the case by part of the new name, in any case', async () => {
      await workItems.searchByOrgName('vidrala')

      await expect(workItems.workItemLink(id)).toBeDisplayed()
    })

    it('no longer finds the case by its old name', async () => {
      await workItems.searchByOrgName(previousOrganisationName)

      await expect(workItems.workItemLink(id)).not.toBeExisting()
      expect(await workItems.getWorkItemCount()).toBe(0)
    })

    it('no longer finds the case by part of its old name', async () => {
      await workItems.searchByOrgName('encirc')

      await expect(workItems.workItemLink(id)).not.toBeExisting()
      expect(await workItems.getWorkItemCount()).toBe(0)
    })
  })

  describe('the case', () => {
    before(async () => {
      await workItems.openWorkItem(id)
    })

    it('shows the new organisation name in the case header', async () => {
      await expect(detail.caseHeaderField('orgName')).toHaveText(
        organisationName
      )
    })

    it('shows the old organisation name nowhere', async () => {
      expect(await detail.mainText()).not.toContain(previousOrganisationName)
    })

    it('keeps its application reference, Org ID and registration number', async () => {
      await expect(detail.caseHeaderField('accreditationRef')).toHaveText(
        expect.stringContaining(applicationReference)
      )
      await expect(detail.caseHeaderField('orgId')).toHaveText(organisationId)
      await expect(detail.caseHeaderField('registrationNumber')).toHaveText(
        expect.stringContaining(registrationNumber)
      )
    })

    it('keeps its status and assignment', async () => {
      await detail.assertStateId(stateId)
      await detail.assertState(status)
      await detail.assertUnassigned()
    })

    it('has no history entries: the rename is not audited', async () => {
      await detail.gotoAudit()
      await detail.assertNoAuditEntries()
    })
  })
})
