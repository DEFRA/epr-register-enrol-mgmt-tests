import { expect } from '@wdio/globals'
import {
  adminUiRequest,
  expectStatus,
  isAdminUiCallerEnabled,
  managementBeRequest
} from '../support/backend-api.js'
import {
  ACCREDITATION_CORRECTED_WORK_ITEM,
  ARCHIVED_WORK_ITEM
} from '../support/seeded-fixtures.js'
import { uniqueOrganisationName } from '../support/unique-name.js'
import {
  assignWorkItemViaApi,
  createWorkItemViaApi,
  listWorkItemsViaApi
} from '../support/work-item-api.js'

/**
 * RA-751 — Search Case management information (epic RA-639).
 *
 * The internal Admin UI gets a "Case management" tab that searches work
 * items through management-be's `GET /work-items`: filters for state, work
 * item type, nation, material, assigned or unassigned and archived or not,
 * and a free-text search over the work item ID, the accreditation ID or RA-
 * reference, the organisation ID and the organisation name. management-be
 * adds what that needs, for every caller:
 *
 *   - `q`: a case-insensitive substring match on the work item id,
 *     `accreditationId`, `applicationReference` (the ticket's "RA-
 *     reference"), `operatorOrganisationId` and `organisationName`; blank
 *     means no filter;
 *   - `assigned=true|false`: has an assignee or not; any other value, or
 *     combined with `unassigned` or `assigneeId`, is a 400;
 *   - `archived=true|false`: `payload.archivedAt` set or not; any other value
 *     is a 400;
 *   - `GET /work-items/re-accreditation/states`: each state of the
 *     re-accreditation workflow, in workflow order, with what management-be
 *     pushes to the Operator journey when an item enters it.
 *
 * and registers the Admin UI as a READ-ONLY caller: it may GET only those
 * two routes, and every other request it sends, read or write, is refused
 * with a 403 ProblemDetails.
 *
 * management-fe does not change, so this is asserted against management-be
 * directly, as the suite's own caller (`epr-register-enrol-mgmt-tests`) and,
 * where the run may hold the Admin UI's secret, as the Admin UI (see
 * test/support/backend-api.js). The Admin UI's own pages are not here: the
 * Admin UI does not run on this suite's stack.
 *
 * Each run creates two `submitted` England plastic items whose organisation
 * names share a prefix unique to the run, and assigns one of them, so every
 * search below is scoped to items only this run holds. The archived and
 * accreditation-id cases use items management-be seeds (seeded-fixtures.js),
 * because no API can archive an item or mint an accreditation id on one the
 * suite created.
 */

// The states in workflow order, each with the status the case management
// UI shows for it and what management-be pushes to the Operator journey when
// an item enters it.
const RE_ACCREDITATION_STATES = [
  ['submitted', 'Not started', false, 'status'],
  ['duly-made', 'Duly made', false, 'status'],
  ['assessment-started', 'Duly made', false, 'none'],
  ['assessment-in-progress', 'Updated', false, 'status'],
  ['awaiting-decision', 'Awaiting decision', false, 'status'],
  ['queried', 'Queried', false, 'query'],
  ['updated', 'Updated', false, 'status'],
  ['approved-pending-contact', 'Approved', false, 'none'],
  ['approved', 'Granted', true, 'status'],
  ['rejected-pending-contact', 'Refused', false, 'none'],
  ['rejected', 'Refused', true, 'status'],
  ['withdrawn', 'Withdrawn', true, 'none']
].map(([id, displayName, isTerminal, operatorJourneyPush]) => ({
  id,
  displayName,
  isTerminal,
  operatorJourneyPush
}))

/** The ids of the items a 200 `GET /work-items` returned for `params`. */
async function searchIds(params) {
  const { body } = expectStatus(
    await listWorkItemsViaApi({ pageSize: '50', ...params }),
    200,
    `GET /work-items?${new URLSearchParams(params)}`
  )
  return body.items.map((item) => item.id)
}

/** Assert management-be refused the Admin UI's request as forbidden. */
function expectForbidden({ status, headers }) {
  expect(status).toBe(403)
  expect(headers.get('content-type')).toContain('application/problem+json')
}

/** Assert `GET /work-items` refuses `params` with a 400 naming `key`. */
async function expectInvalidQuery(params, key) {
  const { status, body } = await listWorkItemsViaApi(params)
  expect(status).toBe(400)
  expect(body.title).toBe('Invalid query')
  expect(Object.keys(body.errors)).toEqual([key])
}

describe('RA-751 Case management search', () => {
  // Unique to this run; each item's own name adds a further suffix to it.
  const runPrefix = uniqueOrganisationName('RA-751 search')
  let assigned
  let unassigned

  before(async () => {
    assigned = await createWorkItemViaApi({
      organisationNamePrefix: runPrefix
    })
    unassigned = await createWorkItemViaApi({
      organisationNamePrefix: runPrefix
    })
    await assignWorkItemViaApi(assigned.id)
  })

  describe('free-text search (q)', () => {
    it('matches the organisation name, in any case, as a substring', async () => {
      const ids = await searchIds({ q: runPrefix.slice(3).toLowerCase() })
      expect(ids.sort()).toEqual([assigned.id, unassigned.id].sort())
    })

    it('matches the work item id as a substring', async () => {
      const ids = await searchIds({
        q: assigned.id.slice(4, 28).toUpperCase()
      })
      expect(ids).toEqual([assigned.id])
    })

    // The ticket calls it the "RA- reference"; this stack generates `AP…`
    // application references (RA-318), so this searches for the one
    // management-be gave the item rather than a hard-coded prefix.
    it('matches the application reference', async () => {
      const ids = await searchIds({
        q: assigned.applicationReference.toLowerCase()
      })
      expect(ids).toEqual([assigned.id])
    })

    it('matches the organisation ID', async () => {
      const ids = await searchIds({
        q: unassigned.operatorOrganisationId.toUpperCase()
      })
      expect(ids).toEqual([unassigned.id])
    })

    it('matches the accreditation ID as a substring', async () => {
      const { id, correctedAccreditationId } = ACCREDITATION_CORRECTED_WORK_ITEM
      const ids = await searchIds({
        q: correctedAccreditationId.slice(3, 13).toLowerCase()
      })
      expect(ids).toEqual([id])
    })

    it('finds nothing when no field matches', async () => {
      const ids = await searchIds({ q: `${runPrefix} no such item` })
      expect(ids).toEqual([])
    })

    it('treats a blank search as no search', async () => {
      const ids = await searchIds({
        orgName: assigned.organisationName,
        q: '   '
      })
      expect(ids).toEqual([assigned.id])
    })

    it('narrows alongside the state, type, nation and material filters', async () => {
      const filters = {
        q: runPrefix,
        stateId: 'submitted',
        typeId: 're-accreditation',
        material: 'plastic'
      }
      expect(
        (await searchIds({ ...filters, nation: 'England' })).sort()
      ).toEqual([assigned.id, unassigned.id].sort())
      expect(await searchIds({ ...filters, nation: 'Wales' })).toEqual([])
    })
  })

  describe('assigned filter', () => {
    it('assigned=true returns only items with an assignee', async () => {
      expect(await searchIds({ q: runPrefix, assigned: 'true' })).toEqual([
        assigned.id
      ])
    })

    it('assigned=false returns only items with no assignee', async () => {
      expect(await searchIds({ q: runPrefix, assigned: 'false' })).toEqual([
        unassigned.id
      ])
    })

    it('refuses a value other than true or false', async () => {
      await expectInvalidQuery({ assigned: 'yes' }, 'assigned')
    })

    it('refuses assigned combined with unassigned', async () => {
      await expectInvalidQuery(
        { assigned: 'true', unassigned: 'true' },
        'assigned'
      )
    })

    it('refuses assigned combined with assigneeId', async () => {
      await expectInvalidQuery(
        { assigned: 'false', assigneeId: 'stub-caseworker-one' },
        'assigned'
      )
    })
  })

  describe('archived filter', () => {
    it('archived=true returns an archived item and no unarchived one', async () => {
      expect(
        await searchIds({ q: ARCHIVED_WORK_ITEM.operatorOrganisationId })
      ).toEqual([ARCHIVED_WORK_ITEM.id])
      expect(
        await searchIds({
          q: ARCHIVED_WORK_ITEM.operatorOrganisationId,
          archived: 'true'
        })
      ).toEqual([ARCHIVED_WORK_ITEM.id])
      expect(await searchIds({ q: runPrefix, archived: 'true' })).toEqual([])
    })

    it('archived=false returns unarchived items and no archived one', async () => {
      expect(
        (await searchIds({ q: runPrefix, archived: 'false' })).sort()
      ).toEqual([assigned.id, unassigned.id].sort())
      expect(
        await searchIds({
          q: ARCHIVED_WORK_ITEM.operatorOrganisationId,
          archived: 'false'
        })
      ).toEqual([])
    })

    it('refuses a value other than true or false', async () => {
      await expectInvalidQuery({ archived: 'maybe' }, 'archived')
    })
  })

  describe('re-accreditation states', () => {
    it('lists every state in workflow order with its Operator journey push', async () => {
      const { body } = expectStatus(
        await managementBeRequest('GET', '/work-items/re-accreditation/states'),
        200,
        'GET /work-items/re-accreditation/states'
      )
      expect(body.typeId).toBe('re-accreditation')
      expect(body.templateVersion).toEqual(expect.any(String))
      expect(body.states).toEqual(RE_ACCREDITATION_STATES)
    })
  })

  // Skipped where the run may not hold the Admin UI's secret (CDP).
  const describeIfAdminUi = isAdminUiCallerEnabled() ? describe : describe.skip

  describeIfAdminUi('the Admin UI caller is read-only', () => {
    it('may search work items', async () => {
      const { body } = expectStatus(
        await adminUiRequest(
          'GET',
          `/work-items?${new URLSearchParams({ q: runPrefix, assigned: 'true' })}`
        ),
        200,
        'Admin UI GET /work-items'
      )
      expect(body.items.map((item) => item.id)).toEqual([assigned.id])
    })

    it('may read the re-accreditation states', async () => {
      expectStatus(
        await adminUiRequest('GET', '/work-items/re-accreditation/states'),
        200,
        'Admin UI GET /work-items/re-accreditation/states'
      )
    })

    it('may not read a single work item', async () => {
      expectForbidden(
        await adminUiRequest('GET', `/work-items/${unassigned.id}`)
      )
    })

    it('may not create a work item', async () => {
      expectForbidden(
        await adminUiRequest('POST', '/work-items', {
          body: {
            typeId: 're-accreditation',
            source: 'mgmt-tests',
            payload: {}
          }
        })
      )
    })

    it('may not assign a work item, which stays unassigned', async () => {
      expectForbidden(
        await adminUiRequest('POST', `/work-items/${unassigned.id}/assign`, {
          body: { assigneeId: 'stub-admin', assigneeName: 'Stub Admin' }
        })
      )
      expect(
        await searchIds({
          q: unassigned.operatorOrganisationId,
          assigned: 'false'
        })
      ).toEqual([unassigned.id])
    })

    it('may not apply a work item action', async () => {
      expectForbidden(
        await adminUiRequest(
          'POST',
          `/work-items/${unassigned.id}/actions/duly-make`
        )
      )
    })

    // management-be's only PATCH route; it has no PUT or DELETE routes.
    it('may not PATCH a work item', async () => {
      expectForbidden(
        await adminUiRequest(
          'PATCH',
          `/work-items/re-accreditation/${unassigned.id}/overseas-sites/site-1/recycling-operations`,
          { body: {} }
        )
      )
    })

    // Only where the stack checks signatures; a Development stack trusts
    // the headers and accepts any.
    const itIfSigned = process.env.ADMIN_UI_SHARED_SECRET ? it : it.skip

    itIfSigned('is refused when signed with the wrong secret', async () => {
      const { status } = await adminUiRequest('GET', '/work-items', {
        sharedSecret: 'not-the-admin-ui-secret'
      })
      expect(status).toBe(401)
    })
  })
})
