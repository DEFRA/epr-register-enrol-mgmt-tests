/**
 * Unique organisation names for work-item fixtures.
 *
 * Mongo behind the CDP test environment is never reset, and neither is a
 * local compose stack started without `down -v`, so every suite run adds to
 * the items earlier runs left behind. A spec that creates "Foo Ltd" and later
 * searches, filters or asserts on "Foo Ltd" can land on another run's item,
 * or count more rows than it created.
 *
 * `WorkItemsPage.createWorkItem` therefore takes an `organisationNamePrefix`
 * and always submits `uniqueOrganisationName(prefix)`, returning the name it
 * used. Every creation helper passes that returned name back to its caller,
 * which is the only value a spec may search for or compare against.
 *
 * A spec that needs a SET of its own items (a count, a sort order, a
 * pagination check) mints one token with `uniqueOrganisationName('Label')`,
 * creates each item with a prefix that starts with that token, and searches
 * by the token: the org search is a case-insensitive substring match, so the
 * token matches that set and nothing else.
 */

import { randomBytes } from 'node:crypto'

/**
 * `${prefix} ${suffix}`, where the suffix is 8 uppercase hex characters from
 * Node's CSPRNG (about 4.3 billion values), e.g. "Delta Recyclers Ltd 3F9A1C2E".
 * The suffix is fixed-length, so one generated name is never a substring of
 * another, and short enough to stay well inside management-fe's 200-character
 * limit on the organisation name.
 */
export function uniqueOrganisationName(prefix) {
  return `${prefix} ${randomBytes(4).toString('hex').toUpperCase()}`
}
