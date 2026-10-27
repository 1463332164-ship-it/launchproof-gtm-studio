# Public preview verification — 2026-10-27

Status: release candidate prepared; public upload and online verification pending.

## Actually executed for this release copy

- Fresh frozen-lockfile dependency install: completed (pnpm 11.25.0; dependencies fetched from registry, not copied node_modules).
- `./run.ps1 test`: 227 tests passed across 6 files; no failed tests.
- `./run.ps1 check:data`: 5 passed, a subset of the 227 tests.
- `./run.ps1 build`: TypeScript no-emit check passed; Vite production build passed.
- Seed file byte comparison with the protected development project: identical.
- Whitelisted public-file privacy scan: no matches for the specified personal contact/name, absolute Windows path, GitHub token and private-key patterns. This is a scoped scan, not a universal security certification.
- Local production build served over HTTP: real browser displayed preview label, 8 facts, 7 sources and 0 personal checks.
- Real browser loaded 3 untested hypotheses and 2 message drafts, observed sample count 0, AI attribution and unscored sensitivity ranges.
- Real browser navigated from message M-A into a decision editor and saved an unselected AI-assisted draft. UI preserved missing reasons and verification tasks as gaps.

No personal U1 validation was recorded. Historical test counts are not added to this run. Narrow viewport, Markdown/JSON downloads, refresh and online checks have not yet been rerun for this release.

## Public release boundary

The public copy adds a preview notice and current page metadata, moves the non-personal test fixture to examples, and adds public documentation. Domain rules and official seed facts remain unchanged. No LP05/V2 feature was developed. Built assets in docs are generated from the included source.
