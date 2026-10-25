"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const pageIndex = require("../src/pageindex.js");

const BASE = "https://github.com/sverrejoh?tab=repositories";

/**
 * Creates an in-memory cache double.
 *
 * @returns {import("../src/types").CursorCache} A cache backed by a Map.
 */
function createMemoryCache() {
  /** @type {Map<string, string>} */
  const entries = new Map();

  return {
    remove(key) {
      entries.delete(key);
    },
    read(key) {
      return entries.has(key) ? String(entries.get(key)) : null;
    },
    write(key, value) {
      entries.set(key, value);
    }
  };
}

/**
 * Serves a deterministic list of `totalPages` pages.
 *
 * @param {number} totalPages The number of pages in the list.
 * @returns {{fetchPage: (url: string) => Promise<string>, probed: number[]}} The fetch double.
 */
function createListFetch(totalPages) {
  /** @type {number[]} */
  const probed = [];

  return {
    probed,
    fetchPage(url) {
      const page = pageIndex.readPageParam(url) || 1;
      probed.push(page);

      if (page >= totalPages) {
        return Promise.resolve('<span class="next_page disabled">Next</span>');
      }

      return Promise.resolve(
        `<a class="next_page" rel="next" href="${BASE}&amp;page=${page + 1}">Next</a>`
      );
    }
  };
}

/**
 * @typedef {{cache?: import("../src/types").CursorCache|null, cacheKey?: string, maxPages?: number, now?: () => number, throttleMs?: number, totalPages?: number}} SetupOptions
 */

/**
 * @typedef {{index: import("../src/types").ListIndex, probed: number[]}} PageSetup
 */

/**
 * Creates an index wired to deterministic doubles.
 *
 * @param {SetupOptions} [options] Overrides for the index dependencies.
 * @returns {PageSetup} The index and its doubles.
 */
function setup(options = {}) {
  const { totalPages = 4, ...rest } = options;
  const list = createListFetch(totalPages);
  const index = pageIndex.createPageIndex({
    fetchPage: list.fetchPage,
    sleep: () => Promise.resolve(),
    throttleMs: 0,
    ...rest
  });

  return { index, probed: list.probed };
}

describe("page parameter helpers", () => {
  it("reads and writes the page parameter", () => {
    assert.equal(pageIndex.readPageParam(BASE), null);
    assert.equal(pageIndex.readPageParam(`${BASE}&page=4`), 4);
    assert.equal(pageIndex.readPageParam(`${BASE}&page=0`), null);
    assert.equal(pageIndex.readPageParam(`${BASE}&page=abc`), null);

    assert.equal(pageIndex.setPageParam(BASE, 3), `${BASE}&page=3`);
    assert.equal(pageIndex.setPageParam(`${BASE}&page=3`, 1), BASE);
    assert.equal(pageIndex.setPageParam(`${BASE}&page=3`, 7), `${BASE}&page=7`);
  });

  it("detects next-page links across markup variants", () => {
    assert.equal(pageIndex.hasNextPage('<a rel="next" href="?page=2">Next</a>', 2), true);
    assert.equal(pageIndex.hasNextPage('<a class="next_page" href="?page=2">Next</a>', 2), true);
    assert.equal(pageIndex.hasNextPage('<a aria-label="Next Page" href="?page=2">2</a>', 2), true);
    // Profile tabs serve a bare variant with only rel="nofollow".
    assert.equal(
      pageIndex.hasNextPage('<a rel="nofollow" href="/u?tab=followers&amp;page=2">Next</a>', 2),
      true
    );
    // The link must target exactly the following page.
    assert.equal(pageIndex.hasNextPage('<a rel="next" href="?page=3">Next</a>', 2), false);
    assert.equal(pageIndex.hasNextPage('<a rel="next" href="?page=25">Next</a>', 2), false);
    // Sign-in calls to action keep the parameter percent-encoded.
    assert.equal(
      pageIndex.hasNextPage('<a href="/login?return_to=https%3A%2F%2Fgithub.com%3Fpage%3D2">', 2),
      false
    );
    assert.equal(pageIndex.hasNextPage('<span class="next_page disabled">Next</span>', 2), false);
    assert.equal(pageIndex.hasNextPage("<div>empty</div>", 2), false);
  });
});

describe("createPageIndex", () => {
  it("requires a page fetcher", () => {
    assert.throws(() => pageIndex.createPageIndex(/** @type {any} */ ({})), TypeError);
    assert.throws(
      () => pageIndex.createPageIndex(/** @type {any} */ ({ fetchPage: null })),
      TypeError
    );
  });

  it("resolves page one without any request", async () => {
    const { index, probed } = setup();
    const result = await index.resolvePage(1, { baseUrl: BASE });

    assert.equal(result.url, BASE);
    assert.deepEqual(probed, []);
  });

  it("builds URLs without any request", async () => {
    const { index, probed } = setup({ totalPages: 12 });
    assert.equal(index.getPageUrl(1, BASE), BASE);
    assert.equal(index.getPageUrl(7, BASE), `${BASE}&page=7`);
    assert.equal(index.getPageUrl(0, BASE), null);
    assert.deepEqual(probed, []);

    await index.resolveLast({ baseUrl: BASE });

    assert.equal(index.getPageUrl(12, BASE), `${BASE}&page=12`);
    assert.equal(index.getPageUrl(13, BASE), null);
  });

  it("reports whether a probe is in flight", async () => {
    const { index } = setup({ totalPages: 12 });
    assert.equal(index.isRunning(), false);

    const probing = index.resolveLast({ baseUrl: BASE });
    assert.equal(index.isRunning(), true);

    await probing;
    assert.equal(index.isRunning(), false);
  });

  it("jumps straight to a requested page without probing", async () => {
    const { index, probed } = setup({ totalPages: 12 });
    const result = await index.resolvePage(7, { baseUrl: BASE });

    assert.equal(result.url, `${BASE}&page=7`);
    assert.deepEqual(probed, []);
    assert.equal(index.getTotal(), null);
  });

  it("finds the last page with a bounded probe", async () => {
    const { index, probed } = setup({ totalPages: 4 });
    const result = await index.resolveLast({ baseUrl: BASE });

    assert.equal(result.total, 4);
    assert.equal(result.url, `${BASE}&page=4`);
    assert.ok(probed.length <= 6, `probed ${probed.length} pages`);
    assert.equal(index.isComplete(), true);
  });

  it("probes lists whose next links carry no class or aria-label", async () => {
    // Profile tabs such as ?tab=followers now serve bare anchors.
    const index = pageIndex.createPageIndex({
      fetchPage: (url) => {
        const page = pageIndex.readPageParam(url) || 1;
        return Promise.resolve(
          page >= 5
            ? '<span role="link" aria-disabled="true">Next</span>'
            : `<a rel="nofollow" href="${BASE}&amp;page=${page + 1}">Next</a>`
        );
      },
      sleep: () => Promise.resolve(),
      throttleMs: 0
    });

    const result = await index.resolveLast({ baseUrl: BASE });

    assert.equal(result.total, 5);
    assert.equal(result.url, `${BASE}&page=5`);
  });

  it("scales logarithmically on long lists", async () => {
    const { index, probed } = setup({ totalPages: 100 });
    const result = await index.resolveLast({ baseUrl: BASE });

    assert.equal(result.total, 100);
    assert.ok(probed.length <= 14, `probed ${probed.length} pages`);
  });

  it("recognizes single-page lists", async () => {
    const { index, probed } = setup({ totalPages: 1 });
    const result = await index.resolveLast({ baseUrl: BASE });

    assert.equal(result.total, 1);
    assert.equal(result.url, BASE);
    assert.deepEqual(probed, [1]);
  });

  it("rejects pages beyond a known total", async () => {
    const { index } = setup({ totalPages: 3 });
    await index.resolveLast({ baseUrl: BASE });

    const result = await index.resolvePage(9, { baseUrl: BASE });

    assert.equal(result.url, null);
    assert.equal(result.total, 3);
  });

  it("reports progress while probing", async () => {
    /** @type {Array<import("../src/types").ListProgress>} */
    const progress = [];
    const { index } = setup({ totalPages: 6 });

    await index.resolveLast({
      baseUrl: BASE,
      onProgress: (event) => progress.push(event)
    });

    const last = progress[progress.length - 1];

    assert.equal(progress.length > 0, true);
    assert.ok(last);
    assert.equal(last.probed, progress.length);
  });

  it("resolves the displayed page from the current URL", () => {
    const { index } = setup();

    assert.equal(index.getCurrentPage(BASE), 1);
    assert.equal(index.getCurrentPage(`${BASE}&page=5`), 5);
  });

  it("reuses a cached total across sessions", async () => {
    const cache = createMemoryCache();
    const first = setup({ cache, cacheKey: "k1", totalPages: 5 });
    await first.index.resolveLast({ baseUrl: BASE });

    const secondList = createListFetch(5);
    const second = pageIndex.createPageIndex({
      cache,
      cacheKey: "k1",
      fetchPage: secondList.fetchPage,
      sleep: () => Promise.resolve(),
      throttleMs: 0
    });

    assert.equal(second.getTotal(), 5);
    assert.deepEqual(secondList.probed, []);
  });

  it("surfaces network failures to the caller", async () => {
    const index = pageIndex.createPageIndex({
      fetchPage: () => Promise.reject(new Error("offline")),
      sleep: () => Promise.resolve(),
      throttleMs: 0
    });

    await assert.rejects(() => index.resolveLast({ baseUrl: BASE }), /offline/);
  });

  it("stops probing when cancelled", async () => {
    const list = createListFetch(50);
    const index = pageIndex.createPageIndex({
      fetchPage: (url) => {
        const result = list.fetchPage(url);
        index.cancel();
        return result;
      },
      sleep: () => Promise.resolve(),
      throttleMs: 0
    });

    const result = await index.resolveLast({ baseUrl: BASE });

    assert.equal(result.url, null);
    assert.equal(result.cancelled, true);
    assert.ok(list.probed.length <= 2);
  });
});
