import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

class LoginPage extends Page {
  /**
   * Stub-login. RA-323: every caseworker holds the same role, so there is
   * no role selection any more. Pass an optional `nation`
   * (England/Scotland/Wales/NorthernIreland) to attach a single nation-scoped
   * role to the user — used to exercise the RA-125 nation auto-default on the
   * work-items list. Omitting `nation` (or passing a falsy value) leaves the
   * user with no nation role, i.e. a multi-nation "see all" user.
   */
  async login(nation) {
    await this.open('/auth/regulator/login')
    if (nation) {
      await $('select[name="nation"]').selectByAttribute('value', nation)
    }
    await $('button=Log in').click()
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/work-items'
    )
  }

  async logout() {
    await this.open('/auth/logout')
    await expect($('h1=Stub Login')).toBeDisplayed()
  }
}

export default new LoginPage()
