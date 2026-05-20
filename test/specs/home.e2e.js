import { browser, expect } from '@wdio/globals'

import LoginPage from 'page-objects/login.page'

describe('Home page', () => {
  it('Should be on the "Home" page', async () => {
    await LoginPage.loginAs('standard')
    await expect(browser).toHaveTitle('Home', { containing: true })
  })
})
