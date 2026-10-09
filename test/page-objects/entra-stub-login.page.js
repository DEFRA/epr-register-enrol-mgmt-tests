import { browser, $, expect } from '@wdio/globals'
import { Page } from './page.js'

/**
 * RA-537. Personas built into the Entra ID stub
 * (epr-register-enrol-entra-stub, src/server/common/users.js). The stub is
 * the source of truth: these must match its usernames byte for byte, and
 * every persona shares the one stub password. These are fixed test
 * identities with no access to anything real — the stub rejects every
 * other account.
 *
 * - the four nation regulators hold Waste.Regulator.Standard, which
 *   management-fe maps to a standard caseworker;
 * - supportReadOnly holds Waste.SupportUser.ReadOnly (read-only support);
 * - noRole holds no app role, so management-fe refuses it with a 403.
 */
export const ENTRA_STUB_USERS = {
  eaRegulator: { username: 'ea.regulator@test.gov.uk', name: 'EA Regulator' },
  nrwRegulator: {
    username: 'nrw.regulator@test.gov.uk',
    name: 'NRW Regulator'
  },
  nieaRegulator: {
    username: 'niea.regulator@test.gov.uk',
    name: 'NIEA Regulator'
  },
  sepaRegulator: {
    username: 'sepa.regulator@test.gov.uk',
    name: 'SEPA Regulator'
  },
  supportReadOnly: {
    username: 'support.readonly@test.gov.uk',
    name: 'Support User'
  },
  noRole: { username: 'no.role@test.gov.uk', name: 'No Role User' }
}

export const ENTRA_STUB_PASSWORD = 'pass'

/**
 * RA-537. The Entra ID stub's own login form (GET/POST /authorize on the
 * stub's origin), reached by following management-fe's redirect from the
 * "Sign in with Entra ID" button. The stub renders it with the shared
 * app-heading component, whose caption is the stub's fixed disclaimer.
 */
class EntraStubLoginPage extends Page {
  caption() {
    return $('[data-testid="app-heading-caption"]')
  }

  usernameInput() {
    return $('#username')
  }

  passwordInput() {
    return $('#password')
  }

  submitButton() {
    return $('button=Login')
  }

  errorSummary() {
    return $('.govuk-error-summary')
  }

  /**
   * Assert we are on the stub's login form: both the disclaimer caption AND
   * the stub's /authorize path. The caption alone proves it's the stub (not
   * real Entra ID, which would ask for a real account); the path proves the
   * browser actually left management-fe rather than rendering a stale page.
   */
  async waitForLoginForm() {
    await expect(this.caption()).toHaveText(
      'Entra ID stub. Does not support real accounts.'
    )
    await browser.waitUntil(
      async () => new URL(await browser.getUrl()).pathname === '/authorize',
      {
        timeoutMsg: `Expected the Entra ID stub login form, got ${await browser.getUrl()}`
      }
    )
  }

  async submit(username, password = ENTRA_STUB_PASSWORD) {
    await this.usernameInput().setValue(username)
    await this.passwordInput().setValue(password)
    await this.submitButton().click()
  }

  /**
   * The stub keeps its own SSO session (a `sessionId` cookie on the stub's
   * origin) and silently re-issues a code to the same user on the next
   * /authorize while it lives. management-fe ends it at logout via the
   * stub's end-session endpoint, but only when it holds an id_token — a
   * caller it refused (the no-role 403) never gets one, so that session has
   * to be cleared here or the next spec's login would come back as that
   * user. WebDriver can only delete cookies for the current document's
   * origin, hence the hop to the stub's always-open /health route.
   */
  async clearSession(stubOrigin) {
    await browser.url(`${stubOrigin}/health`)
    await browser.deleteCookies()
  }

  async origin() {
    return new URL(await browser.getUrl()).origin
  }
}

export default new EntraStubLoginPage()
