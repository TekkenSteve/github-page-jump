/**
 * Cursor chain indexer for GitHub's cursor-based (Previous / Next) lists.
 *
 * Several GitHub list views render without page numbers. Opaque cursors require
 * a cached sequential walk; commit-history offset cursors support direct page
 * URLs and logarithmic end discovery.
 *
 * Shared structural types live in `types.d.ts`.
 */

/**
 * Publishes the cursor chain indexer.
 *
 * @param {object} root The global object that receives the browser API.
 * @param {() => import("./types").CursorApi} factory Creates the cursor API.
 * @returns {void}
 */
(function initializeCursor(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GitHubPageJumpCursor = api;
})(globalThis, createCursor);

/**
 * Creates the cursor chain indexer.
 *
 * @returns {import("./types").CursorApi} The public cursor API.
 */
function createCursor() {
  "use strict";

  const DEFAULT_THROTTLE_MS = 120;
  const DEFAULT_MAX_HOPS = Number.POSITIVE_INFINITY;
  const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
  const CACHE_VERSION = 2;

  /**
   * Reads the percent-encoded `after` cursor from a URL.
   *
   * The raw value is returned because GitHub tolerates only its own encoding
   * and re-encoding a decoded cursor corrupts `+` and `/` characters.
   *
   * @param {string} url The URL or href to inspect.
   * @returns {string|null} The encoded cursor, or null when absent.
   */
  function readAfter(url) {
    const match = /[?&]after=([^&#]*)/.exec(url);
    return match ? match[1] : null;
  }

  /**
   * Removes the `after` query parameter from a URL.
   *
   * @param {string} url The absolute URL to normalize.
   * @returns {string} The URL without a cursor.
   */
  function stripAfter(url) {
    const parsed = new URL(url);
    parsed.searchParams.delete("after");
    return parsed.toString();
  }

  /**
   * Appends a cursor to a URL, replacing any existing cursor.
   *
   * @param {string} url The absolute URL to extend.
   * @param {string} cursor The percent-encoded cursor value.
   * @returns {string} The URL that resolves to the cursor's page.
   */
  function withAfter(url, cursor) {
    const base = stripAfter(url);
    return `${base}${base.includes("?") ? "&" : "?"}after=${cursor}`;
  }

  /**
   * @param {string} url The list URL.
   * @returns {boolean} True for GitHub commit-history routes.
   */
  function isCommitHistory(url) {
    return /\/commits(?:\/|$)/.test(new URL(url).pathname);
  }

  /**
   * Reads every pagination block GitHub embeds into its React payloads.
   *
   * A page can contain several independently rendered partials, each with its
   * own `pagination` object. Consumers must select the block that corresponds
   * to the list cursor instead of assuming the first block owns the page.
   *
   * @param {string} html The raw list page markup.
   * @returns {Array<{startCursor?: unknown, endCursor?: unknown, hasNextPage?: unknown}>}
   *   The structurally valid pagination blocks.
   */
  function readEmbeddedPaginations(html) {
    const marker = '"pagination":{';
    /** @type {Array<{startCursor?: unknown, endCursor?: unknown, hasNextPage?: unknown}>} */
    const blocks = [];
    let searchFrom = 0;

    while (searchFrom < html.length) {
      const at = html.indexOf(marker, searchFrom);
      if (at < 0) {
        break;
      }

      const start = at + marker.length - 1;
      let depth = 0;
      const limit = Math.min(html.length, start + 2000);
      let parsedEnd = start + 1;

      for (let index = start; index < limit; index += 1) {
        const character = html[index];
        if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            parsedEnd = index + 1;
            try {
              const parsed = /** @type {Record<string, unknown>} */ (
                JSON.parse(html.slice(start, parsedEnd))
              );
              blocks.push(parsed);
            } catch (_error) {
              // Ignore this block and continue to the next embedded partial.
            }
            break;
          }
        }
      }

      searchFrom = Math.max(parsedEnd, at + marker.length);
    }

    return blocks;
  }

  /**
   * Derives the next cursor from a page's embedded pagination payload.
   *
   * Commit lists address pages as `<sha> <offset>` inside the payload, while
   * the URL form uses `<sha>+<offset>`; the end cursor therefore names the
   * first commit of the next page.
   *
   * @param {string} html The raw list page markup.
   * @returns {string|null} The next cursor, or null when the payload cannot
   *   name one (another cursor shape, a missing block, or the last page).
   */
  function embeddedNextCursor(html) {
    for (const pagination of readEmbeddedPaginations(html)) {
      if (pagination.hasNextPage !== true) {
        continue;
      }

      const cursor = encodeOffsetCursor(pagination.endCursor);
      if (cursor) {
        return cursor;
      }
    }

    return null;
  }

  /**
   * Converts GitHub's embedded `<anchor> <offset>` cursor to its URL form.
   *
   * @param {unknown} value The embedded cursor value.
   * @returns {string|null} The URL cursor, or null for another cursor shape.
   */
  function encodeOffsetCursor(value) {
    if (typeof value !== "string") {
      return null;
    }

    const match = /^(\S+)\s+(\d+)$/.exec(value);
    return match ? `${match[1]}+${match[2]}` : null;
  }

  /**
   * Parses the URL form of GitHub's commit-history offset cursor.
   *
   * @param {string|null} cursor The URL cursor.
   * @returns {{anchor: string, offset: number}|null} Its components, or null for
   *   an opaque cursor.
   */
  function parseOffsetCursor(cursor) {
    if (!cursor) {
      return null;
    }

    const match = /^([^+]+)\+(\d+)$/.exec(cursor);
    if (!match) {
      return null;
    }

    return { anchor: match[1], offset: Number(match[2]) };
  }

  /**
   * Reads the structured pagination state embedded in a GitHub response.
   *
   * @param {string} html The raw list page markup.
   * @returns {Array<{hasNext: boolean, start: {anchor: string, offset: number}|null,
   *   end: {anchor: string, offset: number}|null}>} The parsed states.
   */
  function readOffsetPaginations(html) {
    return readEmbeddedPaginations(html)
      .filter((pagination) => typeof pagination.hasNextPage === "boolean")
      .map((pagination) => ({
        hasNext: /** @type {boolean} */ (pagination.hasNextPage),
        start: parseOffsetCursor(encodeOffsetCursor(pagination.startCursor)),
        end: parseOffsetCursor(encodeOffsetCursor(pagination.endCursor))
      }));
  }

  /**
   * Extracts the next cursor from a GitHub list page body.
   *
   * The Next link is the primary source: it is what GitHub itself would follow.
   * When the server renders no link at all (deep commit history pages defer the
   * list to the client), the embedded pagination payload still names the next
   * page, so the walk can continue instead of stopping early.
   *
   * @param {string} html The rendered list page markup.
   * @returns {string|null} The encoded cursor for the following page.
   */
  function renderedNextCursor(html) {
    const anchors = html.match(/<a\s[^>]*>/gi) || [];
    /** @type {string[]} */
    const preferred = [];
    /** @type {string[]} */
    const fallback = [];

    anchors.forEach((tag) => {
      const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      if (!hrefMatch) {
        return;
      }

      const href = (hrefMatch[1] || hrefMatch[2] || "").replace(/&amp;/g, "&");
      const cursor = readAfter(href);
      if (!cursor) {
        return;
      }

      if (/rel\s*=\s*["']?nofollow/i.test(tag)) {
        preferred.push(cursor);
      } else {
        fallback.push(cursor);
      }
    });

    const source = preferred.length > 0 ? preferred : fallback;
    if (source.length > 0) {
      return source[source.length - 1];
    }

    return null;
  }

  /**
   * Extracts the next cursor, preferring GitHub's rendered navigation.
   *
   * @param {string} html The rendered list page markup.
   * @returns {string|null} The encoded cursor for the following page.
   */
  function extractNextCursor(html) {
    return renderedNextCursor(html) || embeddedNextCursor(html);
  }

  /**
   * Waits for a number of milliseconds.
   *
   * @param {number} ms The delay in milliseconds.
   * @returns {Promise<void>} Resolves after the delay.
   */
  function defaultSleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Creates a cursor chain index for one list.
   *
   * @param {import("./types").CursorIndexOptions} options Dependencies and limits.
   * @returns {import("./types").ListIndex} The cursor index.
   * @throws {TypeError} When the page fetcher is missing.
   */
  function createCursorIndex(options) {
    if (!options || typeof options.fetchPage !== "function") {
      throw new TypeError("fetchPage is required");
    }

    const {
      cache = null,
      cacheKey = "",
      cacheTtlMs = DEFAULT_CACHE_TTL_MS,
      fetchPage,
      maxHops = DEFAULT_MAX_HOPS,
      now = () => Date.now(),
      sleep = defaultSleep,
      throttleMs = DEFAULT_THROTTLE_MS
    } = options;

    /** @type {string[]} */
    let hops = [];
    let completed = false;
    /** @type {{anchor: string, firstOffset: number, pageSize: number, total: number|null}|null} */
    let offsetIndex = null;
    let running = false;
    let cancelled = false;
    /** @type {Promise<{completed: boolean, hops: string[]}>|null} */
    let activeWalk = null;

    /**
     * Restores a previously cached chain.
     *
     * @returns {void}
     */
    function load() {
      if (!cache || !cacheKey) {
        return;
      }

      const raw = cache.read(cacheKey);
      if (!raw) {
        return;
      }

      try {
        // A corrupt or stale cache entry must never break the list view.
        const parsed =
          /** @type {{version?: unknown, completed?: boolean, hops?: unknown[], offsetIndex?: unknown, savedAt?: number}|null} */ (
            JSON.parse(raw)
          );
        if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.hops)) {
          if (typeof cache.remove === "function") {
            cache.remove(cacheKey);
          }
          return;
        }
        if (typeof parsed.savedAt === "number" && now() - parsed.savedAt > cacheTtlMs) {
          return;
        }

        hops = /** @type {string[]} */ (parsed.hops.filter((value) => typeof value === "string"));

        const storedOffset =
          /** @type {{anchor?: unknown, firstOffset?: unknown, pageSize?: unknown, total?: unknown}|null} */ (
            parsed.offsetIndex || null
          );
        if (
          storedOffset &&
          typeof storedOffset.anchor === "string" &&
          Number.isInteger(storedOffset.firstOffset) &&
          Number.isInteger(storedOffset.pageSize) &&
          typeof storedOffset.pageSize === "number" &&
          storedOffset.pageSize > 0 &&
          (storedOffset.total === null || Number.isInteger(storedOffset.total))
        ) {
          offsetIndex = /** @type {typeof offsetIndex} */ (storedOffset);
        }
        completed = Boolean(parsed.completed);
      } catch (_error) {
        hops = [];
        offsetIndex = null;
        completed = false;
      }
    }

    /**
     * Persists the current chain.
     *
     * @returns {void}
     */
    function save() {
      if (!cache || !cacheKey || (hops.length === 0 && !offsetIndex)) {
        return;
      }

      cache.write(
        cacheKey,
        JSON.stringify({ version: CACHE_VERSION, completed, hops, offsetIndex, savedAt: now() })
      );
    }

    /**
     * Builds the commit-history cursor for a one-based page number.
     *
     * @param {number} page The destination page.
     * @returns {string|null} The generated cursor, or null when offset mode is unavailable.
     */
    function offsetCursorForPage(page) {
      if (!offsetIndex || page <= 1) {
        return null;
      }

      const offset = offsetIndex.firstOffset + (page - 2) * offsetIndex.pageSize;
      return `${offsetIndex.anchor}+${offset}`;
    }

    /**
     * Activates random-access mode from one commit page's embedded range.
     *
     * GitHub exposes both the first and last commit offsets in the structured
     * pagination payload, so one response is enough to derive the page size.
     *
     * @param {string} html The fetched page body.
     * @param {string} requestUrl The fetched list URL.
     * @returns {boolean} True when the response proves a stable offset sequence.
     */
    function detectOffsetMode(html, requestUrl) {
      if (!isCommitHistory(requestUrl)) {
        return false;
      }

      const renderedNext = parseOffsetCursor(renderedNextCursor(html));
      if (!renderedNext) {
        return false;
      }

      const requested = parseOffsetCursor(readAfter(requestUrl));
      const expectedStart = requested ? requested.offset + 1 : 0;
      const pagination = readOffsetPaginations(html).find(
        (candidate) =>
          candidate.hasNext &&
          candidate.start &&
          candidate.end &&
          candidate.start.anchor === candidate.end.anchor &&
          candidate.start.offset === expectedStart &&
          candidate.end.anchor === renderedNext.anchor &&
          candidate.end.offset === renderedNext.offset
      );
      if (!pagination || !pagination.start || !pagination.end) {
        return false;
      }

      const pageSize = pagination.end.offset - pagination.start.offset + 1;
      if (pageSize <= 0) {
        return false;
      }

      offsetIndex = {
        anchor: pagination.end.anchor,
        firstOffset: pagination.end.offset,
        pageSize,
        total: null
      };
      save();
      return true;
    }

    /**
     * Probes whether a generated commit-history page exists.
     *
     * @param {number} page The one-based page number.
     * @param {string} baseUrl The cursor-free list URL.
     * @param {function({indexed: number, total: number|null}): void} [onProgress] Progress sink.
     * @returns {Promise<boolean>} True when the requested page contains a valid cursor range.
     */
    async function probeOffsetPage(page, baseUrl, onProgress) {
      const cursor = offsetCursorForPage(page);
      if (!cursor) {
        return page === 1;
      }

      const html = await fetchPage(withAfter(baseUrl, cursor));
      const expected = parseOffsetCursor(cursor);
      const exists = readOffsetPaginations(html).some(
        (pagination) =>
          pagination.start &&
          expected &&
          pagination.start.anchor === expected.anchor &&
          pagination.start.offset === expected.offset + 1
      );

      if (onProgress) {
        onProgress({ indexed: page, total: null });
      }
      return exists;
    }

    /**
     * Finds the last commit-history page with exponential search and bisection.
     *
     * @param {string} baseUrl The cursor-free list URL.
     * @param {function({indexed: number, total: number|null}): void} [onProgress] Progress sink.
     * @returns {Promise<number|null>} The total, or null when cancelled.
     */
    async function discoverOffsetTotal(baseUrl, onProgress) {
      if (!offsetIndex) {
        return null;
      }
      if (offsetIndex.total !== null) {
        return offsetIndex.total;
      }

      let lower = Math.max(2, hops.length + 1);
      let upper = lower * 2;

      while (!cancelled && (await probeOffsetPage(upper, baseUrl, onProgress))) {
        lower = upper;
        upper *= 2;
        await sleep(throttleMs);
      }

      while (!cancelled && upper - lower > 1) {
        const middle = Math.floor((lower + upper) / 2);
        if (await probeOffsetPage(middle, baseUrl, onProgress)) {
          lower = middle;
        } else {
          upper = middle;
        }
        await sleep(throttleMs);
      }

      if (cancelled) {
        return null;
      }

      offsetIndex.total = lower;
      completed = true;
      save();
      return lower;
    }

    /**
     * Walks the chain until it holds `needed` hops or reaches the last page.
     *
     * @param {number} needed The number of hops required.
     * @param {string} baseUrl The cursor-free list URL.
     * @param {function({indexed: number, total: number|null}): void} [onProgress] Progress sink.
     * @returns {Promise<{completed: boolean, hops: string[]}>} The chain state after walking.
     */
    async function ensureHops(needed, baseUrl, onProgress) {
      // The index is shared per list URL, so a second caller — a rebuilt
      // window after a Turbo swap, or a jump while the background pass runs —
      // joins the walk in flight instead of failing or crawling in parallel.
      if (activeWalk) {
        await activeWalk.catch(() => {});
      }

      if (cancelled || completed || hops.length >= needed || hops.length >= maxHops) {
        return { completed, hops: hops.slice() };
      }

      running = true;
      cancelled = false;

      activeWalk = (async () => {
        try {
          while (!cancelled && !completed && hops.length < needed && hops.length < maxHops) {
            const last = hops.length > 0 ? hops[hops.length - 1] : null;
            const target = last ? withAfter(baseUrl, last) : stripAfter(baseUrl);
            const html = await fetchPage(target);

            if (!offsetIndex && detectOffsetMode(html, target)) {
              hops.push(/** @type {string} */ (offsetCursorForPage(hops.length + 2)));
              if (needed === Number.POSITIVE_INFINITY) {
                await discoverOffsetTotal(baseUrl, onProgress);
              }
              break;
            }

            const next = extractNextCursor(html);
            if (!next || next === last) {
              completed = true;
              save();
              break;
            }

            hops.push(next);
            save();

            if (onProgress) {
              onProgress({ indexed: hops.length + 1, total: completed ? hops.length + 1 : null });
            }

            if (!completed && hops.length < needed) {
              await sleep(throttleMs);
            }
          }
        } finally {
          running = false;
        }

        return { completed, hops: hops.slice() };
      })();

      try {
        return await activeWalk;
      } finally {
        activeWalk = null;
      }
    }

    /**
     * Resolves the URL of an arbitrary page.
     *
     * @param {number} targetPage The one-based page number.
     * @param {{baseUrl: string, onProgress?: function({indexed: number, total: number|null}): void}} context The list URL and progress sink.
     * @returns {Promise<import("./types").CursorResolution>} The resolved URL or its limits.
     */
    async function resolvePage(targetPage, context) {
      const { baseUrl, onProgress } = context;

      if (targetPage <= 1) {
        return {
          cancelled: false,
          total: completed ? hops.length + 1 : null,
          url: stripAfter(baseUrl)
        };
      }

      if (offsetIndex) {
        const total = offsetIndex.total;
        if (total !== null && targetPage > total) {
          return { cancelled: false, total, url: null };
        }
        return {
          cancelled: false,
          total,
          url: withAfter(baseUrl, /** @type {string} */ (offsetCursorForPage(targetPage)))
        };
      }

      const needed = targetPage - 1;
      const state = await ensureHops(needed, baseUrl, onProgress);

      const generatedCursor = offsetCursorForPage(targetPage);
      if (generatedCursor && targetPage > hops.length + 1) {
        return {
          cancelled: false,
          total: getTotal(),
          url: withAfter(baseUrl, generatedCursor)
        };
      }

      if (cancelled) {
        return { cancelled: true, total: state.completed ? hops.length + 1 : null, url: null };
      }

      if (state.hops.length < needed) {
        return { cancelled: false, total: hops.length + 1, url: null };
      }

      return {
        cancelled: false,
        total: state.completed ? hops.length + 1 : null,
        url: withAfter(baseUrl, state.hops[needed - 1])
      };
    }

    /**
     * Resolves the URL of the last page by walking to the end of the chain.
     *
     * @param {{baseUrl: string, onProgress?: function({indexed: number, total: number|null}): void}} context The list URL and progress sink.
     * @returns {Promise<import("./types").CursorResolution>} The resolved URL or its limits.
     */
    async function resolveLast(context) {
      const { baseUrl, onProgress } = context;
      const state = await ensureHops(Number.POSITIVE_INFINITY, baseUrl, onProgress);

      if (cancelled) {
        return { cancelled: true, total: state.completed ? getTotal() : null, url: null };
      }

      if (offsetIndex) {
        const total = await discoverOffsetTotal(baseUrl, onProgress);
        return {
          cancelled,
          total,
          url: total ? withAfter(baseUrl, /** @type {string} */ (offsetCursorForPage(total))) : null
        };
      }

      const total = hops.length + 1;
      const url = hops.length > 0 ? withAfter(baseUrl, hops[hops.length - 1]) : stripAfter(baseUrl);
      return { cancelled: false, total, url };
    }

    /**
     * Resolves the page number currently displayed by a list URL.
     *
     * @param {string} url The current page URL.
     * @returns {number|null} The one-based page number, or null when unknown.
     */
    function getCurrentPage(url) {
      const after = readAfter(url);
      if (!after) {
        return 1;
      }

      if (offsetIndex) {
        const parsed = parseOffsetCursor(after);
        if (!parsed || parsed.anchor !== offsetIndex.anchor) {
          return null;
        }
        const delta = parsed.offset - offsetIndex.firstOffset;
        return delta >= 0 && delta % offsetIndex.pageSize === 0
          ? delta / offsetIndex.pageSize + 2
          : null;
      }

      const index = hops.indexOf(after);
      return index === -1 ? null : index + 2;
    }

    /**
     * Builds the URL of an already indexed page without any request.
     *
     * @param {number} page The one-based page number.
     * @param {string} baseUrl The cursor-free list URL.
     * @returns {string|null} The page URL, or null when it still needs crawling.
     */
    function getPageUrl(page, baseUrl) {
      if (page <= 1) {
        return stripAfter(baseUrl);
      }

      if (offsetIndex && (offsetIndex.total === null || page <= offsetIndex.total)) {
        return withAfter(baseUrl, /** @type {string} */ (offsetCursorForPage(page)));
      }

      if (page - 2 < hops.length) {
        return withAfter(baseUrl, hops[page - 2]);
      }

      return null;
    }

    /**
     * Reports whether a walk is currently in flight.
     *
     * @returns {boolean} True while the chain is being crawled.
     */
    function isRunning() {
      return running;
    }

    /**
     * Reports the number of pages discovered so far.
     *
     * @returns {number} The highest page number reachable without more crawling.
     */
    function getKnownPages() {
      return offsetIndex && offsetIndex.total !== null ? offsetIndex.total : hops.length + 1;
    }

    /**
     * Reports the total page count once the chain end is known.
     *
     * @returns {number|null} The total page count, or null while incomplete.
     */
    function getTotal() {
      if (offsetIndex) {
        return offsetIndex.total;
      }
      return completed ? hops.length + 1 : null;
    }

    /**
     * Reports whether the chain end has been reached.
     *
     * @returns {boolean} True when no further pages exist.
     */
    function isComplete() {
      return offsetIndex ? offsetIndex.total !== null : completed;
    }

    /**
     * Requests that the current walk stops at its next checkpoint.
     *
     * @returns {void}
     */
    function cancel() {
      cancelled = true;
    }

    /**
     * Discards the cached and in-memory chain.
     *
     * @returns {void}
     */
    function reset() {
      hops = [];
      offsetIndex = null;
      completed = false;
      cancelled = false;

      if (cache && cacheKey && typeof cache.remove === "function") {
        cache.remove(cacheKey);
      }
    }

    load();

    return Object.freeze({
      cancel,
      getCurrentPage,
      getKnownPages,
      getPageUrl,
      getTotal,
      isComplete,
      isRunning,
      reset,
      resolveLast,
      resolvePage
    });
  }

  return Object.freeze({
    DEFAULT_CACHE_TTL_MS,
    DEFAULT_MAX_HOPS,
    DEFAULT_THROTTLE_MS,
    createCursorIndex,
    extractNextCursor,
    readAfter,
    stripAfter,
    withAfter
  });
}
