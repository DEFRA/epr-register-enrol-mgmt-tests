import fs from 'node:fs'

const oneMinute = 60 * 1000

export const config = {
  runner: 'local',

  specs: ['./tests/**/*.spec.js'],
  exclude: [],

  maxInstances: 1,

  baseUrl: process.env.ENVIRONMENT
    ? `https://epr-register-enrol-management-fe.${process.env.ENVIRONMENT}.cdp-int.defra.cloud`
    : 'http://localhost:5001',

  hostname: process.env.CHROMEDRIVER_URL ?? '127.0.0.1',
  port: process.env.CHROMEDRIVER_PORT ? parseInt(process.env.CHROMEDRIVER_PORT) : 4444,

  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--no-sandbox',
          '--disable-infobars',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-dev-shm-usage',
          '--ignore-certificate-errors',
          '--disable-background-networking',
          '--dns-prefetch-disable',
          // ...(!process.env.HEADED ? ['--headless'] : []),
        ],
      },
    },
  ],

  logLevel: 'warn',
  logLevels: { webdriver: 'error' },

  bail: 0,
  waitforTimeout: 10000,
  waitforInterval: 200,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  services: ['chromedriver'],

  framework: 'mocha',
  reporters: [
    ['spec', { addConsoleLogs: true, realtimeReporting: true }],
    ['allure', { outputDir: 'allure-results' }],
  ],
  mochaOpts: {
    ui: 'bdd',
    timeout: oneMinute,
  },

  afterTest: async function (_test, _context, { error }) {
    if (error) {
      await browser.takeScreenshot()
    }
  },

  onComplete: function (_exitCode, _config, _capabilities, results) {
    if (results?.failed && results.failed > 0) {
      fs.writeFileSync('FAILED', JSON.stringify(results))
    }
  },
}
