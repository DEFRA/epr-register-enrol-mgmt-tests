import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import {
  FULL_PAYLOAD,
  createFullPayloadWorkItem
} from '../support/full-payload-fixture.js'
import { createWorkItemViaApi } from '../support/work-item-api.js'

/**
 * RA-295 (AC06) — the registration number is shown on the applications list.
 *
 * Regulators triage from the list, so the registration number has to be on the
 * card rather than only on the individual work item page. Asserted against
 * items submitted with a known registration number
 * (`payload.registrationNumber`) through the API — a UI-created item has no
 * way to supply one, so it could only ever prove the em-dash fallback.
 */
describe('RA-295 registration number on the applications list', () => {
  before(async () => {
    // No nation → a multi-nation "see all" user, so the items are visible
    // whichever nation they were routed to.
    await login.login()
  })

  after(async () => {
    await login.logout()
  })

  describe('an application with a registration number', () => {
    let item

    before(async () => {
      item = await createFullPayloadWorkItem()
      // A bare landing defaults to "assigned to me" (RA-299), which would hide
      // this unassigned item.
      await workItems.resetFilters()
      await workItems.searchByOrgName(item.organisationName)
    })

    it('renders the registration number on the card', async () => {
      expect(await workItems.tileHasRegistrationNumber(item.id)).toBe(true)
      await expect(workItems.tileRegistrationNumber(item.id)).toHaveText(
        expect.stringContaining(FULL_PAYLOAD.REGISTRATION_NUMBER)
      )
    })
  })

  describe('across several applications', () => {
    // Each organisation is searched by name and its OWN registration number
    // asserted, rather than scanning a page of cards: reading an unfiltered
    // page would make the outcome depend on what else is in the list.
    //
    // Asserting a DIFFERENT expected number per organisation is what gives
    // this teeth: a card rendering one hardcoded value, or reading the wrong
    // payload field, still satisfies a "looks like EPR-nnn" check but fails
    // here. `createWorkItemViaApi` gives every item its own registration
    // number.
    const items = []

    before(async () => {
      for (let i = 0; i < 2; i++) {
        items.push(
          await createWorkItemViaApi({
            organisationNamePrefix: 'RA295 Registration Number Ltd'
          })
        )
      }
      expect(items[0].payload.registrationNumber).not.toBe(
        items[1].payload.registrationNumber
      )
    })

    for (const index of [0, 1]) {
      it(`shows application ${index + 1}'s own registration number on its card`, async () => {
        const { id, organisationName, payload } = items[index]
        await workItems.resetFilters()
        await workItems.searchByOrgName(organisationName)
        expect(await workItems.tileHasRegistrationNumber(id)).toBe(true)
        await expect(workItems.tileRegistrationNumber(id)).toHaveText(
          expect.stringContaining(payload.registrationNumber)
        )
      })
    }
  })
})
