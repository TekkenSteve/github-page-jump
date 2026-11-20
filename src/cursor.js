/**
 * Cursor chain indexer for GitHub's cursor-based (Previous / Next) lists.
 *
 * Several GitHub list views render without page numbers. Those views paginate
 * with an opaque `after` cursor that cannot be derived from a page number, so
 * jumping to page N requires walking the chain one request at a time. This
 * module walks the chain once, caches it, and resolves page numbers to URLs.
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
  const DEFAULT_MAX_HOPS = 300;
  const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;

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
   * Reads the pagination block GitHub embeds into list page payloads.
   *
   * Every list page ships a `filters.pagination` object inside its embedded
   * React data. Deep commit history pages sometimes render no commit rows and
   * no Next link at all — the server falls back to client-side rendering — but
   * the payload still reports where the page starts, where it ends, and whether
   * another page exists.
   *
   * @param {string} html The raw list page markup.
   * @returns {{endCursor?: unknown, hasNextPage?: unknown}|null} The pagination
   *   block, or null when the page embeds none.
   */
  function readEmbeddedPagination(html) {
    const marker = '"pagination":{';
    const at = html.indexOf(marker);
    if (at < 0) {
      return null;
    }

    // The block is small and only holds cursor strings and booleans, so a
    // brace-balanced slice is enough; nothing inside it can nest arbitrarily.
    const start = at + marker.length - 1;
    let depth = 0;
    const limit = Math.min(html.length, start + 2000);

    for (let index = start; index < limit; index += 1) {
      const character = html[index];
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = /** @type {Record<string, unknown>} */ (
              JSON.parse(html.slice(start, index + 1))
            );
            return parsed;
          } catch (_error) {
            return null;
          }
        }
      }
    }

    return null;
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
    const pagination = readEmbeddedPagination(html);
    if (!pagination) {
      return null;
    }

    if (pagination.hasNextPage === false) {
      return null;
    }

    const end = pagination.endCursor;
    if (typeof end !== "string") {
      return null;
    }

    const offsetCursor = /^(\S+)\s+(\d+)$/.exec(end);
    if (!offsetCursor) {
      return null;
    }

    return `${offsetCursor[1]}+${offsetCursor[2]}`;
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
  function extractNextCursor(html) {
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

    return embeddedNextCursor(html);
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
          /** @type {{completed?: boolean, hops?: unknown[], savedAt?: number}|null} */ (
            JSON.parse(raw)
          );
        if (!parsed || !Array.isArray(parsed.hops)) {
          return;
        }
        if (typeof parsed.savedAt === "number" && now() - parsed.savedAt > cacheTtlMs) {
          return;
        }

        hops = /** @type {string[]} */ (parsed.hops.filter((value) => typeof value === "string"));
        completed = Boolean(parsed.completed);
      } catch (_error) {
        hops = [];
        completed = false;
      }
    }

    /**
     * Persists the current chain.
     *
     * @returns {void}
     */
    function save() {
      if (!cache || !cacheKey || hops.length === 0) {
        return;
      }

      cache.write(cacheKey, JSON.stringify({ completed, hops, savedAt: now() }));
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

      const needed = targetPage - 1;
      const state = await ensureHops(needed, baseUrl, onProgress);

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
        return { cancelled: true, total: state.completed ? hops.length + 1 : null, url: null };
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
      return hops.length + 1;
    }

    /**
     * Reports the total page count once the chain end is known.
     *
     * @returns {number|null} The total page count, or null while incomplete.
     */
    function getTotal() {
      return completed ? hops.length + 1 : null;
    }

    /**
     * Reports whether the chain end has been reached.
     *
     * @returns {boolean} True when no further pages exist.
     */
    function isComplete() {
      return completed;
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
