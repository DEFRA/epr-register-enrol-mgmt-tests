import { expect } from '@wdio/globals'
import {
  buildAddOverseasSiteRequest,
  listAddOverseasSiteWorkItems,
  postAddOverseasSiteRequest,
  submitAddOverseasSiteRequest
} from '../support/in-year-change-api.js'

/**
 * RA-739. management-be creates an add-ORS submission whole or not at all:
 * a malformed one is rejected and creates nothing, and resending one (as the
 * operator backend does after a timeout) returns the original references and
 * creates nothing new.
 *
 * Submitted straight to management-be, as the operator backend does.
 */
describe('RA-739 add-ORS submissions are all or nothing', () => {
  describe('a submission with missing fields', () => {
    // Each case keeps organisationName, which is how "creates nothing" looks
    // the work items up.
    const cases = {
      'no operator request id': (payload) => delete payload.operatorRequestId,
      'no material': (payload) => delete payload.material,
      'no payment reference': (payload) => delete payload.paymentReference,
      'no sites': (payload) => (payload.sites = []),
      'a site without an ORS id': (payload) => delete payload.sites[1].orsId,
      'a repeated site id': (payload) =>
        (payload.sites[1].siteId = payload.sites[0].siteId)
    }

    for (const [name, malform] of Object.entries(cases)) {
      it(`is rejected with 400 and creates nothing: ${name}`, async () => {
        const request = buildAddOverseasSiteRequest({
          organisationNamePrefix: 'RA739 Rejected ORS Ltd',
          siteCount: 2
        })
        malform(request.payload)

        const response = await postAddOverseasSiteRequest(request.payload)

        expect(response.status).toBe(400)
        expect(
          await listAddOverseasSiteWorkItems(request.organisationName)
        ).toHaveLength(0)
      })
    }
  })

  describe('a repeated operatorRequestId', () => {
    let original
    let replay

    before(async () => {
      original = await submitAddOverseasSiteRequest({
        organisationNamePrefix: 'RA739 Replayed ORS Ltd',
        siteCount: 2
      })
      replay = await postAddOverseasSiteRequest(original.payload)
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
      const listed = await listAddOverseasSiteWorkItems(
        original.organisationName
      )
      expect(listed.map((item) => item.id).sort()).toEqual(
        original.workItems.map((item) => item.id).sort()
      )
    })
  })
})
