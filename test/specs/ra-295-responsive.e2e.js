import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail, {
  CASE_HEADER_FIELDS
} from '../page-objects/work-item-detail.page.js'
import { VIEWPORTS } from '../page-objects/page.js'

/**
 * RA-295 (AC05) — the redesigned pages stay usable on a narrow viewport.
 *
 * The redesign introduces a full-bleed case header with an inline meta line
 * and a two-column body (details + a right-hand assignment panel). Both are
 * layouts that look fine at desktop width and fall apart on a phone: the meta
 * line overflows, or the right-hand panel is pushed off the edge instead of
 * stacking underneath.
 *
 * "Usable" is asserted as more than `isDisplayed()`. An element sitting at
 * x=900 on a 320px viewport is still "displayed" to WebDriver but is
 * unreadable, so each check also measures the element's box against the real
 * viewport width, and the page as a whole is checked for horizontal overflow.
 *
 * Runs at 320px (the narrowest width GOV.UK supports) and at the 641px tablet
 * breakpoint where the collapse to a single column begins.
 */
describe('RA-295 responsive layout', () => {
  before(async () => {
    await login.login()
  })

  after(async () => {
    // The window size is per-SESSION, not per-spec. Leaving the browser narrow
    // would silently change the layout every later spec runs against, so this
    // restore is not optional housekeeping.
    await workItems.resetViewport()
    await login.logout()
  })

  describe('the individual work item page', () => {
    before(async () => {
      await workItems.resetFilters()
      await workItems.searchByOrgName('Full Payload Verification Ltd')
      expect(await workItems.getRowCount()).toBe(1)
      await workItems.openFirstListedWorkItem()
    })

    afterEach(async () => {
      await detail.resetViewport()
    })

    for (const viewport of ['mobile', 'tablet']) {
      describe(`at the ${viewport} viewport (${VIEWPORTS[viewport].width}px)`, () => {
        beforeEach(async () => {
          await detail.setViewport(viewport)
          // Re-request the page at the new width so the server-rendered
          // markup and any width-dependent layout settle together, rather
          // than reading a layout mid-reflow.
          await browser.refresh()
          await workItems.waitForDetailPage()
        })

        it('still shows the case header', async () => {
          await expect(detail.caseHeader()).toBeDisplayed()
        })

        it('keeps every case header field on screen and unclipped', async () => {
          const offScreen = []
          for (const name of Object.keys(CASE_HEADER_FIELDS)) {
            const field = await detail.caseHeaderField(name)
            if (!(await field.isDisplayed())) {
              offScreen.push(`${name} (not displayed)`)
              continue
            }
            if (!(await detail.isWithinViewport(field))) {
              offScreen.push(`${name} (outside the viewport)`)
            }
          }
          expect(offScreen).toEqual([])
        })

        it('still shows the application information', async () => {
          await expect(detail.applicationDetails()).toBeDisplayed()
          expect(
            await detail.isWithinViewport(await detail.applicationDetails())
          ).toBe(true)
        })

        it('still shows the assignment panel', async () => {
          // The right-hand column is the part most likely to be pushed off the
          // edge rather than stacked when the layout collapses.
          await expect(detail.assignmentPanel()).toBeDisplayed()
          expect(
            await detail.isWithinViewport(await detail.assignmentPanel())
          ).toBe(true)
        })

        it('does not force the page to scroll sideways', async () => {
          expect(await detail.hasHorizontalOverflow()).toBe(false)
        })
      })
    }
  })

  describe('the applications list page', () => {
    afterEach(async () => {
      await workItems.resetViewport()
    })

    for (const viewport of ['mobile', 'tablet']) {
      describe(`at the ${viewport} viewport (${VIEWPORTS[viewport].width}px)`, () => {
        beforeEach(async () => {
          await workItems.setViewport(viewport)
          await workItems.resetFilters()
          await workItems.searchByOrgName('Full Payload Verification Ltd')
        })

        it('still lists the matching application', async () => {
          expect(await workItems.getRowCount()).toBe(1)
        })

        it('keeps the application card on screen and unclipped', async () => {
          const id = await workItems.firstResultWorkItemId()
          const card = await workItems.tileFor(id)
          await expect(card).toBeDisplayed()
          expect(await workItems.isWithinViewport(card)).toBe(true)
        })

        it('does not force the page to scroll sideways', async () => {
          expect(await workItems.hasHorizontalOverflow()).toBe(false)
        })
      })
    }
  })
})
