# Security Policy

## Supported Versions

Security fixes are handled for the current `main` branch and the latest published release.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories:

https://github.com/ant-m13/CreditCalc/security/advisories/new

If advisories are unavailable, open a GitHub issue with a minimal description and avoid posting sensitive user data, exported calculations, or private share links.

## Data Handling

CreditCalc runs entirely in the browser. It does not send loan data to a server, but exported JSON files and shared calculation links contain the source parameters of a calculation. Treat them as private financial data.

## Browser Hardening

The static build ships a restrictive CSP meta tag for GitHub Pages: scripts, stylesheet files, images, workers and connections are limited to the application origin, and development-only `ws:` / localhost endpoints are not allowed in production HTML. Inline scripts stay blocked; inline style attributes are allowed because React, custom accent colors and Recharts use DOM-applied styles at runtime. `frame-ancestors` must be configured as an HTTP response header by the hosting provider, because browsers ignore it in meta CSP.
