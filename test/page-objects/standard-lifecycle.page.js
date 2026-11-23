import { Page } from './page.js'

export const RE_ACCREDITATION = 're-accreditation'

/**
 * RA-495. A page of the shared Standard lifecycle: Duly make, Make
 * determination or Confirm applicant contact. Every type on that lifecycle
 * has its own copy at `/work-items/{typeId}/{id}/{page}`, so each method takes
 * the type and defaults it to re-accreditation, the type most specs drive.
 */
export class StandardLifecyclePage extends Page {
  /** @param {string} page the URL's last segment, e.g. `'duly-make'` */
  constructor(page) {
    super()
    this.pageSegment = page
  }

  path(workItemId, typeId = RE_ACCREDITATION) {
    return `/work-items/${typeId}/${workItemId}/${this.pageSegment}`
  }

  /**
   * Navigate straight to the page, bypassing the detail-page CTA.
   *
   * Hiding a CTA is not a control — used by the guard specs to prove the
   * route itself refuses from the wrong state.
   */
  async gotoFor(workItemId, typeId = RE_ACCREDITATION) {
    await this.open(this.path(workItemId, typeId))
  }
}
