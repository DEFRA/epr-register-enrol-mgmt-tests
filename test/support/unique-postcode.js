/**
 * Collision-safe site postcodes for work-item fixtures.
 *
 * management-be's ApplicationReferenceGenerator (WorkItems/Core) derives
 * every applicationReference from (accreditation year, agency code, operator
 * org segment, LAST 3 CHARACTERS of the regulator postcode, first 2
 * characters of material). Every UI-created item carries the create form's
 * demo org id and (unless a spec picks one) England, so the postcode suffix
 * and material are the only inputs that vary. At most 5 work items can ever
 * share one tuple: the generator's collision-retry loop appends a
 * disambiguator digit for attempts 2-5, then fails PERMANENTLY with "Failed
 * to generate a unique applicationReference after 5 attempts".
 *
 * A fixed postcode therefore uses up one of those 5 slots on every run, every
 * wdio spec-file retry and every environment whose Mongo is never reset (CDP
 * test, or a local compose stack started without `down -v`), until creation
 * fails for good. `WorkItemsPage.createWorkItem` draws a fresh value from here
 * whenever its caller does not pass one, which is how every creation helper
 * gets a collision-safe postcode without any shared ledger of used values.
 */

import { randomInt } from 'node:crypto'

// digit + letter + letter, matching the shape of a real UK postcode inward
// code (management-be's suffix extraction doesn't actually require this
// shape — it just takes the last 3 characters — but keeping it realistic
// avoids relying on that not mattering anywhere else in the stack).
const DIGITS = 10
const LETTERS = 26
const SUFFIX_SPACE = DIGITS * LETTERS * LETTERS // 6760

/**
 * A 3-character suffix (e.g. "4QX") drawn uniformly at random from the full
 * 6760-value space via Node's CSPRNG. A given pair of calls collides with
 * probability 1/6760 — and even a collision isn't itself a test failure,
 * since ApplicationReferenceGenerator's own collision-retry loop absorbs up
 * to 4 more before giving up; this only needs to make hitting that ceiling
 * astronomically unlikely, not impossible.
 *
 * (An earlier version derived this from `process.hrtime.bigint() % 6760` to
 * avoid a dependency on randomness — don't reintroduce that. Reducing a
 * slowly-incrementing counter by a small modulus is periodic, not uniform:
 * verified empirically to produce ~68% collisions across 20k calls in a
 * tight loop, i.e. almost the opposite of the intended effect.)
 */
function uniquePostcodeSuffix() {
  const seed = randomInt(SUFFIX_SPACE)
  const digit = seed % DIGITS
  const letterPair = Math.floor(seed / DIGITS)
  const letter1 = String.fromCodePoint(65 + (letterPair % LETTERS))
  const letter2 = String.fromCodePoint(
    65 + (Math.floor(letterPair / LETTERS) % LETTERS)
  )
  return `${digit}${letter1}${letter2}`
}

/**
 * A full postcode with a random suffix. Defaults to England's SW1A outward
 * code. The agency in the reference comes from the create form's `nation`
 * field (RA-526), not the postcode, so `outward` is cosmetic: pass one only
 * to keep a spec's postcode consistent with a non-England `nation`, e.g.
 * `uniquePostcode('EH1')` alongside `nation: 'Scotland'`.
 */
export function uniquePostcode(outward = 'SW1A') {
  return `${outward} ${uniquePostcodeSuffix()}`
}
