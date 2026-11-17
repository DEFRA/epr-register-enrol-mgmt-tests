import workItems from '../page-objects/work-items.page.js'

/**
 * Shared re-accreditation journey steps: creating a re-accreditation, plus
 * every Standard-lifecycle step (`standard-lifecycle-journey.js`), re-exported
 * so re-accreditation specs import their whole run-up from one place.
 */
export * from './standard-lifecycle-journey.js'

/**
 * Create a re-accreditation work item and return
 * `{ id, organisationName }` — the name is `namePrefix` plus the suffix
 * `createWorkItem` appends (see `unique-name.js`).
 *
 * `material` is fixed to `plastic` below. The site postcode is left to
 * `createWorkItem`'s collision-safe default (see `unique-postcode.js`).
 *
 * `chargeAmountPence` (RA-316) is optional and passed straight through.
 *
 * OMITTING IT LEAVES THE ITEM WITH NO CHARGE AT ALL — there is no prefill
 * and nothing defaults it, so the duly-making page renders "Not provided".
 * That is correct for the many callers that never open that page, and it
 * means a spec which asserts a charge but forgets to supply one FAILS
 * rather than passing on a borrowed default.
 *
 * Supply it when the spec asserts on the rendered charge, and VARY IT
 * between specs: the duly-making page divides by 100 to display, and a
 * factor-of-100 slip is only conspicuous when different items show
 * different figures. Keep any value at or above 50000 pence — below that,
 * an undivided render still lands under the £50,000 ceiling in
 * `ra-316-duly-making.e2e.js` and the check silently loses its power.
 */
export async function createReAccreditation(
  namePrefix,
  { chargeAmountPence } = {}
) {
  await workItems.goto()
  const { id, organisationName } = await workItems.createWorkItem({
    organisationNamePrefix: namePrefix,
    siteAddressLine1: '1 Decision Street',
    siteAddressTown: 'London',
    material: 'plastic',
    tonnageBand: '0-500',
    chargeAmountPence
  })
  return { id, organisationName }
}
