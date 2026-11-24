import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { driveToApproved } from '../support/standard-lifecycle-journey.js'
import {
  createOperatorBackedWorkItem,
  getOperatorApplication,
  waitForOperatorApplicationStatus
} from '../support/operator-backend-api.js'
import {
  buildAddOverseasSiteRequest,
  postAddOverseasSiteRequest
} from '../support/in-year-change-api.js'
import { expectStatus } from '../support/backend-api.js'
import { getWorkItem } from '../support/decision-api.js'
import {
  DELHI,
  IN_YEAR_CHANGE_ORGANISATION_ID,
  findInYearChangeAccreditation,
  getChangeRequestItem,
  isMonorepoMongoConfigured,
  resetInYearChangeOrganisation,
  submitAddOverseasSiteChangeRequest,
  waitForChangeRequestItemStatus
} from '../support/operator-change-requests.js'

/**
 * RA-769 task 008. The Accreditation summary tab against the real services.
 * An operator submits an add-ORS request in the operator journey, for the
 * seeded accreditation of org 50019, and its case shows that accreditation as
 * the operator backend holds it today: read live, not the `e2e-` test
 * accreditation the direct-post spec (ra-769-accreditation-summary-tab) sees.
 * The requested ORS is not on the tab until it is granted, and is on it
 * afterwards, on the same case. Its BES evidence file, uploaded through
 * cdp-uploader, downloads from the tab for real.
 *
 *   before grant   the case is Submitted; the tab lists only the ORS the
 *                  accreditation already has
 *   grant          duly made, approved, applicant contact confirmed: the
 *                  operator backend accredits the site
 *   after grant    the same case's tab lists the new ORS, with its evidence
 *
 * Runs only against the monorepo's root stack with MONOREPO_MONGO_URL set
 * (see support/operator-change-requests.js): it resets org 50019's change
 * requests, and their case-management work items, before and after, so it
 * can be rerun. Skipped anywhere else, or if the seeded accreditation is not
 * there. Never run it while someone is testing org 50019 by hand on that
 * stack. ORDERING IS LOAD-BEARING: the grant is one-way.
 *
 * The interim sites follow management-fe's MULTIPLE_INTERIM_SITES_ENABLED,
 * but the sites on this accreditation (Hamburg, and Delhi's) have none, so
 * the same line shows with the flag on or off.
 */

const INTRO =
  'A summary of the accreditation as it stands today. The changes in this request are not included until the request is granted.'
const BES_FILENAME = `ra769-bes-evidence-${Date.now()}.pdf`
const BES_CONTENT = `%PDF-1.4\nRA-769 BES evidence ${Date.now()}\n%%EOF\n`

const describeIfMonorepoMongo = isMonorepoMongoConfigured()
  ? describe
  : describe.skip

/** The labelled rows of the summary list, by label. */
const rowsByLabel = (rows) => new Map(rows)

// What the ORS summaries should show for the sites held: the number and name
// of each, and the condensed address only where the name repeats in the list.
const expectedOrsSummaries = (held) =>
  held.map((site) => ({
    open: false,
    number: site.orsId,
    name: site.siteName,
    address:
      held.filter(({ siteName }) => siteName === site.siteName).length > 1
        ? `${site.addressLine1}, ${site.country}`
        : ''
  }))

describeIfMonorepoMongo(
  'RA-769: the Accreditation summary of an add-ORS request from the operator journey',
  () => {
    let applicationId
    let accreditation
    let request

    /** The ORSs the accreditation holds today, as the operator backend lists them. */
    const accreditedSites = async () =>
      (
        await getOperatorApplication(
          IN_YEAR_CHANGE_ORGANISATION_ID,
          applicationId
        )
      ).overseasSites.sites
        .filter((site) => site.selected)
        .sort((a, b) => a.orsId.localeCompare(b.orsId))

    const openTab = async () => {
      await workItems.openWorkItem(request.id)
      await detail.gotoAccreditationSummary()
    }

    before(async function () {
      applicationId = await findInYearChangeAccreditation()
      if (!applicationId) {
        // Not the monorepo's root stack: no seeded in-year change accreditation.
        this.skip()
      }
      await resetInYearChangeOrganisation({
        siteId: DELHI.siteId,
        pristine: DELHI.pristine
      })
      accreditation = await getOperatorApplication(
        IN_YEAR_CHANGE_ORGANISATION_ID,
        applicationId
      )
      await login.login()
    })

    after(async () => {
      if (applicationId) {
        await resetInYearChangeOrganisation({
          siteId: DELHI.siteId,
          pristine: DELHI.pristine
        })
        await login.logout()
      }
    })

    describe('before the request is granted', () => {
      before(async () => {
        request = await submitAddOverseasSiteChangeRequest({
          applicationId,
          site: DELHI,
          answers: DELHI.answers,
          besEvidence: { filename: BES_FILENAME, content: BES_CONTENT }
        })
        await openTab()
      })

      it('submits a real add-ORS request and opens its case', async () => {
        const workItem = await getWorkItem(request.id)
        expect(workItem.typeId).toBe('add-overseas-site')
        expect(workItem.payload.operatorOrganisationId).toBe(
          IN_YEAR_CHANGE_ORGANISATION_ID
        )
        expect(workItem.payload.accreditationApplicationId).toBe(applicationId)
        expect(await detail.isActiveTab('accreditationSummary')).toBe(true)
        await detail.assertState('Not started')
        await expect(detail.caseHeaderFieldByKey('title')).toHaveText(
          `${DELHI.siteName} (${DELHI.orsId})`
        )
      })

      it("shows the operator backend's accreditation, not the test one", async () => {
        await expect(detail.accreditationSummaryHeading()).toHaveText(
          'Accreditation Summary'
        )
        await expect(detail.accreditationSummaryIntro()).toHaveText(INTRO)
        const rows = rowsByLabel(await detail.accreditationSummaryRows())

        expect(rows.get('Organisation')).toBe(
          `${accreditation.organisationName} (${accreditation.orgId})`
        )
        expect(rows.get('Accreditation number')).toBe(
          accreditation.accreditationReference
        )
        expect(rows.get('Status')).toBe('Granted')
        expect(rows.get('Accreditation year')).toBe(String(accreditation.year))
        // No re-accreditation case issued this accreditation, so it counts from
        // the start of its year.
        expect(rows.get('Accreditation start date')).toBe(
          `1 January ${accreditation.year}`
        )
        expect(rows.get('Registration number')).toBe(
          accreditation.registrationReference
        )
        // An exporter with no site address shows its registered address.
        expect(accreditation.siteAddress).toBeNull()
        expect(rows.get('Location')).toBe(
          accreditation.companyRegisteredAddress
        )
        expect(rows.get('Type')).toBe('Exporter accreditation')
        expect(rows.get('Material')).toBe(accreditation.materialType)

        // Nothing here is the stable `e2e-` test accreditation.
        expect(rows.get('Accreditation number')).not.toBe('A26ER9999999999PL')
        expect(rows.get('Organisation')).not.toContain('E2E Test Organisation')
      })

      it('lists the ORSs the accreditation holds, and not the one requested', async () => {
        const held = await accreditedSites()
        expect(held.map((site) => site.orsId)).not.toContain(DELHI.orsId)

        expect(await detail.accreditationSummaryOrsSummaries()).toEqual(
          expectedOrsSummaries(held)
        )
        const text = await detail.accreditationSummaryPanel().getText()
        expect(text).not.toContain(DELHI.siteName)
        expect(text).not.toContain(BES_FILENAME)
      })

      it("shows an accredited ORS's details as the operator backend holds them", async () => {
        const [site] = await accreditedSites()
        const shown = await detail.accreditationSummaryOrsDetails(0)
        expect(shown.address).toBe(
          `${site.addressLine1}, ${site.townOrCity}, ${site.country}`
        )
        const rows = rowsByLabel(shown.rows)
        expect(rows.get('ORS ID')).toBe(site.orsId)
        expect(rows.get('Coordinates')).toBe(site.coordinates)
        expect(rows.get('Contact name')).toBe(site.contactName)
        expect(rows.get('Contact email')).toBe(site.contactEmail)
        expect(rows.get('Contact phone number')).toBe(site.contactPhone)
        expect(rows.get('Operation code')).toBe(site.operationCodes.join(' '))
        expect(rows.get('Repatriated loads')).toBe(site.repatriatedLoads)
        expect(rows.get('EU country')).toBe(site.isEu ? 'Yes' : 'No')
        expect(rows.get('OECD country')).toBe(site.isOecd ? 'Yes' : 'No')
      })

      it('says "No interim sites" for an ORS with none, with the flag on or off', async () => {
        const shown = await detail.accreditationSummaryInterimSites(0)
        expect(shown.none).toBe('No interim sites')
        expect(shown.label).toBeNull()
        expect(shown.sites).toEqual([])
      })

      it('offers no case actions on the tab', async () => {
        await expect($('[data-testid="case-assignment-panel"]')).not.toExist()
        const text = await detail.accreditationSummaryPanel().getText()
        for (const action of ['Assign', 'Duly make', 'Query']) {
          expect(text).not.toContain(action)
        }
      })
    })

    describe('once the request is granted', () => {
      before(async () => {
        await driveToApproved(request.id)
        await detail.assertState('Granted')
        const { item, site } = await waitForChangeRequestItemStatus(
          request,
          'Approved'
        )
        expect(item.status).toBe('Approved')
        expect(site.accreditationStatus).toBe('Accredited')
        await openTab()
      })

      it('lists the new ORS on the tab of the case that added it', async () => {
        const held = await accreditedSites()
        expect(held.map((site) => site.orsId)).toContain(DELHI.orsId)
        // In ORS ID order, the new one after the existing one.
        expect(held.map((site) => site.orsId)).toEqual(
          [...held.map((site) => site.orsId)].sort()
        )

        expect(await detail.accreditationSummaryOrsSummaries()).toEqual(
          expectedOrsSummaries(held)
        )
      })

      it('shows the new ORS with the answers the operator gave', async () => {
        const held = await accreditedSites()
        const index = held.findIndex((site) => site.orsId === DELHI.orsId)
        const shown = await detail.accreditationSummaryOrsDetails(index)
        const rows = rowsByLabel(shown.rows)

        expect(rows.get('ORS ID')).toBe(DELHI.orsId)
        expect(rows.get('Coordinates')).toBe(DELHI.answers.coordinates)
        expect(rows.get('Operation code')).toBe(
          DELHI.answers.operationCodes.join(' ')
        )
        expect(rows.get('Conditions of export')).toBe('No')
        expect(rows.get('EU country')).toBe('No')
        expect(rows.get('OECD country')).toBe('No')
        expect(shown.address).toBe(
          `${held[index].addressLine1}, ${held[index].townOrCity}, India`
        )
        await expect(detail.accreditationSummaryPanel()).not.toHaveText(
          expect.stringContaining('NEW:')
        )

        const interim = await detail.accreditationSummaryInterimSites(index)
        expect(interim.none).toBe('No interim sites')
      })

      it('still reads the accreditation start from the start of its year', async () => {
        const rows = rowsByLabel(await detail.accreditationSummaryRows())
        expect(rows.get('Accreditation start date')).toBe(
          `1 January ${accreditation.year}`
        )
        expect(rows.get('Status')).toBe('Granted')
      })

      it("lists the new ORS's BES evidence file as a download link", async () => {
        const sites = await detail.accreditationSummaryBesSites()
        const delhi = sites.find((site) => site.name === DELHI.siteName)
        expect(delhi).toEqual({
          name: DELHI.siteName,
          country: 'India',
          documents: [
            {
              text: BES_FILENAME,
              href: `/work-items/${request.id}/accreditation-summary/files/${request.besFile.fileId}/download`
            }
          ]
        })
      })

      it('streams the real file when the link is followed', async () => {
        const href = `/work-items/${request.id}/accreditation-summary/files/${request.besFile.fileId}/download`
        // Fetched from the page, so the request carries the caseworker's session.
        const response = await browser.execute(async (url) => {
          const res = await fetch(url)
          return {
            status: res.status,
            contentType: res.headers.get('content-type'),
            disposition: res.headers.get('content-disposition'),
            body: await res.text()
          }
        }, href)

        expect(response.status).toBe(200)
        expect(response.contentType).toContain('application/pdf')
        expect(response.disposition).toContain(BES_FILENAME)
        expect(response.body).toBe(BES_CONTENT)
      })

      it('does not serve a file that is not on the live summary', async () => {
        const status = await browser.execute(
          async (url) => (await fetch(url)).status,
          `/work-items/${request.id}/accreditation-summary/files/not-in-the-summary/download`
        )
        expect(status).toBe(404)
      })

      it('still has the item in the operator journey as granted', async () => {
        const { item } = await getChangeRequestItem(request)
        expect(item.status).toBe('Approved')
      })
    })
  }
)

/**
 * RA-769 (stored start date). An accreditation counts from the start date its
 * re-accreditation case stamped when it was granted, which is today when that
 * is after 1 January of its year, not from 1 January. The seeded org 50019 was
 * never granted through case management, so its tab shows 1 January. This
 * grants a new accreditation through a re-accreditation case (an organisation
 * management-be treats as real, so it reads the operator backend instead of
 * answering from its stub), then opens an add-ORS case for it.
 *
 * Needs the same root stack as above: management-be pushes the grant to the
 * operator backend, so the accreditation reads Approved there. It creates a
 * new organisation each run, so it needs no reset.
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** `yyyy-mm-dd` as `d MMMM yyyy`. */
const formatDate = (isoDate) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

describeIfMonorepoMongo(
  'RA-769: the Accreditation summary of an accreditation granted through case management',
  () => {
    let granted
    let application
    let addOrsCaseId

    before(async function () {
      if (!(await findInYearChangeAccreditation())) {
        // Not the monorepo's root stack.
        this.skip()
      }
      await login.login()
      granted = await createOperatorBackedWorkItem({
        organisationIdGroup: 'ra769-',
        realOrganisation: true
      })
      await driveToApproved(granted.id)
      application = await waitForOperatorApplicationStatus(granted, 'Approved')

      const request = buildAddOverseasSiteRequest({
        organisationNamePrefix: 'RA769 Granted Accreditation Ltd',
        siteCount: 1
      })
      request.payload.operatorOrganisationId = granted.operatorOrganisationId
      request.payload.accreditationApplicationId = granted.operatorApplicationId
      const { body } = expectStatus(
        await postAddOverseasSiteRequest(request.payload),
        201,
        'submit an add-ORS request for the granted accreditation'
      )
      addOrsCaseId = body.workItems[0].id
      await workItems.openWorkItem(addOrsCaseId)
      await detail.gotoAccreditationSummary()
    })

    after(async () => {
      await login.logout()
    })

    it('shows the start date the re-accreditation case stamped, not 1 January', async () => {
      const issuer = await getWorkItem(granted.id)
      const stamped = issuer.payload.accreditationStartDate
      expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // Only a stamped date that is not the fallback proves it was read.
      expect(stamped).not.toBe(`${application.year}-01-01`)

      const rows = rowsByLabel(await detail.accreditationSummaryRows())
      expect(rows.get('Accreditation start date')).toBe(formatDate(stamped))
      expect(rows.get('Accreditation number')).toBe(
        application.accreditationReference
      )
      expect(rows.get('Accreditation number')).toBe(
        issuer.payload.accreditationId
      )
      expect(rows.get('Status')).toBe('Granted')
    })

    it("shows the operator backend's accreditation for it", async () => {
      const rows = rowsByLabel(await detail.accreditationSummaryRows())
      expect(rows.get('Organisation')).toBe(
        application.orgId == null
          ? application.organisationName
          : `${application.organisationName} (${application.orgId})`
      )
      expect(rows.get('Accreditation year')).toBe(String(application.year))
      expect(rows.get('Registration number')).toBe(
        application.registrationReference
      )
      expect(rows.get('Type')).toBe('Reprocessor accreditation')
    })
  }
)
