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
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ MERGE ORDER: this spec depends on management-be#93 (the index move). Merge  │
 * │ that first. If this file reaches `main` while `management-be:latest` still  │
 * │ predates the fix, the second `it` fails with a real E11000 on EVERY PR to   │
 * │ this repo — not just this one — because an unrelated PR's branch won't      │
 * │ match a management-be branch, so `Run Journey Tests` builds against         │
 * │ `latest`. If you are staring at a red `Run Journey Tests` on a change that   │
 * │ has nothing to do with duly making, this is why: management-be#93 has not    │
 * │ merged and republished `latest` yet.                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
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
 * <h3>This spec is only a guard against a build that creates the index</h3>
 *
 * It asserts nothing on its own. Both writes succeed trivially against any
 * build where the `payload.accreditationId` index is absent, because there is
 * then no unique constraint to collide with — and "absent" is the normal state
 * for a duly-making-only journey unless the index is created at STARTUP.
 * `WorkItemPersistence.DefineIndexes` does that. `AccreditationIdLookup`, where
 * the definition used to live, does not: it is a lazily constructed singleton
 * nothing resolves during startup, so nothing creates its indexes until the
 * first approval.
 *
 * Two consequences, both live rather than hypothetical:
 *
 *  1. CI has to build management-be FROM THE PAIRED BRANCH. `run-journey-tests`
 *     resolves it with `git ls-remote --heads .../management-be "$BRANCH"`
 *     against this PR's own head ref — an EXACT name match. A mismatch is not
 *     an error: the step is skipped and the run silently falls back to
 *     `defradigital/epr-register-enrol-management-be:latest`. If `latest`
 *     predates the index move, this spec passes and has proved nothing. So the
 *     branch name here must match the management-be branch carrying the fix.
 *  2. If the definition ever migrates back onto a lazily constructed type, this
 *     spec goes green while dev breaks.
 *
 * Treat a change to WHERE the index is defined, or to the branch pairing, as a
 * change to whether this test means anything. Verified by reverting the index
 * to unique + sparse with the code untouched: the second `it` then fails on the
 * production symptom. Absent that control, a green run here is not evidence.
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
