# Security Policy

## Supported Versions

Security fixes are handled for the current `main` branch and the latest published release.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories:

https://github.com/ant-m13/CreditCalc/security/advisories/new

If advisories are unavailable, open a GitHub issue with a minimal description and avoid posting sensitive user data, exported calculations, or private share links.

## Data Handling

CreditCalc runs entirely in the browser. The application does not intentionally send loan data to a backend, but this is not an encryption or isolation guarantee. Loan data is stored unencrypted in the browser profile. Exported JSON files, recovery backups and shared calculation links contain source parameters and must be treated as private financial data.

## Static Hosting Trust Boundary

The production project URL is `https://ant-m13.github.io/CreditCalc/`. Browser storage is isolated by origin (scheme, host and port), not by URL path. Consequently, `localStorage` used by `/CreditCalc/` is shared with any other content that executes under the `https://ant-m13.github.io` origin. A compromised or untrusted sibling project page on that origin could read or modify the same storage even though it has a different path.

For calculations that require stronger browser isolation, deploy CreditCalc on a dedicated custom domain/origin that does not host unrelated applications. Keep all content and third-party scripts served from that origin within the same security review boundary. A custom path on the existing `ant-m13.github.io` host is not a separate origin.

The first-run dialog warns about this shared origin before the user enters loan data. Choosing “Работать без сохранения” removes the persisted loan state and keeps subsequent financial changes only in memory for the current tab; the same session-only mode can be changed under interface settings. Export JSON before closing the tab if those changes are needed later. This mode reduces persistent exposure but cannot isolate the live page from compromised same-origin content, browser extensions or the host environment.

## Browser Hardening

The static build ships a restrictive CSP meta tag: scripts, stylesheet files, images, workers and connections are limited to the application origin, and development-only `ws:` / localhost endpoints are not allowed in production HTML. Inline scripts stay blocked; inline style attributes are allowed because React, custom accent colors and Recharts apply styles at runtime.

A meta CSP cannot enforce the `frame-ancestors` directive, and `X-Frame-Options` can only be delivered as an HTTP response header. A hosting provider or reverse proxy should set `Content-Security-Policy: frame-ancestors 'none'` (or an explicitly approved allowlist) and, for legacy clients, `X-Frame-Options: DENY`. The repository's GitHub Pages deployment does not currently establish those anti-framing response headers, so clickjacking remains a documented residual risk on that host.

The CSP and local-only architecture do not protect against a malicious browser extension, a compromised browser profile or operating system, modified same-origin content, or a compromised production dependency.

## PWA Cache and Offline Data

The service worker is registered under the application base path and ignores requests outside that scope. Cache names include an application prefix plus a scope hash. The precache contains only the static production shell: HTML, hashed JavaScript/CSS/Workers, icons, the web manifest, local fonts and the offline fallback. Loan state, imported or exported JSON, share payloads and other user-provided financial values are not written to Cache Storage.

Cache Storage, service workers and `localStorage` still belong to the browser origin. Same-origin sibling content can inspect or delete origin caches even when it cannot be controlled by the `/CreditCalc/` worker. No confidential data is placed in those caches, and a dedicated origin remains the recommended isolation boundary.

The “Повысить надёжность” action calls the browser Storage API only after a user gesture. A successful persistent-storage grant may reduce automatic eviction, but it is not a backup and does not protect against manual site-data clearing, profile deletion or device loss. Installing the PWA provides the same guarantees: it does not encrypt, duplicate or synchronize loan data.

## Clearing Local Data

Export a recovery backup first if the data may still be needed. Then clear the following keys through the browser's developer tools under Application/Storage → Local Storage → `https://ant-m13.github.io`:

- `ipoteka-calculator-v1` — loans and application settings;
- `credit-calculator-onboarding-done` — onboarding state;
- `credit-calculator-seen-version` — last acknowledged version.

Alternatively, use the browser's “clear site data” control for `ant-m13.github.io`. Because storage is origin-wide, that action may also remove data belonging to other projects on the same GitHub Pages host. Deleting browser storage does not delete downloaded JSON/recovery files, copied parameter codes, shared URLs from browser history or copies already sent to other people; remove those separately.

The same origin-wide clear operation also removes the PWA service worker and Cache Storage. The static shell will be downloaded again on the next online visit; financial data can be restored only from a separately retained JSON export.
