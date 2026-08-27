import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

/** Prefix-matched testid of an application card's "open this item" link. */
const WORK_ITEM_LINK_SELECTOR = '[data-testid^="work-item-link-"]'

/** The results summary line ("Showing {start}-{end} of {total}"). */
const WORK_ITEMS_SUMMARY_SELECTOR = '[data-testid="work-items-summary"]'

/**
 * Card field keys that both the field-order contract below and the per-field
 * accessors further down refer to. Named so the two never drift apart.
 */
const SUBMITTED_ON_FIELD = 'submitted-on'
const ASSIGNED_TO_FIELD = 'assigned-to'

/**
 * RA-370 (supersedes RA-324 AC05). The order in which an application card
 * renders its fields — the story's field list, verbatim and in order:
 * application ref, org name, org ID, material type, applicant type, submitted
 * on, assigned to, due date.
 *
 * Changes vs the RA-324 phase-2 order this replaces:
 *   - org-name/org-id now come BEFORE material/applicant-type (the title line
 *     was reworded from "Reprocessor reaccreditation: {Material}" to
 *     "{Material} reaccreditation (Reprocessor)", so material precedes
 *     applicant type);
 *   - submitted-on is back on the card, between applicant-type and
 *     assigned-to, shown only while the assessment has not started;
 *   - assigned-to is no longer gated on the SLA clock — it renders on every
 *     card, "Unassigned" when nobody holds it.
 *
 * NOT listed here: the id-keyed status tag (its position is RA-324's concern,
 * not a story field) and registration-number (RA-295 AC06 — it renders between
 * org-id and material but is outside the RA-370 field list, so keeping it out
 * of this constant lets each ticket's contract move independently).
 *
 * This is an ORDERING contract, not a presence one — some of the entries are
 * conditional, so treat the list as the sequence a card's fields must respect
 * rather than the set it must contain:
 *   - org-id renders only `{% if item.orgId %}`, and orgId maps to
 *     payload.operatorOrganisationId — RA-448 made this a required field on
 *     the UI "Create work item" form (previously it was never set for
 *     UI-created items, so the tile never rendered for them; now it always
 *     does unless a spec deliberately omits it, which the schema no longer
 *     allows for a submission to succeed);
 *   - submitted-on and due-on are exact inverses, so a card carries one or the
 *     other and never both.
 *
 * Exported so the specs assert against the same source of truth the page
 * object reads, rather than a second hand-kept copy.
 */
export const TILE_FIELD_ORDER = [
  'application-ref',
  'org-name',
  'org-id',
  'material',
  'applicant-type',
  SUBMITTED_ON_FIELD,
  ASSIGNED_TO_FIELD,
  'due-on'
]

class WorkItemsPage extends Page {
  /**
   * RA-299 (AC10/14). An explicit, empty filter submission — resets the
   * currently-displayed list AND overwrites the session's "last applied"
   * filters with an empty state, so a subsequent bare goto() genuinely shows
   * the AC06/AC08 defaults rather than restoring whatever an earlier test in
   * the same session happened to leave behind. Use this between tests that
   * apply different filters within one login/session, instead of goto()
   * (which now deliberately restores prior session state — that IS the
   * behaviour under test in the session-persistence spec, but it is a trap
   * for any other test that assumes goto() is a stateless reset).
   */
  async resetFilters() {
    await this.open('/work-items?filtersApplied=1')
    await this.worklistSummary().waitForDisplayed()
  }

  async goto() {
    await this.open('/work-items')
    // RA-324: the work-items list was redesigned into the "Applications"
    // tiles page. The route is unchanged (/work-items) but the H1 now reads
    // "Applications"; the nav LINK that reaches this page stays labelled
    // "Work items".
    await expect($('[data-testid="app-heading-title"]')).toHaveText(
      'Applications'
    )
  }

  async clickCreateWorkItem() {
    await $('[data-testid="work-items-create-link"]').click()
    await browser.waitUntil(async () =>
      (await browser.getUrl()).includes('/work-items/re-accreditation/new')
    )
  }

  async createWorkItem(opts) {
    await this.clickCreateWorkItem()
    // The application reference is no longer entered on the form — the
    // case management backend generates it on submission. Callers read
    // it back from the success banner after the work item is created.
    // Email field is pre-filled with test@defra.gov.uk. Callers
    // may override via opts.operatorEmail; otherwise we leave the default value
    // in place.
    if (opts.operatorEmail !== undefined) {
      await $('#field-operatorEmail').setValue(opts.operatorEmail)
    }
    await $('#field-organisationName').setValue(opts.organisationName)
    // RA-448. Both fields are pre-filled with a demo value (500001 /
    // reg-demo-001) on GET, same convention as operatorEmail above — most
    // callers don't care about the specific value, only that one is set, so
    // only override when the spec actually supplies one. management-be's
    // accreditation-number adapter now requires operatorOrganisationId to
    // be a real numeric 6-digit Org ID for EVERY work item, regardless of
    // how it was created.
    if (opts.operatorOrganisationId !== undefined) {
      await $('#field-operatorOrganisationId').setValue(
        opts.operatorOrganisationId
      )
    }
    // RA-448 phase 2 review: management-be's accreditation-number adapter
    // sends this (not operatorRegistrationId) as the backend's
    // {applicationId} route segment. Pre-filled with a value GENERATED
    // FRESH per GET (unlike the other demo fields, which are fixed) —
    // management-be's own submission idempotency check (RA-311/MBE-3)
    // treats a matching operatorApplicationId on an existing item as a
    // replay, so a shared literal here would collapse every UI-created
    // item across a run onto whichever was created first.
    if (opts.operatorApplicationId !== undefined) {
      await $('#field-operatorApplicationId').setValue(
        opts.operatorApplicationId
      )
    }
    if (opts.operatorRegistrationId !== undefined) {
      await $('#field-operatorRegistrationId').setValue(
        opts.operatorRegistrationId
      )
    }
    await $('#field-siteAddress-line1').setValue(opts.siteAddressLine1)
    // The create form pre-fills line 2 with example text, so an empty
    // string means "clear the field" rather than "leave the default".
    if (opts.siteAddressLine2 !== undefined) {
      const line2 = await $('#field-siteAddress-line2')
      await line2.clearValue()
      if (opts.siteAddressLine2 !== '') {
        await line2.setValue(opts.siteAddressLine2)
      }
    }
    await $('#field-siteAddress-town').setValue(opts.siteAddressTown)
    await $('#field-siteAddress-postcode').setValue(opts.siteAddressPostcode)
    await $('#field-material').selectByAttribute('value', opts.material)
    await $('#field-tonnageBand').selectByAttribute('value', opts.tonnageBand)
    // RA-316. The charge is an optional passthrough field taking an INTEGER
    // NUMBER OF PENCE — no fee arithmetic happens anywhere in the stack, so
    // whatever a caller supplies is exactly what the duly-making page later
    // renders (divided by 100).
    //
    // THERE IS NO PREFILL. The field is empty by default and nothing
    // defaults it anywhere in the stack, so an item created without this
    // renders "Not provided" as its charge. That is deliberate: a demo item
    // has no charge to populate FROM, and inventing one would put a
    // plausible fabricated figure on the screen where a regulator confirms
    // payment. Any spec asserting a charge must therefore supply one — and
    // if it forgets, the charge assertion fails rather than passing on a
    // borrowed default, which is the right way round.
    //
    // Left untouched when the caller says nothing, so the many existing
    // callers that never mention a charge are unaffected — same contract as
    // `operatorEmail` above.
    //
    // A real visible input rather than schema-only passthrough, deliberately:
    // the create schema validates with `stripUnknown: true`, so a value with
    // no matching form control would be dropped silently, with no error and
    // no way for this form-driving page object to reach it.
    if (opts.chargeAmountPence !== undefined) {
      await $('#field-chargeAmountPence').setValue(
        String(opts.chargeAmountPence)
      )
    }
    await $('[data-testid="create-work-item-submit"]').click()
    const banner = await $('[data-testid="work-item-success-banner"]')
    await expect(banner).toBeDisplayed()
    // The banner renders "Reference: AP..." (RA-318: AP + year + agency +
    // orgId + postcode suffix + material prefix, max 18 chars) — pull the
    // server-generated reference out of it for later assertions. Fail
    // loudly if it is absent so callers get a clear diagnostic rather
    // than a confusing "null did not match" assertion downstream.
    const bannerText = await banner.getText()
    const match = bannerText.match(/AP[A-Z0-9]+\b/)
    if (!match) {
      throw new Error(
        `success banner had no AP-prefixed reference: "${bannerText}"`
      )
    }
    const applicationReference = match[0]
    const url = await browser.getUrl()
    const id = url.split('/').pop()
    return { id, applicationReference }
  }

  async openWorkItem(id) {
    await this.open(`/work-items/${id}`)
  }

  /**
   * Open the first work item currently listed by clicking its row link.
   * Used to reach a backend-seeded item whose id is not known to the test —
   * pair it with a bounding search (e.g. searchByOrgName) so exactly one row
   * is present and the "first" row is unambiguous.
   */
  async openFirstListedWorkItem() {
    const link = await $(WORK_ITEM_LINK_SELECTOR)
    await link.waitForClickable()
    await link.click()
    await this.waitForDetailPage()
  }

  /**
   * Wait for a work item detail page to have rendered, so callers can read it
   * without racing a slow navigation.
   *
   * RA-295 replaces the envelope summary list with the case header panel, so
   * this accepts EITHER landmark. Keying the wait on `work-item-summary`
   * alone (as it did before) would hang for the full timeout on every
   * post-RA-295 page; keying it on `case-header` alone would hang against a
   * pre-RA-295 build. Accepting either keeps the many specs that merely need
   * "the detail page has loaded" working across the transition, and none of
   * them assert on the landmark itself — the specs that DO care assert
   * explicitly.
   */
  async waitForDetailPage() {
    const caseHeader = await $('[data-testid="case-header"]')
    const envelopeSummary = await $('[data-testid="work-item-summary"]')
    await browser.waitUntil(
      async () =>
        (await caseHeader.isDisplayed()) ||
        (await envelopeSummary.isDisplayed()),
      {
        timeout: 10000,
        timeoutMsg:
          'Expected a work item detail page (case header or envelope summary) to render'
      }
    )
  }

  workItemLink(id) {
    return $(`[data-testid="work-item-link-${id}"]`)
  }

  workItemStateTag(id) {
    return $(`[data-testid="work-item-state-tag-${id}"]`)
  }

  /**
   * Click Apply and wait for the filtered page to actually load.
   *
   * Applying a filter is a full page navigation. Without this wait the
   * caller races it and can read cards from the *unfiltered* list still on
   * screen — which silently returns the wrong work item rather than
   * failing, and gets worse the more items the suite has created.
   *
   * The wait keys off the URL query string changing. Every real apply
   * re-serialises the selected filters into the query string, so unlike the
   * filtersApplied=1 flag it also changes on a second apply (e.g. sorting
   * after a search). NB: element staleness is NOT a usable signal here —
   * WDIO v9 re-resolves selectors on each access, so a captured Apply button
   * never appears stale after navigation.
   *
   * Re-applying an identical filter is a genuine no-op that leaves the URL
   * unchanged. That is tolerated ONLY when we can prove we were already in an
   * applied state (the pre-click URL carries filtersApplied=1). Starting from
   * an unapplied URL and seeing no navigation means Apply did not work, so the
   * timeout is re-thrown rather than swallowed — otherwise a broken Apply
   * button degrades into a confusing assertion failure further downstream.
   */
  async applyFiltersAndWait() {
    const before = await browser.getUrl()
    const applyButton = await $('[data-testid="work-items-filter-apply"]')
    await applyButton.click()
    try {
      await browser.waitUntil(async () => (await browser.getUrl()) !== before, {
        timeout: 10000,
        timeoutMsg: 'Expected applying the filter to navigate'
      })
    } catch (err) {
      if (!before.includes('filtersApplied=1')) {
        throw err
      }
      // Already-applied URL + no change = identical re-apply, which is fine.
    }
    // The new page must have rendered its filter form before we return, so
    // callers interact with the fresh DOM rather than a mid-navigation blank.
    await $('[data-testid="work-items-filter-form"]').waitForExist({
      timeout: 10000
    })
  }

  /**
   * RA-324 phase-2 merged the separate Org ID / Org name inputs into one
   * "Organisation name or ID" search (data-testid work-items-filter-org-search,
   * param `organisation`) that matches organisation name OR operator org id
   * (case-insensitive; registration id is NOT matched — the Registration ID
   * filter was removed). searchByOrgName and searchByOrgId are retained as
   * intent-revealing aliases so existing call sites keep working — both drive
   * the one combined field.
   */
  async searchByOrg(value) {
    await this.expandSection('organisation')
    await $('[data-testid="work-items-filter-org-search"]').setValue(value)
    await this.applyFiltersAndWait()
  }

  searchByOrgName(value) {
    return this.searchByOrg(value)
  }

  searchByOrgId(value) {
    return this.searchByOrg(value)
  }

  /**
   * Reads the work item id out of the first result row's link testid.
   * Used for seeded items whose id is not known up front (unlike items
   * created via createWorkItem, which return their id directly).
   */
  async firstResultWorkItemId() {
    const link = await $(WORK_ITEM_LINK_SELECTOR)
    const testId = await link.getAttribute('data-testid')
    return testId.replace('work-item-link-', '')
  }

  async clearSearch() {
    await this.clearAllFilters()
  }

  /**
   * Search by organisation with `includeArchived=true`, driven straight
   * through the query string for a deterministic, one-navigation load. (The
   * "Show archived items" checkbox in the Archived filter section — see
   * checkArchived — sets the same param through the UI, exercised separately
   * in the phase-2 filters spec.)
   *
   * RA-313 made the param inert: terminal-state items are on the default
   * worklist now, so this returns the same set as searchByOrgName. Retained as
   * the regression guard that ticking the box never SUBTRACTS results.
   */
  async searchArchivedByOrgName(value) {
    await this.open(
      `/work-items?filtersApplied=1&includeArchived=true&organisation=${encodeURIComponent(
        value
      )}`
    )
    await $(WORK_ITEMS_SUMMARY_SELECTOR).waitForDisplayed()
  }

  /**
   * The total match count parsed out of the results summary line. RA-324
   * phase-2 replaced the old "(N work items match ...)" summary with
   * "Showing {start}-{end} of {total}" (worklistSummary doc comment) — match
   * the new format's trailing "of {total}", falling back to the legacy
   * "(N work item" pattern for safety, and 0 for the "No work items match
   * your filters" empty state (neither pattern matches it).
   */
  async getWorkItemCount() {
    const summary = await $(WORK_ITEMS_SUMMARY_SELECTOR).getText()
    const match =
      summary.match(/of (\d+)/) || summary.match(/\((\d+) work item/)
    return match ? Number.parseInt(match[1], 10) : 0
  }

  // ── RA-324 phase-2 collapsible filter sections ───────────────────────────── //

  /**
   * A filter section is a native <details data-testid="filter-section-{key}">,
   * collapsed by default and auto-opened (open attribute) when it holds a
   * selection. key ∈ {sort,type,nation,material,assignment,status,organisation}.
   */
  filterSection(key) {
    return $(`[data-testid="filter-section-${key}"]`)
  }

  filterSectionToggle(key) {
    return $(`[data-testid="filter-section-${key}-toggle"]`)
  }

  /** Whether a filter <details> section is currently expanded. */
  async isSectionOpen(key) {
    return (await this.filterSection(key).getAttribute('open')) !== null
  }

  /**
   * Expand a collapsible filter section so its controls become interactable.
   * A control inside a collapsed <details> is not rendered and cannot be
   * clicked, so every interaction helper opens its section first. No-op when
   * the section is already open (clicking an open summary would collapse it).
   */
  async expandSection(key) {
    if (!(await this.isSectionOpen(key))) {
      await this.filterSectionToggle(key).click()
      await browser.waitUntil(async () => this.isSectionOpen(key), {
        timeout: 5000,
        timeoutMsg: `Expected filter section "${key}" to expand`
      })
    }
  }

  // ── RA-324 phase-2 active-filters block ──────────────────────────────────── //

  /** The "Active filters" block (rendered only when at least one is active). */
  activeFilters() {
    return $('[data-testid="active-filters"]')
  }

  /** Every removable active-filter tag link. */
  activeFilterTags() {
    return $$('[data-testid="active-filter-remove"]')
  }

  /** The label text of each active-filter tag, e.g. "Nation: England". */
  async activeFilterLabels() {
    const tags = await this.activeFilterTags()
    return Promise.all(
      [...tags].map((tag) =>
        tag.$('[data-testid="active-filter-label"]').getText()
      )
    )
  }

  /**
   * Remove a single active filter by clicking the tag whose label contains
   * `labelSubstring` (e.g. "England" or "Sorted by"). Throws if none matches
   * so a wrong assumption fails loudly rather than silently no-op'ing.
   */
  async removeActiveFilter(labelSubstring) {
    const tags = await this.activeFilterTags()
    for (const tag of tags) {
      const label = await tag.$('[data-testid="active-filter-label"]').getText()
      if (label.includes(labelSubstring)) {
        await tag.click()
        return
      }
    }
    throw new Error(`No active-filter tag matching "${labelSubstring}"`)
  }

  clearAllFilters() {
    return $('[data-testid="active-filters-clear"]').click()
  }

  // ── Checkbox/radio filters + pagination ──────────────────────────────────── //

  filterForm() {
    return $('[data-testid="work-items-filter-form"]')
  }

  applyFilters() {
    return this.applyFiltersAndWait()
  }

  async checkType(value) {
    await this.expandSection('type')
    await $(`input[name="typeId"][value="${value}"]`).click()
  }

  /**
   * RA-299 (AC01/15). Tick an "Application type" checkbox — a NEW filter
   * section distinct from the existing "Applicant type" section (checkType,
   * param typeId). Param applicationType; both sections merge into the same
   * backend typeIds filter. Values: re-accreditation (real typeId — the only
   * one with matching data), accreditation | registration-application |
   * annual-fee-payment (stub typeIds, mirror the existing Exporter stub
   * pattern and always return the empty state until those work item types
   * exist).
   */
  async checkApplicationType(value) {
    await this.expandSection('application-type')
    await $(`input[name="applicationType"][value="${value}"]`).click()
  }

  /**
   * Tick a Status filter. RA-324 phase-2 renamed the browser-facing param
   * from `stateId` to `status` (the BFF expands it to the backend state ids —
   * e.g. status=updated covers both assessment-in-progress and updated).
   */
  async checkStatus(value) {
    await this.expandSection('status')
    await $(`input[name="status"][value="${value}"]`).click()
  }

  async checkMaterial(value) {
    await this.expandSection('material')
    await $(`input[name="material"][value="${value}"]`).click()
  }

  /**
   * Tick "Show archived items" in the Archived section. RA-324 phase-2 re-added
   * this as the 8th collapsible section; the control is unchanged from phase-1
   * (checkbox name=includeArchived, testid work-items-filter-include-archived)
   * and still just sets includeArchived=true. RA-313 made the param inert
   * (nothing is hidden any more, so nothing is left for it to reveal); the
   * control stays because the Applications page UI is out of RA-313's scope.
   * See epr-kenf for retiring it.
   */
  async checkArchived() {
    await this.expandSection('archived')
    await $('[data-testid="work-items-filter-include-archived"]').click()
  }

  async checkRegulator(nation) {
    await this.expandSection('nation')
    await $(`input[name="nation"][value="${nation}"]`).click()
  }

  async setAssignmentMode(mode) {
    await this.expandSection('assignment')
    await $(`input[name="assigneeMode"][value="${mode}"]`).click()
  }

  async selectSpecificUser(userId) {
    await this.expandSection('assignment')
    await $('input[name="assigneeMode"][value="user"]').click()
    await $(
      '[data-testid="work-items-filter-assignee-user"]'
    ).selectByAttribute('value', userId)
  }

  /**
   * Choose a Sort option and apply. Values: due-date | organisation | status
   * (default, when none chosen, is newest submitted first). Sort also surfaces
   * as a removable "Sorted by: …" active-filter chip.
   */
  async selectSort(value) {
    await this.expandSection('sort')
    await $(`[data-testid="filter-sort-${value}"]`).click()
    await this.applyFiltersAndWait()
  }

  /** The application-ref link text of each card, in list (DOM) order. */
  async cardRefOrder() {
    const links = await $$(WORK_ITEM_LINK_SELECTOR)
    return Promise.all([...links].map((link) => link.getText()))
  }

  /** Read the value of the first <option> in the specific-user select. */
  async firstAssignableUserId() {
    const options = await $$(
      '[data-testid="work-items-filter-assignee-user"] option'
    )
    for (const option of options) {
      const value = await option.getAttribute('value')
      if (value) {
        return value
      }
    }
    return null
  }

  /**
   * fe removed the duplicate bottom "Clear filters" link — the single
   * clear-all affordance is now the "Clear all filters" link in the Active
   * filters block (data-testid active-filters-clear). Kept as an
   * intent-revealing alias of clearAllFilters so existing call sites read
   * unchanged.
   */
  clearFilters() {
    return this.clearAllFilters()
  }

  clearFiltersLink() {
    return $('[data-testid="active-filters-clear"]')
  }

  getSummaryText() {
    return $(WORK_ITEMS_SUMMARY_SELECTOR).getText()
  }

  /**
   * The results summary line. It is rendered only when the backend query
   * succeeds (ok=true) — on a failed query the template swaps it for the
   * "Could not reach the backend" notification banner instead. Its presence
   * is therefore a positive signal that GET /work-items returned rather than
   * 500'd (RA-342).
   */
  worklistSummary() {
    return $(WORK_ITEMS_SUMMARY_SELECTOR)
  }

  /**
   * The GOV.UK notification banner the worklist renders when the backend
   * query fails (titleText "Could not reach the backend", body e.g.
   * "Backend returned 500"). No data-testid exists on it, so the GOV.UK
   * component class is the selector. Used by RA-342 to assert the legacy
   * snapshot no longer crashes the whole worklist batch.
   */
  worklistErrorBanner() {
    return $('.govuk-notification-banner')
  }

  pagination() {
    return $('.govuk-pagination')
  }

  async hasPagination() {
    return (await this.pagination().isExisting())
      ? await this.pagination().isDisplayed()
      : false
  }

  /** All page-link hrefs inside the GOV.UK pagination component. */
  async paginationHrefs() {
    const links = await $$('.govuk-pagination__link')
    return Promise.all([...links].map((l) => l.getAttribute('href')))
  }

  nextPageLink() {
    return $('.govuk-pagination__next .govuk-pagination__link')
  }

  async gotoNextPage() {
    await this.nextPageLink().click()
  }

  /**
   * Number of work items currently rendered in the results region. RA-324
   * replaced the govukTable with one <article data-testid="application-tile">
   * per application, so the count is the number of tiles rather than table
   * rows. Search/filter/pagination are unchanged, so callers that bound the
   * list first still get a deterministic count.
   */
  async getRowCount() {
    return this.getTileCount()
  }

  // ── RA-324 Applications tiles ────────────────────────────────────────────── //

  /** All application tiles currently rendered (document order). */
  tiles() {
    return $$('[data-testid="application-tile"]')
  }

  async getTileCount() {
    const tiles = await this.tiles()
    return tiles.length
  }

  /**
   * The tile <article> for a given work item id. Each tile carries
   * data-work-item-id="{id}" so a specific application can be located
   * directly, without depending on its position in the list.
   */
  tileFor(id) {
    return $(`[data-testid="application-tile"][data-work-item-id="${id}"]`)
  }

  /**
   * A field element inside a tile, located by its generic field testid
   * (org-name, org-id, registration-number, material, applicant-type, and — in
   * the card footer — submitted-on, assigned-to, due-on). Scoped to the tile so
   * it cannot resolve a field on a different application. The application
   * reference field is the tile link itself (workItemLink(id)), not a generic
   * field testid.
   *
   * RA-370: every one of these testid nodes holds the VALUE ONLY — the visible
   * label ("Assigned to:", "Due on:") sits in a sibling span outside the hook —
   * so assertions can use toHaveText on the exact value without a prefix.
   */
  tileField(id, field) {
    return this.tileFor(id).$(`[data-testid="${field}"]`)
  }

  /** Whether a (conditional) field is rendered inside a tile. */
  async tileHasField(id, field) {
    return this.tileFor(id).$(`[data-testid="${field}"]`).isExisting()
  }

  /**
   * RA-295 (AC06). The registration number on an application card.
   *
   * Deliberately NOT added to TILE_FIELD_ORDER: that constant is RA-324's
   * card-ordering contract, and AC06 only requires the registration number to
   * be "included in the data being displayed", not placed at a particular
   * position. tileFieldOrder() filters to TILE_FIELD_ORDER, so the new field
   * is ignored there and RA-324's ordering spec keeps passing unchanged.
   */
  tileRegistrationNumber(id) {
    return this.tileField(id, 'registration-number')
  }

  async tileHasRegistrationNumber(id) {
    return this.tileHasField(id, 'registration-number')
  }

  /**
   * The registration number rendered on every card currently listed, in DOM
   * order. Lets AC06 assert the field is on the cards generally rather than
   * on one hand-picked card that might be the only one wired up.
   */
  async cardRegistrationNumbers() {
    const cards = await this.tiles()
    return Promise.all(
      [...cards].map(async (card) => {
        const field = await card.$('[data-testid="registration-number"]')
        return (await field.isExisting()) ? field.getText() : null
      })
    )
  }

  /**
   * The tile's status badge (RA-324 renders it as a govukTag with the
   * existing id-keyed testid). Alias of workItemStateTag for readability in
   * the Applications specs.
   */
  tileStatusBadge(id) {
    return this.workItemStateTag(id)
  }

  /**
   * The AC05 field testids present in a tile, in document order, with the
   * application-reference link normalised to the logical name
   * 'application-ref'. Lets a spec assert the fields render in the defined
   * order without requiring every conditional field to be present.
   */
  async tileFieldOrder(id) {
    return this.fieldOrderIn(await this.tileFor(id), id)
  }

  // ── RA-370 card field order + Submitted on ───────────────────────────────── //

  /**
   * RA-370. The ordered field testids inside ONE card element, normalising the
   * id-keyed application-reference link to 'application-ref'.
   *
   * Split out of tileFieldOrder so the same reading can be taken from a card
   * located by position (cardFieldOrders, which walks every card on the page)
   * as well as from a card located by work item id. `id` is optional: when it
   * is not known, any `work-item-link-*` testid is normalised instead, which is
   * safe because the selector is already scoped to a single card.
   *
   * @param {WebdriverIO.Element} card
   * @param {string} [id]
   */
  async fieldOrderIn(card, id) {
    const elements = await card.$$('[data-testid]')
    const seen = []
    for (const element of elements) {
      let testId = await element.getAttribute('data-testid')
      if (
        id
          ? testId === `work-item-link-${id}`
          : testId?.startsWith('work-item-link-')
      ) {
        testId = 'application-ref'
      }
      if (TILE_FIELD_ORDER.includes(testId) && !seen.includes(testId)) {
        seen.push(testId)
      }
    }
    return seen
  }

  /**
   * RA-370. The field order of EVERY card currently listed, in DOM order — one
   * array of testids per card.
   *
   * The AC is "fields appear in a consistent order for every case item", so a
   * spec must not settle for checking one hand-picked card: a template that
   * ordered the first card correctly and the rest differently would pass that.
   */
  async cardFieldOrders() {
    const cards = await this.tiles()
    const orders = []
    for (const card of cards) {
      orders.push(await this.fieldOrderIn(card))
    }
    return orders
  }

  /**
   * RA-370. The "Submitted on" value on a card. Rendered only while the
   * application assessment has NOT been started; pair positive assertions with
   * tileHasSubmittedOn for the conditional-visibility negative.
   */
  tileSubmittedOn(id) {
    return this.tileField(id, SUBMITTED_ON_FIELD)
  }

  async tileHasSubmittedOn(id) {
    return this.tileHasField(id, SUBMITTED_ON_FIELD)
  }

  /**
   * RA-370. "Assigned to" — present on every card, showing the officer's name
   * when assigned and the literal "Unassigned" when not. (Before RA-370 it
   * lived in the SLA footer and so appeared only once the clock had started.)
   */
  tileAssignedTo(id) {
    return this.tileField(id, ASSIGNED_TO_FIELD)
  }

  async tileHasAssignedTo(id) {
    return this.tileHasField(id, ASSIGNED_TO_FIELD)
  }

  /**
   * RA-370. "Due date" — rendered only once the SLA clock has started.
   */
  tileDueOn(id) {
    return this.tileField(id, 'due-on')
  }

  async tileHasDueOn(id) {
    return this.tileHasField(id, 'due-on')
  }

  /**
   * RA-370. The card footer, which now always renders (it used to appear only
   * once the SLA clock had started) and holds the submitted-on / assigned-to /
   * due-on trio.
   */
  tileFooter(id) {
    return this.tileField(id, 'application-card-footer')
  }

  /**
   * RA-370. The card's title sentence, e.g. "Plastic reaccreditation
   * (Reprocessor)". The material and applicant-type testids sit INSIDE it, so
   * the ordering assertions alone cannot catch a change to the surrounding
   * wording — the spans keep their DOM order under any copy. Assert this text
   * directly to pin the user-visible sentence.
   */
  tileTitle(id) {
    return this.tileField(id, 'application-card-title')
  }

  /**
   * RA-370. The rendered value of one field on every card currently listed, in
   * DOM order, with `null` for cards where the (conditional) field is absent.
   * Lets a spec assert a rule holds list-wide rather than on a single card.
   */
  async cardFieldValues(field) {
    const cards = await this.tiles()
    const values = []
    for (const card of cards) {
      const element = await card.$(`[data-testid="${field}"]`)
      values.push((await element.isExisting()) ? await element.getText() : null)
    }
    return values
  }
}

export default new WorkItemsPage()
