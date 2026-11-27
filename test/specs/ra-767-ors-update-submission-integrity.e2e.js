import { expect } from '@wdio/globals'
import {
  buildOrsUpdateRequest,
  listOrsWorkItems,
  postOrsUpdateRequest,
  submitOrsUpdateRequest
} from '../support/update-overseas-site-api.js'

/**
 * RA-767. management-be creates an ORS change request whole or not at all,
 * for an update-only request and for one that also adds an ORS: one with
 * missing fields is rejected and creates nothing, and resending one (as the
 * operator backend does after a timeout) returns the original references and
 * creates nothing new. ra-739-in-year-change-submission-integrity covers an
 * add-only request.
 *
 * Submitted straight to management-be in one POST, as the operator backend
 * does (see support/update-overseas-site-api.js).
 */
const SHAPES = {
  'an update-only request': { addCount: 0, updateCount: 2 },
  'a request adding one ORS and updating another': {
    addCount: 1,
    updateCount: 1
  }
}

// Each case keeps organisationName, which is how "creates nothing" looks the
// work items up. The last site is always an update site.
const MISSING_FIELDS = {
  'no operator request id': (payload) => delete payload.operatorRequestId,
  'no material': (payload) => delete payload.material,
  'no sites': (payload) => (payload.sites = []),
  'an update site without an ORS id': (payload) =>
    delete payload.sites.at(-1).orsId,
  'an update site without a site name': (payload) =>
    delete payload.sites.at(-1).siteName,
  'a repeated site id': (payload) =>
    (payload.sites[1].siteId = payload.sites[0].siteId),
  'a site of an unknown type': (payload) =>
    (payload.sites.at(-1).typeId = 'not-a-work-item-type')
}

describe('RA-767 ORS update submissions are all or nothing', () => {
  for (const [shapeName, shape] of Object.entries(SHAPES)) {
    describe(shapeName, () => {
      describe('with missing fields', () => {
        const cases = { ...MISSING_FIELDS }
        if (shape.addCount > 0) {
          // The added ORS is charged for, so the request needs its payment
          // reference.
          cases['no payment reference'] = (payload) =>
            delete payload.paymentReference
        }

        for (const [name, malform] of Object.entries(cases)) {
          it(`is rejected with 400 and creates nothing: ${name}`, async () => {
            const request = buildOrsUpdateRequest({
              organisationNamePrefix: 'RA767 Rejected ORS Ltd',
              ...shape
            })
            malform(request.payload)

            const response = await postOrsUpdateRequest(request)

            expect(response.status).toBe(400)
            expect(
              await listOrsWorkItems(request.organisationName)
            ).toHaveLength(0)
          })
        }
      })

      describe('with a repeated operatorRequestId', () => {
        let original
        let replay

        before(async () => {
          original = await submitOrsUpdateRequest({
            organisationNamePrefix: 'RA767 Replayed ORS Ltd',
            ...shape
          })
          replay = await postOrsUpdateRequest(original)
        })

        it('returns the original references, flagged as a replay', () => {
          expect(replay.status).toBe(201)
          expect(replay.headers.get('x-idempotent-replay')).toBe('true')
          expect(replay.body).toEqual({
            submissionReference: original.submissionReference,
            workItems: original.workItems
          })
        })

        it('creates nothing new', async () => {
          const listed = await listOrsWorkItems(original.organisationName)
          expect(listed.map((item) => item.id).sort()).toEqual(
            original.workItems.map((item) => item.id).sort()
          )
        })
      })
    })
  }
})
