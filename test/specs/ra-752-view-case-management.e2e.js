import { randomUUID } from 'node:crypto'

import { expect } from '@wdio/globals'
import {
  adminUiRequest,
  CASEWORKER_USER,
  expectStatus,
  isAdminUiCallerEnabled,
  managementBeRequest
} from '../support/backend-api.js'
import {
  expectForbidden,
  expectRefusedAndUnchanged
} from '../support/admin-ui-assertions.js'
import { getWorkItem } from '../support/decision-api.js'
import { waitForStatusPushes } from '../support/status-push-audit.js'
import {
  assignWorkItemViaApi,
  createWorkItemViaApi
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
 * Each answers the Admin UI as it answers a caseworker, and a work item that
 * does not exist, or an id that could not be one, is a plain 404. The
 * recommendation (`GET /work-items/re-accreditation/{id}/recommendation`)
 * stays refused with a 403: neither management-fe's work item page nor the
 * Admin UI reads it. Writes stay refused with a 403 too: the RA-751 spec
 * (ra-751-case-management-search.e2e.js) covers creating, assigning,
 * applying an action and the PATCH; this spec adds adding a note, the write
 * that shares its path with the newly opened `GET /work-items/{id}`.
 *
 * The Admin UI's own page is not here: the Admin UI does not run on this
 * suite's stack, and its server.inject tests cover it. Like RA-751's Admin UI
 * cases, this runs only where the suite may hold the Admin UI's secret (see
 * test/support/backend-api.js), so it is skipped on CDP.
 *
 * Each run submits a work item through the API for an `e2e-` organisation
 * (whose prior year management-be answers from its stub), assigns it, adds a
 * note and duly makes it, so the item holds a note, an audit log and a status
 * push to the Operator journey.
 */

/** `yyyy-MM-dd` for a date `days` before today: a payment already made. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

const describeIfAdminUi = isAdminUiCallerEnabled() ? describe : describe.skip

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
    expectStatus(
      await managementBeRequest(
        'POST',
        `/work-items/re-accreditation/${item.id}/duly-make`,
        { body: { paymentDate: daysAgo(3) }, user: CASEWORKER_USER }
      ),
      200,
      `duly make work item ${item.id}`
    )
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

  describe('a work item that does not exist', () => {
    const unknownId = randomUUID()

    for (const path of [
      `/work-items/${unknownId}`,
      `/work-items/re-accreditation/${unknownId}/prior-year`
    ]) {
      it(`is a 404 for GET ${path.replace(unknownId, '{unknown id}')}`, async () => {
        const { status, body } = await adminUiRequest('GET', path)
        expect(status).toBe(404)
        // A plain 404: the ticket names no problem code for a missing item.
        expect(body?.errorCode).toBeUndefined()
      })
    }

    // The id routes only match a GUID, so anything else matches no route,
    // and no route policy runs to refuse it.
    for (const path of [
      '/work-items/not-a-guid',
      '/work-items/re-accreditation/not-a-guid/prior-year'
    ]) {
      it(`is a 404 for GET ${path}`, async () => {
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

    it('may not add a note, and the item is unchanged', async () => {
      await expectRefusedAndUnchanged(item.id, () =>
        adminUiRequest('POST', `/work-items/${item.id}/notes`, {
          body: { text: `RA-752 refused note ${randomUUID()}` }
        })
      )
    })
  })
})
