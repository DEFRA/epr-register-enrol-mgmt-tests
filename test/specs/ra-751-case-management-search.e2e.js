import { expect } from '@wdio/globals'
import {
  CASEWORKER_USER,
  MGMT_TESTS_CLIENT_ID,
  adminUiRequest,
  expectStatus,
  isAdminUiCallerEnabled,
  managementBeRequest
} from '../support/backend-api.js'
import { uniqueOrganisationIdGroup } from '../support/operator-backend-api.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  ACCREDITATION_CORRECTED_WORK_ITEM,
  ARCHIVED_WORK_ITEM
} from '../support/seeded-fixtures.js'
import { uniqueOrganisationName } from '../support/unique-name.js'
import {
  assignWorkItemViaApi,
  buildWorkItemSubmission,
  createWorkItemViaApi,
  dulyMakeViaApi,
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
 *     means no filter; over 100 characters (after trimming) or sent twice is
 *     a 400;
 *   - `assigned=true|false`: has an assignee or not; any other value, or
 *     combined with `unassigned` or `assigneeId`, is a 400;
 *   - `archived=true|false`: `payload.archivedAt` set or not; any other value
 *     is a 400;
 *   - `sort=last-modified`: newest `lastModifiedAt` first by default or
 *     with `dir=desc`, oldest first with `dir=asc`; an unknown `sort` or
 *     `dir` is a 400;
 *   - `GET /work-items/re-accreditation/states`: each state of the
 *     re-accreditation workflow, in workflow order, with what management-be
 *     pushes to the Operator journey when an item enters it.
 *
 * and registers the Admin UI as a READ-ONLY caller: it may GET those two
 * routes, and every write it sends is refused with a 403 ProblemDetails.
 * (RA-752 opens the single work item reads to it too; those are covered in
 * ra-752-view-case-management.e2e.js.) Its search results carry only the
 * fields it shows (id, type, state, last changed, assignee, application
 * reference, organisation ID and name); every other caller still gets the
 * full item. A stored one of those payload fields that is not a string
 * comes back as null for that item, rather than failing the page. Its user
 * name header, percent-encoded, may be as long as the longest Entra ID
 * display name becomes when encoded.
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
  // Entering it to await a decision is not pushed; returning to it from a
  // continued review is.
  ['awaiting-decision', 'Awaiting decision', false, 'partial'],
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

/**
 * `value` without its first and last characters: neither a prefix nor a
 * suffix of it, so only a substring match finds `value` by it.
 */
const innerSubstring = (value) => value.slice(1, -1)

/** The ids of the items a 200 `GET /work-items` returned for `params`. */
async function searchIds(params) {
  const { body } = expectStatus(
    await listWorkItemsViaApi({ pageSize: '50', ...params }),
    200,
    `GET /work-items?${new URLSearchParams(params)}`
  )
  return body.items.map((item) => item.id)
}

/** The body of the Admin UI's `GET path`, which must answer 200. */
async function adminUiGet(path, options) {
  const { body } = expectStatus(
    await adminUiRequest('GET', path, options),
    200,
    `Admin UI GET ${path}`
  )
  return body
}

/** The body of the Admin UI's `GET /work-items` with the query `params`. */
const adminUiSearch = (params, options) =>
  adminUiGet(`/work-items?${new URLSearchParams(params)}`, options)

/** Assert management-be refused the Admin UI's request as forbidden. */
function expectForbidden({ status, headers }) {
  expect(status).toBe(403)
  expect(headers.get('content-type')).toContain('application/problem+json')
}

/** The parts of a work item any write would change. */
const writableView = ({
  stateId,
  lastModifiedAt,
  assignedToId,
  payload,
  auditLog
}) => ({ stateId, lastModifiedAt, assignedToId, payload, auditLog })

/**
 * Assert that the read-only gate, and nothing else, refuses the Admin UI's
 * `method` `path` with `body` on the work item `workItemId`:
 *
 *   1. the Admin UI's request is a 403 ProblemDetails, and the work item
 *      reads the same afterwards as before;
 *   2. the very same request from this suite, a caller that is not
 *      read-only, acting as `user`, then answers `allowedStatus`.
 *
 * (2) is what makes (1) prove the gate: management-be accepts the request on
 * its own terms (the item's state, the body, the user's role and nation), so
 * the 403 is not a refusal every caller would get. The Admin UI's request
 * carries `user`'s role and nation when it has them, so a handler's own role
 * or nation check cannot be what refused it either. Returns the work item as
 * it reads after (2).
 */
async function expectOnlyTheGateRefuses(
  workItemId,
  { method, path, body, user = CASEWORKER_USER, allowedStatus = 200 }
) {
  const before = writableView(await getWorkItem(workItemId))
  expectForbidden(
    await adminUiRequest(method, path, {
      body,
      role: user.role,
      nation: user.nation
    })
  )
  expect(writableView(await getWorkItem(workItemId))).toEqual(before)
  expectStatus(
    await managementBeRequest(method, path, { body, user }),
    allowedStatus,
    `${method} ${path} as ${user.id}, not read-only`
  )
  return getWorkItem(workItemId)
}

/** Assert `GET /work-items` refuses `params` with a 400 naming `key`. */
async function expectInvalidQuery(params, key) {
  const { status, body } = await listWorkItemsViaApi(params)
  expect(status).toBe(400)
  expect(body.title).toBe('Invalid query')
  expect(Object.keys(body.errors)).toEqual([key])
}

// Skipped where the run may not hold the Admin UI's secret (CDP), and where
// a stack does not enable it: the monorepo root's compose.yml runs
// wdio.conf.js with ADMIN_UI_CALLER_ENABLED unset. Said in the run log, so a
// run that skipped it cannot pass for one that ran it.
const describeIfAdminUi = isAdminUiCallerEnabled() ? describe : describe.skip
if (!isAdminUiCallerEnabled()) {
  // eslint-disable-next-line no-console -- say WHY the block is skipped in the run log
  console.warn(
    'RA-751: ADMIN_UI_CALLER_ENABLED is not "true", so "the Admin UI caller is read-only" is SKIPPED. Set it to "true" (and ADMIN_UI_SHARED_SECRET to management-be\'s AUTH_SHARED_SECRET__ADMIN_UI where that is set) to run it.'
  )
}

// Only where the stack checks signatures; a Development stack trusts the
// headers and accepts any. Said in the run log too.
const isAdminUiSigned = Boolean(process.env.ADMIN_UI_SHARED_SECRET)
if (isAdminUiCallerEnabled() && !isAdminUiSigned) {
  // eslint-disable-next-line no-console -- say WHY the test is skipped in the run log
  console.warn(
    'RA-751: ADMIN_UI_SHARED_SECRET is not set, so "is refused when signed with the wrong secret" is SKIPPED.'
  )
}

// An Entra ID display name is at most 256 characters, and the Admin UI sends
// it through `encodeURIComponent`, which turns "€" (3 bytes in UTF-8) into
// "%E2%82%AC", 9 characters, the most any one character becomes. So this is
// the longest user name header the Admin UI can send: 2,304 characters.
const LONGEST_ENTRA_DISPLAY_NAME = '€'.repeat(256)

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

  it('gives this suite, a caller that is not read-only, the full item', async () => {
    const { body } = expectStatus(
      await listWorkItemsViaApi({ q: runPrefix, assigned: 'true' }),
      200,
      'GET /work-items as mgmt-tests'
    )
    const [item] = body.items
    expect(item.id).toBe(assigned.id)
    // management-be records the submitting caller's client id.
    expect(item.submittedBy).toBe(MGMT_TESTS_CLIENT_ID)
    expect(item.submittedAt).toEqual(expect.any(String))
    expect(item.payload.operatorEmail).toBe(assigned.payload.operatorEmail)
  })

  describe('free-text search (q)', () => {
    it('matches the organisation name, in any case, as a substring', async () => {
      const ids = await searchIds({
        q: innerSubstring(runPrefix).toLowerCase()
      })
      expect(ids.sort()).toEqual([assigned.id, unassigned.id].sort())
    })

    it('matches the work item id as a substring', async () => {
      const ids = await searchIds({
        q: innerSubstring(assigned.id).toUpperCase()
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
        q: innerSubstring(correctedAccreditationId).toLowerCase()
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

    it('accepts a search of 100 characters, not counting surrounding spaces', async () => {
      expect(await searchIds({ q: ` ${'x'.repeat(100)} ` })).toEqual([])
    })

    it('refuses a search longer than 100 characters', async () => {
      await expectInvalidQuery({ q: 'x'.repeat(101) }, 'q')
    })

    it('refuses a search sent more than once', async () => {
      await expectInvalidQuery(
        new URLSearchParams([
          ['q', runPrefix],
          ['q', 'other']
        ]),
        'q'
      )
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

  describe('last-modified sort', () => {
    // The assign in `before` came after both items were created, so the item
    // created FIRST is the more recently changed: only an order by
    // lastModifiedAt, not by submission, puts it first.
    it('sort=last-modified returns the most recently changed first', async () => {
      expect(await searchIds({ q: runPrefix, sort: 'last-modified' })).toEqual([
        assigned.id,
        unassigned.id
      ])
    })

    it('dir=desc returns the most recently changed first', async () => {
      expect(
        await searchIds({ q: runPrefix, sort: 'last-modified', dir: 'desc' })
      ).toEqual([assigned.id, unassigned.id])
    })

    it('dir=asc returns the least recently changed first', async () => {
      expect(
        await searchIds({ q: runPrefix, sort: 'last-modified', dir: 'asc' })
      ).toEqual([unassigned.id, assigned.id])
    })

    it('refuses a sort sent more than once', async () => {
      await expectInvalidQuery(
        new URLSearchParams([
          ['sort', 'last-modified'],
          ['sort', 'status']
        ]),
        'sort'
      )
    })

    it('refuses a direction sent more than once', async () => {
      await expectInvalidQuery(
        new URLSearchParams([
          ['sort', 'last-modified'],
          ['dir', 'asc'],
          ['dir', 'desc']
        ]),
        'dir'
      )
    })

    it('refuses an unknown sort', async () => {
      await expectInvalidQuery({ sort: 'last-changed' }, 'sort')
    })

    it('refuses a direction other than asc or desc', async () => {
      await expectInvalidQuery({ sort: 'last-modified', dir: 'newest' }, 'dir')
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

  describeIfAdminUi('the Admin UI caller is read-only', () => {
    it('may search work items, seeing only the fields it needs', async () => {
      const body = await adminUiSearch({ q: runPrefix, assigned: 'true' })
      expect(Object.keys(body).sort()).toEqual(
        ['items', 'page', 'pageSize', 'totalCount'].sort()
      )
      expect(body.items).toEqual([
        {
          id: assigned.id,
          typeId: 're-accreditation',
          stateId: 'submitted',
          lastModifiedAt: expect.any(String),
          assignedToId: CASEWORKER_USER.id,
          assignedToName: CASEWORKER_USER.name,
          payload: {
            applicationReference: assigned.applicationReference,
            operatorOrganisationId: assigned.operatorOrganisationId,
            organisationName: assigned.organisationName
          }
        }
      ])
    })

    it('may search with a user name outside ASCII', async () => {
      const body = await adminUiSearch(
        { q: runPrefix, assigned: 'true' },
        { userName: 'Siobhán O’Brien' }
      )
      expect(body.items.map((item) => item.id)).toEqual([assigned.id])
    })

    it('may search with the longest non-ASCII user name Entra ID allows', async () => {
      const body = await adminUiSearch(
        { q: runPrefix, assigned: 'true' },
        { userName: LONGEST_ENTRA_DISPLAY_NAME }
      )
      expect(body.items.map((item) => item.id)).toEqual([assigned.id])
    })

    it('is refused a user name longer than Entra ID allows', async () => {
      const { status } = await adminUiRequest(
        'GET',
        `/work-items?${new URLSearchParams({ q: runPrefix })}`,
        { userName: `${LONGEST_ENTRA_DISPLAY_NAME}€` }
      )
      expect(status).toBe(401)
    })

    it('may sort its search by last modified, newest first', async () => {
      const body = await adminUiSearch({
        q: runPrefix,
        sort: 'last-modified',
        dir: 'desc'
      })
      expect(body.items.map((item) => item.id)).toEqual([
        assigned.id,
        unassigned.id
      ])
    })

    // A stored field of the wrong type comes in through POST /work-items,
    // which does not check the types of these fields. It costs the Admin UI
    // that one field of that one item, not the page.
    it('gets null for a stored field that is not a string, and the rest of the page', async () => {
      const group = uniqueOrganisationIdGroup()
      const wellFormed = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-751 well-formed',
        fields: { operatorOrganisationId: `${group}well-formed` }
      })
      const malformed = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-751 malformed',
        fields: {
          operatorOrganisationId: `${group}malformed`,
          organisationName: 751
        }
      })
      // Stored as sent: a caller that is not read-only gets the number.
      expect((await getWorkItem(malformed.id)).payload.organisationName).toBe(
        751
      )

      const { items } = await adminUiSearch({ q: group })
      const payloadOf = (id) => items.find((item) => item.id === id)?.payload
      expect(items).toHaveLength(2)
      expect(payloadOf(malformed.id)).toEqual({
        applicationReference: malformed.applicationReference,
        operatorOrganisationId: malformed.operatorOrganisationId,
        organisationName: null
      })
      expect(payloadOf(wellFormed.id)).toEqual({
        applicationReference: wellFormed.applicationReference,
        operatorOrganisationId: wellFormed.operatorOrganisationId,
        organisationName: wellFormed.organisationName
      })
    })

    it('may read the re-accreditation states', async () => {
      const body = await adminUiGet('/work-items/re-accreditation/states')
      expect(body.typeId).toBe('re-accreditation')
      expect(body.states).toEqual(RE_ACCREDITATION_STATES)
    })

    // Each refused write below is one management-be accepts from a caller
    // that is not read-only (see expectOnlyTheGateRefuses), on an item of its
    // own, so the writes that this suite then makes change nothing the
    // searches above rely on.

    it('may not create a work item, which a caller that is not read-only may', async () => {
      const submission = buildWorkItemSubmission({
        organisationNamePrefix: 'RA-751 refused create'
      })
      const { organisationName } = submission.payload
      expectForbidden(
        await adminUiRequest('POST', '/work-items', { body: submission })
      )
      expect(await searchIds({ q: organisationName })).toEqual([])

      expectStatus(
        await managementBeRequest('POST', '/work-items', { body: submission }),
        201,
        'the same submission as mgmt-tests'
      )
      expect(await searchIds({ q: organisationName })).toHaveLength(1)
    })

    it('may not assign a work item, which a caseworker may', async () => {
      const { id } = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-751 refused assign'
      })
      const after = await expectOnlyTheGateRefuses(id, {
        method: 'POST',
        path: `/work-items/${id}/assign`,
        body: {
          assigneeId: CASEWORKER_USER.id,
          assigneeName: CASEWORKER_USER.name
        }
      })
      expect(after.assignedToId).toBe(CASEWORKER_USER.id)
    })

    // `start-assessment` is the action a caller may apply through this
    // route from `duly-made` (`duly-make` itself has its own route).
    it('may not apply a work item action, which a caseworker may', async () => {
      const { id } = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-751 refused action'
      })
      await dulyMakeViaApi(id)
      const after = await expectOnlyTheGateRefuses(id, {
        method: 'POST',
        path: `/work-items/${id}/actions/start-assessment`
      })
      expect(after.stateId).toBe('assessment-started')
    })

    // management-be's only PATCH route; it has no PUT or DELETE routes. Its
    // handler answers 403 itself to a user without the `standard` role or
    // from another nation, so both requests carry that role and the item's
    // nation. The request then gets past every check management-be makes and
    // on to the operator journey backend, which holds no application for
    // an item this suite created, so it answers 404. That proves the 403 is
    // the gate's; a 200 would need an exporter application with an overseas
    // site, which the operator backend only seeds from ReEx data.
    it('may not PATCH a work item, which a standard caseworker of its nation may', async () => {
      const { id } = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-751 refused PATCH'
      })
      await expectOnlyTheGateRefuses(id, {
        method: 'PATCH',
        path: `/work-items/re-accreditation/${id}/overseas-sites/1/recycling-operations`,
        body: { operationCodes: ['R3'] },
        user: { ...CASEWORKER_USER, role: 'standard', nation: 'England' },
        allowedStatus: 404
      })
    })

    const itIfSigned = isAdminUiSigned ? it : it.skip

    itIfSigned('is refused when signed with the wrong secret', async () => {
      const { status } = await adminUiRequest('GET', '/work-items', {
        sharedSecret: 'not-the-admin-ui-secret'
      })
      expect(status).toBe(401)
    })
  })
})
