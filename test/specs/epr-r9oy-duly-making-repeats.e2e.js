import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import {
  createReAccreditation,
  dulyMake
} from '../support/re-accreditation-journey.js'

/**
 * epr-r9oy — duly making must work for MORE THAN ONE application.
 *
 * <h3>Why a second application is the whole test</h3>
 *
 * On dev, duly making returned 500 for every regulator who tried it, while
 * `ra-316-duly-making.e2e.js` stayed green throughout. That spec duly makes
 * ONE application, and the first duly making in a collection always succeeds.
 * The failure only appears on the second:
 *
 *   E11000 duplicate key error collection: ...workItems
 *   index: payload.accreditationId_1 dup key: { payload.accreditationId: null }
 *
 * `ReAccreditationDulyMakingService` stamps the payment date by round-tripping
 * the payload through `ReAccreditationPayload` and merging `ToBsonDocument()`,
 * which materialises every modelled-but-absent field as an explicit null —
 * `accreditationId` among them, since it is null until approval. The index over
 * that field is unique, so the first application to carry an explicit null
 * claims the one null slot and every application after it collides.
 *
 * A single-application journey cannot see that, no matter how thorough it is
 * about the page, the banner or the audit trail. Only the second write fails.
 * That is the entire reason this file exists as a separate spec rather than
 * another `it` inside the RA-316 file: the assertion is not "duly making
 * works", it is "duly making works AGAIN".
 *
 * <h3>What makes it a real guard</h3>
 *
 * The index is created by `WorkItemPersistence.DefineIndexes` at startup, so
 * every stack this suite runs against carries it. It previously lived on
 * `AccreditationIdLookup`, a lazily constructed singleton nothing resolves
 * during startup — which meant CI had no such index at all, and this spec
 * would have passed against the very build that was failing on dev. If that
 * definition ever migrates back onto a lazily constructed type, this spec goes
 * green again while dev breaks, so treat a change to where the index is
 * defined as a change to whether this test means anything.
 *
 * <h3>Ordering is load-bearing</h3>
 *
 * The two applications must be duly made in sequence, in this order, against
 * the same database. Parallelising them, or giving each its own `before`, would
 * lose the "second one" property the test exists to assert.
 */
describe('epr-r9oy duly making repeats across applications', () => {
  let firstId
  let secondId

  before(async () => {
    await login.login()
    // Two distinct real fee bands, neither used by another spec, so a figure
    // rendered on one page cannot be mistaken for the other's if this fails
    // mid-way. Both clear the 50000-pence floor `createReAccreditation`
    // requires.
    firstId = await createReAccreditation('Duly Repeat One Ltd', 'SW1A 1DR', {
      chargeAmountPence: 163800
    })
    secondId = await createReAccreditation('Duly Repeat Two Ltd', 'SW1A 2DR', {
      chargeAmountPence: 273000
    })
    await login.logout()
  })

  beforeEach(async () => {
    await login.login()
  })

  afterEach(async () => {
    await login.logout()
  })

  it('duly makes the first application', async () => {
    // Always passed, even with the defect present — it is here to establish
    // the precondition for the next test, and to make a failure HERE
    // unambiguous: something broke duly making outright, not the repeat.
    await dulyMake(firstId)
    await detail.assertState('Duly made')
  })

  it('duly makes a second application against the same collection', async () => {
    // The regression. With the index defined as unique + sparse rather than
    // unique + partial, this write fails with E11000, management-fe redirects
    // to the detail page with "There was a problem completing duly making",
    // and the state stays "Not started".
    await dulyMake(secondId)
    await detail.assertState('Duly made')

    // Assert the success banner rather than only the state, so a failure says
    // which of the two things went wrong: a state mismatch alone cannot
    // distinguish "the write was rejected" from "the page did not refresh".
    await detail.assertFlashBanner()
    const banner = await detail.flashBannerText()
    expect(banner).toContain('duly made')
    expect(banner).not.toContain('There was a problem')
  })
})
