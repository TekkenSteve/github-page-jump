# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-20

### Fixed

- Cursor lists no longer stop short on deep commit history pages. GitHub
  sometimes serves a page whose commit rows and Prev/Next links are rendered
  client-side only, so the markup carries no `after=` link even though another
  page exists; the number window read that as the end of the list (for example
  stopping at 24 pages on `/commits/main`). Cursor extraction now falls back to
  the pagination block embedded in the page payload, which names the next page
  even when the server renders no link.
- A second index pass on the same list (for example after a Turbo rebuild)
  now joins the walk already in flight instead of failing with "Indexing
  failed, please retry".

## [1.0.0] - 2026-10-26

Initial release.

### Added

- First-page and last-page buttons plus a direct page-number input on
  paginators that already show page numbers (GitHub search, notifications).
- A page-number window (`1 … n`) inserted between GitHub's own Previous and
  Next on lists that hide their page numbers — `?tab=repositories`,
  `?tab=followers`, `?tab=stars`, `/tags`, `/commits` — indexed in the
  background while you read the list.
- Recognition of every pagination shape GitHub serves today, including the
  last page of a cursor chain, which carries no `after=` link at all, and
  profile lists whose "Next" links are bare `rel="nofollow"` anchors.
- A fixed-pagination preference that pins the paginator to the bottom of the
  viewport, toggled from the toolbar popup.
- Controls built from GitHub's Primer color variables (light, dark, and
  high-contrast themes) and named with GitHub's own `Page N` accessibility
  convention.
- Bilingual documentation: English and 简体中文 READMEs with real screenshots
  captured from the extension running on GitHub.

[Unreleased]: https://github.com/TekkenSteve/github-page-jump/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/TekkenSteve/github-page-jump/releases/tag/v1.0.0
