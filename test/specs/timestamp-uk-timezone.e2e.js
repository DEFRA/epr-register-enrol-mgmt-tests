import { expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { recentUkDateTimeGdsWindow } from '../support/uk-time.js'

/**
 * RA-197 — timestamps display in UK local time (BST/GMT).
 *
 * The backend stores and returns timestamps in UTC; the case management
 * frontend must convert them to UK local time (Europe/London) for display so
 * British Summer Time (UTC+1) and GMT (UTC+0) — and the spring-forward /
 * autumn-back transitions — are shown correctly.
 *
 * A freshly created work item is stamped server-side at "now", so this spec
 * proves the wired-up pipeline end to end: the rendered "Submitted at" /
 * "Last modified" values are in GDS UK-local format (never a raw ISO/UTC
 * string) AND match the current Europe/London wall clock computed
 * independently of the runner's own timezone. The exact BST/GMT offsets and
 * both DST boundary transitions are pinned deterministically by the frontend
 * unit tests (format-date.test.js).
 */
const GDS_DATETIME = /^\d{1,2} [A-Z][a-z]+ \d{4} at \d{1,2}:\d{2}(am|pm)$/

describe('RA-197 — timestamps display in UK local time (BST/GMT)', () => {
  let submittedAt

  before(async () => {
    await login.login()
    await workItems.goto()
    await workItems.createWorkItem({
      organisationName: 'Timezone Test Ltd',
      siteAddressLine1: '1 Clock Lane',
      siteAddressTown: 'London',
      siteAddressPostcode: 'SW1A 1AA',
      material: 'glass',
      tonnageBand: '0-500'
    })
    // createWorkItem leaves us on the work item detail page.
    submittedAt = await detail.getSummaryValueByKey('Submitted at')
  })

  after(async () => {
    await login.logout()
  })

  it('renders "Submitted at" in GDS date-time format, not a raw ISO/UTC string', () => {
    expect(submittedAt).toMatch(GDS_DATETIME)
    expect(submittedAt).not.toContain('T')
    expect(submittedAt).not.toContain('Z')
  })

  it('renders "Submitted at" as the current UK local time (Europe/London)', () => {
    const acceptable = recentUkDateTimeGdsWindow(new Date(), 5)
    expect([...acceptable]).toContain(submittedAt)
  })

  it('renders "Last modified" in UK-local GDS format too', async () => {
    const lastModified = await detail.getSummaryValueByKey('Last modified')
    expect(lastModified).toMatch(GDS_DATETIME)
    const acceptable = recentUkDateTimeGdsWindow(new Date(), 5)
    expect([...acceptable]).toContain(lastModified)
  })
})
