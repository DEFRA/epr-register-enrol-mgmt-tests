import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

class LoginPage extends Page {
  /**
   * Stub-login as the given role. Pass an optional `nation`
   * (England/Scotland/Wales/NorthernIreland) to attach a single nation-scoped
   * role to the user — used to exercise the RA-125 nation auto-default on the
   * work-items list. Omitting `nation` (or passing a falsy value) leaves the
   * user with no nation role, i.e. a multi-nation "see all" user.
   */
  async loginAs(role, nation) {
    await this.open('/auth/regulator/login')
    await $(`input[name="role"][value="${role}"]`).click()
    if (nation) {
      await $('select[name="nation"]').selectByAttribute('value', nation)
    }
    await $('button=Log in').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/'
    )
  }

  async logout() {
    await this.open('/auth/logout')
    await expect($('h1=Stub Login')).toBeDisplayed()
  }
}

export default new LoginPage()
