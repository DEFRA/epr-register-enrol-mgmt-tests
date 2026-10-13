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

// management-be reads only the last 3 characters of the postcode, and
// management-fe accepts any /^[A-Z0-9 ]{3,10}$/i value, so every character of
// the suffix can come from the full alphanumeric set.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SUFFIX_LENGTH = 3
const SUFFIX_SPACE = ALPHABET.length ** SUFFIX_LENGTH // 46656

/**
 * A 3-character suffix (e.g. "Q7X") drawn uniformly at random from the
 * 46,656-value [0-9A-Z]^3 space via Node's CSPRNG.
 *
 * Headroom on a database that is never reset: at roughly 100 same-material
 * items per suite run, the expected number of tuples that reach the 5-item
 * ceiling stays well below one per run for several hundred runs (with the
 * old 6,760-value digit+letter+letter space that point came at about 100).
 *
 * (An earlier version derived this from `process.hrtime.bigint() % 6760` to
 * avoid a dependency on randomness — don't reintroduce that. Reducing a
 * slowly-incrementing counter by a small modulus is periodic, not uniform:
 * verified empirically to produce ~68% collisions across 20k calls in a
 * tight loop, i.e. almost the opposite of the intended effect.)
 */
function uniquePostcodeSuffix() {
  let seed = randomInt(SUFFIX_SPACE)
  let suffix = ''
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET[seed % ALPHABET.length]
    seed = Math.floor(seed / ALPHABET.length)
  }
  return suffix
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
