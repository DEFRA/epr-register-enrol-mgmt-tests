import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from '../support/backend-api.js'
import {
  ORGANISATION_RENAMED_WORK_ITEMS,
  isOrganisationNameMigrationEnabled
} from '../support/seeded-fixtures.js'

/**
 * RA-764 — Update org name for 500069 on 2027 accreditation data.
 *
 * Organisation 500069 was renamed in Re/Ex from "Encirc Ltd" to "VIDRALA UK &
 * IRELAND LIMITED", but its 2027 cases kept a stale copy of the old name. It
 * holds two registrations, so two cases: R26NR5000690003GR (Northern
 * Ireland, NIEA) and R26ER5002260055GR (England, EA). management-be adds a
 * gated, idempotent one-off migration that rewrites each case's
 * `payload.organisationName`, the only copy case management holds and the
 * field both search paths read. It records no audit entry and changes
 * nothing else.
 *
 * ACs under test, as a regulator sees them, for BOTH cases:
 *   - AC1: searching the Applications page for the new name finds both
 *     cases, and each shows the new name;
 *   - AC2: status, references and history are as they were: "Not started",
 *     unassigned, the same application reference, registration number and
 *     Org ID, and still no history entries;
 *   - AC3 (the part visible here): the migration has run on every start of
 *     the stack before the suite. Re-running it is pinned by management-be's
 *     migration unit tests, not here: the fixtures are reset to the old name
 *     before it runs.
 *
 * management-be seeds `ORGANISATION_RENAMED_WORK_ITEMS` under the OLD name
 * and resets them on every start; on the compose stack the migration is
 * enabled (docker/config/management-be.env) and runs after that reset. See
 * test/support/seeded-fixtures.js. Nothing here changes the items, so the
 * spec passes on any number of runs between restarts. Skipped where the
 * migration is not enabled (CDP test), where the items still carry the old
 * name.
 *
 * Also skipped, MERGE WINDOW ONLY, when the running management-be does not
 * seed both fixtures: until management-be's RA-764 scope fix reaches its
 * `latest` image, every journey run without a matching management-be branch
 * uses an image with at most the first item (on its old, wrong registration
 * number). The probe skips only on a 404 for a fixture id; once both items
 * exist every assertion below runs unchanged. The probe goes when this spec
 * is removed with the migration.
 *
 * Negative paths pinned, for both cases:
 *   - searching for the old name, whole or in part, finds neither case;
 *   - the old name appears nowhere on either case;
 *   - the rename added no history entry (the fixtures are seeded with none).
 *
 * Not pinned here: that other organisations are untouched. The migration is
 * keyed to 500069's organisation and registration numbers, which nothing else
 * this suite seeds or creates carries; management-be's unit tests cover the
 * non-matching cases.
 */

const describeIfMigrated = isOrganisationNameMigrationEnabled()
  ? describe
  : describe.skip

const fixtures = ORGANISATION_RENAMED_WORK_ITEMS

// Both cases share the organisation and its names; only the ids, references
// and registrations differ.
const [{ organisationName, previousOrganisationName }] = fixtures

/**
 * MERGE WINDOW ONLY. Whether the running management-be seeds every RA-764
 * fixture: true when each returns 200, false when any returns 404 (an image
 * from before the second, England, fixture was added). Any other status
 * throws, so a broken stack is never mistaken for an image that predates the
 * fixtures.
 */
async function areFixturesSeeded() {
  for (const { id } of fixtures) {
    const result = await managementBeRequest('GET', `/work-items/${id}`, {
      user: CASEWORKER_USER
    })
    if (result.status === 404) {
      return false
    }
    expectStatus(result, 200, `GET RA-764 fixture work item ${id}`)
  }
  return true
}

describeIfMigrated('RA-764 organisation renamed for 500069', () => {
  let loggedIn = false

  // A function, not an arrow: `this.skip()` needs Mocha's hook context.
  before(async function () {
    if (!(await areFixturesSeeded())) {
      // eslint-disable-next-line no-console -- say WHY the suite was skipped in the run log
      console.warn(
        'RA-764 fixtures not seeded by this management-be image — skipping'
      )
      this.skip()
    }
    // No nation role: a multi-nation user, so both the Northern Ireland and
    // the England item are visible.
    await login.login()
    loggedIn = true
  })

  after(async () => {
    // Mocha still runs `after` when `before` skipped the suite.
    if (loggedIn) {
      await login.logout()
    }
  })

  describe('Applications page search', () => {
    beforeEach(async () => {
      // An explicit empty filter state, so no default ("assigned to me") or
      // earlier search can exclude the unassigned seeded items.
      await workItems.resetFilters()
    })

    it('finds both cases, and only them, by the new name, ampersand included', async () => {
      await workItems.searchByOrgName(organisationName)

      expect(await workItems.getWorkItemCount()).toBe(fixtures.length)
      for (const { id } of fixtures) {
        await expect(workItems.workItemLink(id)).toBeDisplayed()
        await expect(workItems.tileField(id, 'org-name')).toHaveText(
          organisationName
        )
      }
    })

    it('lists each case with its Org ID and registration number unchanged', async () => {
      await workItems.searchByOrgName(organisationName)

      for (const { id, organisationId, registrationNumber } of fixtures) {
        await expect(workItems.tileField(id, 'org-id')).toHaveText(
          organisationId
        )
        await expect(workItems.tileRegistrationNumber(id)).toHaveText(
          registrationNumber
        )
      }
    })

    it('finds both cases by part of the new name, in any case', async () => {
      await workItems.searchByOrgName('vidrala')

      for (const { id } of fixtures) {
        await expect(workItems.workItemLink(id)).toBeDisplayed()
      }
    })

    it('no longer finds either case by its old name', async () => {
      await workItems.searchByOrgName(previousOrganisationName)

      for (const { id } of fixtures) {
        await expect(workItems.workItemLink(id)).not.toBeExisting()
      }
      expect(await workItems.getWorkItemCount()).toBe(0)
    })

    it('no longer finds either case by part of its old name', async () => {
      await workItems.searchByOrgName('encirc')

      for (const { id } of fixtures) {
        await expect(workItems.workItemLink(id)).not.toBeExisting()
      }
      expect(await workItems.getWorkItemCount()).toBe(0)
    })
  })

  for (const {
    id,
    applicationReference,
    organisationId,
    registrationNumber,
    regulator,
    status,
    stateId
  } of fixtures) {
    describe(`the ${regulator} case ${registrationNumber}`, () => {
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
  }
})
