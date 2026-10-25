/**
 * Page-parameter list indexer for GitHub's numberless paginators.
 *
 * Several GitHub list views (profile repositories, followers, following,
 * stargazers… ) paginate with a real `page` query parameter but render only
 * Previous / Next links, hiding the page numbers. Those views need no chain
 * walking: page N is reachable by rewriting the parameter directly. Only the
 * total page count is unknown, and it is found with a short exponential plus
 * binary probe.
 *
 * Shared structural types live in `types.d.ts`.
 */

/**
 * Publishes the page-parameter list indexer.
 *
 * @param {object} root The global object that receives the browser API.
 * @param {() => import("./types").PageApi} factory Creates the page index API.
 * @returns {void}
 */
(function initializePageIndex(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GitHubPageJumpPageIndex = api;
})(globalThis, createPageIndexApi);

/**
 * Creates the page-parameter list indexer.
 *
 * @returns {import("./types").PageApi} The public page index API.
 */
function createPageIndexApi() {
  "use strict";

  const DEFAULT_THROTTLE_MS = 120;
  const DEFAULT_MAX_PAGES = 500;
  const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;

  /**
   * Escapes literal text for embedding in a regular expression.
   *
   * @param {string} text The text to escape.
   * @returns {string} The escaped pattern source.
   */
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Reads the current page number from a list URL.
   *
   * @param {string} url The URL to inspect.
   * @param {string} [pageParam] The pagination query parameter.
   * @returns {number|null} The one-based page number, or null when absent.
   */
  function readPageParam(url, pageParam = "page") {
    try {
      const value = new URL(url).searchParams.get(pageParam);
      const parsed = Number(value);
      return value !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Writes a page number into a list URL, dropping the parameter for page one.
   *
   * @param {string} url The URL to rewrite.
   * @param {number} page The target page number.
   * @param {string} [pageParam] The pagination query parameter.
   * @returns {string} The rewritten URL.
   */
  function setPageParam(url, page, pageParam = "page") {
    try {
      const parsed = new URL(url);

      if (page <= 1) {
        parsed.searchParams.delete(pageParam);
      } else {
        parsed.searchParams.set(pageParam, String(page));
      }

      return parsed.toString();
    } catch (_error) {
      return url;
    }
  }

  /**
   * Detects whether a rendered list page links to a following page.
   *
   * A "next" link must target the following page number, so the check looks
   * for an anchor whose href points at `nextPage`. That holds for every
   * markup generation GitHub has served — the classic `next_page` anchors
   * and the bare `rel="nofollow"` variant on profile tabs — and it ignores
   * unrelated anchors such as sign-in calls to action, whose page parameter
   * stays percent-encoded inside `return_to`.
   *
   * @param {string} html The rendered list page markup.
   * @param {number} nextPage The page number a "next" link would target.
   * @param {string} [pageParam] The pagination query parameter.
   * @returns {boolean} True when the page advertises a next page.
   */
  function hasNextPage(html, nextPage, pageParam = "page") {
    const anchors = html.match(/<a\b[^>]*>/gi) || [];
    const target = new RegExp(`[?&](?:amp;)?${escapeRegExp(pageParam)}=${nextPage}(?![0-9])`, "i");
    return anchors.some((tag) => target.test(tag));
  }

  /**
   * Waits for a number of milliseconds.
   *
   * @param {number} ms The delay in milliseconds.
   * @returns {Promise<void>} Resolves after the delay.
   */
  function defaultSleep(ms) {
    return new Promise((sleepResolve) => {
      setTimeout(sleepResolve, ms);
    });
  }

  /**
   * Creates a page index for one paginated list.
   *
   * @param {import("./types").PageIndexOptions} options Dependencies and limits.
   * @returns {import("./types").ListIndex} The page index.
   * @throws {TypeError} When the page fetcher is missing.
   */
  function createPageIndex(options) {
    if (!options || typeof options.fetchPage !== "function") {
      throw new TypeError("fetchPage is required");
    }

    const {
      cache = null,
      cacheKey = "",
      cacheTtlMs = DEFAULT_CACHE_TTL_MS,
      fetchPage,
      maxPages = DEFAULT_MAX_PAGES,
      now = () => Date.now(),
      pageParam = "page",
      sleep = defaultSleep,
      throttleMs = DEFAULT_THROTTLE_MS
    } = options;

    /** @type {number|null} */
    let total = null;
    let running = false;
    let cancelled = false;

    /**
     * Restores a previously cached total.
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
        const parsed = /** @type {{savedAt?: number, total?: unknown}|null} */ (JSON.parse(raw));
        if (!parsed || typeof parsed.total !== "number" || parsed.total < 1) {
          return;
        }
        if (typeof parsed.savedAt === "number" && now() - parsed.savedAt > cacheTtlMs) {
          return;
        }

        total = Math.floor(parsed.total);
      } catch (_error) {
        total = null;
      }
    }

    /**
     * Persists the discovered total.
     *
     * @returns {void}
     */
    function save() {
      if (!cache || !cacheKey || total === null) {
        return;
      }

      cache.write(cacheKey, JSON.stringify({ savedAt: now(), total }));
    }

    /**
     * Probes one page for a next-page link.
     *
     * @param {number} page The page to fetch.
     * @param {string} baseUrl The page-parameter-free list URL.
     * @returns {Promise<boolean>} True when the page links to a following page.
     */
    async function probe(page, baseUrl) {
      const html = await fetchPage(setPageParam(baseUrl, page, pageParam));
      return hasNextPage(html, page + 1, pageParam);
    }

    /**
     * Finds the total page count with an exponential scan and a binary search.
     *
     * The total is the smallest page whose markup no longer advertises a next
     * page, which makes the predicate monotonic and therefore bisectable.
     *
     * @param {string} baseUrl The page-parameter-free list URL.
     * @param {function({probed: number, total: number|null}): void} [onProgress] Progress sink.
     * @returns {Promise<number|null>} The total, or null when cancelled.
     */
    async function discover(baseUrl, onProgress) {
      if (total !== null) {
        return total;
      }

      if (running) {
        throw new Error("page indexing is already running");
      }

      running = true;
      cancelled = false;

      let probed = 0;

      /**
       * Probes one page, throttles, and reports progress.
       *
       * @param {number} page The page to probe.
       * @returns {Promise<boolean>} True when the page links to a following page.
       */
      async function step(page) {
        const has = await probe(page, baseUrl);
        probed += 1;

        if (onProgress) {
          onProgress({ probed, total: null });
        }

        if (cancelled) {
          return false;
        }

        await sleep(throttleMs);
        return has;
      }

      try {
        if (cancelled) {
          return null;
        }

        const firstHasNext = await step(1);

        if (cancelled) {
          return null;
        }

        if (!firstHasNext) {
          total = 1;
          save();
          return total;
        }

        let lower = 1;
        let candidate = 2;
        let upper = null;

        while (candidate <= maxPages) {
          const has = await step(candidate);

          if (cancelled) {
            return null;
          }

          if (!has) {
            upper = candidate;
            break;
          }

          lower = candidate;
          candidate *= 2;
        }

        if (cancelled) {
          return null;
        }

        let high = upper === null ? maxPages + 1 : upper;

        while (high - lower > 1) {
          const middle = Math.floor((lower + high) / 2);

          if (cancelled) {
            return null;
          }

          if (await step(middle)) {
            lower = middle;
          } else {
            high = middle;
          }
        }

        total = high;
        save();
        return total;
      } finally {
        running = false;
      }
    }

    /**
     * Resolves the URL of an arbitrary page without any network round trip.
     *
     * @param {number} targetPage The one-based page number.
     * @param {{baseUrl: string}} context The page-parameter-free list URL.
     * @returns {Promise<import("./types").CursorResolution>} The resolved URL or its limits.
     */
    async function resolvePage(targetPage, context) {
      const { baseUrl } = context;

      if (targetPage <= 1) {
        return { cancelled: false, total, url: setPageParam(baseUrl, 1, pageParam) };
      }

      if (total !== null && targetPage > total) {
        return { cancelled: false, total, url: null };
      }

      return { cancelled: false, total, url: setPageParam(baseUrl, targetPage, pageParam) };
    }

    /**
     * Resolves the URL of the last page by probing for the total.
     *
     * @param {{baseUrl: string, onProgress?: function({probed: number, total: number|null}): void}} context The list URL and progress sink.
     * @returns {Promise<import("./types").CursorResolution>} The resolved URL or its limits.
     */
    async function resolveLast(context) {
      const { baseUrl, onProgress } = context;
      const found = await discover(baseUrl, onProgress);

      if (cancelled || found === null) {
        return { cancelled: cancelled, total, url: null };
      }

      return { cancelled: false, total: found, url: setPageParam(baseUrl, found, pageParam) };
    }

    /**
     * Resolves the page number currently displayed by a list URL.
     *
     * @param {string} url The current page URL.
     * @returns {number|null} The one-based page number, defaulting to one.
     */
    function getCurrentPage(url) {
      return readPageParam(url, pageParam) || 1;
    }

    /**
     * Builds the URL of a page without any request.
     *
     * @param {number} page The one-based page number.
     * @param {string} baseUrl The page-parameter-free list URL.
     * @returns {string|null} The page URL, or null when it cannot exist.
     */
    function getPageUrl(page, baseUrl) {
      if (!Number.isInteger(page) || page < 1) {
        return null;
      }

      if (total !== null && page > total) {
        return null;
      }

      return setPageParam(baseUrl, page, pageParam);
    }

    /**
     * Reports whether a probe is currently in flight.
     *
     * @returns {boolean} True while the total is being discovered.
     */
    function isRunning() {
      return running;
    }

    /**
     * Reports the number of pages known without more probing.
     *
     * @returns {number} The highest known page number.
     */
    function getKnownPages() {
      return total === null ? 1 : total;
    }

    /**
     * Reports the total page count once discovered.
     *
     * @returns {number|null} The total page count, or null while unknown.
     */
    function getTotal() {
      return total;
    }

    /**
     * Reports whether the total page count is known.
     *
     * @returns {boolean} True when no further probing is needed.
     */
    function isComplete() {
      return total !== null;
    }

    /**
     * Requests that the current probe stops at its next checkpoint.
     *
     * @returns {void}
     */
    function cancel() {
      cancelled = true;
    }

    /**
     * Discards the cached and in-memory total.
     *
     * @returns {void}
     */
    function reset() {
      total = null;
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
    DEFAULT_MAX_PAGES,
    DEFAULT_THROTTLE_MS,
    createPageIndex,
    hasNextPage,
    readPageParam,
    setPageParam
  });
}
