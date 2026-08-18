/**
 * RA-407 seed — glass sub type on the CM Application details panel.
 *
 * The management-fe Application details panel renders a new "Glass sub type"
 * row (value testid `app-detail-value-glass-sub-type`) directly after Material
 * for GLASS applications, driven by `payload.glassRecyclingProcess`:
 *   - `glass_re_melt` -> "Glass - Remelt"
 *   - `glass_other`   -> "Glass - other"
 * The row is NOT rendered when the material is not glass, or when
 * `glassRecyclingProcess` is absent.
 *
 * `glassRecyclingProcess` cannot be set through the case-management "Create
 * work item" form (which only populates org name, site address, material and
 * tonnage band), so the accompanying spec (ra-407-cm-glass-sub-type.e2e.js)
 * needs work items whose stored payload carries the field. This script inserts
 * them directly, exactly as the RA-342 legacy-snapshot seed
 * (20-legacy-snapshot-work-item.js) does and for the same reasons: the compose
 * Mongo exposes no host port and the test suite carries no Mongo driver, so a
 * raw document can only be introduced from inside the Mongo container at init,
 * before the backend connects. That is safe because the backend's work-item
 * seeder is idempotent (CreateIfAbsentAsync with deterministic ids — see
 * WorkItemSeederHostedService): it only inserts its own missing items and never
 * drops or replaces the collection, so these raw documents survive startup
 * seeding and are present when the worklist and detail pages are queried.
 *
 * Three items, each findable by a unique org-name search:
 *   - remelt  : material glass, glassRecyclingProcess 'glass_re_melt'
 *   - other   : material glass, glassRecyclingProcess 'glass_other'
 *   - absent  : material glass, NO glassRecyclingProcess (the negative — the
 *               row must be absent even for a glass item when the field is
 *               missing)
 *
 * The database name mirrors Mongo__DatabaseName in
 * docker/config/management-be.env and the collection name mirrors
 * WorkItemPersistence ("workItems"). Fixed _id GUID strings make the inserts
 * idempotent across re-inits (replaceOne upsert). The templateSnapshot mirrors
 * the shape the RA-342 seed proved deserialises, so the item renders in the
 * worklist and on the detail page.
 */

/* global db */

const glassDb = db.getSiblingDB('epr-register-case-management')

const now = new Date()

// A minimal, current-shaped re-accreditation snapshot — the same structure the
// RA-342 seed carries (minus its deliberately-stray legacy fields), so these
// items deserialise and render like real seeded work items.
const templateSnapshot = {
  templateVersion: '1',
  states: [
    { _id: 'submitted', displayName: 'Submitted', isTerminal: false },
    { _id: 'approved', displayName: 'Approved', isTerminal: true }
  ],
  transitions: [
    {
      actionId: 'approve',
      displayName: 'Approve',
      fromStateId: 'submitted',
      toStateId: 'approved',
      requiresAllTasksComplete: true
    }
  ],
  tasksByState: {
    submitted: [{ _id: 'task-one', displayName: 'Task One' }]
  }
}

/**
 * Build one glass work item. `glassRecyclingProcess` is only set when a value
 * is supplied, so the "absent" item genuinely omits the field rather than
 * storing it empty.
 */
function glassWorkItem({ id, reference, organisationName, glassRecyclingProcess }) {
  const payload = {
    // The worklist row link renders payload.applicationReference as its
    // visible text; real items always carry one, so these do too.
    applicationReference: reference,
    organisationName,
    registrationNumber: 'EPR-407' + reference.slice(-3),
    operatorRegistrationId: 'reg-407-' + reference.slice(-3),
    material: 'glass',
    previousAccreditationYear: 2025,
    complianceIssuesReported: 0,
    operatorEmail: 'ra407.' + reference.slice(-3).toLowerCase() + '@example.test',
    siteAddressLine1: '1 Glass Works',
    siteAddressTown: 'London',
    siteAddressPostcode: 'SW1A 1AA',
    // nation keeps the item inside the England worklist filter.
    nation: 'England'
  }
  if (glassRecyclingProcess !== undefined) {
    payload.glassRecyclingProcess = glassRecyclingProcess
  }
  return {
    // WorkItem.Id is a Guid stored as a String, so _id must be a parseable
    // GUID string.
    _id: id,
    typeId: 're-accreditation',
    stateId: 'submitted',
    submittedAt: now,
    lastModifiedAt: now,
    templateVersion: '1',
    version: 0,
    payload,
    templateSnapshot
  }
}

const items = [
  glassWorkItem({
    id: '00000407-0000-4000-8000-000000000001',
    reference: 'AP407GLASS001',
    organisationName: 'RA-407 Glass Remelt Ltd',
    glassRecyclingProcess: 'glass_re_melt'
  }),
  glassWorkItem({
    id: '00000407-0000-4000-8000-000000000002',
    reference: 'AP407GLASS002',
    organisationName: 'RA-407 Glass Other Ltd',
    glassRecyclingProcess: 'glass_other'
  }),
  glassWorkItem({
    id: '00000407-0000-4000-8000-000000000003',
    reference: 'AP407GLASS003',
    organisationName: 'RA-407 Glass No Subtype Ltd'
    // glassRecyclingProcess deliberately omitted — the negative case.
  })
]

for (const item of items) {
  glassDb.workItems.replaceOne({ _id: item._id }, item, { upsert: true })
  print(
    'RA-407: seeded glass work item ' +
      item._id +
      ' (' +
      item.payload.organisationName +
      ') into epr-register-case-management.workItems'
  )
}
