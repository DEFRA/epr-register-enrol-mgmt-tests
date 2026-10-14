import { config as local } from './wdio.local.conf.js'

export const config = {
  ...local,
  execArgv: [],
  ...(process.env.CHROMEDRIVER_PORT
    ? {
        hostname: '127.0.0.1',
        port: Number(process.env.CHROMEDRIVER_PORT)
      }
    : {}),
  specs: [
    ['durability-capture', 'restart-readback'].includes(
      process.env.RA_622_SPIKE_PHASE
    )
      ? './test/specs/ra-622-durability.e2e.js'
      : './test/specs/ra-622-management-access.e2e.js'
  ],
  capabilities: [
    {
      browserName: 'chrome',
      ...(process.env.CHROME_VERSION
        ? { browserVersion: process.env.CHROME_VERSION }
        : {}),
      'goog:chromeOptions': {
        args: [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--window-size=1920,1080'
        ],
        ...(process.env.CHROME_BINARY
          ? { binary: process.env.CHROME_BINARY }
          : {})
      }
    }
  ],
  reporters: ['spec'],
  mochaOpts: { ...local.mochaOpts, timeout: 180000 },
  beforeSession() {
    process.env.RA_622_SPIKE_TESTS = 'true'
  },
  onComplete() {}
}
