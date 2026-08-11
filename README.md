epr-register-enrol-mgmt-tests

The template to create a service that runs WDIO tests against an environment.

- [Local](#local)
  - [Requirements](#requirements)
    - [Node.js](#nodejs)
  - [Setup](#setup)
  - [Running local tests](#running-local-tests)
  - [Debugging local tests](#debugging-local-tests)
- [Production](#production)
  - [Debugging tests](#debugging-tests)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Local Development

### Requirements

#### Node.js

Please install [Node.js](http://nodejs.org/) `>= v20` and [npm](https://nodejs.org/) `>= v9`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
nvm use
```

### Setup

Install application dependencies:

```bash
npm install
```

### Git hooks

A `pre-commit` hook runs a security audit, format checks and linting before
allowing a commit. Enable it once per clone:

```bash
npm run setup:husky
```

Bypass in an emergency with `git commit --no-verify`.

### Running local tests

Start application you are testing on the url specified in `baseUrl` [wdio.local.conf.js](wdio.local.conf.js)

```bash
npm run test:local
```

### Debugging local tests

```bash
npm run test:local:debug
```

## Production

### Running the tests

Tests are run from the CDP-Portal under the Test Suites section. Before any changes can be run, a new docker image must be built, this will happen automatically when a pull request is merged into the `main` branch.
You can check the progress of the build under the actions section of this repository. Builds typically take around 1-2 minutes.

The results of the test run are made available in the portal.

## Requirements of CDP Environment Tests

1. Your service builds as a docker container using the `.github/workflows/publish.yml`
   The workflow tags the docker images allowing the CDP Portal to identify how the container should be run on the platform.
   It also ensures its published to the correct docker repository.

2. The Dockerfile's entrypoint script should return exit code of 0 if the test suite passes or 1/>0 if it fails

3. Test reports should be published to S3 using the script in `./bin/publish-tests.sh`

## Running on GitHub

Alternatively you can run the test suite as a GitHub workflow.
Test runs on GitHub are not able to connect to the CDP Test environments. Instead, they run the tests agains a version of the services running in docker.
A docker compose `compose.yml` is included as a starting point, which includes the databases (mongodb, redis) and infrastructure (localstack) pre-setup.

Steps:

1. Edit the compose.yml to include your services.
2. Modify the scripts in docker/scripts to pre-populate the database, if required and create any localstack resources.
3. Test the setup locally with `docker compose up` and `npm run test:github`
4. Set up the workflow trigger in `.github/workflows/journey-tests`.

By default, the provided workflow will run when triggered manually from GitHub or when triggered by another workflow.

If you want to use the repository exclusively for running docker composed based test suites consider displaying the publish.yml workflow.

### Stale seed data: use `docker compose down -v` after a seed change

`epr-register-enrol-management-be` seeds its work items with
`CreateIfAbsentAsync`, which **inserts but never updates**. A seed item is
keyed on a deterministic id, so:

- a **new** seed key appears on the next backend boot, even against a mongo
  volume that has already been seeded — no reset needed;
- a **changed value on an existing** seed key does **not**. The old document
  stays exactly as it was.

The failure this produces is nastier than it sounds: specs assert against
values the seeder now claims to emit, the backend serves the old document, and
the run fails with content mismatches that look for all the world like a broken
frontend template. It is easy to lose an hour to it.

So whenever the backend's seed data changes — or specs start failing on values
you can see are correct in `ReAccreditationSeeder.cs`:

```bash
docker compose down -v   # -v drops the mongo volume; without it the old seed persists
docker compose up -d
```

The same applies to the published image tags. `compose.yml` defaults to
`:latest` for both services, which can lag `main`; to run against a specific
build, set `MANAGEMENT_BE` / `MANAGEMENT_FE` to a tag you have built locally:

```bash
MANAGEMENT_BE=mytag MANAGEMENT_FE=mytag docker compose up -d
```

### Journey tests failing on specs you didn't write

**Merge `main` into all three branches before investigating.**

PR CI tests the **merge commit** — your branch merged into `main` — so it runs
every spec on `main`, including ones added after you branched. But
`run-journey-tests` **branch-matches**: it looks for a branch of the same name
in `epr-register-enrol-management-fe` and `-management-be` and, when one exists,
builds those services from _that branch_ rather than from `main`.

Those two facts pull in opposite directions. If a story merges to `main` after
your branch was cut, you get its **new specs** running against **partner code
that predates them**, and they fail. Nothing is broken; the branch is simply
behind.

The diagnostic tell:

> Failures cluster **entirely inside one spec file you have never touched**,
> whose story merged to `main` recently — and your own specs all pass.

A red run caused by your change looks different: it lands in the specs and page
objects your change actually touches.

Merging `main` into **this** repo is **not sufficient**, and that is the
non-obvious half. It brings the new specs in, but the partner _images_ still
have to carry the code those specs exercise. All three branches need it:

```bash
# in each of mgmt-tests, management-fe and management-be,
# on the shared branch name:
git merge origin/main
```

Then re-trigger the run rather than pushing an empty commit — the action
re-resolves the partner branches with `git ls-remote` at run time, so a rerun
of the same commit picks up their new heads.

This is not a defect to be fixed. Testing the merge commit against
branch-matched images is what allows three repositories' pull requests to be
verified together at all; a long-lived branch going red when `main` moves is
that design working, and the remedy is a merge you would do before merging
anyway.

### Reproducing a CI failure locally: mind the network namespace

CI runs `wdio` **on the runner host** (`setup-node` → `npm ci` →
`npm run test:github`), with the stack in Docker. So a spec helper that fetches
the backend directly at `http://localhost:8085` works, because `compose.yml`
publishes that port to the host. Only the _browser_ is in a container.

Run `wdio` **inside** a container joined to the compose network instead — a
reasonable thing to do when the host's Node version doesn't match `.nvmrc` —
and `localhost` becomes the container itself. Those helpers fail with
`TypeError: fetch failed` while the browser-driven assertions carry on working,
so most of the suite passes and one file collapses. Point them at the service
name:

```bash
-e MANAGEMENT_BE_URL=http://epr-register-enrol-management-be:8085
```

The wider lesson is worth more than the fix:

> **A reproduction that fails differently from the thing you're reproducing is
> not a reproduction.**

This bit during RA-292. A local run of a CI failure died on
`TypeError: fetch failed`; CI had failed on assertions. Same file, same tests,
entirely different cause. Read as a successful reproduction it said "this story
is broken on `main`" — and would have sent someone hunting a regression in
merged code that was working perfectly. The mismatch in _failure shape_ was the
only thing distinguishing a real reproduction from an accident of local
plumbing.

So before drawing a conclusion from a local repro, check it fails **the same
way**: same error type, same assertion, same tests. If it doesn't, you are
debugging your own environment.

`epr-register-enrol-management-be`'s README has a companion entry,
**"Checks that don't check"**, cataloguing the same family from the other side —
checks that appear to exercise a path they never touch, each failing quietly and
in the direction the author was hoping for. This trap is that pattern seen from
the reproduction end, and it is listed there as one of the four instances.

## Writing specs: ask each question of the element that can answer it

A container's rendered text is the **union of its children's**. So a question
phrased _"does this line say X"_ can only be asked of the line. A container can
answer _"does this subtree contain X anywhere"_ — and nothing narrower.

Both failure directions turned up on one story (RA-292), which is why this is
written down rather than left to taste:

| Scoped to a container                                                                   | What happens                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Absence** — "the country is not on the site name line", asked of the whole site block | Fails **immediately**, because the block also contains the address, which contains the country. False by construction. Annoying, but self-announcing.                  |
| **Presence** — "this site is flagged new", asked of the whole site block                | **Passes for the wrong reason** and keeps passing. An interim site renders _inside_ its parent ORS block, so a new interim site makes its not-new parent look flagged. |

The second is the dangerous one. It goes green on day one and stays green, so
nothing ever prompts anyone to look; it was caught only by going looking for it.

The rule in practice, using this suite's page object:

```js
// WRONG — flaggedBlockNamed() returns the whole block
const block = await detail.flaggedBlockNamed('overseasSite', name)
expect(await block.getText()).not.toContain(country)

// RIGHT — read the specific line
const line = await detail.blockFieldText(
  'overseasSite',
  name,
  'overseas-site-name'
)
expect(line).not.toContain(country)
```

The same reasoning is why the `NEW: ` prefix helpers resolve a per-kind _line_
element (`overseas-site-name`, `interim-site-name`) rather than reading block
text, and why marker lookups use **exact** `data-testid` values — a suffix
selector such as `[data-testid$="new-tag"]` scoped to an ORS also matches its
nested interim site's marker.

## BrowserStack

Two wdio configuration files are provided to help run the tests using BrowserStack in both a GitHub workflow (`wdio.github.browserstack.conf.js`) and from the CDP Portal (`wdio.browserstack.conf.js`).
They can be run from npm using the `npm run test:browserstack` (for running via portal) and `npm run test:github:browserstack` (from GitHib runner).
See the CDP Documentation for more details.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
