# Security

## Your data stays in your browser

Ppl Work Smart is a static page. It has no backend and makes no network requests.

- Logs you paste, and the config you build, are kept only in your browser's `localStorage`.
- The page sets a Content-Security-Policy with `connect-src 'none'` and `default-src 'none'`. The browser blocks any attempt to send data out, even from code that was injected.
- Only local scripts and styles are loaded. There are no CDNs, analytics, fonts or trackers.
- Untrusted text (pasted logs, config values) is only ever inserted as text, never as HTML.
- Downloads (CSV, `.log`, `.spl`, config JSON) are made locally with `Blob` URLs.

The GitHub Pages site serves the same static files, so the same rules apply there.

**Don't commit real log data.** Exported configs and CSVs can contain whatever you pasted. `.gitignore` excludes the default export file names.

## Automated checks

Every push and pull request runs, and the checks re-run weekly:

| Check | What it does |
|---|---|
| `tests/security.test.js` | Fails if the code uses network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, …), HTML-injection sinks (`innerHTML`, `eval`, …), loads remote resources, or contains credential patterns, or if the CSP is weakened. |
| gitleaks | Scans the full git history for secrets. |
| CodeQL (`security-extended`) | Static analysis of the JavaScript and the workflow files. |
| Dependabot | Keeps the GitHub Actions used by the workflow up to date. |

## Reporting a vulnerability

Please use **Security → Report a vulnerability** on this repository (private advisory) rather than a public issue.
