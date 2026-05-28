import { browser, $, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

class WorkItemsPage extends Page {
  async goto() {
    await this.open('/work-items')
    await expect($('[data-testid="app-heading-title"]')).toHaveText(
      'Work items'
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
    // applicationReference is auto-generated and read-only; we
    // simply read whatever the server rendered so callers can use it
    // for later assertions if needed.
    const applicationReference = await $(
      '#field-applicationReference'
    ).getValue()
    // Email field is pre-filled with test@defra.gov.uk. Callers
    // may override via opts.operatorEmail; otherwise we leave the default value
    // in place.
    if (opts.operatorEmail !== undefined) {
      const operatorEmailInput = await $('#field-email')
      await operatorEmailInput.setValue(opts.operatorEmail)
    }
    await $('#field-organisationName').setValue(opts.organisationName)
    await $('#field-siteAddress-line1').setValue(opts.siteAddressLine1)
    if (opts.siteAddressLine2 !== undefined) {
      await $('#field-siteAddress-line2').setValue(opts.siteAddressLine2)
    }
    await $('#field-siteAddress-town').setValue(opts.siteAddressTown)
    await $('#field-siteAddress-postcode').setValue(opts.siteAddressPostcode)
    await $('#field-material').selectByAttribute('value', opts.material)
    await $('#field-tonnageBand').selectByAttribute('value', opts.tonnageBand)
    await $('[data-testid="create-work-item-submit"]').click()
    await expect($('[data-testid="work-item-success-banner"]')).toBeDisplayed()
    const url = await browser.getUrl()
    const id = url.split('/').pop()
    return { id, applicationReference }
  }

  async openWorkItem(id) {
    await this.open(`/work-items/${id}`)
  }

  workItemLink(id) {
    return $(`[data-testid="work-item-link-${id}"]`)
  }

  workItemStateTag(id) {
    return $(`[data-testid="work-item-state-tag-${id}"]`)
  }
}

export default new WorkItemsPage()
