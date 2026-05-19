# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm install

npm test                             # Run all tests (headless Chrome)
npm run test:local                   # Run against localhost:5001 in headed mode
npm run test:report                  # Generate and open Allure report
```

Single spec:
```bash
npx wdio run wdio.conf.js --spec tests/journey.spec.js
```

## Architecture Overview

E2E test suite for the EPR Register Enrolment Management application using **WebdriverIO + Mocha** (ESM, plain JavaScript). Mirrors the structure of the sibling repo `epr-register-enrol-fe-tests`.

```
tests/
├── page-objects/   # POM classes extending Page (one file per page/component)
│   ├── Page.js               — base class with open(path)
│   ├── LoginPage.js
│   ├── WorkItemsPage.js
│   └── WorkItemDetailPage.js
└── journey.spec.js           — Mocha describe/it journey tests
wdio.conf.js
```

Environment config (resolved in order):
1. `BASE_URL` env var
2. `https://epr-register-enrol-backend.${ENVIRONMENT}.cdp-int.defra.cloud`
3. `http://localhost:5001` (fallback)

## Conventions & Patterns

- **Locators:** prefer `data-testid` attributes (`$('[data-testid="..."]')`); fall back to text selectors (`$('button=Log in')`) or XPath
- **Page objects:** extend `Page`, export a singleton instance (`export default new XxxPage()`), expose actions as `async` methods
- **Globals:** import `browser`, `$`, `$$`, `expect` explicitly from `@wdio/globals`
- **Journey flow:** tests follow the worklist lifecycle — New → In Progress → Completed
- **Custom E2E skill:** invoke `/case-managment-e2e-tests` to auto-generate journey specs from the Beads backlog
