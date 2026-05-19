import { browser, $, expect } from '@wdio/globals'
import { Page } from 'page-objects/page.js'

class LoginPage extends Page {
  async loginAs(role) {
    await this.open('/auth/regulator/login')
    await $(`input[name="role"][value="${role}"]`).click()
    await $('button=Log in').click()
    await browser.waitUntil(async () => new URL(await browser.getUrl()).pathname === '/')
  }

  async logout() {
    await this.open('/auth/logout')
    await expect($('h1=Stub Login')).toBeDisplayed()
  }
}

export default new LoginPage()
