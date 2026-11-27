import { randomUUID } from 'node:crypto'

import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  adminUiRequest,
  CASEWORKER_USER,
  expectStatus,
  managementBeRequest
} from '../support/backend-api.js'
import {
  describeIfAdminUi,
  expectForbidden,
  expectOnlyTheGateRefuses
} from '../support/admin-ui-caller.js'
import { getWorkItem } from '../support/decision-api.js'
import { waitForStatusPushes } from '../support/status-push-audit.js'
import {
  assignWorkItemViaApi,
  createWorkItemViaApi,
  dulyMakeViaApi
} from '../support/work-item-api.js'

/**
 * RA-752 — View Case management information (epic RA-639).
 *
 * The internal Admin UI gets a page for one work item: a Document tab with
 * the work item as JSON (payload, notes and audit log, including the status
 * pushes to the Operator journey) and a Regulator view laid out as
 * management-fe shows it, including the prior year.
 *
 * After RA-751 management-be let the Admin UI, its READ-ONLY caller, GET only
 * `/work-items` and `/work-items/re-accreditation/states`. RA-752 opts in the
 * two reads that page needs:
 *
 *   - `GET /work-items/{id}`;
 *   - `GET /work-items/re-accreditation/{id}/prior-year`.
 *
 * Each answers the Admin UI as it answers a caseworker. Their failures are
 * ProblemDetails whose `errorCode` tells the Admin UI what happened, because
 * it shows "not found" only for the code it expects and an "unavailable"
 * banner for anything else:
 *
 *   - no work item with that id: 404 `work-item-not-found`, on both routes;
 *   - a work item with no prior year (ReEx has no record of its
 *     organisation, it has no ReEx identifiers, or it stores no accreditation
 *     year): prior-year 404 `prior-year-not-found`;
 *   - ReEx unavailable: prior-year 502 `reex-unavailable`. management-fe's
 *     work item page still renders then, without the prior-year section.
 *
 * The recommendation (`GET /work-items/re-accreditation/{id}/recommendation`)
 * stays refused with a 403: neither management-fe's work item page nor the
 * Admin UI reads it. Writes stay refused with a 403 too: the RA-751 spec
 * (ra-751-case-management-search.e2e.js) covers creating, assigning,
 * applying an action and the PATCH; this spec adds adding a note, the write
 * that shares its path with the newly opened `GET /work-items/{id}`.
 *
 * The Admin UI's own page is not here: the Admin UI does not run on this
 * suite's stack, and its server.inject tests cover it. Like RA-751's Admin UI
 * cases, this runs only where the suite may hold the Admin UI's secret (see
 * test/support/backend-api.js), so it is skipped on CDP. The ReEx "no record"
 * and outage cases need the compose stack's ReEx stand-in
 * (docker/stubs/external-services-stub.mjs), so they are skipped elsewhere.
 *
 * Each run submits a work item through the API for an `e2e-` organisation
 * (whose prior year management-be answers from its stub), assigns it, adds a
 * note and duly makes it, so the item holds a note, an audit log and a status
 * push to the Operator journey.
 */

// Only on the compose stack, where management-be's real ReEx client calls
// the ReEx stand-in. Said in the run log, so a run that skipped them cannot
// pass for one that ran them.
const isReExStubbed = process.env.REEX_COMPOSE_STUB_ENABLED === 'true'
if (!isReExStubbed) {
  // eslint-disable-next-line no-console -- say WHY the tests are skipped in the run log
  console.warn(
    'RA-752: REEX_COMPOSE_STUB_ENABLED is not "true", so the prior-year cases for a ReEx "no record" 404 and a ReEx outage are SKIPPED.'
  )
}
const itIfReExStubbed = isReExStubbed ? it : it.skip
const describeIfReExStubbed = isReExStubbed ? describe : describe.skip

/** The Admin UI's prior-year read for the work item `id`. */
const adminUiPriorYear = (id) =>
  adminUiRequest('GET', `/work-items/re-accreditation/${id}/prior-year`)

/** Assert a ProblemDetails failure with `status` and `errorCode`. */
function expectProblem({ status, headers, body }, expected) {
  expect(status).toBe(expected.status)
  expect(headers.get('content-type')).toContain('application/problem+json')
  expect(body.errorCode).toBe(expected.errorCode)
}

describeIfAdminUi('RA-752 View Case management information', () => {
  const noteText = `RA-752 note ${randomUUID()}`
  let item

  before(async () => {
    item = await createWorkItemViaApi({
      organisationNamePrefix: 'RA-752 view'
    })
    await assignWorkItemViaApi(item.id)
    expectStatus(
      await managementBeRequest('POST', `/work-items/${item.id}/notes`, {
        body: { text: noteText },
        user: CASEWORKER_USER
      }),
      200,
      `add a note to work item ${item.id}`
    )
    await dulyMakeViaApi(item.id)
    // The push to the Operator journey runs after the response.
    await waitForStatusPushes(item.id, 1)
  })

  describe('the Admin UI caller may read', () => {
    it('a single work item, with its payload, notes and audit log', async () => {
      // Read as a caseworker first: the audit log only grows, so whatever
      // the caseworker saw the Admin UI must see too, even if a late entry
      // lands between the two reads.
      const caseworkerView = await getWorkItem(item.id)
      const { body } = expectStatus(
        await adminUiRequest('GET', `/work-items/${item.id}`),
        200,
        'Admin UI GET /work-items/{id}'
      )

      expect(body.id).toBe(item.id)
      expect(body.typeId).toBe('re-accreditation')
      expect(body.stateId).toBe('duly-made')
      expect(body.payload).toEqual(caseworkerView.payload)
      expect(body.notes).toEqual(caseworkerView.notes)
      expect(body.notes.map((note) => note.text)).toContain(noteText)
      expect(body.auditLog).toEqual(
        expect.arrayContaining(caseworkerView.auditLog)
      )
      expect(
        body.auditLog.some((entry) => entry.action.startsWith('status-push'))
      ).toBe(true)
    })

    it("a work item's prior year, as a caseworker sees it", async () => {
      const path = `/work-items/re-accreditation/${item.id}/prior-year`
      const { body } = expectStatus(
        await adminUiRequest('GET', path),
        200,
        'Admin UI GET prior-year'
      )
      const caseworker = expectStatus(
        await managementBeRequest('GET', path, { user: CASEWORKER_USER }),
        200,
        'caseworker GET prior-year'
      )
      expect(body.year).toBe(item.payload.previousAccreditationYear)
      expect(body).toEqual(caseworker.body)
    })
  })

  describe('a work item with no prior year', () => {
    itIfReExStubbed(
      'is a 404 prior-year-not-found when ReEx has no record of its organisation',
      async () => {
        // Not `e2e-`, so management-be asks ReEx (the stand-in), which
        // answers as ReEx does for an organisation it has never heard of.
        const { id } = await createWorkItemViaApi({
          organisationNamePrefix: 'RA-752 no ReEx record',
          fields: { operatorOrganisationId: `ra752-no-record-${randomUUID()}` }
        })
        expectProblem(await adminUiPriorYear(id), {
          status: 404,
          errorCode: 'prior-year-not-found'
        })
      }
    )

    it('is a 404 prior-year-not-found when it has no ReEx registration id', async () => {
      const { id } = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-752 no ReEx ids',
        fields: ({ operatorRegistrationId, ...payload }) => payload
      })
      expectProblem(await adminUiPriorYear(id), {
        status: 404,
        errorCode: 'prior-year-not-found'
      })
    })

    // ReEx identifiers but no year to look up: management-be must not guess
    // one, nor call ReEx.
    it('is a 404 prior-year-not-found when it stores no accreditation year', async () => {
      const { id } = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-752 no year',
        fields: ({
          accreditationYear,
          previousAccreditationYear,
          ...payload
        }) => payload
      })
      expectProblem(await adminUiPriorYear(id), {
        status: 404,
        errorCode: 'prior-year-not-found'
      })
    })
  })

  describeIfReExStubbed('when ReEx is unavailable', () => {
    let unavailable

    before(async () => {
      // The ReEx stand-in answers 503 for this organisation.
      unavailable = await createWorkItemViaApi({
        organisationNamePrefix: 'RA-752 ReEx unavailable',
        fields: {
          operatorOrganisationId: `reex-unavailable-${randomUUID()}`
        }
      })
    })

    it('prior-year is a 502 reex-unavailable', async () => {
      expectProblem(await adminUiPriorYear(unavailable.id), {
        status: 502,
        errorCode: 'reex-unavailable'
      })
    })

    describe("management-fe's work item page", () => {
      before(async () => {
        await login.login()
      })

      after(async () => {
        await login.logout()
      })

      // The same page for an item whose prior year loads, so the absence
      // below is the outage's doing and not a selector that never matches.
      it('shows the prior-year section when the prior year loads', async () => {
        await workItems.openWorkItem(item.id)
        await workItems.waitForDetailPage()
        expect(await detail.hasPriorYear('heading')).toBe(true)
      })

      it('still renders, without the prior-year section, when ReEx is unavailable', async () => {
        await workItems.openWorkItem(unavailable.id)
        await workItems.waitForDetailPage()
        expect(await detail.hasCaseHeader()).toBe(true)
        expect(await detail.hasPriorYear('heading')).toBe(false)
      })
    })
  })

  describe('a work item that does not exist', () => {
    const unknownId = randomUUID()

    for (const path of [
      `/work-items/${unknownId}`,
      `/work-items/re-accreditation/${unknownId}/prior-year`
    ]) {
      it(`is a 404 work-item-not-found for GET ${path.replace(unknownId, '{unknown id}')}`, async () => {
        expectProblem(await adminUiRequest('GET', path), {
          status: 404,
          errorCode: 'work-item-not-found'
        })
      })
    }

    // Route-constraint pins, not RA-752 behaviour: the id routes only match
    // a GUID, so anything else matches no route and was a 404 before RA-752
    // too. The Admin UI checks the id is a GUID before it calls
    // management-be, so it never sends one.
    for (const path of [
      '/work-items/not-a-guid',
      '/work-items/re-accreditation/not-a-guid/prior-year'
    ]) {
      it(`is a 404 for GET ${path}, which matches no route`, async () => {
        const { status } = await adminUiRequest('GET', path)
        expect(status).toBe(404)
      })
    }
  })

  describe('the Admin UI caller is still read-only', () => {
    it("may not read a work item's recommendation", async () => {
      expectForbidden(
        await adminUiRequest(
          'GET',
          `/work-items/re-accreditation/${item.id}/recommendation`
        )
      )
    })

    it('may not add a note, which a caseworker may', async () => {
      const text = `RA-752 refused note ${randomUUID()}`
      const after = await expectOnlyTheGateRefuses(item.id, {
        method: 'POST',
        path: `/work-items/${item.id}/notes`,
        body: { text }
      })
      expect(after.notes.map((note) => note.text)).toContain(text)
    })
  })
})
