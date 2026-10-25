/**
 * Unit tests for the cursor chain indexer.
 */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const cursor = require("../src/cursor.js");

const BASE = "https://github.com/TekkenSteve?tab=stars";
const NEXT_MARKUP =
  '<div class="paginate-container"><div class="BtnGroup" data-test-selector="pagination">' +
  '<button class="btn BtnGroup-item" disabled="disabled">Previous</button>' +
  '<a rel="nofollow" class="btn BtnGroup-item" ' +
  'href="https://github.com/TekkenSteve?after=Y3Vyc29yOnYyOpK0MjAyNi0wOC0wNlQxMjo1ODo1MFrOK1T92g%3D">Next</a>' +
  "</div></div>";

/**
 * @typedef {{entries: Map<string, string>, read: (key: string) => string|null, write: (key: string, value: string) => void, remove: (key: string) => void}} MemoryCache
 */

/**
 * Creates an in-memory cache double.
 *
 * @returns {MemoryCache} A cursor cache backed by a Map.
 */
function createMemoryCache() {
  /** @type {Map<string, string>} */
  const entries = new Map();

  return /** @type {MemoryCache} */ ({
    entries,
    remove(key) {
      entries.delete(key);
    },
    read(key) {
      return entries.has(key) ? /** @type {string} */ (entries.get(key)) : null;
    },
    write(key, value) {
      entries.set(key, value);
    }
  });
}

/**
 * @typedef {{fetchPage: (url: string) => Promise<string>, requested: string[]}} ChainFetch
 */

/**
 * Creates a fake GitHub list that paginates through `c1`, `c2`, ... cursors.
 *
 * @param {number} totalPages The number of pages in the chain.
 * @returns {ChainFetch} The fetch double and its request log.
 */
function createChainFetch(totalPages) {
  /** @type {string[]} */
  const requested = [];

  return {
    requested,
    /**
     * Serves one list page.
     *
     * @param {string} url The requested URL.
     * @returns {Promise<string>} The page markup.
     */
    fetchPage(url) {
      requested.push(url);
      const after = cursor.readAfter(url);
      const current = after ? Number(after.replace("c", "")) + 1 : 1;

      if (!after && url.includes("after=")) {
        return Promise.reject(new Error(`unexpected cursor: ${url}`));
      }

      if (current >= totalPages) {
        return Promise.resolve("<div>last page</div>");
      }

      return Promise.resolve(`<a rel="nofollow" href="${BASE}&amp;after=c${current}">Next</a>`);
    }
  };
}

/**
 * Creates a deterministic sleep double.
 *
 * @returns {{sleep: (ms: number) => Promise<void>, delays: number[]}} The sleep double.
 */
function createSleepDouble() {
  /** @type {number[]} */
  const delays = [];
  return {
    delays,
    sleep(ms) {
      delays.push(ms);
      return Promise.resolve();
    }
  };
}

/**
 * @typedef {{cache?: import("../src/types").CursorCache|null, cacheKey?: string, maxHops?: number, now?: () => number, throttleMs?: number, totalPages?: number}} SetupOptions
 */

/**
 * @typedef {{delays: number[], index: import("../src/types").ListIndex, progress: Array<import("../src/types").ListProgress>, requested: string[], resolve: (page: number) => Promise<import("../src/types").CursorResolution>, resolveLast: () => Promise<import("../src/types").CursorResolution>}} CursorSetup
 */

/**
 * Creates an index wired to deterministic doubles.
 *
 * @param {SetupOptions} [options] Overrides for the index dependencies.
 * @returns {CursorSetup} The index and its doubles.
 */
function setup(options = {}) {
  const { cache = null, cacheKey = "", maxHops, now, throttleMs = 0, totalPages = 5 } = options;
  const chain = createChainFetch(totalPages);
  const { delays, sleep } = createSleepDouble();
  /** @type {Array<import("../src/types").ListProgress>} */
  const progress = [];

  const index = cursor.createCursorIndex({
    cache,
    cacheKey,
    fetchPage: chain.fetchPage,
    maxHops,
    now,
    sleep,
    throttleMs
  });

  return {
    delays,
    index,
    progress,
    requested: chain.requested,
    /**
     * Runs a resolution with the shared progress sink.
     *
     * @param {number} page The target page number.
     * @returns {Promise<import("../src/types").CursorResolution>} The resolution.
     */
    resolve(page) {
      return index.resolvePage(page, {
        baseUrl: BASE,
        onProgress: (event) => progress.push(event)
      });
    },
    /**
     * Resolves the last page with the shared progress sink.
     *
     * @returns {Promise<import("../src/types").CursorResolution>} The resolution.
     */
    resolveLast() {
      return index.resolveLast({
        baseUrl: BASE,
        onProgress: (event) => progress.push(event)
      });
    }
  };
}

describe("URL helpers", () => {
  it("reads encoded cursors without decoding them", () => {
    assert.equal(cursor.readAfter(`${BASE}&after=abc%3D`), "abc%3D");
    assert.equal(cursor.readAfter(BASE), null);
    assert.equal(cursor.readAfter(`${BASE}&after=`), "");
  });

  it("strips and re-applies the cursor parameter", () => {
    const withCursor = cursor.withAfter(BASE, "c1");
    assert.equal(withCursor, `${BASE}&after=c1`);
    assert.equal(cursor.stripAfter(withCursor), BASE);
  });

  it("replaces an existing cursor instead of appending a second one", () => {
    assert.equal(cursor.withAfter(cursor.withAfter(BASE, "c1"), "c2"), `${BASE}&after=c2`);
  });
});

describe("extractNextCursor", () => {
  it("prefers the rel=nofollow pagination link", () => {
    assert.equal(
      cursor.extractNextCursor(NEXT_MARKUP),
      "Y3Vyc29yOnYyOpK0MjAyNi0wOC0wNlQxMjo1ODo1MFrOK1T92g%3D"
    );
  });

  it("decodes escaped ampersands in hrefs", () => {
    assert.equal(
      cursor.extractNextCursor('<a rel="nofollow" href="/u?tab=stars&amp;after=XYZ">Next</a>'),
      "XYZ"
    );
  });

  it("returns null for lists without a next link", () => {
    assert.equal(cursor.extractNextCursor("<div>last page</div>"), null);
    assert.equal(cursor.extractNextCursor(""), null);
  });

  it("falls back to any link carrying a cursor", () => {
    assert.equal(cursor.extractNextCursor('<a href="/u?after=FALLBACK">more</a>'), "FALLBACK");
  });
});

describe("createCursorIndex", () => {
  it("requires a page fetcher", () => {
    assert.throws(() => cursor.createCursorIndex(/** @type {any} */ ({})), TypeError);
    assert.throws(
      () => cursor.createCursorIndex(/** @type {any} */ ({ fetchPage: null })),
      TypeError
    );
  });

  it("resolves the first page without any request", async () => {
    const { index, requested } = setup();
    const result = await index.resolvePage(1, { baseUrl: BASE });

    assert.deepEqual(result, { cancelled: false, total: null, url: BASE });
    assert.deepEqual(requested, []);
  });

  it("builds URLs for indexed pages without another request", async () => {
    const { index, requested, resolve } = setup({ totalPages: 5 });
    assert.equal(index.getPageUrl(1, BASE), BASE);
    assert.equal(index.getPageUrl(3, BASE), null);

    await resolve(3);

    assert.equal(index.getPageUrl(2, BASE), `${BASE}&after=c1`);
    assert.equal(index.getPageUrl(3, BASE), `${BASE}&after=c2`);
    assert.equal(index.getPageUrl(4, BASE), null);
    assert.equal(requested.length, 2);
  });

  it("reports whether a walk is in flight", async () => {
    const { index, resolve } = setup({ totalPages: 5 });
    assert.equal(index.isRunning(), false);

    const walking = resolve(4);
    assert.equal(index.isRunning(), true);

    await walking;
    assert.equal(index.isRunning(), false);
  });

  it("walks the chain to reach an arbitrary page", async () => {
    const { requested, resolve } = setup({ totalPages: 5 });
    const result = await resolve(3);

    assert.equal(result.url, `${BASE}&after=c2`);
    assert.equal(result.cancelled, false);
    assert.deepEqual(requested, [BASE, `${BASE}&after=c1`]);
  });

  it("reports progress while walking", async () => {
    const { progress, resolve } = setup({ totalPages: 5 });
    await resolve(4);

    assert.deepEqual(progress, [
      { indexed: 2, total: null },
      { indexed: 3, total: null },
      { indexed: 4, total: null }
    ]);
  });

  it("resolves the last page and reports the total", async () => {
    const { index, requested, resolveLast } = setup({ totalPages: 4 });
    const result = await resolveLast();

    assert.equal(result.url, `${BASE}&after=c3`);
    assert.equal(result.total, 4);
    assert.equal(requested.length, 4);
    assert.equal(index.isComplete(), true);
    assert.equal(index.getTotal(), 4);
  });

  it("returns the base URL when the list has a single page", async () => {
    const { resolveLast } = setup({ totalPages: 1 });
    const result = await resolveLast();

    assert.equal(result.url, BASE);
    assert.equal(result.total, 1);
  });

  it("reports the real total when a requested page is out of range", async () => {
    const { resolve } = setup({ totalPages: 3 });
    const result = await resolve(9);

    assert.equal(result.url, null);
    assert.equal(result.total, 3);
    assert.equal(result.cancelled, false);
  });

  it("throttles consecutive requests", async () => {
    const { delays, resolve } = setup({ throttleMs: 120, totalPages: 5 });
    await resolve(4);

    assert.deepEqual(delays, [120, 120]);
  });

  it("stops at the configured hop limit", async () => {
    const { index, requested, resolveLast } = setup({ maxHops: 2, totalPages: 10 });
    const result = await resolveLast();

    assert.equal(requested.length, 2);
    assert.equal(index.getTotal(), null);
    assert.equal(index.getKnownPages(), 3);
    assert.equal(result.url, `${BASE}&after=c2`);
  });

  it("cancels a walk at the next checkpoint", async () => {
    const chain = createChainFetch(50);
    const { sleep } = createSleepDouble();
    /** @type {import("../src/types").ListIndex|null} */
    let indexRef = null;
    let calls = 0;

    const index = cursor.createCursorIndex({
      fetchPage(url) {
        calls += 1;
        if (calls === 1 && indexRef) {
          indexRef.cancel();
        }

        return chain.fetchPage(url);
      },
      sleep,
      throttleMs: 0
    });
    indexRef = index;

    const result = await index.resolvePage(20, { baseUrl: BASE });

    assert.equal(result.cancelled, true);
    assert.equal(result.url, null);
    assert.equal(calls, 1);
  });

  it("resolves the displayed page from the current URL", async () => {
    const { index, resolveLast } = setup({ totalPages: 4 });
    await resolveLast();

    assert.equal(index.getCurrentPage(BASE), 1);
    assert.equal(index.getCurrentPage(`${BASE}&after=c1`), 2);
    assert.equal(index.getCurrentPage(`${BASE}&after=c3`), 4);
    assert.equal(index.getCurrentPage(`${BASE}&after=unknown`), null);
  });

  it("propagates fetch failures", async () => {
    const index = cursor.createCursorIndex({
      fetchPage: () => Promise.reject(new Error("429")),
      sleep: () => Promise.resolve(),
      throttleMs: 0
    });

    await assert.rejects(() => index.resolvePage(3, { baseUrl: BASE }), /429/);
  });
});

describe("cursor chain cache", () => {
  it("reuses a cached chain without further requests", async () => {
    const cache = createMemoryCache();
    const first = setup({ cache, cacheKey: "k1", totalPages: 5 });
    await first.resolveLast();

    const second = setup({ cache, cacheKey: "k1", totalPages: 5 });
    const result = await second.resolve(4);

    assert.equal(result.url, `${BASE}&after=c3`);
    assert.deepEqual(second.requested, []);
    assert.equal(second.index.getTotal(), 5);
  });

  it("ignores expired cache entries", async () => {
    const cache = createMemoryCache();
    let clock = 0;
    const first = setup({
      cache,
      cacheKey: "k2",
      now: () => clock,
      totalPages: 5
    });
    await first.resolveLast();

    clock = cursor.DEFAULT_CACHE_TTL_MS + 1;
    const second = setup({ cache, cacheKey: "k2", now: () => clock, totalPages: 5 });
    assert.equal(second.index.getTotal(), null);
  });

  it("survives corrupt cache entries", async () => {
    const cache = createMemoryCache();
    cache.write("k3", "{not json");
    const { resolve } = setup({ cache, cacheKey: "k3", totalPages: 3 });

    const result = await resolve(2);
    assert.equal(result.url, `${BASE}&after=c1`);
  });

  it("discards the chain on reset", async () => {
    const cache = createMemoryCache();
    const { index, resolveLast } = setup({ cache, cacheKey: "k4", totalPages: 4 });
    await resolveLast();
    index.reset();

    assert.equal(index.getTotal(), null);
    assert.equal(cache.read("k4"), null);
  });
});
