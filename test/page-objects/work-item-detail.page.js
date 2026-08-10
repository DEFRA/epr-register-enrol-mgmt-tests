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
   * The user-facing application reference shown as the page identity.
   *
   * RA-295 removed `app-heading` / `app-heading-caption` from the detail page
   * — the case header IS the page identity now — so this reads
   * `case-header-accreditation-ref`. The RA-249 rule is unchanged: it falls
   * back to the work item id when there is no RA-* reference.
   *
   * Handles BOTH page shapes deliberately. RA-295 rebuilt the detail and
   * audit-log pages around the case header, but the tasks sub-page still uses
   * the shared `appHeading` macro and its `app-heading-caption`. RA-196
   * asserts the reference on both, so a helper that understood only one of
   * them would force that spec to know which page it is on — exactly the
   * detail a page object exists to absorb.
   *
   * Prefers the caption when present so the tasks page keeps its existing
   * "Work item {ref}" text, and falls back to the case header elsewhere.
   */
  async getCaption() {
    const caption = await $('[data-testid="app-heading-caption"]')
    if (await caption.isExisting()) {
      return caption.getText()
    }
    return this.caseHeaderFieldText('accreditationRef')
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

  /**
   * Assign the work item to a specific user.
   *
   * RA-295 (AC03) turned "Reassign the application" into a LINK, so the
   * assignee picker moved off the detail page onto a GET interstitial at
   * /work-items/{id}/assign (the same pattern as withdraw in RA-188 and query
   * in RA-291). The POST target is unchanged.
   *
   * Kept as one method rather than exposing the interstitial to callers: a
   * dozen specs across the suite just want "make this item assigned to X" and
   * have no interest in how many pages that now takes. Navigating via the
   * panel link rather than typing the URL means the specs still exercise the
   * affordance AC03 is actually about.
   */
  async assignTo(userId) {
    await this.assignmentControl('reassign').click()
    await $('[data-testid="assign-form"]').waitForDisplayed()
    await $('[data-testid="assign-select"]').selectByAttribute('value', userId)
    await $('[data-testid="assign-submit"]').click()
    await this.waitForDetailUrl()
  }

  /**
   * Clear the assignee via the unassign interstitial.
   *
   * The "Unassign the application" link is present in EVERY state (AC03), so
   * the interstitial has to cope with an item that is already unassigned — in
   * that case it renders `unassign-already-unassigned` and no submit button.
   * This throws rather than silently doing nothing in that situation, so a
   * caller whose assumptions have drifted gets a clear diagnostic instead of
   * an assertion failure several steps later.
   */
  async unassign() {
    await this.assignmentControl('unassign').click()
    const submit = await $('[data-testid="unassign-submit"]')
    if (!(await submit.isExisting())) {
      throw new Error(
        'unassign(): the item is already unassigned (the interstitial rendered ' +
          'unassign-already-unassigned and offered no submit button)'
      )
    }
    await submit.click()
    await this.waitForDetailUrl()
  }

  /**
   * Wait for a POST-redirect-GET back onto the work item detail page. The
   * assignment interstitials redirect to /work-items/{id} on success; without
   * this the caller races the navigation and reads the interstitial's DOM.
   */
  async waitForDetailUrl() {
    await browser.waitUntil(
      async () =>
        /\/work-items\/[^/]+$/.test(new URL(await browser.getUrl()).pathname),
      {
        timeout: 10000,
        timeoutMsg: 'Expected to land back on the work item detail page'
      }
    )
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
    // RA-372: wait for the navigation to land. Callers that go straight into
    // an auto-waiting matcher never noticed the gap, but a caller that reads
    // the DOM once — counting the rendered tasks, say — would otherwise race
    // the click and read the detail page it just left.
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/tasks$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg: 'Expected to land on the tasks page'
      }
    )
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
   * RA-372. Complete a task via its "Mark complete" button rather than the
   * status select.
   *
   * Both routes end at the same place, but this one is the affordance a
   * caseworker actually reaches for, and it is the route that has to keep
   * working while the application sits in `updated` — the whole point of the
   * bug. Waits for the PRG redirect for the same reason setTaskStatus does.
   */
  async completeTask(task) {
    await $(`[data-testid="complete-task-${task}"]`).click()
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/tasks$/.test(await browser.getUrl()),
      {
        timeout: 10000,
        timeoutMsg: `Expected tasks page URL after completing "${task}"`
      }
    )
  }

  /**
   * RA-372. Whether a given task is rendered on the tasks page at all.
   *
   * The tasks page groups by status, so a task can move between headings
   * between visits; `work-item-task-<taskId>` is on the list item itself and
   * is therefore stable across those moves.
   */
  async hasTask(task) {
    return $(`[data-testid="work-item-task-${task}"]`).isExisting()
  }

  /**
   * RA-372. Every task id currently rendered on the tasks page, in DOM order.
   *
   * Returned rather than asserted so a spec can prove BOTH halves of "the
   * tasks of the state the query was raised from": the expected ids are
   * present AND no other state's ids have leaked in. Asserting presence alone
   * would pass against a page that rendered the union of every state's tasks.
   */
  async taskIds() {
    // Scoped to `li` on purpose: the DETAIL page carries
    // `work-item-task-progress`, which a bare prefix match would happily
    // report as a task called "progress".
    const items = await $$('li[data-testid^="work-item-task-"]')
    const ids = []
    for (const item of items) {
      const testId = await item.getAttribute('data-testid')
      ids.push(testId.replace('work-item-task-', ''))
    }
    return ids
  }

  /**
   * RA-372. The "No tasks are required for this work item in its current
   * state." message. This is exactly what the bug rendered for an `updated`
   * application, so its ABSENCE is the primary regression assertion.
   */
  async hasNoTasksMessage() {
    return $('[data-testid="work-item-no-tasks"]').isExisting()
  }

  /**
   * RA-372. The `govuk-tag--*` modifier on the case header's status badge.
   *
   * Needed because `assessment-in-progress` and `updated` deliberately share
   * the display name "Updated" (RA-324 AC06, confirmed with the backend and
   * explicitly not reconciled), so `assertState('Updated')` cannot tell the
   * two apart — and telling them apart is the entire subject of this story.
   * The badge colour does distinguish them: `updated` is turquoise,
   * `assessment-in-progress` is blue (see `state-badge.js` in management-fe).
   */
  async stateTagClass() {
    const tag = await $('[data-testid="work-item-state-tag"]')
    if (!(await tag.isExisting())) {
      return ''
    }
    return (await tag.getAttribute('class')) ?? ''
  }

  /**
   * Polls rather than reading once, because callers reach for this straight
   * after an action that PRG-redirects. `getAttribute` is a single shot with
   * none of the implicit waiting the expect-webdriverio matchers do, so a
   * one-shot read here would intermittently assert against the pre-redirect
   * page — the classic source of a flaky state assertion.
   */
  async assertStateTagClass(modifier) {
    await browser.waitUntil(
      async () => (await this.stateTagClass()).split(/\s+/).includes(modifier),
      {
        timeout: 10000,
        timeoutMsg: `Expected the status badge to carry "${modifier}"`
      }
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
    // RA-295 removed `work-item-summary`, which this used as the "everything
    // else on the page" landmark. Re-pointed at `application-details`, which
    // is the section that now occupies that position.
    //
    // This is not a cosmetic swap: an XPath naming a testid that no longer
    // exists anywhere can never match, so leaving it would have turned an
    // ordering guarantee into a permanently failing assertion (and, had it
    // been written as a negative, into one that could never fail).
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="application-details"]'
      )
    ).toExist()
    // The decision metadata must sit between the panel and the details.
    await expect(
      $(
        '//*[@data-testid="re-accreditation-approval-panel"]' +
          '/following::*[@data-testid="re-accreditation-decision-metadata"]' +
          '/following::*[@data-testid="application-details"]'
      )
    ).toExist()
  }

  async addNote(text) {
    await $('[data-testid="note-text"]').setValue(text)
    await $('[data-testid="add-note-submit"]').click()
  }

  /**
   * Open the audit log.
   *
   * RA-295 replaced the "View audit log" link (`work-item-audit-log-link`,
   * now gone) with the "Application history" tab. The route is unchanged, so
   * the dozen specs that call this are unaffected by the change of
   * affordance — which is the point of it living here.
   */
  async gotoAudit() {
    await this.tab('history').click()
    await browser.waitUntil(
      async () => /\/work-items\/[^/]+\/audit/.test(await browser.getUrl()),
      { timeoutMsg: 'Expected audit log URL after clicking the history tab' }
    )
  }

  /**
   * RA-372. The state transitions the audit log shows, in order — one entry
   * per `action-applied`, each as `"<from> → <to>"`.
   *
   * The audit log is where a state machine's edges become observable to a
   * regulator: management-fe's `summariseAuditEntry` renders every applied
   * action as `Action (from → to)` in the visible summary line, so this reads
   * the rendered page rather than reaching into the backend for
   * `fromStateId`.
   *
   * Returned as an ordered list rather than asserted one entry at a time so a
   * spec can pin the whole path. That matters for a waypoint state: whether
   * the waypoint was discharged through a declared edge or jumped across an
   * undeclared one is visible ONLY in the shape of the sequence — the start
   * and end states are identical either way.
   */
  async appliedTransitions() {
    const entries = await $$(
      '[data-testid="work-item-audit-log"] li[data-action="action-applied"]'
    )
    const transitions = []
    for (const entry of entries) {
      const text = await entry.getText()
      const match = text.match(/\(([^)]*→[^)]*)\)/)
      transitions.push(
        match ? match[1].trim() : text.replace(/\s+/g, ' ').trim()
      )
    }
    return transitions
  }

  /**
   * RA-372. Whether an error summary is on the page.
   *
   * Deliberately reads the GOV.UK class, not the message. The copy belongs to
   * management-fe (and `epr-ewv8` is filed to change it), so pinning it here
   * would cement wording another repo intends to move — the same rule
   * `assertAssignRefused` below states for management-be's 409 text. What
   * this suite is entitled to assert is that the caseworker was NOT shown a
   * problem.
   */
  async hasErrorSummary() {
    return $('.govuk-error-summary').isExisting()
  }

  /**
   * A case tab. Note the ACTIVE tab renders as a <span aria-current="page">
   * and only the inactive one is an <a>, so callers must not assume both are
   * clickable — assert with isActiveTab() rather than clicking blindly.
   */
  tab(name) {
    const testIds = {
      summary: 'tab-application-summary',
      history: 'tab-application-history'
    }
    const testId = testIds[name]
    if (!testId) {
      throw new Error(`Unknown case tab "${name}"`)
    }
    return $(`[data-testid="${testId}"]`)
  }

  async isActiveTab(name) {
    return (await this.tab(name).getAttribute('aria-current')) === 'page'
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
   * RA-372. The text of the generic flash banner, for callers that need to
   * distinguish WHICH operation flashed it rather than merely that one did.
   */
  async flashBannerText() {
    return $('[data-testid="work-item-flash-banner"]').getText()
  }

  /**
   * RA-372. The detail page's read-only "N of M tasks complete." line.
   *
   * The detail page and the tasks page render the empty case with the SAME
   * `work-item-no-tasks` testid, so this is the positive counterpart on the
   * detail side — it exists only when the work item has tasks at all.
   */
  async taskProgressText() {
    return $('[data-testid="work-item-task-progress"]').getText()
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

  /**
   * RA-295 moved the operator email out of the removed envelope summary list
   * into the retained reference block at the foot of the page. Scoped to that
   * row so the assertion cannot pass on the address appearing somewhere else
   * (it is also rendered in notification audit entries).
   */
  async assertOperatorEmail(email) {
    await expect(this.referenceRow('operator-email')).toHaveText(
      expect.stringContaining(email)
    )
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

  /**
   * Whether a case-header field is present.
   *
   * Guarded, because the field selectors are SCOPED to the header container:
   * calling `.$()` on an element that does not exist throws rather than
   * returning a not-found element, so on a page with no case header at all
   * this would raise `Can't call $ on element with selector
   * "[data-testid=case-header]"` instead of answering "no". A predicate named
   * `has…` must return a boolean for every page it is pointed at — callers
   * (and `hasRealDueOn` below) branch on it.
   */
  async hasCaseHeaderField(name) {
    if (!(await this.caseHeader().isExisting())) {
      return false
    }
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
    return this.documentLinksIn('sampling-inspection-plan')
  }

  /**
   * Every document link inside one application-details row, scoped to that
   * row. Parameterised because the BES-evidence row renders the same document
   * markup as the sampling & inspection plan and needs the same download
   * coverage — `download-file.controller.js` reaches BES files through a
   * SEPARATE `overseasSites.sites[].besEvidence.files` lookup, so proving the
   * sampling branch resolves says nothing about the BES one.
   */
  documentLinksIn(rowKey) {
    return this.applicationDetailRow(rowKey).$$(
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
  async fetchSupportingDocumentResponses(rowKey = 'sampling-inspection-plan') {
    const links = await this.documentLinksIn(rowKey)
    const allHrefs = await Promise.all(
      [...links].map((link) => link.getAttribute('href'))
    )
    // A document is only an <a> when it is `scanStatus: "Clean"` and has a
    // fileId; a quarantined or still-scanning file is listed as a <span> with
    // a govuk-tag and no href. Those are correctly not downloadable, so they
    // are filtered out rather than counted as failures — the caller asserts on
    // the documents that SHOULD resolve.
    const hrefs = allHrefs.filter(Boolean)
    const responses = await browser.execute(async (urls) => {
      const results = []
      for (const url of urls) {
        const res = await fetch(url)
        results.push({
          status: res.status,
          contentType: res.headers.get('content-type'),
          // The response BODY is the only thing that distinguishes the two
          // seeded objects. Status and content-type are identical for both,
          // so an href bug serving document one for both entries would look
          // like two healthy 200s — which is exactly the failure the backend
          // seeder warns about when it says to keep the two s3Keys distinct.
          body: await res.text()
        })
      }
      return results
    }, hrefs)
    // Returned alongside so a caller can assert the links are distinct even
    // before fetching anything.
    return responses.map((r, i) => ({ ...r, href: hrefs[i] }))
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
  /**
   * The three assignment affordances AC03 requires, scoped to the right-hand
   * panel so a control rendered elsewhere cannot satisfy the AC ("available on
   * the right side panel box" is the requirement, not merely "present").
   *
   * `reassign` and `unassign` are LINKS to interstitials, not submit buttons —
   * AC03 says "link", so the pickers moved off this page. The `assign-submit`
   * / `unassign-submit` buttons now live on those interstitials and are NOT
   * in this panel.
   */
  assignmentControl(name) {
    const testIds = {
      selfAssign: 'self-assign-submit',
      reassign: 'reassign-link',
      unassign: 'unassign-link'
    }
    const testId = testIds[name]
    if (!testId) {
      throw new Error(`Unknown assignment control "${name}"`)
    }
    return this.assignmentPanel().$(`[data-testid="${testId}"]`)
  }

  /** Guarded for the same reason as hasCaseHeaderField — the control
   * selectors are scoped to the panel, so a missing panel would throw
   * rather than answer "no". */
  async hasAssignmentControl(name) {
    if (!(await this.assignmentPanel().isExisting())) {
      return false
    }
    return this.assignmentControl(name).isExisting()
  }

  /**
   * RA-358 (assignment gating). Whether an assignment affordance is actually
   * USABLE — i.e. a live control the caseworker can act on.
   *
   * Deliberately tolerant of two valid implementations, because the
   * requirement is "a closed case offers no assignment affordance", not "the
   * markup is shaped a particular way": management-fe may either omit the
   * control entirely, or follow the RA-335 precedent and render an inert
   * `<span>` with the same test id (which `appActionLink` already does for
   * read-only users). Both satisfy the AC; a live `<a>` or `<button>` does
   * not, and that is what this returns true for.
   *
   * Written this way so the spec pins the behaviour rather than the choice
   * between those two, and does not need rewriting when the choice is made.
   */
  async hasUsableAssignmentControl(name) {
    if (!(await this.hasAssignmentControl(name))) {
      return false
    }
    const control = this.assignmentControl(name)
    const tagName = (await control.getTagName()).toLowerCase()
    if (tagName === 'span') {
      return false
    }
    // A link is only usable if it actually navigates; `appActionLink` drops
    // the href rather than the element in some states.
    if (tagName === 'a') {
      return Boolean(await control.getAttribute('href'))
    }
    return await control.isEnabled()
  }

  /**
   * RA-358. The panel's terminal-state explanation, which REPLACES the three
   * affordances on a closed case rather than merely disabling them.
   */
  assignmentClosedNotice() {
    return $('[data-testid="assignment-closed"]')
  }

  /**
   * RA-358. Assert a terminal-state case offers no usable assignment
   * affordance at all.
   *
   * Pairs the negative with a POSITIVE hook on purpose. management-fe
   * suppresses the three controls from the DOM, so an absence-only assertion
   * would also pass if the panel failed to render for an unrelated reason —
   * the page erroring, the testids being renamed, or the item not loading at
   * all. That is precisely how a false "pre-existing failure" wasted time
   * earlier in this work. Requiring `assignment-closed` to be displayed means
   * the panel demonstrably rendered and deliberately said the case is closed,
   * so the absences below are meaningful rather than vacuous.
   *
   * Checks all three affordances together and reports which survived, so a
   * failure names the offender instead of stopping at the first.
   */
  async assertNoUsableAssignmentAffordances() {
    await expect(this.assignmentPanel()).toBeDisplayed()
    await expect(this.assignmentClosedNotice()).toBeDisplayed()

    const names = ['selfAssign', 'reassign', 'unassign']
    const usable = []
    for (const name of names) {
      if (await this.hasUsableAssignmentControl(name)) {
        usable.push(name)
      }
    }
    expect(usable).toEqual([])
  }

  /**
   * RA-358. Assert an assign attempt on a terminal work item was REFUSED.
   *
   * management-be returns 409 and management-fe's BFF maps it to an error
   * render rather than a redirect, so the browser stays on the interstitial
   * URL and shows a GOV.UK error summary. Both are asserted: the error
   * summary alone would also appear for an ordinary validation failure, and
   * the URL alone would not distinguish a refusal from a page that simply
   * never submitted.
   *
   * The 409's COPY is deliberately not pinned. management-be owns that
   * wording, it changed once already during this work (it used to embed the
   * work item GUID, which RA-358 exists to remove), and its own tests cover
   * it. What this suite is entitled to assert is that the call was refused.
   */
  async assertAssignRefused() {
    const submit = $('button[type="submit"]')
    await submit.waitForClickable({
      timeout: 10000,
      timeoutMsg: 'Expected the assign interstitial to offer a submit button'
    })
    await submit.click()

    const errorSummary = $('.govuk-error-summary')
    await errorSummary.waitForDisplayed({
      timeout: 10000,
      timeoutMsg:
        'Expected an error summary after assigning a terminal work item'
    })
    const url = new URL(await browser.getUrl())
    expect(url.pathname).toMatch(/\/assign$/)
  }

  /**
   * Read the session's CSRF crumb from any form the current page rendered.
   *
   * The crumb cookie is HttpOnly by design, so the token has to come from a
   * hidden field rather than `document.cookie`. It is per-session, not
   * per-form, so a crumb captured on one page stays valid on another — which
   * is what makes the stale-form scenario below reproducible.
   */
  async readCrumb() {
    return browser.execute(
      () => document.querySelector('input[name="crumb"]')?.value
    )
  }

  /**
   * RA-358. POST the self-assign route directly, as a stale form would.
   *
   * Self-assign is a POST-only route with its own controller
   * (`makeSelfAssignController`), separate from the assign/reassign
   * interstitial, and it re-renders the detail page on failure rather than
   * redirecting. Once management-fe hides the button on a closed case there
   * is no clickable path left, so the only way to exercise the route — and
   * the real journey it models, a page opened before the case was withdrawn
   * and submitted after — is to post the captured crumb.
   *
   * `fetch` attaches the session cookies itself for a same-origin request.
   */
  async postSelfAssign(workItemId, crumb) {
    return browser.execute(
      async (id, crumbValue) => {
        const res = await fetch(`/work-items/${id}/self-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `crumb=${crumbValue}`
        })
        const body = await res.text()
        return {
          status: res.status,
          hasErrorSummary: body.includes('govuk-error-summary'),
          mentionsAssign: /assign/i.test(body)
        }
      },
      workItemId,
      crumb
    )
  }

  /**
   * The panel's assignment status line, reading exactly "Unassigned",
   * "Assigned to {Name}" or "Assigned to you".
   */
  assignmentCurrent() {
    return $('[data-testid="assignment-current"]')
  }

  // ── RA-295: the retained reference block at the foot of the page ─────────── //

  /**
   * A row in the reference block, keyed by the field name in its testid (e.g.
   * 'operator-registration-id', 'application-reference', 'operator-email').
   *
   * Rows with no value are OMITTED entirely rather than rendered with an em
   * dash — so absence is the correct assertion for missing data here, unlike
   * the case header where the field renders with a dash. Getting that backwards
   * gives a test that can never fail.
   */
  referenceRow(key) {
    return this.footerApplicationRef().$(
      `[data-testid="work-item-reference-row-${key}"]`
    )
  }

  async hasReferenceRow(key) {
    if (!(await this.footerApplicationRef().isExisting())) {
      return false
    }
    return this.referenceRow(key).isExisting()
  }

  async referenceRowText(key) {
    return this.referenceRow(key).getText()
  }

  /**
   * The value cell of an application-information row. Rows also carry
   * `app-detail-value-{key}` on the value side, so assertions can target the
   * submitted data without matching the row's own label — which matters for
   * short values ("Plastic") that could otherwise be satisfied by the label.
   */
  applicationDetailValue(key) {
    return this.applicationDetails().$(
      `[data-testid="app-detail-value-${key}"]`
    )
  }

  /** The "no supporting documents" empty state on the sampling plan row. */
  noDocumentsMessage() {
    return $('[data-testid="app-detail-documents-none"]')
  }

  // ── RA-295: prior-year section, folded onto the detail page ─────────────── //

  /**
   * The RA-254 prior-year block, which moved onto the detail page with the
   * rest of the application-details content.
   *
   * management-fe renders it only when the backend prior-year lookup succeeds
   * and is absent entirely when it fails, so callers must treat it as
   * optional rather than assuming it is always present.
   */
  priorYear(part = 'details') {
    const testIds = {
      heading: 'prior-year-heading',
      details: 'prior-year-details',
      tonnage: 'prior-year-tonnage',
      authorisers: 'prior-year-authorisers',
      businessPlan: 'prior-year-business-plan'
    }
    const testId = testIds[part]
    if (!testId) {
      throw new Error(`Unknown prior-year part "${part}"`)
    }
    return $(`[data-testid="${testId}"]`)
  }

  async hasPriorYear(part = 'details') {
    return this.priorYear(part).isExisting()
  }

  /**
   * RA-358 (AC1). The prominent "this application has been withdrawn" message
   * on the detail page of a withdrawn work item.
   *
   * Before RA-358 a withdrawn item announced itself only through the grey
   * `Withdrawn` status tag in the case header and a generic "This work item is
   * in a final state" Outcome panel — neither of which tells a regulator what
   * actually happened to the application. This is the explicit message.
   */
  withdrawnNotice() {
    return $('[data-testid="work-item-withdrawn-notice"]')
  }

  async hasWithdrawnNotice() {
    return this.withdrawnNotice().isExisting()
  }

  /**
   * RA-358 (AC1). The emphasised application reference inside the withdrawn
   * message. Rendered only when the case actually has one — the copy degrades
   * to an unqualified sentence rather than falling back to the GUID — so
   * callers that may hit a reference-less item must check existence first.
   */
  withdrawnNoticeReference() {
    return $('[data-testid="work-item-withdrawn-reference"]')
  }

  async withdrawnNoticeText() {
    return this.withdrawnNotice().getText()
  }

  /**
   * RA-358 (AC1). Assert the withdrawn message is on screen and says so.
   *
   * The exact wording belongs to management-fe and content design, so this
   * matches case-insensitively on "withdrawn" rather than pinning the whole
   * sentence — a copy tweak should not turn this suite red. What RA-358
   * actually guarantees (the message exists, is visible, and names the
   * withdrawal) is asserted; the identifier rules are asserted separately by
   * `assertWithdrawnNoticeIdentifiedBy` so a failure says which half broke.
   */
  async assertWithdrawnNotice() {
    await this.withdrawnNotice().waitForDisplayed({
      timeout: 10000,
      timeoutMsg:
        'Expected a withdrawn message on the detail page of a withdrawn work item'
    })
    await expect(this.withdrawnNotice()).toHaveText(/withdrawn/i)
  }

  /**
   * RA-358 (AC1). Where the withdrawn message names the case it must use the
   * user-facing application reference, never the system-generated work item
   * GUID.
   *
   * Scoped to the message itself rather than the whole page on purpose:
   * RA-196 deliberately KEEPS a "Work item ID" summary row carrying the GUID
   * on this page for debugging, so a page-wide GUID-absence assertion would
   * fail for a reason that has nothing to do with this AC.
   */
  async assertWithdrawnNoticeIdentifiedBy(applicationReference, workItemId) {
    const text = await this.withdrawnNoticeText()
    expect(text).toContain(applicationReference)
    expect(text).not.toContain(workItemId)
    await expect(this.withdrawnNoticeReference()).toHaveText(
      applicationReference
    )
  }

  /**
   * RA-346. Is an action affordance rendered on the detail page at all?
   *
   * A transition whose `requiresAllTasksComplete` gate is unmet is filtered
   * out of `availableActions` entirely, so the button is ABSENT rather than
   * disabled — unlike the read-only support-user case (RA-335), where the
   * control renders as an inert `<span>`. Specs therefore assert existence,
   * not enabledness.
   */
  async hasAction(actionId) {
    return $(`[data-testid="action-${actionId}"]`).isExisting()
  }

  /**
   * RA-346. Every element carrying an `action-*` testid, by the suffix.
   *
   * ⚠ This is NOT the engine's `availableActions`. The `action-` testid
   * prefix is reused by two independently-rendered panels in `detail.njk`:
   *
   *  - the actions panel, whose primary buttons and secondary query/withdraw
   *    links DO come from `availableActions`;
   *  - the assignment panel, where `action-sla-extend` and
   *    `action-sla-override` render as "Change the due date" / "Override the
   *    due date" gated on `canChangeDueDate`. `sla-extend` is deliberately
   *    filtered OUT of `availableActions` by the detail controller, so those
   *    two never pass through the engine's gate at all.
   *
   * So only a `withdraw-*` / `query` / primary-button id is evidence that
   * the actions panel rendered. Using an SLA id as a negative control would
   * pass even if the actions panel were missing entirely.
   */
  async availableActionIds() {
    const elements = await $$('[data-testid^="action-"]')
    const ids = []
    for (const element of elements) {
      const testId = await element.getAttribute('data-testid')
      ids.push(testId.replace(/^action-/, ''))
    }
    return ids
  }

  // ── RA-364: the actions panel, scoped and counted ────────────────────────── //

  /**
   * The bordered actions card. Always rendered, even with no actions.
   */
  actionsPanel() {
    return $('[data-testid="actions-panel"]')
  }

  /**
   * The inner container holding the action controls. Rendered ONLY when the
   * (already filtered) action list is non-empty — management-fe filters in the
   * detail controller, before the data reaches the template, so the template's
   * length check sees the filtered list. That ordering is what makes "all
   * actions were non-caller-invocable" render the empty state rather than an
   * empty container, and is asserted by assertActionsPanelWellFormed().
   */
  workItemActions() {
    return $('[data-testid="work-item-actions"]')
  }

  /** The generic "No actions are currently available" empty state. */
  noActionsMessage() {
    return $('[data-testid="work-item-no-actions"]')
  }

  /**
   * RA-132. The re-accreditation terminal-state panel, which REPLACES the
   * generic actions panel body via the `actionsPanel` block override in
   * `re-accreditation/detail-v1.njk`. A withdrawn/granted/refused
   * re-accreditation item therefore shows THIS, not `work-item-no-actions` —
   * a distinction worth encoding, because a spec that expected the generic
   * empty state on a terminal item would fail for a reason that has nothing
   * to do with the behaviour under test.
   */
  readOnlyActionsNotice() {
    return $('[data-testid="re-accreditation-readonly-actions"]')
  }

  /**
   * RA-364. Every action control rendered INSIDE the actions panel.
   *
   * ⚠ Scoping to the panel is load-bearing, not tidiness. The `action-` testid
   * prefix is shared with the ASSIGNMENT panel, which renders `action-sla-extend`
   * and `action-sla-override` ("Change the due date" / "Override the due date")
   * gated on `canChangeDueDate`. Those two are siblings of this panel, not
   * children of it (`case-assignment-panel` and `actions-panel` are separate
   * `app-case-panel` divs), and `sla-extend` is deliberately filtered OUT of
   * `availableActions` by the detail controller — so a page-wide
   * `[data-testid^="action-"]` count silently includes up to two controls that
   * never passed through the projection this ticket is about. That is precisely
   * how a count-based assertion becomes wrong-by-two and unfalsifiable.
   *
   * `availableActionIds()` above is the page-wide version and keeps its existing
   * callers; this is the panel-scoped one. They are NOT interchangeable.
   *
   * The wrapper itself is safe: `actions-panel` does not match
   * `[data-testid^="action-"]` (the 7th character is `s`, not `-`), so the
   * container cannot inflate the count.
   */
  actionControls() {
    return this.actionsPanel().$$('[data-testid^="action-"]')
  }

  /**
   * The action ids rendered in the panel, in DOM order.
   *
   * ⚠ Duplicates are DELIBERATELY PRESERVED. RA-364 is a bug about the same
   * control being rendered four times over, so de-duplicating here — as
   * `applicationDetailRowOrder()` legitimately does for its own purposes —
   * would destroy the only evidence the bug leaves behind and turn every
   * assertion below into one that could never fail.
   */
  async actionControlIds() {
    if (!(await this.actionsPanel().isExisting())) {
      return []
    }
    const controls = await this.actionControls()
    const ids = []
    for (const control of controls) {
      const testId = await control.getAttribute('data-testid')
      ids.push((testId ?? '').replace(/^action-/, ''))
    }
    return ids
  }

  /**
   * The VISIBLE LABEL of each control in the panel, in DOM order, duplicates
   * preserved for the same reason as above.
   *
   * The label is the control's own text node — `action.displayName` straight
   * from the backend for buttons and withdraw links, and a hardcoded "Query"
   * for the query link. Labels are what the user actually sees duplicated, and
   * what the ticket's screenshot shows four of; asserting on ids alone would
   * miss a regression that reintroduced four DISTINCT ids all labelled
   * "Resume", which is exactly the shape of the original bug.
   */
  async actionControlLabels() {
    if (!(await this.actionsPanel().isExisting())) {
      return []
    }
    const controls = await this.actionControls()
    const labels = []
    for (const control of controls) {
      labels.push((await control.getText()).trim())
    }
    return labels
  }

  /**
   * How many controls in the panel carry `label`, compared case-insensitively
   * and trimmed. Used for the zero-Resume / exactly-one-Withdraw assertions:
   * a count is falsifiable against the bug, whereas "a Withdraw link exists"
   * passed happily while four broken Resume buttons sat next to it.
   */
  async countActionsLabelled(label) {
    const labels = await this.actionControlLabels()
    const needle = label.trim().toLowerCase()
    return labels.filter((text) => text.toLowerCase() === needle).length
  }

  /** How many controls in the panel carry exactly `actionId`. */
  async countActionsWithId(actionId) {
    const ids = await this.actionControlIds()
    return ids.filter((id) => id === actionId).length
  }

  /**
   * RA-364 (AC05). No action label may appear twice in the panel.
   *
   * This is the heart of the ticket, so it reports the offending labels with
   * their counts rather than just failing a length check — a bare
   * `expect(n).toBe(0)` on a regression would say "expected 4 to be 0" and
   * leave the next person to open a browser to find out which control it was.
   */
  async assertNoDuplicateActionLabels() {
    const labels = await this.actionControlLabels()
    const counts = new Map()
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label, count]) => `${label} ×${count}`)
    expect(duplicated).toEqual([])
  }

  /**
   * RA-364 (AC06). The actions panel must always be in exactly ONE of three
   * well-formed shapes, never a rendered-but-empty container:
   *
   *   1. `work-item-actions` present AND holding at least one control;
   *   2. `work-item-no-actions` — the generic empty state;
   *   3. `re-accreditation-readonly-actions` — the RA-132 terminal-state
   *      override, which replaces the panel body entirely.
   *
   * The regression this guards is specific: if the non-caller-invocable filter
   * ran AFTER the template's `availableActions.length > 0` check rather than
   * before it, a work item whose actions were all filtered away would render
   * `work-item-actions` as an EMPTY div — no controls, and no empty-state
   * message either. Asserting only "the empty state appears somewhere" would
   * not catch that; asserting the container is never empty is what does.
   */
  async assertActionsPanelWellFormed() {
    await expect(this.actionsPanel()).toBeDisplayed()

    const hasControls = await this.workItemActions().isExisting()
    const hasEmptyState = await this.noActionsMessage().isExisting()
    const hasReadOnlyNotice = await this.readOnlyActionsNotice().isExisting()

    const shapes = [hasControls, hasEmptyState, hasReadOnlyNotice].filter(
      Boolean
    ).length
    expect(shapes).toBe(1)

    if (hasControls) {
      const ids = await this.actionControlIds()
      // The container exists, so it must hold something. This is the
      // empty-panel assertion; `toBeGreaterThan(0)` on a count that came back
      // as `[]` is the failure mode being guarded.
      expect(ids.length).toBeGreaterThan(0)
    }
  }

  /**
   * RA-132 / RA-346. The re-accreditation "Approve" CTA is not a generic
   * action button — it is a type-specific link rendered by the
   * `approveAction` block in `re-accreditation/detail-v1.njk`, wrapped in
   * this container. RA-346 gates that container on the awaiting-decision
   * tasks being complete, so its presence is the thing under test.
   */
  approveCta() {
    return $('[data-testid="re-accreditation-approve-cta"]')
  }

  async hasApproveCta() {
    return this.approveCta().isExisting()
  }

  /**
   * RA-132. The approve interstitial lives on a type-specific route, not
   * under the generic `/work-items/{id}/actions/...` namespace.
   */
  approvePath(workItemId) {
    return `/work-items/re-accreditation/${workItemId}/approve`
  }

  /**
   * RA-346. Navigate straight to the approve interstitial, bypassing the
   * CTA. Hiding the CTA alone is not a control — the route itself has to
   * refuse when the decision tasks are incomplete.
   */
  async openApprovePathDirectly(workItemId) {
    await this.open(this.approvePath(workItemId))
  }

  /**
   * RA-346 (and RA-335, which established the pattern). POST to a route
   * from inside the page so the browser attaches the session cookie.
   *
   * The crumb cookie is HttpOnly by design, so the CSRF token is read from
   * whichever hidden `crumb` field the currently-rendered page already
   * carries — otherwise the request would be rejected as a CSRF failure and
   * we would learn nothing about the business-rule gate we are testing.
   *
   * Returns `{ status, redirected, url }` rather than a bare status because
   * the two guarded routes refuse in two different shapes: the generic
   * apply-action route re-renders in place with a 409, while the
   * re-accreditation approve route follows this app's PRG convention and
   * 302s back to the detail page. `redirect: 'manual'` is deliberately NOT
   * used — it yields an opaque response with status 0 and no readable
   * headers, so the redirect is followed and asserted via `redirected` +
   * the final `url` instead.
   */
  async postFromPage(path) {
    return browser.execute(async (url) => {
      const crumb = document.querySelector('input[name="crumb"]')?.value ?? ''
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `crumb=${encodeURIComponent(crumb)}`
      })
      return {
        status: response.status,
        redirected: response.redirected,
        url: response.url
      }
    }, path)
  }
}

export default new WorkItemDetailPage()
