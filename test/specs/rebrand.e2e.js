import { $, browser, expect } from '@wdio/globals'
import login from '../page-objects/login.page.js'

describe('RA-220 — Defra rebrand: header, service navigation, and footer', () => {
  before(async () => {
    await login.login()
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
        expect.stringContaining('Packaging waste applications')
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

  describe('Service navigation links', () => {
    it('nav links are black', async () => {
      const link = await $('.govuk-service-navigation__link')
      const color = await link.getCSSProperty('color')
      expect(color.parsed.hex).toBe('#0b0c0c')
    })
  })

  describe('Page background', () => {
    it('page content wrapper has grey background', async () => {
      const bg = await $('.app-main-background').getCSSProperty(
        'background-color'
      )
      expect(bg.parsed.hex).toBe('#f5f5f5')
    })

    it('grey background covers breadcrumb area on pages with breadcrumbs', async () => {
      // The work items list is the top of the hierarchy (RA-326 removed the
      // Home page it used to sit under) and no longer renders a breadcrumb
      // trail, so this needs a nested page — the create-work-item form
      // always has a two-item "Work items > ..." trail.
      await browser.url('/work-items/re-accreditation/new')
      const wrapperTop = await $('.app-main-background').getLocation('y')
      const breadcrumbTop = await $('.govuk-breadcrumbs').getLocation('y')
      expect(breadcrumbTop).toBeGreaterThanOrEqual(wrapperTop)
    })
  })

  describe('Footer', () => {
    it('has a white background', async () => {
      const bg = await $('.govuk-footer').getCSSProperty('background-color')
      expect(bg.parsed.hex).toBe('#ffffff')
    })
  })
})
