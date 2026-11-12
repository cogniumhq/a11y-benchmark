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
node comparison/gaps.mjs <published comparison.json> out/direct/comparison.json
```

`diff.mjs` refuses two snapshots measured against different corpus revisions,
prints both sets of lane metrics, and lists every case whose cell or matched
criteria differ, with the native rules that mapped.

`gaps.mjs` is what the weekly job runs. It exits 1 when a known defect loses a
declared criterion it matched in the baseline, when a corrected control gains
one, or when a case errors. Declared criteria the baseline already missed are
listed as standing misses and do not fail the run. `--cognium-export` scores a
sanitized Conformis export against the baseline case list.

When `gaps.mjs` fails the weekly job, `file-issue.mjs` opens an issue with
`GAPS.md`, or comments on the open one with the same title. It needs only Node
and the job's `GITHUB_TOKEN`, because the self-hosted runner has no `gh`.
`check/weekly-workflow.test.mjs` fails if the workflow calls `gh` again.

A navigation that times out is tried once more (`navigate.mjs`), because a page
that did not load is recorded as an error, and an error where the published
bundle had a score reads as a lost detection. A second timeout is still an error.

## Lane variants

Two **variants** of this lane change one thing on the Cognium Conformis side
and keep everything else: the corpus revision, the pins, the scoring rule. A
variant is published apart, under its own lane name and bundle path
(`results/<date>-v0.1.0-<variant>`), labelled as a variant, and **never quoted
as the `latest-browser-served` lane**. Its figures are printed beside this
lane's, never summed with them and never read as a gain over them. Only Cognium
Conformis is run in a variant: the direct tools have no such setting. The lanes
are defined in [`lanes.mjs`](lanes.mjs) (`node comparison/lanes.mjs list`).

| Lane | What changes | Pages | Subject |
|---|---|---|---|
| `latest-browser-served` | nothing: the published lane | 214 | `cognium/latest-browser-served-subject.yaml` |
| `latest-browser-served-explore-2` | state exploration depth 2 (`--explore=2`) | the same 214, same order | the same subject |
| `latest-browser-served-journey-pages` | each journey case is its own subject over its declared `steps` pages | the lane's 18 journey cases | `cognium/journey-pages/<case id>.yaml`, one per case |

```sh
# explore-2: the same subject, scanned at depth 2
npm run a11y:site -- --subject <this repo>/comparison/cognium/latest-browser-served-subject.yaml \
  --live --explore=2 --out out/latest-browser-served-explore-2/report          # inside cogniumhq/conformis
node comparison/import-cognium.mjs --lane latest-browser-served-explore-2 \
  --source out/latest-browser-served-explore-2/report --fixture-root <corpus> \
  --out out/latest-browser-served-explore-2/cognium-export.json --conformis-revision <commit>
node comparison/run.mjs --lane latest-browser-served-explore-2 --fixture-root <corpus> --out out \
  --tools cognium --cognium-export out/latest-browser-served-explore-2/cognium-export.json

# journey pages: one scan per journey case, never one site
for subject in <this repo>/comparison/cognium/journey-pages/*.yaml; do
  npm run a11y:site -- --subject "$subject" --live \
    --out "out/latest-browser-served-journey-pages/reports/$(basename "$subject" .yaml)"  # inside cogniumhq/conformis
done
node comparison/import-cognium-journeys.mjs --source out/latest-browser-served-journey-pages/reports \
  --fixture-root <corpus> --out out/latest-browser-served-journey-pages/cognium-export.json \
  --conformis-revision <commit>
node comparison/run.mjs --lane latest-browser-served-journey-pages --fixture-root <corpus> --out out \
  --tools cognium --cognium-export out/latest-browser-served-journey-pages/cognium-export.json
```

What keeps them apart:

- `run.mjs --lane <variant>` writes `<out>/<variant>/comparison.json`, never
  `<out>/comparison.json`, with a `lane` block that names the variant, the lane
  it varies and how it may be quoted. Without `--lane`, the run and its output
  are byte for byte what they were before variants existed.
- An export carries its lane. A run of one lane refuses an export of another,
  and an importer refuses to write a variant's export outside a path named for
  it.
- `merge.mjs` refuses to join snapshots of two lanes. `diff.mjs` refuses to diff
  two lanes unless given `--across-lanes`, and then prints the result as a
  difference between lanes, not a change in either.
- [`check/comparable-lane.mjs`](../check/comparable-lane.mjs) refuses rows of a
  variant when it scores this lane.

**explore-2.** The importer requires the report itself to record
`explore: 2`; the operator's word is not enough. A live run whose inventory
probe may not click on the subject's host ignores `--explore` and would pass a
depth-0 run off as the variant. The default lane refuses a report that records
any state exploration.

**journey pages.** The subjects are generated from the pinned corpus's
`journeys.json` (`node comparison/lanes.mjs write-journey-subjects
--fixture-root <corpus at the pin>`); a test holds the committed files to it.
The broken and the corrected version of a journey are separate subjects, and no
page is an entry point of two subjects: pooled into one site, a site-anchored
finding from one journey would land on every other journey, corrected controls
included. A finding the scan anchors to the site (the relationships between
pages that 3.2.3, 3.2.4, 3.2.6 and 3.3.7 are about), or to any of the case's
steps pages, is attributed to that journey's case; each row says how many came
from each (`attribution`). A finding anchored to a page outside the case's
steps is refused.

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
