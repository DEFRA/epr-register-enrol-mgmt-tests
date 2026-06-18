import { $, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'

describe('RA-220 — Defra rebrand: header, service navigation, and footer', () => {
  before(async () => {
    await login.loginAs('standard')
  })

  describe('Header', () => {
    it('has a white background', async () => {
      const bg = await $('.govuk-header').getCSSProperty('background-color')
      expect(bg.parsed.hex).toBe('#ffffff')
    })

    it('displays the Defra logo image', async () => {
      const logo = await $('.app-header__logo-img')
      await expect(logo).toBeDisplayed()
    })

    it('Defra logo has correct alt text', async () => {
      const logo = await $('.app-header__logo-img')
      await expect(logo).toHaveAttribute(
        'alt',
        'Department for Environment, Food and Rural Affairs'
      )
    })

    it('Defra logo src references defra-logo-wide', async () => {
      const logo = await $('.app-header__logo-img')
      const src = await logo.getAttribute('src')
      expect(src).toContain('defra-logo-wide')
    })
  })

  describe('Service navigation', () => {
    it('displays the service name', async () => {
      await expect($('.govuk-service-navigation__service-name')).toHaveText(
        expect.stringContaining('EPR Register Case Management')
      )
    })

    it('has a white background', async () => {
      const bg = await $('.govuk-service-navigation').getCSSProperty(
        'background-color'
      )
      expect(bg.parsed.hex).toBe('#ffffff')
    })

    it('has a Defra green bottom border', async () => {
      const color = await $('.govuk-service-navigation').getCSSProperty(
        'border-bottom-color'
      )
      expect(color.parsed.hex).toBe('#00a33b')
    })
  })

  describe('Footer', () => {
    it('has a white background', async () => {
      const bg = await $('.govuk-footer').getCSSProperty('background-color')
      expect(bg.parsed.hex).toBe('#ffffff')
    })

    it('contains an Accessibility statement link', async () => {
      await expect($('a=Accessibility statement')).toBeDisplayed()
    })

    it('contains a Cookies link', async () => {
      await expect($('a=Cookies')).toBeDisplayed()
    })

    it('contains a Feedback link', async () => {
      await expect($('a=Feedback')).toBeDisplayed()
    })
  })
})
