// Ask for review of a standards refresh that is already on its branch.
//
// The organization does not allow GitHub Actions to open a pull request
// (run 42629777910: "GitHub Actions is not permitted to create or approve
// pull requests"). Pushing the branch is allowed. This tries the pull
// request, and when that refusal is the reason, leaves an issue whose body
// is the refresh report and a compare link a person opens the pull request
// from. Any other refusal still fails the run.
//
//   GITHUB_TOKEN=... node refresh-open.mjs --repo <owner/name> \
//     --base <branch> --head refresh/standards-sources --report <file>

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const BLOCKED = /not permitted to create or approve pull requests|does not allow GitHub Actions to create or approve pull requests/i;

export function pullRequestBlocked(status, text) {
  return (status === 403 || status === 409) && BLOCKED.test(text);
}

async function request(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'a11y-benchmark-refresh',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
  }
  return { ok: response.ok, status: response.status, text, value };
}

function refused(result, method, url) {
  const error = new Error(`${method} ${url} answered ${result.status}: ${result.text.slice(0, 300)}`);
  error.status = result.status;
  error.body = result.text;
  return error;
}

async function findOpenIssue(fetchImpl, token, repo, title) {
  for (let page = 1; page <= 5; page += 1) {
    const url = `${API}/repos/${repo}/issues?state=open&per_page=100&page=${page}`;
    const result = await request(fetchImpl, token, 'GET', url);
    if (!result.ok) throw refused(result, 'GET', url);
    const hit = result.value.find((item) => !item.pull_request && item.title === title);
    if (hit) return hit.number;
    if (result.value.length < 100) return null;
  }
  return null;
}

/**
 * Open or update the pull request for this branch. When the token is not
 * allowed to open one, comment the report on the open issue of `issueTitle`,
 * or open that issue. Returns { action, number }.
 */
export async function openRefreshReview({
  repo,
  base,
  head,
  title,
  body,
  issueTitle,
  token,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error('no token: set GITHUB_TOKEN');
  if (!body.trim()) throw new Error('empty report: nothing to review');
  const [owner] = repo.split('/');
  const listUrl = `${API}/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`;
  const listed = await request(fetchImpl, token, 'GET', listUrl);
  if (!listed.ok) throw refused(listed, 'GET', listUrl);
  if (listed.value.length > 0) {
    const number = listed.value[0].number;
    const url = `${API}/repos/${repo}/pulls/${number}`;
    const updated = await request(fetchImpl, token, 'PATCH', url, { title, body });
    if (!updated.ok) throw refused(updated, 'PATCH', url);
    return { action: 'updated', number };
  }

  const createUrl = `${API}/repos/${repo}/pulls`;
  const created = await request(fetchImpl, token, 'POST', createUrl, { title, head, base, body });
  if (created.ok) return { action: 'opened', number: created.value.number };
  if (!pullRequestBlocked(created.status, created.text)) throw refused(created, 'POST', createUrl);

  const compare = `https://github.com/${repo}/compare/${base}...${head}?expand=1`;
  const issueBody = [
    'GitHub Actions cannot open this pull request. The organization does not allow it, and pushing the branch is allowed.',
    '',
    `Open it from ${compare}`,
    '',
    body,
  ].join('\n');
  const existing = await findOpenIssue(fetchImpl, token, repo, issueTitle);
  if (existing) {
    const url = `${API}/repos/${repo}/issues/${existing}/comments`;
    const comment = await request(fetchImpl, token, 'POST', url, { body: issueBody });
    if (!comment.ok) throw refused(comment, 'POST', url);
    return { action: 'commented', number: existing, compare };
  }
  const url = `${API}/repos/${repo}/issues`;
  const issue = await request(fetchImpl, token, 'POST', url, { title: issueTitle, body: issueBody });
  if (!issue.ok) throw refused(issue, 'POST', url);
  return { action: 'issue', number: issue.value.number, compare };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = arg('repo');
  const base = arg('base');
  const head = arg('head');
  const report = arg('report');
  if (!repo || !base || !head || !report) {
    console.error('usage: node refresh-open.mjs --repo <owner/name> --base <branch> --head <branch> --report <file>');
    process.exit(2);
  }
  const title = 'Refresh standards-derived sources';
  try {
    const result = await openRefreshReview({
      repo,
      base,
      head,
      title,
      body: fs.readFileSync(report, 'utf8'),
      issueTitle: `${title} needs a pull request`,
      token: process.env.GITHUB_TOKEN,
    });
    const where = result.action === 'opened' || result.action === 'updated' ? 'pull request' : 'issue';
    console.log(`${result.action} ${where} #${result.number}${result.compare ? `\n${result.compare}` : ''}`);
  } catch (error) {
    console.error(`could not ask for review: ${error.message}`);
    process.exit(1);
  }
}
