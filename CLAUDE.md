# jackson-rachel

Static wedding site on GitHub Pages, served at jackson-rachel.com through
Cloudflare. No build step — the HTML, CSS, and JS in the repo root are what
ships.

## Before committing: check the PR is still open

Work happens on `claude/github-pages-photo-dropbox-hjax01`, and that branch's
PR usually gets merged within minutes. **A merged PR cannot take new commits.**
Pushing to the branch afterwards silently strands the work — the push succeeds,
the branch moves, and nothing reaches `main`.

So at the start of any turn that will commit:

```
git fetch origin main
git log --oneline origin/main..HEAD    # anything here that main should have?
```

If the branch's PR has been merged, do not add to it. Restart from the current
default branch and replay only the unmerged work:

```
git checkout -B <branch> origin/main
git cherry-pick <unmerged commits>
```

Then open a **new** PR. The merged one is finished. Force-with-lease is fine
when the branch holds only already-merged history.

This has bitten three times. Verifying with `pull_request_read` before
committing takes one call; recovering afterwards takes several and risks
losing work.

## The photo drop box

Guests upload photos and videos without signing in to anything. A Google Apps
Script web app (`apps-script/Code.gs`) executes as the site owner and accepts
anonymous requests, so the browser never needs Google credentials.

Full setup, folder IDs, and day-to-day notes live in
[`apps-script/README.md`](apps-script/README.md). Key points:

- **`Code.gs` changes require a redeploy**, and the site keeps running the old
  code until then. Use **Deploy → Manage deployments → pencil → Version: New
  version**. Creating a *new deployment* instead mints a different `/exec` URL
  that then has to be pasted into `config.js` — that has caused real confusion
  more than once.
- The endpoint is public by design. `ALLOWED_ORIGINS` is not access control;
  the size caps, type checks, hourly `sweepInbox`, and rate limit are.
- Bytes never pass through Apps Script. It opens a Drive resumable upload
  session and the browser PUTs directly to Google, which is what makes phone
  videos work.

## Things that turned out to matter

- **`[hidden]` needs `!important`** (in `styles.css`). Any class setting
  `display` beats the attribute otherwise, and elements meant to be hidden
  render.
- **Reserve layout space before a fetch.** Anything that appears once a request
  returns must put placeholders up front, or the page lurches. Same for the
  Drive fallback iframes: hide them the moment JS takes over a panel, not when
  the response lands, or the old view flashes past on every load.
- **Never delete a tile when its thumbnail fails.** Drive drops requests under
  load; retry with backoff instead. Fall back to the Drive iframe only when
  every thumbnail in a panel has failed.
- **Cache keys must include what they depend on.** The listing cache was keyed
  on a folder's short name, so repointing that name at different folders kept
  serving the old contents.

## Testing

There is no test suite. Changes get driven in a real browser with Playwright
(`/opt/node22/lib/node_modules/playwright`, Chromium at `/opt/pw-browsers`)
against a mock endpoint, with `drive.google.com` requests intercepted — the
sandbox cannot reach `script.google.com` or the live site, so anything that
depends on real Drive responses has to be verified by the user.

Worth simulating, since all of these produced real bugs: slow responses, flaky
responses that succeed on retry, and dead ones that never succeed.
