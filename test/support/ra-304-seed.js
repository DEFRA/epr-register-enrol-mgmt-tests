/**
 * RA-304 fixture map for the seeded `awaiting-decision` work item.
 *
 * The values are OWNED BY the compose Mongo init script
 * (docker/scripts/mongodb/30-awaiting-decision-work-item.js) — that file
 * explains WHY the item has to be seeded rather than journeyed. They are
 * reproduced here so the two RA-304 spec files assert against one copy rather
 * than two drifting ones, following the RA-292 fixture-module precedent.
 *
 * If any value below stops matching, the seed script changed: fix it here, not
 * in the specs.
 */

/** Fixed GUID `_id` of the seeded item, so its detail page opens directly. */
export const AWAITING_DECISION_ID = '00000304-0000-4000-8000-000000000304'

/** Resolves an organisation search to exactly the seeded item. */
export const AWAITING_DECISION_ORG_NAME = 'RA-304 Awaiting Decision Ltd'

/**
 * The label `awaiting-decision` must present as after RA-304 — the same label
 * `duly-made` carries, which is the whole point of the story.
 */
export const AWAITING_DECISION_LABEL = 'Duly made'

/** The `govuk-tag--*` modifier `awaiting-decision` shares with `duly-made`. */
export const AWAITING_DECISION_TAG_CLASS = 'govuk-tag--purple'

/**
 * The label that must never reach a caseworker again (AC3).
 *
 * The raw state id `awaiting-decision` is a different string and is NOT
 * forbidden: it legitimately survives in `data-state-id`, in form values, and
 * in the audit log's `from -> to` id trace, none of which is a status label.
 * AC3 is about the human-readable vocabulary, so the banned string is the
 * display name.
 */
export const BANNED_STATUS_LABEL = 'Awaiting decision'
