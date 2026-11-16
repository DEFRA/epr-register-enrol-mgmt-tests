/**
 * RA-690/RA-763. The accreditation reference rule, as the operator backend
 * applies it: `A` + the year applied for's YY + characters 4–17 of its
 * source. One copy, so every spec expects the same thing.
 */

/** `reference` with its leading letter `A` and its YY (characters 2–3) replaced by `year`'s. */
export function withYear(reference, year) {
  return `A${String(year % 100).padStart(2, '0')}${reference.slice(3)}`
}

/** The reference a registration number would give, which a renewal must not be issued. */
export function derivedFromRegistration(registrationReference, year) {
  return withYear(registrationReference, year)
}
