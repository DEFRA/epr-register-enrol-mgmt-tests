import { $, browser } from '@wdio/globals'
import { Page } from './page.js'

function toXPathString(value) {
  const s = String(value)
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  const parts = s.split("'").map((p) => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

class ApplicationDetailsPage extends Page {
  async open(workItemId) {
    await super.open(`/work-items/${workItemId}/application-details`)
  }

  async getCaption() {
    return $('[data-testid="app-heading-caption"]').getText()
  }

  /**
   * Get the value cell for a given key label from any summary list on the page.
   */
  async getSummaryValueByKey(key) {
    return $(
      `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)=${toXPathString(key)}]/following-sibling::*[contains(@class,"govuk-summary-list__value")]`
    ).getText()
  }

  /**
   * True if the summary list section for the given data-testid attribute exists.
   */
  async sectionExists(testid) {
    return $(`[data-testid="${testid}"]`).isExisting()
  }

  async isDeclarationShown() {
    return this.sectionExists('app-details-submitted-by')
  }

  async isAuthorisersEmpty() {
    return $('[data-testid="app-details-authorisers-none"]').isExisting()
  }

  async isBusinessPlanEmpty() {
    return $('[data-testid="app-details-business-plan-none"]').isExisting()
  }

  async isSamplingPlanEmpty() {
    return $('[data-testid="app-details-sampling-files-none"]').isExisting()
  }

  async isPriorYearSectionShown() {
    return $('[data-testid="app-details-prior-year-heading"]').isExisting()
  }

  async isPriorYearAuthorisersTableShown() {
    return $('[data-testid="app-details-prior-year-authorisers"]').isExisting()
  }

  async isPriorYearBusinessPlanShown() {
    return $(
      '[data-testid="app-details-prior-year-business-plan"]'
    ).isExisting()
  }

  async getAuthorisersTableText() {
    return $('[data-testid="app-details-authorisers"]').getText()
  }

  async getSamplingFilesTableText() {
    return $('[data-testid="app-details-sampling-files"]').getText()
  }

  /** The download link for the first (only, in current fixtures) sampling file. */
  downloadSamplingFileLink() {
    return $('[data-testid="app-details-sampling-file-download-1"]')
  }

  async isSamplingFileDownloadShown() {
    return this.downloadSamplingFileLink().isExisting()
  }

  async getSamplingFileDownloadHref() {
    return this.downloadSamplingFileLink().getAttribute('href')
  }

  async getOverseasSiteName() {
    return $('[data-testid="app-details-overseas-site-1-name"]').getText()
  }

  async getBesEvidenceFilesTableText() {
    return $('[data-testid="app-details-bes-evidence-files-1"]').getText()
  }

  /** The download link for the first (only, in current fixtures) BES-evidence file. */
  downloadBesEvidenceFileLink() {
    return $('[data-testid="app-details-bes-file-download-1"]')
  }

  async isBesEvidenceFileDownloadShown() {
    return this.downloadBesEvidenceFileLink().isExisting()
  }

  async getBesEvidenceFileDownloadHref() {
    return this.downloadBesEvidenceFileLink().getAttribute('href')
  }

  /**
   * Wait until the URL indicates we are on the application-details page for
   * any work item. Used after clicking the link from the detail page.
   */
  async waitForPage() {
    await browser.waitUntil(
      async () =>
        /\/work-items\/[^/]+\/application-details$/.test(
          await browser.getUrl()
        ),
      {
        timeout: 10000,
        timeoutMsg: 'Expected application-details page URL'
      }
    )
  }
}

export default new ApplicationDetailsPage()
