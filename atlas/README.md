# rig-bridge: how it works

Mapped at 2026-09-24 from commit e91f65b.

## What this is

6 parts, mostly TypeScript (48 files). Work enters through 4 doors; the busiest is Deploy site to GitHub Pages, which reaches 1 part. It publishes to npm. People run rig-bridge.

## What changed since the last map

This is the first map.

## What comes in

1. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
2. **Release.** When a tag matching `v[0-9]+.[0-9]+.[0-9]+` or `v[0-9]+.[0-9]+.[0-9]+-*` is pushed. Runs src/cli.ts, src/cli-e2e.test.ts, src/cli.test.ts and 22 more; checks src/.
3. **ci.** On a pull request touching 11 paths; on a push touching 11 paths; or by hand. Runs src/cli.ts, src/cli-e2e.test.ts, src/cli.test.ts and 22 more; checks src/.
4. **rig-bridge** (a command people run). Runs src/cli.ts.

## What happens through Deploy site to GitHub Pages

1. The workflow runs site/astro.config.mjs and site/src/ in the site.
2. It deploys the site.

## Who reads the results

Deploy site to GitHub Pages writes nothing this map can see.

## The other doors

**Release** runs src/cli.ts, src/cli-e2e.test.ts, src/cli.test.ts and 22 more, checks src/, publishes to npm, and creates a GitHub release.

**ci** runs src/cli.ts, src/cli-e2e.test.ts, src/cli.test.ts and 22 more, and checks src/.

**rig-bridge** (a command people run) runs src/cli.ts.

## What breaks what

- **src** is imported by no other part and sits on the path of 3 doors.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits, since the window holds fewer than 30 qualifying commits.

## What no test touches

Every code part is imported by at least one test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .github/, docs/, the repository root, schemas/ and site/; 3 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/cli.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 1 file uses syntax the parser cannot read (src/engine/envelope.test.ts), so what it imports is not known: a NUL character inside a string (1).
- 3 writes and 32 reads use paths built at run time and are not named here.
- 4 reads go to the directory the command is run in, the home directory or a path its caller passes, not to this repository.
- 39 commands are built at run time and not followed, 36 of them in tests.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 20 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
