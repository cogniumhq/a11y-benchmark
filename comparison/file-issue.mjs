// File a regression report as a GitHub issue, or add it to the one already open.
//
// The self-hosted runner has no `gh`, so the weekly job could write GAPS.md and
// then not file it (run 43088141458: `gh: command not found`, exit 127). This
// uses only Node's fetch and the job's own token, so the filing step needs
// nothing installed on the runner.
//
//   GITHUB_TOKEN=... node comparison/file-issue.mjs --repo <owner/name> \
//     --title "<title>" --body-file <GAPS.md>
//
// An open issue is found by its exact title, from the issues list, not by the
// search API: search quoting is how a duplicate would be filed every week.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

async function call(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'a11y-benchmark-weekly',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`${method} ${url} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

/** The number of the open issue with exactly this title, or null. Pull requests are not issues here. */
export async function findOpenIssue({ repo, title, token, fetchImpl = fetch }) {
  for (let page = 1; page <= 5; page += 1) {
    const url = `${API}/repos/${repo}/issues?state=open&per_page=100&page=${page}`;
    const items = await call(fetchImpl, token, 'GET', url);
    const hit = items.find((item) => !item.pull_request && item.title === title);
    if (hit) return hit.number;
    if (items.length < 100) return null;
  }
  return null;
}

/** Comment on the open issue with this title, or open one. Returns { action, number }. */
export async function fileIssue({ repo, title, body, token, fetchImpl = fetch }) {
  if (!token) throw new Error('no token: set GITHUB_TOKEN');
  if (!body.trim()) throw new Error('empty report: nothing to file');
  const existing = await findOpenIssue({ repo, title, token, fetchImpl });
  if (existing) {
    await call(fetchImpl, token, 'POST', `${API}/repos/${repo}/issues/${existing}/comments`, { body });
    return { action: 'commented', number: existing };
  }
  const created = await call(fetchImpl, token, 'POST', `${API}/repos/${repo}/issues`, { title, body });
  return { action: 'created', number: created.number };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = arg('repo');
  const title = arg('title');
  const bodyFile = arg('body-file');
  if (!repo || !title || !bodyFile) {
    console.error('usage: node file-issue.mjs --repo <owner/name> --title <title> --body-file <file>');
    process.exit(2);
  }
  try {
    const result = await fileIssue({ repo, title, body: fs.readFileSync(bodyFile, 'utf8'), token: process.env.GITHUB_TOKEN });
    console.log(`${result.action} issue #${result.number} in ${repo}`);
  } catch (error) {
    console.error(`could not file the regression: ${error.message}`);
    process.exit(1);
  }
}
