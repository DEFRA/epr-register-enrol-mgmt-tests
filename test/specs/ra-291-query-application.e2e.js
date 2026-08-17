import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import query, { QUERY_SECTIONS } from '../page-objects/query.page.js'
import { raiseQuery, resumeFromQuery } from '../support/query-resubmission.js'
import { uniquePostcode } from '../support/unique-postcode.js'

/**
 * RA-291 — Query an application.
 *
 * A regulator can query an application at the duly-making and assessment
 * stages to ask the operator for clarification. The detail page offers a
 * "Query" link; the query page collects one or more sections plus a
 * mandatory reason capped at 200 words, then moves the application into
 * the `queried` state.
 *
 * Business rule: only one query may be open at a time — once an
 * application is queried the affordance disappears, so a second query
 * cannot be raised.
 */

const uniqueOrg = (label) => `${label} ${Date.now()}`

/**
 * Create a Submitted application to query.
 *
 * `postcode` defaults to a freshly-generated, collision-safe one (see
 * `support/unique-postcode.js`). Work items created through the case
 * management UI carry no operator organisation id, so
 * ApplicationReferenceGenerator derives the reference from the site
 * postcode and material alone — items sharing both exhaust its
 * collision-retry budget and the submission fails, which is why this no
 * longer takes a hand-picked literal.
 */
const createSubmittedWorkItem = async (
  organisationName,
  postcode = uniquePostcode()
) => {
  await workItems.goto()
  return (
    await workItems.createWorkItem({
      organisationName,
      siteAddressLine1: '1 Query Street',
      siteAddressTown: 'London',
      siteAddressPostcode: postcode,
      material: 'plastic',
      tonnageBand: '0-500'
    })
  ).id
}

describe('RA-291 Query an application', () => {
  describe('AC01/AC02 — reaching the query page', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(uniqueOrg('Query Nav Ltd'))
    })

    after(async () => {
      await login.logout()
    })

    it('still renders the re-accreditation detail template', async () => {
      // Guard against template-version drift. The backend stamps its
      // current TemplateVersion onto every new work item; if the frontend
      // has not registered that version, the page silently falls back to
      // the generic detail template and the re-accreditation view — the
      // approve CTA, the custom actions panel — disappears with nothing
      // failing. Adding a query transition bumps the version, so this
      // needs asserting on a freshly created item.
      await workItems.openWorkItem(workItemId)
      await expect($('[data-testid="re-accreditation-detail"]')).toBeDisplayed()
    })

    it('offers a Query link on the application summary page', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
      const href = await $('[data-testid="action-query"]').getAttribute('href')
      expect(href).toContain(`/work-items/${workItemId}/query`)
    })

    it('navigates to the query page when Query is selected', async () => {
      await workItems.openWorkItem(workItemId)
      await $('[data-testid="action-query"]').click()
      await query.waitForQueryUrl(workItemId)
      await query.assertOnQueryPage()
    })

    it('returns to the application without querying it when Cancel is used', async () => {
      await query.gotoFor(workItemId)
      await query.cancel()
      await query.waitForDetailUrl(workItemId)
      await detail.assertState('Not started')
    })

    // RA-434: content-design copy update. "This will be included in the
    // email to the operator." became "The reason you provide is for
    // internal use only." (always shown), and the assignment inset became
    // "The operator query status will be updated." (shown only while the
    // application is unassigned — this freshly-created item qualifies; the
    // conditionality itself is covered by ra-295-assignment-and-query.e2e.js).
    it('shows the RA-434 reason guidance and query status notice', async () => {
      await query.gotoFor(workItemId)
      await expect(query.reasonHint()).toHaveText(
        expect.stringContaining(
          'The reason you provide is for internal use only.'
        )
      )
      await expect(query.assignmentNotice()).toHaveText(
        expect.stringContaining('The operator query status will be updated.')
      )
    })
  })

  describe('AC03 — selecting sections', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(
        uniqueOrg('Query Sections Ltd')
      )
    })

    after(async () => {
      await login.logout()
    })

    it('offers all six queryable sections', async () => {
      await query.gotoFor(workItemId)
      expect(await query.countSectionOptions()).toBe(QUERY_SECTIONS.length)
      for (const section of QUERY_SECTIONS) {
        await expect(query.sectionCheckbox(section)).toExist()
      }
    })

    it('allows more than one section to be selected at once', async () => {
      await query.gotoFor(workItemId)
      await query.selectSections(['authority-to-issue', 'business-plan'])
      expect(await query.isSectionSelected('authority-to-issue')).toBe(true)
      expect(await query.isSectionSelected('business-plan')).toBe(true)
    })
  })

  describe('AC04/AC08 — validation', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(uniqueOrg('Query Invalid Ltd'))
    })

    after(async () => {
      await login.logout()
    })

    it('rejects a query with no reason and keeps the application unqueried', async () => {
      await query.gotoFor(workItemId)
      await query.selectSection('business-plan')
      await query.submit()
      await query.assertErrorSummaryDisplayed()
      expect(await query.errorSummaryText()).toContain(
        'Enter a reason for the query'
      )

      await workItems.openWorkItem(workItemId)
      await detail.assertState('Not started')
    })

    it('rejects a query with no section selected', async () => {
      await query.gotoFor(workItemId)
      await query.fillReason('Please clarify the submitted figures.')
      await query.submit()
      await query.assertErrorSummaryDisplayed()
      expect(await query.errorSummaryText()).toContain(
        'Select which areas you want to query'
      )
    })

    it('rejects a reason longer than 200 words', async () => {
      await query.gotoFor(workItemId)
      await query.selectSection('prn-tonnage')
      await query.fillReason('word '.repeat(201).trim())
      await query.submit()
      await query.assertErrorSummaryDisplayed()
      expect(await query.errorSummaryText()).toContain(
        'Query must be 200 words or fewer'
      )
    })

    it('accepts a reason of exactly 200 words', async () => {
      await query.gotoFor(workItemId)
      await query.selectSection('prn-tonnage')
      await query.fillReason('word '.repeat(200).trim())
      await query.submit()
      await query.waitForDetailUrl(workItemId)
      await detail.assertState('Queried')
    })
  })

  describe('AC07 — word limit is visible to the user', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(uniqueOrg('Query Count Ltd'))
    })

    after(async () => {
      await login.logout()
    })

    it('shows the remaining word allowance', async () => {
      await query.gotoFor(workItemId)
      expect(await query.characterCountMessage()).toContain(
        'You have 200 words remaining'
      )
    })

    it('decreases the allowance as the reason is typed', async () => {
      await query.gotoFor(workItemId)
      await query.fillReason('one two three')
      await browser.waitUntil(
        async () =>
          (await query.characterCountMessage()).includes(
            'You have 197 words remaining'
          ),
        {
          timeout: 5000,
          timeoutMsg:
            'Expected the live character count to fall to 197 words remaining'
        }
      )
    })
  })

  // The `it`s in this block run in order and share one work item: the first
  // submits the query, and the rest assert the resulting state (assignment,
  // audit, affordance withdrawn, direct-visit guard). Keep them ordered —
  // do not reorder or run one in isolation with `.only`.
  describe('AC05 — submitting the query', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(uniqueOrg('Query Submit Ltd'))
    })

    after(async () => {
      await login.logout()
    })

    it('records the query against the application and moves it to Queried', async () => {
      await query.gotoFor(workItemId)
      await query.selectSections([
        'authority-to-issue',
        'sampling-and-inspection-plan'
      ])
      await query.fillReason(
        'Please confirm the authority to issue and re-upload the sampling and inspection plan.'
      )
      await query.submit()

      await query.waitForDetailUrl(workItemId)
      await detail.assertState('Queried')
    })

    it('assigns the application to the querying regulator', async () => {
      // The query page promises "the application will also be assigned to
      // you" — the assignment is part of the query operation, so an
      // unassigned application becomes owned by whoever raised the query.
      // RA-323: the stub login identity is the first caseworker.
      await workItems.openWorkItem(workItemId)
      await detail.assertAssignedTo('Stub Caseworker One')
    })

    it('records the query in the application history', async () => {
      await workItems.openWorkItem(workItemId)
      await detail.gotoAudit()
      // 'Action applied' is on every action entry; 'Application queried' is
      // what actually pins the query, so assert only that.
      await detail.assertAuditEntry('Application queried')
    })

    it('withdraws the Query affordance so a second query cannot be raised', async () => {
      await workItems.openWorkItem(workItemId)
      await expect($('[data-testid="action-query"]')).not.toExist()
    })

    it('turns away a direct visit to the query page once already queried', async () => {
      await browser.url(`/work-items/${workItemId}/query`)
      await query.waitForDetailUrl(workItemId)
      await expect($('[data-testid="query-form"]')).not.toExist()
      await detail.assertState('Queried')
    })
  })

  /**
   * Regression coverage for the stale-summary bug: ReAccreditationResumeService
   * used to write a resubmitted section's value only into
   * payload.latestSections, which nothing — including this page — ever read
   * back, so the business plan / PRN tonnage / sampling plan rows kept
   * showing the pre-query value (or "—") after the operator had answered the
   * query. The first fix merged the resubmitted value onto its canonical
   * top-level payload field (e.g. payload.businessPlan), but keyed that merge
   * map by the kebab-case query-section key ("business-plan"). Real traffic
   * never matches that: the operator backend's HttpCaseWorkingApiAdapter
   * .BuildSectionsPayload keys `sections` by its own OperatorSection enum
   * name — "BusinessPlan", "Prns", "SamplingPlan" — so the merge silently
   * missed every time. The second fix rekeyed the map to match. This spec
   * sends `sections` with those same PascalCase keys, exactly as the real
   * operator backend does, across all three affected fields in one
   * resubmission.
   */
  describe('CM summary reflects a resubmission after a query', () => {
    let workItemId

    before(async () => {
      await login.login()
      workItemId = await createSubmittedWorkItem(
        uniqueOrg('Query Resubmit Ltd')
      )
    })

    after(async () => {
      await login.logout()
    })

    it('shows the resubmitted business plan, PRN tonnage and sampling plan values after resume-from-query', async () => {
      await query.gotoFor(workItemId)
      await query.selectSections([
        'business-plan',
        'prn-tonnage',
        'sampling-and-inspection-plan'
      ])
      await query.fillReason(
        'Please provide the missing business plan, PRN tonnage and sampling plan detail.'
      )
      await query.submit()
      await query.waitForDetailUrl(workItemId)
      await detail.assertState('Queried')

      // Before resubmission the rows exist but are empty (none of these were
      // collected via the "Create work item" form).
      await workItems.openWorkItem(workItemId)
      expect(await detail.applicationDetailRowText('business-plan')).toContain(
        '—'
      )
      expect(await detail.applicationDetailRowText('prn-tonnage')).toContain(
        '—'
      )
      expect(
        await detail.applicationDetailRowText('sampling-inspection-plan')
      ).toContain('No documents uploaded.')

      await resumeFromQuery(workItemId, {
        sectionKeys: [
          'business-plan',
          'prn-tonnage',
          'sampling-and-inspection-plan'
        ],
        sections: {
          BusinessPlan: {
            newInfrastructureDetail:
              'RA-291 regression: resubmitted investment plan.',
            newInfrastructurePercent: 42
          },
          Prns: {
            plannedTonnageBand: 'UpTo5000'
          },
          SamplingPlan: {
            files: [
              {
                fileId: 'ra-291-regression-file',
                filename: 'ra-291-regression-sampling-plan.pdf',
                scanStatus: 'Clean',
                uploadedAt: new Date().toISOString()
              }
            ]
          }
        }
      })

      await workItems.openWorkItem(workItemId)
      const businessPlan =
        await detail.applicationDetailRowText('business-plan')
      expect(businessPlan).toContain(
        'RA-291 regression: resubmitted investment plan.'
      )
      expect(businessPlan).toContain('42% of PRN income')

      expect(await detail.applicationDetailRowText('prn-tonnage')).toContain(
        'Up to 5,000 tonnes'
      )

      expect(await detail.supportingDocumentNames()).toContain(
        'ra-291-regression-sampling-plan.pdf'
      )
    })

    it('shows the "More than 10,000 tonnes" label for the highest PRN tonnage band after resume-from-query', async () => {
      const highTonnageWorkItemId = await createSubmittedWorkItem(
        uniqueOrg('Query Resubmit High Tonnage Ltd')
      )

      await raiseQuery(highTonnageWorkItemId, {
        sections: ['prn-tonnage'],
        reason: 'Please confirm the planned PRN tonnage band.'
      })

      await resumeFromQuery(highTonnageWorkItemId, {
        sectionKeys: ['prn-tonnage'],
        sections: {
          Prns: {
            plannedTonnageBand: 'Over10000'
          }
        }
      })

      await workItems.openWorkItem(highTonnageWorkItemId)
      expect(await detail.applicationDetailRowText('prn-tonnage')).toContain(
        'More than 10,000 tonnes'
      )
    })
  })
})
