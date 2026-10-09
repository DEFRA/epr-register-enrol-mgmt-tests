import { browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'
import entraStubLogin, {
  ENTRA_STUB_USERS
} from '../page-objects/entra-stub-login.page.js'
import workItems from '../page-objects/work-items.page.js'
import detail from '../page-objects/work-item-detail.page.js'
import { isEntraStubLoginEnabled } from '../support/entra-stub-login.js'
import { uniquePostcode } from '../support/unique-postcode.js'

/**
 * RA-537 — log in to Case Management through the Entra ID stub.
 *
 * On CDP test and perf-test management-fe keeps its built-in "Stub Login"
 * chooser, and the chooser's "Sign in with Entra ID" button goes to the
 * Entra ID stub (epr-register-enrol-entra-stub) rather than real Entra ID.
 * The stub issues tokens for a fixed set of personas whose app roles drive
 * management-fe's role mapping, so this spec proves each mapping end to
 * end: regulator → caseworker, support → read-only, no role → 403. It also
 * proves logout ends the stub's own session (not just management-fe's) and
 * that, in this hybrid mode, a regulator who signed in through the stub is
 * assignable alongside the built-in stub caseworkers.
 *
 * Skipped unless ENTRA_STUB_LOGIN=true (see support/entra-stub-login.js):
 * local and compose/GitHub runs have no Entra ID configured, so the button
 * isn't rendered there, and the built-in stub logins used by the rest of
 * the suite are unaffected either way.
 */
const describeIfEntraStub = isEntraStubLoginEnabled() ? describe : describe.skip

describeIfEntraStub('RA-537 Entra ID stub login', () => {
  describe('regulator personas', () => {
    afterEach(async () => {
      await login.logout()
    })

    for (const persona of [
      ENTRA_STUB_USERS.eaRegulator,
      ENTRA_STUB_USERS.nrwRegulator,
      ENTRA_STUB_USERS.nieaRegulator,
      ENTRA_STUB_USERS.sepaRegulator
    ]) {
      it(`${persona.username} lands on the work items list as a caseworker`, async () => {
        await login.loginViaEntraStub(persona.username)

        await expect(browser).toHaveTitle('Applications', { containing: true })
        await expect(login.navSignOut()).toBeDisplayed()
        // Caseworkers never get the support-only nav link — its absence
        // is what tells the regulator mapping apart from the support one.
        await expect(login.navBackendStatusLink()).not.toBeExisting()
      })
    }
  })

  describe('support persona', () => {
    afterEach(async () => {
      await login.logout()
    })

    it('lands on the work items list as a read-only support user', async () => {
      await login.loginViaEntraStub(ENTRA_STUB_USERS.supportReadOnly.username)

      await expect(browser).toHaveTitle('Applications', { containing: true })
      await expect(login.navBackendStatusLink()).toBeDisplayed()
    })
  })

  describe('no-role persona', () => {
    let stubOrigin

    after(async () => {
      // management-fe refuses this caller before storing an id_token, so it
      // cannot end the stub's session at logout — clear it directly so the
      // next login isn't silently re-issued as this persona.
      if (stubOrigin) {
        await entraStubLogin.clearSession(stubOrigin)
      }
    })

    it('is refused with the access-denied page', async () => {
      stubOrigin = await login.loginViaEntraStub(
        ENTRA_STUB_USERS.noRole.username,
        { landsOn: '/auth/regulator/callback' }
      )

      await expect(login.pageHeading).toHaveText(
        'You do not have access to this service'
      )
      expect(await login.hasAuthenticatedNav()).toBe(false)

      // And no session was created: a protected page still sends the
      // caller back to sign in.
      await workItems.open('/work-items')
      await login.waitForSignInPage()
    })
  })

  describe('wrong password', () => {
    it('stays on the stub login form with an error', async () => {
      await login.openEntraStubLoginForm()
      await entraStubLogin.submit(
        ENTRA_STUB_USERS.eaRegulator.username,
        'not-the-password'
      )

      await expect(entraStubLogin.errorSummary()).toHaveText(
        expect.stringContaining('Invalid email or password')
      )
      await entraStubLogin.waitForLoginForm()

      await workItems.open('/work-items')
      await login.waitForSignInPage()
    })
  })

  describe('logout', () => {
    it('ends the stub session and lands on the logged-out page', async () => {
      await login.loginViaEntraStub(ENTRA_STUB_USERS.eaRegulator.username)

      // Sign out → stub end-session → /auth/logout → /auth/logged-out.
      await login.signOutViaNav()

      // Proof the stub's own session ended, not just management-fe's: while
      // it lives the stub skips its form and re-issues a code at once, so
      // seeing the form again means the end-session leg ran.
      await login.continueToLogin()
      await login.entraIdLoginButton().click()
      await entraStubLogin.waitForLoginForm()
    })
  })

  describe('hybrid mode assignment', () => {
    let workItemId

    before(async () => {
      // Created by a built-in stub caseworker, so the Entra ID stub
      // regulator below starts from an unassigned item.
      await login.login()
      await workItems.goto()
      ;({ id: workItemId } = await workItems.createWorkItem({
        organisationName: 'Entra Stub Hybrid Ltd',
        siteAddressLine1: '1 Entra Street',
        siteAddressTown: 'London',
        siteAddressPostcode: uniquePostcode(),
        material: 'plastic',
        tonnageBand: '0-500'
      }))
      await login.logout()
    })

    afterEach(async () => {
      await login.logout()
    })

    it('lets an Entra ID stub regulator self-assign an application', async () => {
      await login.loginViaEntraStub(ENTRA_STUB_USERS.eaRegulator.username)
      await workItems.openWorkItem(workItemId)

      await detail.selfAssign()
      await detail.assertAssignedTo(ENTRA_STUB_USERS.eaRegulator.name)
    })

    // Relies on EA Regulator having signed in through the stub earlier in
    // the run (the test above does, and so do the regulator persona tests):
    // management-fe adds an Entra ID user to its shared assignable-users
    // directory only on a regulator-role login, and lists them by the
    // id_token `name` claim after the built-in stub users.
    it('offers the Entra ID stub regulator to a built-in stub caseworker as an assignee', async () => {
      await login.login()
      await workItems.openWorkItem(workItemId)

      await detail.openAssignForm()
      await expect(
        detail.assigneeOption(ENTRA_STUB_USERS.eaRegulator.name)
      ).toBeExisting()
    })
  })
})
