import { browser, $ } from '@wdio/globals'

class Page {
  get pageHeading() {
    return $('h1')
  }

  open(path) {
    return browser.url(path)
  }

  /**
   * RA-324 (AC01/AC03). The service navigation is part of the shared page
   * layout, so these hooks are present on every authenticated page (the
   * Applications list, a work-item detail page, etc.). Exposed on the base
   * Page so any page object can assert the nav persists across the journey.
   */
  navWorkItemsLink() {
    return $('[data-testid="nav-work-items"]')
  }

  navSignOut() {
    return $('[data-testid="nav-sign-out"]')
  }
}

export { Page }
