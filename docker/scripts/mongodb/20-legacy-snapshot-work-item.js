/**
 * RA-342 regression seed.
 *
 * Reproduces the "Backend returned 500" worklist crash end-to-end. A stored
 * work item's frozen `templateSnapshot` can carry BSON elements the current
 * model no longer declares (here `templateSnapshot.transitions[0].requiredRoles`
 * — the role-tiered field dropped in RA-323). Before the management-be fix
 * (adding [BsonIgnoreExtraElements] to WorkItemTemplateSnapshot / Transition /
 * State / Task), Mongo deserialisation threw System.FormatException and crashed
 * the WHOLE `GET /work-items` query — not just this one row — so every
 * caseworker saw a 500 and the worklist would not load at all.
 *
 * This script inserts one such legacy-shaped document directly, so the
 * management E2E job runs the worklist journey against a real legacy document
 * and the accompanying spec (ra-342-legacy-snapshot-worklist.e2e.js) proves the
 * worklist renders without the "Backend returned 500" banner.
 *
 * Why an init script rather than seeding from the spec: the compose Mongo
 * exposes no host port and the test suite carries no Mongo driver, so a raw
 * legacy document can only be introduced from inside the Mongo container. This
 * runs at container init, before the backend connects. That is safe because the
 * backend's work-item seeder is idempotent (CreateIfAbsentAsync with
 * deterministic ids — see WorkItemSeederHostedService): it only inserts its own
 * missing items and never drops or replaces the collection, so this raw
 * document survives startup seeding and is present when the worklist is queried.
 *
 * The database name mirrors Mongo__DatabaseName in docker/config/management-be.env
 * and the collection name mirrors WorkItemPersistence ("workItems"). The stray
 * fields (retiredSnapshotField / colour / mandatory) alongside requiredRoles
 * exercise all four annotated snapshot types; requiredRoles alone is the element
 * named in the original stack trace and is sufficient to trigger the crash.
 *
 * A fixed _id makes the insert idempotent across re-inits (replaceOne upsert).
 */

/* global db */

const legacyDb = db.getSiblingDB('epr-register-case-management')

const now = new Date()

const legacyWorkItem = {
  // WorkItem.Id is a Guid stored as a String ([BsonRepresentation(String)]),
  // so _id must be a parseable GUID string.
  _id: '00000342-0000-4000-8000-000000000342',
  typeId: 're-accreditation',
  stateId: 'submitted',
  submittedAt: now,
  lastModifiedAt: now,
  templateVersion: '1',
  version: 0,
  // Realistic payload so the worklist row renders and the item is findable by
  // an org-name search; nation keeps it inside the England worklist filter.
  payload: {
    // The worklist row link renders payload.applicationReference as its
    // visible text (see decorate() in the management-fe list controller); an
    // item without one renders a zero-size, un-clickable link. Real items
    // always carry a reference, so the legacy seed does too.
    applicationReference: 'AP342LEGACY01',
    organisationName: 'RA-342 Legacy Snapshot Ltd',
    registrationNumber: 'EPR-342000',
    operatorRegistrationId: 'reg-342',
    material: 'plastic',
    previousAccreditationYear: 2025,
    complianceIssuesReported: 0,
    operatorEmail: 'ra342.legacy@example.test',
    siteAddressPostcode: 'SW1A 1AA',
    nation: 'England'
  },
  templateSnapshot: {
    templateVersion: '1',
    // Stray element at the snapshot root — exercises
    // [BsonIgnoreExtraElements] on WorkItemTemplateSnapshot.
    retiredSnapshotField: 'legacy',
    states: [
      {
        // WorkItemState.Id -> _id (NamedIdMemberConvention).
        _id: 'submitted',
        displayName: 'Submitted',
        isTerminal: false,
        // Stray element on WorkItemState.
        colour: 'amber'
      },
      {
        _id: 'approved',
        displayName: 'Approved',
        isTerminal: true
      }
    ],
    transitions: [
      {
        actionId: 'approve',
        displayName: 'Approve',
        fromStateId: 'submitted',
        toStateId: 'approved',
        requiresAllTasksComplete: true,
        // THE stray element from the original stack trace — the field the
        // WorkItemTransition model no longer declares. This alone reproduces
        // the FormatException in GET /work-items before the fix.
        requiredRoles: ['regulator-admin', 'regulator-approver']
      }
    ],
    tasksByState: {
      submitted: [
        {
          // WorkItemTask.Id -> _id.
          _id: 'task-one',
          displayName: 'Task One',
          // Stray element on WorkItemTask.
          mandatory: true
        }
      ]
    }
  }
}

legacyDb.workItems.replaceOne({ _id: legacyWorkItem._id }, legacyWorkItem, {
  upsert: true
})

print(
  'RA-342: seeded legacy-shaped work item ' +
    legacyWorkItem._id +
    ' into epr-register-case-management.workItems'
)
