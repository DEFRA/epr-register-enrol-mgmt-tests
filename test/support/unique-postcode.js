/**
 * Collision-safe postcode suffixes for work-item fixtures.
 *
 * management-be's ApplicationReferenceGenerator (WorkItems/Core) derives
 * every applicationReference from (accreditation year, agency code, operator
 * org id, LAST 3 CHARACTERS of the regulator postcode, first 2 characters of
 * material). At most 5 work items can ever share one such tuple — the
 * generator's collision-retry loop appends a disambiguator digit for
 * attempts 2-5, then fails PERMANENTLY on the 6th with "Failed to generate a
 * unique applicationReference after 5 attempts". See the doc comment on
 * `createReAccreditation` in `re-accreditation-journey.js` for the full
 * mechanism.
 *
 * The suite used to manage this by hand: every spec picks its own postcode
 * and a comment somewhere claims its last 3 characters are "unused across
 * the suite". That does not scale past a couple of dozen call sites, does
 * not survive wdio's own spec-file retries (a retry re-runs `before()`,
 * calling the same creation helper with the same hardcoded postcode again —
 * consuming another slot from the very tuple that may already be why the
 * first attempt was flaky), and does not survive a compose stack whose
 * mongo volume outlives a single run (local dev, or any environment that
 * doesn't `docker compose down -v` between runs) — this is the "a clean
 * database passes and a reused one fails" failure mode the suite's own
 * comments already warned about.
 *
 * This generator removes the bookkeeping instead of trying to do it better:
 * every call gets a value with overwhelming odds of not colliding with any
 * other call, in this process or another, in this run or a prior one — no
 * shared ledger of "already used" values required.
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
export function uniquePostcodeSuffix() {
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
 * A full postcode with a unique suffix. Defaults to England's SW1A outward
 * code — the agency nearly every spec already targets. Pass `outward` for a
 * spec that specifically needs a different nation/agency (e.g. Scotland's
 * `EH1`, per ApplicationReferenceGenerator's postcode-area table) — the
 * suffix is still auto-generated, only the agency-determining prefix is
 * caller-controlled.
 */
export function uniquePostcode(outward = 'SW1A') {
  return `${outward} ${uniquePostcodeSuffix()}`
}
