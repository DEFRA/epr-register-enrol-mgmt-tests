import { MongoClient, UUID } from 'mongodb'

/**
 * RA-311/MGT-F1 — direct Mongo seeding into epr-register-enrol-backend's
 * `accreditationApplications` collection.
 *
 * Per the RA-311 fix doc's test-linkage decision, the operator-backend side
 * of a case-management-linked application is seeded directly into Mongo
 * rather than driven through a full submit: there is no operator-facing
 * flow that produces a `CaseManagementWorkItemId`-linked, `Submitted`
 * application on demand, and the ReEx-backed `seed` endpoint that *is*
 * exposed doesn't accept one either.
 *
 * Only the fields the query-raise path actually reads/writes are set here;
 * every other property (Prns/BusinessPlan/SamplingPlan sections, Query,
 * dates) is left for AccreditationApplicationModel's own C# property
 * initialisers to fill in — the driver's camelCase/ignore-extra-elements
 * conventions (MongoDbClientFactory.cs) mean an omitted field simply keeps
 * its default rather than needing to be reproduced here.
 *
 * Runs from the Node test process itself (not the browser), so it connects
 * to Mongo's published port directly rather than through docker networking
 * — mirrors management-be-api.js's own localhost/published-port approach.
 */
const MONGO_URI =
  process.env.OPERATOR_BE_MONGO_URI || 'mongodb://localhost:27017/?tls=false'
const DATABASE_NAME = 'epr'
const COLLECTION_NAME = 'accreditationApplications'

let client

async function getCollection() {
  if (!client) {
    client = new MongoClient(MONGO_URI)
    await client.connect()
  }
  return client.db(DATABASE_NAME).collection(COLLECTION_NAME)
}

/**
 * Seeds a `Submitted` accreditation application linked to `workItemId`
 * (management-be's own work-item GUID), so that when management-be pushes
 * a raised query for that work item, `GetByCaseManagementWorkItemIdAsync`
 * finds it. Returns `{ organisationId, applicationId }` — the pair GetById
 * needs to read the seeded application back.
 *
 * `isExporter: false` by default keeps the exporter-only section keys
 * (broadly-equivalent-standards/overseas-reprocessing-sites) out of scope
 * for callers that don't ask for them — QueryFromCaseManagement rejects
 * those keys for a non-exporter application.
 */
export async function seedQueryableApplication(
  workItemId,
  { organisationId, materialType = 'Plastic', isExporter = false } = {}
) {
  const collection = await getCollection()
  const { insertedId } = await collection.insertOne({
    organisationId,
    year: new Date().getFullYear(),
    materialType,
    applicationStatus: 'Submitted',
    isExporter,
    caseManagementWorkItemId: new UUID(workItemId)
  })
  return { organisationId, applicationId: insertedId.toHexString() }
}

export async function closeOperatorBackendDb() {
  await client?.close()
  client = undefined
}
