# Comparison runner: browser-served lane

This directory re-runs the multi-tool comparison published as
[`2026-10-13-v0.1.0-latest-browser-served`](https://github.com/cogniumhq/a11y-benchmark-results/tree/main/results/2026-10-13-v0.1.0-latest-browser-served)
from committed inputs. It measures automated detection on the 214 served
known-defect and corrected-control pages of corpus `v0.1.0` at
`469486a4811c5055de9d2524ede1ca520c2774c8`.

It is a measurement harness, not ground truth. Nothing here changes what the
corpus asserts, and a tool's output never changes a case's expected result.

## What is pinned

| Input | Where |
|---|---|
| Corpus revision and manifest digest | `pins.json`; `run.mjs` refuses another checkout, or one with local changes, unless `--allow-unpinned` is given and recorded |
| Case list and order | `suites/latest-browser-served.json` (the published bundle's 214 cases) |
| axe-core, Pa11y, IBM Equal Access, Lighthouse, Siteimprove Alfa, QualWeb, Playwright, Puppeteer and every transitive dependency | `package.json` (exact versions) and `package-lock.json`; `run.mjs` refuses an install that differs |
| IBM rule engine | `accessibility-checker` downloads its rules at run time unless told otherwise. The archive list it read on 2026-10-13 (`accessibility-checker-engine` 4.0.29, the `@next` tag) and the engine that list selects for checker 4.0.34 (`accessibility-checker-engine` 4.0.27, archive `13July2026`) are locked packages, served to the checker on 127.0.0.1 |
| Adapter configuration and native-rule-to-WCAG mapping | `run.mjs`, summarized per tool in `pins.json` |
| Cognium Conformis subject | `cognium/latest-browser-served-subject.yaml`: the 214 entry pages, no flows |
| Cognium Conformis revision | `pins.json` (`28f9e14d…`, packs `a11y/html@1.2.1` + `tech/html-aria@1.2.1`, browser driver 0.9.13) |

## What is recorded, not pinned

- **Browser build.** Pass `--chromium <executable>`, or let Playwright 1.61.1
  use its own build (Chromium 149.0.7827.55, the 2026-10-13 build). The version
  that ran is written to `environment.browser`.
- **Operating system, CPU architecture and installed fonts.** The 2026-10-13
  direct-tool run used macOS on arm64; its Cognium run used Linux on arm64.
- **Cognium Conformis.** Its runtime is in a private repository. This directory
  holds its subject declaration, its command and the importer that reduces its
  report to control ids, mapped criteria and counts; `--cognium-export` brings
  that export into the comparison.
- **Nu Html Checker.** A container image named by digest in `pins.json`. It is
  a markup-signal lane and does not contribute to WCAG criterion metrics.

## Run

```sh
git -C <corpus> checkout --detach 469486a4811c5055de9d2524ede1ca520c2774c8
npm ci --prefix comparison

# the six directly executed tools
node comparison/run.mjs --fixture-root <corpus> --out out/direct \
  [--chromium <executable>]

# Cognium Conformis (needs the private repository at the pinned revision)
node <corpus>/serve.mjs --host 127.0.0.1 --port 4173 &
npm run a11y:site -- --subject <this repo>/comparison/cognium/latest-browser-served-subject.yaml \
  --live --out out/cognium-report                      # inside cogniumhq/conformis
node comparison/import-cognium.mjs --source out/cognium-report --fixture-root <corpus> \
  --out out/cognium-export.json --conformis-revision <commit>
node comparison/run.mjs --fixture-root <corpus> --out out/cognium \
  --tools cognium --cognium-export out/cognium-export.json
```

`import-cognium.mjs` reads the report's A/AA view (`nodes`, `witnesses`) into
`cases`. AAA candidates the subject did not adopt are in the report's separate
`beyondClaim` block; the importer exports them under `beyond_claim` and prints
them on an AAA line of their own. They are never added to a `cases` row, count
or criterion, and `run.mjs` does not score them.

`run.mjs` writes `comparison.json` in the shape the results repository's
`scripts/import-comparison.mjs` publishes, and prints, per tool, the
known-defect cases target-detected, the declared criteria matched and the
corrected controls target-clean.

`--only <id,id>` runs a subset for a smoke test. The snapshot names the subset;
a subset is never the lane result.

## Check a reproduction

```sh
node comparison/diff.mjs <published comparison.json> out/direct/comparison.json
```

It refuses two snapshots measured against different corpus revisions, prints
both sets of lane metrics, and lists every case whose cell or matched criteria
differ, with the native rules that mapped.

## Scoring

The published lane's rule, also in [`check/comparable-lane.mjs`](../check/comparable-lane.mjs):

- a known defect is detected when a finding maps to one of its declared
  `min_criteria`;
- a corrected control is target-clean when no finding maps to one of its
  `must_not_report` criteria;
- a finding on any other criterion is kept and earns nothing either way;
- no finding is `cannot-tell`, never a pass; an error is an error.

For assertion-level recall and false-positive rates, convert the snapshot to
schema-valid result files and use [`check/score.mjs`](../check/score.mjs) from a
corpus checkout at the same revision.
