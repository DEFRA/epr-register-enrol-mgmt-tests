import { $, $$, browser, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * Build an XPath 1.0 string literal that safely encodes a JS string,
 * including values that contain single quotes, double quotes or both.
 * XPath 1.0 has no escape syntax so mixed-quote strings have to be
 * stitched together with concat().
 */
function toXPathString(value) {
  const s = String(value)
  if (!s.includes("'")) return `'${s}'`
  if (!s.includes('"')) return `"${s}"`
  const parts = s.split("'").map((p) => `'${p}'`)
  return `concat(${parts.join(`, "'", `)})`
}

/**
 * RA-295 (AC01). The eight things the case header must carry, mapped to the
 * `data-testid` that surfaces each one. Exported so a spec asserts against the
 * same single source of truth the page object reads, rather than a second
 * hand-kept copy — and so a markup rename is a one-line change here rather
 * than a sweep through the specs.
 */
export const CASE_HEADER_FIELDS = {
  applicationsLink: 'case-header-applications-link',
  accreditationRef: 'case-header-accreditation-ref',
  orgName: 'case-header-org-name',
  orgId: 'case-header-org-id',
  material: 'case-header-material',
  status: 'case-header-status',
  assignedTo: 'case-header-assigned-to',
  dueOn: 'case-header-due-on',
  registrationNumber: 'case-header-registration-number'
}

/**
 * RA-295 (AC02). The application information rows, in the exact order the AC
 * prescribes. `bes` and `ors` are Exporter-only and are expected to be ABSENT
 * for a Reprocessor (re-accreditation) application, so ordering assertions
 * compare against the subset actually rendered rather than requiring all ten.
 */
export const APPLICATION_DETAIL_ROWS = [
  'site-address',
  'type',
  'material',
  'prn-tonnage',
  'prn-authorisers',
  'authority-to-issue',
  'sampling-inspection-plan',
  'business-plan',
  'bes',
  'ors'
]

/** RA-295 (AC02). The Exporter-only rows, split out for the negative test. */
export const EXPORTER_ONLY_ROWS = ['bes', 'ors']

class WorkItemDetailPage extends Page {
  /**
   * Read the page caption text (RA-196). The caption now shows the
   * user-facing application reference rather than the internal id.
   */
  async getCaption() {
    return $('[data-testid="app-heading-caption"]').getText()
  }

  /**
   * Read a summary list row value by its key label (RA-196). Returns the
   * trimmed text of the value cell whose preceding key cell matches
   * `key` exactly.
   */
  async getSummaryValueByKey(key) {
    const value = $(
      `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)=${toXPathString(
        key
      )}]/following-sibling::*[contains(@class,"govuk-summary-list__value")]`
    )
    return value.getText()
  }

  /**
   * Whether a summary list row with the given key label exists (RA-196).
   */
  async hasSummaryKey(key) {
    return $(
      `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)=${toXPathString(
        key
      )}]`
    ).isExisting()
  }

  /**
   * RA-295 moved status and assignee out of the envelope summary list and into
   * the case header's meta line. Roughly fifteen specs assert on those two
   * values via assertState / assertAssignedTo / assertUnassigned without
   * caring WHERE they are rendered, so the three helpers below read the case
   * header when it is present and fall back to the summary list otherwise.
   *
   * Keeping the fallback matters for more than the transition: the summary
   * list still renders on work item pages the redesign does not cover, and a
   * hard switch would have turned a UI relocation into a fifteen-spec rewrite
   * for no gain in what is actually being tested.
   */
  async hasCaseHeader() {
    return this.caseHeader().isExisting()
  }

  async assertState(expectedState) {
    if (await this.hasCaseHeader()) {
      await expect(this.caseHeaderField('status')).toHaveText(
        expect.stringContaining(expectedState)
      )
      return
    }
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${expectedState}")]`
      )
    ).toBeDisplayed()
  }

  async assignTo(userId) {
    await $('[data-testid="assign-select"]').selectByAttribute('value', userId)
    await $('[data-testid="assign-submit"]').click()
  }

  /**
   * Clear the assignee via the Unassign form. The button only renders
   * once an item is assigned, so callers must have assigned first.
   */
  async unassign() {
    await $('[data-testid="unassign-submit"]').click()
  }

  /**
   * Assert who holds the work item. Reads the RA-295 case header's "Assigned
   * to" field when present, else the envelope summary row.
   *
   * Both paths are scoped to the assignee field specifically, so neither can
   * pass on the name merely appearing somewhere else on the page.
   */
  async assertAssignedTo(displayName) {
    if (await this.hasCaseHeader()) {
      await expect(this.caseHeaderField('assignedTo')).toHaveText(
        expect.stringContaining(displayName)
      )
      return
    }
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)="Assigned to"]/following-sibling::*[contains(@class,"govuk-summary-list__value") and contains(.,"${displayName}")]`
      )
    ).toBeDisplayed()
  }

  /**
   * Assert the assignee field reads "Unassigned" — the literal rendered when
   * no assignee is set.
   */
  async assertUnassigned() {
    await this.assertAssignedTo('Unassigned')
  }

  /**
   * Navigate from the work item detail page to the tasks sub-page.
   * Task status controls live at /work-items/{id}/tasks, not on the
   * detail page itself.
   */
  async gotoTasks() {
    await $('[data-testid="work-item-tasks-link"]').click()
  }

  /**
   * Navigate from the tasks sub-page back to the work item detail page.
   * Extracts the work item id from the current URL.
   */
  async gotoDetail() {
    const url = await browser.getUrl()
    const match = url.match(/\/work-items\/([^/]+)/)
    await this.open(`/work-items/${match[1]}`)
  }

  async setTaskStatus(task, status) {
    await $(`[data-testid="task-status-select-${task}"]`).selectByAttribute(
      'value',
      status
    )
    await $(`[data-testid="set-task-status-${task}"]`).click()
    // Wait for the PRG redirect to land back on the tasks page.  When the
    // full suite runs concurrently the default page-load wait can return
    // before the redirect has fully settled, so we poll the URL explicitly.
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/tasks$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg: `Expected tasks page URL after setting "${task}" to "${status}"`
      }
    )
  }

  async assertTaskStatus(task, expectedText) {
    await expect($(`[data-testid="task-status-tag-${task}"]`)).toHaveText(
      expect.stringContaining(expectedText)
    )
  }

  /**
   * Trigger any work item action by its actionId (RA-133). The action
   * buttons are rendered with `data-testid="action-<actionId>"` so this
   * works for `payment-received`, `submit-for-decision`, `approve`, etc.
   */
  async triggerAction(actionId) {
    await $(`[data-testid="action-${actionId}"]`).click()
  }

  /**
   * Type into the optional decision-note textarea on the approval
   * interstitial (RA-132 / RA-203).
   */
  async setDecisionNote(text) {
    await $('[data-testid="approval-decision-note"]').setValue(text)
  }

  /**
   * Submit the approval interstitial form (RA-133).  After
   * triggerAction('approve') the browser is on the GET confirmation
   * page at /work-items/re-accreditation/{id}/approve.  This method
   * clicks the "Approve determination" submit button and waits for the
   * POST-redirect-GET back to the detail page.
   */
  async submitApproval() {
    await $('[data-testid="approval-submit"]').click()
    await browser.waitUntil(
      async () => !/\/approve$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg:
          'Expected redirect away from approval interstitial after submitting approval'
      }
    )
  }

  /**
   * Assert that the re-accreditation approval confirmation panel
   * (RA-133) is displayed and exposes the generated accreditation id.
   * Returns the accreditation id text so callers can assert on its
   * format.
   */
  async assertApprovalPanelVisible() {
    await expect(
      $('[data-testid="re-accreditation-approval-panel"]')
    ).toBeDisplayed()
    await expect(
      $('[data-testid="re-accreditation-approval-panel-id"]')
    ).toBeDisplayed()
  }

  async getAccreditationId() {
    return $('[data-testid="re-accreditation-approval-panel-id"]').getText()
  }

  async getAccreditationStartDate() {
    return $(
      '[data-testid="re-accreditation-accreditation-start-date"]'
    ).getText()
  }

  async getAccreditationYear() {
    return $('[data-testid="re-accreditation-accreditation-year"]').getText()
  }

  /**
   * Assert that the re-accreditation "Accreditation issued" success panel
   * (RA-177) renders ABOVE the generic envelope attributes summary in DOM
   * order, with the accreditation metadata between them. Uses an XPath
   * `following::` axis so the assertion is about document order, not
   * pixel position.
   */
  async assertApprovalPanelAboveSummary() {
    // The envelope summary must appear somewhere after the approval panel.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="work-item-summary"]'
      )
    ).toExist()
    // The decision metadata must sit between the panel and the summary.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="re-accreditation-decision-metadata"]' +
          '/following::*[@data-testid="work-item-summary"]'
      )
    ).toExist()
  }

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }

  async gotoAudit() {
    await $('[data-testid="work-item-audit-log-link"]').click()
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/audit/.test(await browser.getUrl()),
      { timeoutMsg: 'Expected audit log URL after clicking audit link' }
    )
  }

  async assertAuditEntry(action) {
    await expect(
      $(`//*[@data-testid="work-item-audit-log"]//*[contains(.,"${action}")]`)
    ).toBeDisplayed()
  }

  /**
   * Assert the post-redirect flash banner is shown on the detail page
   * (e.g. after an SLA extend/override). Kept here so specs don't reach
   * for the inline selector.
   */
  async assertFlashBanner() {
    await expect($('[data-testid="work-item-flash-banner"]')).toBeDisplayed()
  }

  /**
   * Assert the detail page no longer surfaces the payload pre block or
   * the template version summary row. RA-186 moved the payload into the
   * submitted audit log entry and removed template version from the
   * envelope summary.
   */
  async assertNoPayloadOrTemplateVersionOnDetail() {
    await expect($('[data-testid="work-item-payload"]')).not.toBeExisting()
    await expect(
      $(
        '//*[contains(@class,"govuk-summary-list__key") and normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  /**
   * Expand every "Show details" disclosure on the audit log page so
   * subsequent assertions can match content rendered inside them.
   */
  async expandAllAuditEntryDetails() {
    const disclosures = await $$(
      '[data-testid="work-item-audit-entry-details"]'
    )
    for (const disclosure of disclosures) {
      const isOpen = await disclosure.getAttribute('open')
      if (isOpen === null) {
        await disclosure.$('.govuk-details__summary').click()
      }
    }
  }

  /**
   * Assert the Payload row on the work-item-submitted audit entry
   * contains the given substring. RA-186 surfaces the submission
   * payload inside the submitted entry's disclosure rather than as a
   * stand-alone panel on the detail page.
   *
   * Scoped to the <li data-action="work-item-submitted"> so the
   * assertion cannot pass against a Payload row on a different entry.
   * The substring is XPath-escaped via toXPathString so values that
   * include quotes do not corrupt the locator.
   */
  async assertSubmittedAuditPayloadContains(substring) {
    const needle = toXPathString(substring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action="work-item-submitted"]//dt[normalize-space(.)="Payload"]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  /**
   * The audit-log entries for a given backend `action` (RA-234). The
   * audit-log template stamps `data-action="{{ entry.action }}"` on every
   * `<li>`, so this scopes assertions to e.g. `notification-sent` /
   * `notification-failed` entries without matching unrelated rows.
   */
  auditEntriesForAction(action) {
    return $$(
      `//*[@data-testid="work-item-audit-log"]//li[@data-action=${toXPathString(
        action
      )}]`
    )
  }

  /**
   * The audit entries for `action` whose "Notification type" detail row matches
   * `template` (e.g. "OfficerAssignment"). A work item carries several
   * notifications sharing one action — submit alone records both the operator
   * SubmissionConfirmation and the RA-240 RegulatorSubmission — so counting by
   * action conflates them; count by template to pin an assertion to the
   * notification actually under test. Callers must
   * `expandAllAuditEntryDetails()` first so the detail rows are present.
   */
  notificationEntriesForTemplate(action, template) {
    return $$(
      `//*[@data-testid="work-item-audit-log"]//li[@data-action=${toXPathString(
        action
      )}]` +
        `[.//dt[normalize-space(.)="Notification type"]/following-sibling::dd[contains(.,${toXPathString(
          template
        )})]]`
    )
  }

  /**
   * The `notification-sent` entries for `template`. Lets a caller assert that a
   * specific template did NOT send, without counting unrelated sends.
   */
  notificationSentEntriesForTemplate(template) {
    return this.notificationEntriesForTemplate('notification-sent', template)
  }

  /**
   * Assert a notification audit entry for `action` surfaces a detail row
   * whose key is exactly `key` and whose value contains `valueSubstring`
   * (RA-234). The notification detail rows (Recipient, Notification type,
   * Reference, Reason, Error) live inside the entry's "Show details"
   * disclosure, so callers must `expandAllAuditEntryDetails()` first.
   *
   * Scoped to the `<li data-action="...">` so a row on a different entry
   * cannot satisfy the assertion; both the key and the value substring are
   * XPath-escaped so quoted emails/refs cannot corrupt the locator.
   *
   * A work item usually carries several notifications sharing one action —
   * submit alone records both the operator SubmissionConfirmation and the
   * regulator RegulatorSubmission as `notification-sent`. Where the assertion
   * is about one specific template, use
   * `assertNotificationDetailRowForTemplate` instead so a row belonging to a
   * different template cannot satisfy it.
   */
  async assertNotificationDetailRow(action, key, valueSubstring) {
    const entry = toXPathString(action)
    const dt = toXPathString(key)
    const needle = toXPathString(valueSubstring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action=${entry}]` +
          `//dt[normalize-space(.)=${dt}]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  /**
   * As `assertNotificationDetailRow`, but additionally scoped to the audit
   * entry whose "Notification type" row is `template`. Required whenever the
   * asserted value is not unique to the template under test — e.g. the England
   * regulator mailbox is the recipient of both RegulatorSubmission (fired on
   * submit) and OfficerAssignment, so an unscoped Recipient assertion would
   * pass on the submit entry alone and could never fail.
   */
  async assertNotificationDetailRowForTemplate(
    action,
    template,
    key,
    valueSubstring
  ) {
    const entry = toXPathString(action)
    const tpl = toXPathString(template)
    const dt = toXPathString(key)
    const needle = toXPathString(valueSubstring)
    await expect(
      $(
        `//*[@data-testid="work-item-audit-log"]//li[@data-action=${entry}]` +
          `[.//dt[normalize-space(.)="Notification type"]/following-sibling::dd[contains(.,${tpl})]]` +
          `//dt[normalize-space(.)=${dt}]/following-sibling::dd[contains(.,${needle})]`
      )
    ).toBeDisplayed()
  }

  /**
   * Assert that a failed-notification audit entry renders with the
   * visually-distinct error styling RA-234 introduced: the failure CSS
   * class `app-audit-entry--failure` (a red left border) on the entry and
   * the red GOV.UK "Failed" tag inside it.
   */
  async assertNotificationFailureStyling() {
    const failureEntry = $(
      '//*[@data-testid="work-item-audit-log"]//li[contains(@class,"app-audit-entry--failure")]'
    )
    await expect(failureEntry).toBeDisplayed()
    await expect(
      failureEntry.$('.//*[contains(@class,"govuk-tag--red")]')
    ).toHaveText('Failed')
  }

  async assertNoTemplateVersionOnAuditLog() {
    await expect(
      $(
        '//*[@data-testid="work-item-audit-log"]//dt[normalize-space(.)="Template version"]'
      )
    ).not.toBeExisting()
  }

  async assertOperatorEmail(email) {
    await expect(
      $(
        `//*[contains(@class,"govuk-summary-list__value") and contains(.,"${email}")]`
      )
    ).toBeDisplayed()
  }

  // ── RA-295 AC01: case header ─────────────────────────────────────────────── //

  /** The case header panel that sits directly under the service navigation. */
  caseHeader() {
    return $('[data-testid="case-header"]')
  }

  /**
   * A single case-header field element, keyed by the logical names in
   * CASE_HEADER_FIELDS (e.g. 'orgName', 'dueOn'). Scoped to the header so a
   * value repeated elsewhere on the page cannot satisfy a header assertion —
   * "Plastic" appears in both the header and the Material detail row, so an
   * unscoped material assertion could never fail.
   */
  caseHeaderField(name) {
    const testId = CASE_HEADER_FIELDS[name]
    if (!testId) {
      throw new Error(`Unknown case header field "${name}"`)
    }
    return this.caseHeader().$(`[data-testid="${testId}"]`)
  }

  async caseHeaderFieldText(name) {
    return this.caseHeaderField(name).getText()
  }

  async hasCaseHeaderField(name) {
    return this.caseHeaderField(name).isExisting()
  }

  /**
   * Whether the header's "Due on" carries a real date rather than the em-dash
   * "no value" fallback.
   *
   * RA-295 replaces the old SLA tracker badge with this absolute due date, so
   * this is what "the caseworker can see the SLA clock is running" looks like
   * after the redesign. Asserting the field merely EXISTS would not do — it is
   * rendered either way, showing an em dash when no clock has started.
   */
  async hasRealDueOn() {
    if (!(await this.hasCaseHeaderField('dueOn'))) {
      return false
    }
    const text = (await this.caseHeaderFieldText('dueOn')).trim()
    return text !== '' && text !== '—'
  }

  /**
   * Click the header's "Applications" link and wait until the browser is
   * actually on the Applications list. The AC is that the link *takes you
   * back to the list page*, so asserting the href alone would not prove it —
   * the click and the resulting navigation are the behaviour under test.
   */
  async clickApplicationsLink() {
    await this.caseHeaderField('applicationsLink').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/work-items',
      {
        timeout: 10000,
        timeoutMsg:
          'Expected the case header "Applications" link to navigate back to /work-items'
      }
    )
  }

  // ── RA-295: markup the redesign removes ──────────────────────────────────── //

  /**
   * The RA-98 reference-implementation notification banner ("Re-accreditation
   * work item" / "Reference implementation showing how a module supplies its
   * own detail template"), which AC01 removes.
   *
   * Deliberately matched on its body text rather than on
   * `.govuk-notification-banner` generally: the flash banner, the create
   * success banner and the notification-failure banner are all GOV.UK
   * notification banners too, so asserting "no notification banner exists"
   * would fail for unrelated, wanted reasons — and would pass vacuously on a
   * page where the RA-98 banner had merely been restyled.
   */
  ra98ReferenceBanner() {
    return $(
      '//*[contains(@class,"govuk-notification-banner")]' +
        '[contains(.,"Reference implementation showing how a module supplies its own detail template")]'
    )
  }

  /**
   * The SLA tracker badge — the "On track" / "At risk" / "Breached" govukTag
   * in the detail page's "SLA status" section. RA-295 removes it. The
   * container testid is the one the pre-RA-295 template stamped
   * (`sla-clock-info`), so this asserts the badge is genuinely gone rather
   * than merely renamed.
   */
  slaStatusBadge() {
    return $('[data-testid="sla-clock-info"]')
  }

  /**
   * The "View full application details" link that took the user to the
   * separate /application-details page. AC02 folds that page into the detail
   * page and removes the link.
   */
  viewApplicationDetailsLink() {
    return $('[data-testid="view-application-details-link"]')
  }

  // ── RA-295 AC02: single-page application information ─────────────────────── //

  /** The container holding the ordered application information rows. */
  applicationDetails() {
    return $('[data-testid="application-details"]')
  }

  applicationDetailRow(key) {
    return this.applicationDetails().$(`[data-testid="app-detail-row-${key}"]`)
  }

  async hasApplicationDetailRow(key) {
    return this.applicationDetailRow(key).isExisting()
  }

  async applicationDetailRowText(key) {
    return this.applicationDetailRow(key).getText()
  }

  /**
   * The application-information row keys actually rendered, in DOM order.
   *
   * Returns only keys the AC names (filtered through APPLICATION_DETAIL_ROWS)
   * so an unrelated row added later cannot break the ordering assertion, and
   * de-duplicates so a nested testid cannot report a key twice. A spec asserts
   * order by comparing this against APPLICATION_DETAIL_ROWS filtered to the
   * same set — which checks relative order without requiring every
   * conditional row to be present.
   */
  async applicationDetailRowOrder() {
    const rows = await this.applicationDetails().$$('[data-testid]')
    const seen = []
    for (const row of rows) {
      const testId = await row.getAttribute('data-testid')
      const key = (testId ?? '').replace(/^app-detail-row-/, '')
      if (
        testId?.startsWith('app-detail-row-') &&
        APPLICATION_DETAIL_ROWS.includes(key) &&
        !seen.includes(key)
      ) {
        seen.push(key)
      }
    }
    return seen
  }

  /**
   * The filenames of every supporting document listed against the sampling &
   * inspection plan row. AC02 requires ALL supporting documents to be listed,
   * so this returns the full set for a length + membership assertion; reading
   * only the first would pass against a template that renders `files[0]` and
   * stops, which is precisely the regression the AC guards against.
   */
  supportingDocumentLinks() {
    return this.applicationDetailRow('sampling-inspection-plan').$$(
      '[data-testid="app-detail-document"]'
    )
  }

  async supportingDocumentNames() {
    const links = await this.supportingDocumentLinks()
    return Promise.all([...links].map((link) => link.getText()))
  }

  /**
   * Request every supporting document's href from inside the browser session,
   * so the cookie carries over and the URL resolves against whatever host the
   * current environment's baseUrl points at (docker network name in CI,
   * localhost locally, the deployed host on BrowserStack).
   *
   * Mirrors fetchBesEvidenceFileDownloadResponse on the application-details
   * page object. Proves each listed document resolves to a real object rather
   * than just having a well-shaped href — which matters here precisely because
   * AC02 is about the documents beyond the first, the ones most likely to be
   * rendered with a copy-pasted or index-confused link.
   */
  async fetchSupportingDocumentResponses() {
    const links = await this.supportingDocumentLinks()
    const hrefs = await Promise.all(
      [...links].map((link) => link.getAttribute('href'))
    )
    return browser.execute(async (urls) => {
      const results = []
      for (const url of urls) {
        const res = await fetch(url)
        results.push({
          status: res.status,
          contentType: res.headers.get('content-type')
        })
      }
      return results
    }, hrefs)
  }

  /**
   * The "S&I updated by" uploaded-at / uploaded-by metadata, which the Jira
   * notes explicitly RETAIN through the redesign.
   */
  samplingPlanUpdatedBy() {
    return $('[data-testid="app-detail-sampling-updated-by"]')
  }

  // ── RA-295: application ref retained, moved to the bottom ────────────────── //

  /** The retained debugging application ref, relocated to the page footer. */
  footerApplicationRef() {
    return $('[data-testid="work-item-application-ref-footer"]')
  }

  /**
   * Assert the retained application ref sits AFTER the application
   * information section in document order — the Jira note is not just "keep
   * it" but "move it to the bottom of the page", so position is part of the
   * requirement. Uses an XPath `following::` axis so this is about DOM order,
   * not pixel position (mirroring assertApprovalPanelAboveSummary).
   */
  async assertApplicationRefAtBottom() {
    await expect(this.footerApplicationRef()).toBeDisplayed()
    await expect(
      $(
        '//*[@data-testid="application-details"]' +
          '/following::*[@data-testid="work-item-application-ref-footer"]'
      )
    ).toExist()
  }

  // ── RA-295 AC03: assignment panel ────────────────────────────────────────── //

  /** The bordered right-hand assignment panel. */
  assignmentPanel() {
    return $('[data-testid="case-assignment-panel"]')
  }

  /**
   * The three assignment affordances AC03 requires, scoped to the right-hand
   * panel so a control rendered elsewhere on the page cannot satisfy the AC
   * ("available on the right side panel box" is the requirement, not merely
   * "present somewhere").
   */
  assignmentControl(name) {
    const testIds = {
      selfAssign: 'self-assign-submit',
      reassign: 'assign-submit',
      unassign: 'unassign-submit'
    }
    const testId = testIds[name]
    if (!testId) {
      throw new Error(`Unknown assignment control "${name}"`)
    }
    return this.assignmentPanel().$(`[data-testid="${testId}"]`)
  }

  async hasAssignmentControl(name) {
    return this.assignmentControl(name).isExisting()
  }
}

export default new WorkItemDetailPage()
