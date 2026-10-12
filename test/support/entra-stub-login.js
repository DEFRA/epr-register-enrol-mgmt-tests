/**
 * RA-537. Whether this run can log in through the Entra ID stub. Only CDP
 * test and perf-test wire management-fe's "Sign in with Entra ID" button to
 * the stub, and cdp-app-config sets ENTRA_STUB_LOGIN=true for this suite
 * there. Everywhere else the button is either absent (local, compose/GitHub:
 * no Entra ID configured) or goes to real Entra ID (dev), so specs that need
 * the stub skip unless the flag is exactly "true".
 */
export const isEntraStubLoginEnabled = () =>
  process.env.ENTRA_STUB_LOGIN === 'true'
