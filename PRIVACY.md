# Privacy Policy

GitHub Page Jump is a client-side Chrome extension. It has no backend and no
analytics. Everything it reads stays in the browser tab.

## Data handling

- **No collection.** The extension never collects, stores, or transmits personal
  data, browsing history, page content, or telemetry.
- **Same-origin requests only.** On GitHub lists that paginate with a `after`
  cursor instead of page numbers, the extension fetches those same list pages
  from `https://github.com` to read the next cursor out of the markup. These are
  ordinary same-origin requests made with the cookies already present in your
  browser — the same page you would load by clicking "Next". Responses are parsed
  in memory to find the cursor and are never sent anywhere else.
- **Local caching.** Cursors discovered while walking a list are cached in the
  page's `sessionStorage` for 30 minutes so repeated jumps are instant. The cache
  is cleared when the tab closes and contains only opaque cursor values.
- **Local preference.** The single preference ("Fixed pagination") is stored with
  `chrome.storage.sync` so it follows your Chrome profile. It stays inside your
  browser account and is never read by anyone else.

## Permissions

| Permission           | Why it is required                                   |
| -------------------- | ---------------------------------------------------- |
| `storage`            | Remember whether fixed pagination is enabled.        |
| `https://github.com` | Inject the pagination controls on GitHub pages only. |

The extension declares no `host_permissions` beyond the content-script match
pattern, and never contacts a third-party origin.

## Changes

Any future change to this policy will be reflected in this file and in the
release notes of the corresponding version.

## Contact

Open an issue at <https://github.com/TekkenSteve/github-page-jump/issues>.
