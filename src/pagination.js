/**
 * GitHub pagination DOM adapter.
 *
 * Shared structural types live in `types.d.ts`.
 */

/**
 * Publishes the GitHub pagination DOM adapter.
 *
 * @param {object} root The global object that receives the browser API.
 * @param {(core: import("./types").CoreApi|null) => import("./types").PaginationApi|null} factory Creates the pagination API.
 * @returns {void}
 */
(function initializePagination(root, factory) {
  const isNode = typeof module === "object" && Boolean(module.exports);
  const core = isNode ? require("./core.js") : root.GitHubPageJumpCore;
  const cursor = isNode ? require("./cursor.js") : root.GitHubPageJumpCursor;
  const pageIndex = isNode ? require("./pageindex.js") : root.GitHubPageJumpPageIndex;
  const api = factory(core, cursor, pageIndex);

  if (isNode) {
    module.exports = api;
  }

  root.GitHubPageJumpPagination = api;
})(globalThis, createPagination);

/**
 * Creates the pagination DOM API around the pure core helpers.
 *
 * @param {import("./types").CoreApi|null} core The core pagination API.
 * @param {import("./types").CursorApi|null} cursor The cursor chain API.
 * @param {import("./types").PageApi|null} pageIndex The page-parameter index API.
 * @returns {import("./types").PaginationApi|null} The public pagination API, or null without the core dependency.
 */
function createPagination(core, cursor, pageIndex) {
  "use strict";

  if (!core) {
    return null;
  }

  // Narrow once so the controller closures keep a non-nullable core reference.
  const coreApi = core;
  const cursorApi = cursor && typeof cursor.createCursorIndex === "function" ? cursor : null;
  const pageApi = pageIndex && typeof pageIndex.createPageIndex === "function" ? pageIndex : null;

  const CONTROL_CLASS = "ghpj-controls";
  const FIXED_CLASS = "ghpj-pagination--fixed";
  const LEGACY_STYLE_SELECTOR = ".paginate-container, .pagination, .previous_page, .next_page";
  const OUTLINE_CLASS = "ghpj-controls--outline";
  const CURSOR_CACHE_PREFIX = "ghpj:cursor:";
  const PAGE_CACHE_PREFIX = "ghpj:page:";
  // A cursor chain is marked by `after=` links pointing forward and `before=`
  // links pointing back. The last page of a chain carries only a `before=`
  // link, so both parameters identify the cursor strategy.
  const CURSOR_LINK_SELECTOR = 'a[href*="after="], a[href*="before="]';
  const PAGE_LINK_SELECTOR = 'a[href*="page="]';
  const PAGE_WINDOW_SLOTS = 7;
  const GAP = "gap";

  /**
   * Builds the page-number window rendered between Previous and Next.
   *
   * GitHub keeps the first and last page always reachable and centers the
   * window on the current page, which keeps the pager at a stable width.
   *
   * @param {number} current The page currently displayed.
   * @param {number} upper The highest reachable page number.
   * @returns {(number|"gap")[]} The window items, where "gap" renders an ellipsis.
   */
  function buildPageWindow(current, upper) {
    if (upper <= PAGE_WINDOW_SLOTS) {
      return Array.from({ length: upper }, (_unused, index) => index + 1);
    }

    let start = current - 1;
    let end = current + 1;

    if (current <= 4) {
      start = 2;
      end = 5;
    } else if (current >= upper - 3) {
      start = upper - 4;
      end = upper - 1;
    }

    /** @type {(number|"gap")[]} */
    const items = [1];

    if (start > 2) {
      items.push(GAP);
    }

    for (let page = Math.max(start, 2); page <= Math.min(end, upper - 1); page += 1) {
      items.push(page);
    }

    if (end < upper - 1) {
      items.push(GAP);
    }

    items.push(upper);
    return items;
  }

  /**
   * Extracts normalized page descriptors from GitHub pagination markup.
   *
   * @param {Element} pagination The pagination root element.
   * @returns {import("./types").DomPageDescriptor[]} The descriptors containing valid page numbers.
   */
  function collectDescriptors(pagination) {
    /** @type {import("./types").DomPageDescriptor[]} */
    const descriptors = [];

    pagination.querySelectorAll("a, span, em").forEach((node) => {
      const element = /** @type {HTMLElement} */ (node);
      const page = coreApi.readPageNumber({
        ariaLabel: element.getAttribute("aria-label") || "",
        text: element.textContent ? element.textContent.trim() : ""
      });

      if (page !== null) {
        descriptors.push({
          current:
            element.getAttribute("aria-current") === "page" ||
            element.classList.contains("current"),
          element,
          href: element.getAttribute("href") || "",
          page
        });
      }
    });

    return descriptors;
  }

  /**
   * Decides how one paginator can be jumped through.
   *
   * GitHub renders three usable shapes: numbered links (page numbers are known
   * up front), `after` / `before` cursor links, and bare `page` parameter
   * links that hide their numbers. The first shape needs no network work; the
   * other two do.
   *
   * @param {Element} pagination The pagination root element.
   * @returns {"numeric"|"cursor"|"page"|null} The jump strategy, or null when unsupported.
   */
  function classify(pagination) {
    if (collectDescriptors(pagination).length > 0) {
      return "numeric";
    }

    if (pagination.querySelector(CURSOR_LINK_SELECTOR)) {
      return "cursor";
    }

    if (pagination.querySelector(PAGE_LINK_SELECTOR)) {
      return "page";
    }

    return null;
  }
  // GitHub serves React and legacy Rails structures, and both may hide their
  // page numbers. Structure (where controls belong) stays in this ordered list;
  // jump strategy is decided separately by `classify`.
  /** @type {readonly import("./types").PaginationAdapter[]} */
  const PAGINATION_ADAPTERS = Object.freeze([
    Object.freeze({
      hostSelector: "[data-hidden-viewport-ranges]",
      legacy: false,
      selector: 'nav[data-component="Pagination"]'
    }),
    Object.freeze({
      hostSelector: null,
      legacy: false,
      selector: 'nav[aria-label="Pagination"]'
    }),
    Object.freeze({
      hostSelector: ":scope > .pagination",
      legacy: true,
      selector: ".paginate-container"
    })
  ]);

  const PAGINATION_SELECTOR = [
    ...new Set(PAGINATION_ADAPTERS.map(({ selector }) => selector))
  ].join(",");

  const ICONS = Object.freeze({
    first:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.75 3a.75.75 0 0 1 .75.75v8a.75.75 0 0 1-1.5 0V3.75a.75.75 0 0 1 .75-.75Zm8.03 9.78a.75.75 0 0 1-1.06 0L6.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L8.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>',
    jump: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06l2.97-2.97H1.75a.75.75 0 0 1 0-1.5h9.44L8.22 4.03a.75.75 0 0 1 0-1.06Z"/></svg>',
    last: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.25 3A.75.75 0 0 1 13 3.75v8a.75.75 0 0 1-1.5 0V3.75a.75.75 0 0 1 .75-.75Zm-8.03 9.78a.75.75 0 0 0 1.06 0L9.53 8.53a.75.75 0 0 0 0-1.06l-4.25-4.25a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L7.94 8l-3.72 3.72a.75.75 0 0 0 0 1.06Z"/></svg>'
  });

  /**
   * Creates a page fetcher that reads GitHub list pages with session cookies.
   *
   * @param {Window & typeof globalThis} windowObject The page window.
   * @returns {(url: string) => Promise<string>} The HTML fetcher.
   */
  function createDefaultFetchPage(windowObject) {
    return function fetchPage(url) {
      const fetchFunction = windowObject.fetch;
      if (typeof fetchFunction !== "function") {
        return Promise.reject(new Error("fetch is unavailable"));
      }

      return fetchFunction
        .call(windowObject, url, { credentials: "same-origin" })
        .then(
          (/** @type {{ok: boolean, status: number, text: () => Promise<string>}} */ response) => {
            if (!response.ok) {
              throw new Error(`GitHub responded with ${response.status}`);
            }

            return response.text();
          }
        );
    };
  }

  /**
   * Wraps a Storage-like object so quota and privacy errors never surface.
   *
   * @param {Storage|null|undefined} storage The session storage, when available.
   * @returns {import("./types").CursorCache|null} The cache adapter.
   */
  function createStorageCache(storage) {
    if (!storage) {
      return null;
    }

    return {
      read(key) {
        try {
          return storage.getItem(key);
        } catch (_error) {
          return null;
        }
      },
      write(key, value) {
        try {
          storage.setItem(key, value);
        } catch (_error) {
          // Storage may be full or blocked by privacy settings.
        }
      },
      remove(key) {
        try {
          storage.removeItem(key);
        } catch (_error) {
          // Removal is best effort only.
        }
      }
    };
  }

  /**
   * Creates a lifecycle-managed controller for one document.
   *
   * @param {import("./types").PaginationControllerOptions} options Browser dependencies and localized labels.
   * @returns {import("./types").PaginationController} The pagination controller.
   * @throws {TypeError} When a required dependency is missing.
   */
  function createPaginationController(options) {
    if (!options || !options.document || !options.labels || !options.window) {
      throw new TypeError("document, labels, and window are required");
    }

    const documentObject = options.document;
    const labels = options.labels;
    const windowObject = options.window;
    const MutationObserverClass = options.MutationObserver || windowObject.MutationObserver;
    const scheduleFrame =
      options.scheduleFrame || windowObject.requestAnimationFrame.bind(windowObject);
    const cancelFrame = options.cancelFrame || windowObject.cancelAnimationFrame.bind(windowObject);
    const fetchPage = options.fetchPage || createDefaultFetchPage(windowObject);
    const createCursorIndex =
      options.createCursorIndex || (cursorApi ? cursorApi.createCursorIndex : null);
    const createPageIndex = options.createPageIndex || (pageApi ? pageApi.createPageIndex : null);
    const sessionStorage =
      "sessionStorage" in options ? options.sessionStorage : windowObject.sessionStorage;
    const sleep = options.sleep;
    const cursorSupported = Boolean(cursorApi && createCursorIndex && fetchPage);
    const pageSupported = Boolean(pageApi && createPageIndex && fetchPage);
    const cursorCache = createStorageCache(sessionStorage);
    /** @type {Map<string, import("./types").ListIndex>} */
    const cursorIndexes = new Map();
    /** @type {Map<string, import("./types").ListIndex>} */
    const pageIndexes = new Map();
    /** @type {WeakMap<HTMLElement, import("./types").SequentialHandlers>} */
    const sequentialHandlers = new WeakMap();
    const autoIndexEnabled = options.autoIndex !== false;

    let fixedEnabled = false;
    /** @type {MutationObserver|null} */
    let observer = null;
    /** @type {number|null} */
    let scheduledFrame = null;
    let started = false;

    /**
     * Resolves the adapter for a pagination root.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {import("./types").PaginationAdapter|undefined} The first matching adapter.
     */
    function getAdapter(pagination) {
      return PAGINATION_ADAPTERS.find(({ selector }) => pagination.matches(selector));
    }

    /**
     * Resolves the element that should contain injected controls.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {Element} The adapter-specific host or the root itself.
     */
    function getHost(pagination) {
      const adapter = getAdapter(pagination);
      const adaptedHost =
        adapter && adapter.hostSelector && pagination.querySelector(adapter.hostSelector);
      return adaptedHost || pagination;
    }

    /**
     * Determines whether controls should match legacy outline hover behavior.
     *
     * @param {Element} pagination The pagination root element.
     * @param {import("./types").PaginationAdapter|undefined} adapter The matched structure adapter.
     * @returns {boolean} True when legacy control styling is required.
     */
    function usesLegacyStyle(pagination, adapter) {
      return Boolean(
        (adapter && adapter.legacy) ||
        pagination.matches(LEGACY_STYLE_SELECTOR) ||
        pagination.querySelector(LEGACY_STYLE_SELECTOR)
      );
    }

    /**
     * Reads GitHub's declared total page count from pagination markup.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {string|null} The declared total, or null when absent.
     */
    function getDeclaredTotal(pagination) {
      const element = pagination.matches("[data-total-pages]")
        ? pagination
        : pagination.querySelector("[data-total-pages]");
      return element ? element.getAttribute("data-total-pages") : null;
    }

    /**
     * Creates an accessible icon-only button.
     *
     * @param {"first"|"jump"|"last"} kind The icon and default class variant.
     * @param {string} label The accessible name and tooltip.
     * @param {string} [className] An optional class override.
     * @returns {HTMLButtonElement} The configured button.
     */
    function createIconButton(kind, label, className) {
      const button = documentObject.createElement("button");
      button.type = "button";
      button.className = className || `ghpj-button ghpj-button--${kind}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.innerHTML = ICONS[kind];
      return button;
    }

    /**
     * Navigates through an exact native link when possible, otherwise through a built URL.
     *
     * @param {Element} pagination The pagination root element.
     * @param {number} targetPage The destination page number.
     * @returns {void}
     */
    function navigate(pagination, targetPage) {
      const descriptors = collectDescriptors(pagination);
      const exactLink = descriptors.find(
        ({ element, page }) => page === targetPage && element.matches("a[href]")
      );

      if (exactLink) {
        exactLink.element.click();
        return;
      }

      const targetUrl = coreApi.buildPageUrl(descriptors, windowObject.location.href, targetPage);
      windowObject.location.assign(targetUrl);
    }

    /**
     * Updates native input validity and its accessible invalid state.
     *
     * @param {HTMLInputElement} input The page-number input.
     * @param {string} message The validation message, or an empty string to clear it.
     * @returns {void}
     */
    function setValidity(input, message) {
      input.setCustomValidity(message);
      input.setAttribute("aria-invalid", message ? "true" : "false");
    }

    /**
     * Creates the control group placed before native pagination items.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {HTMLDivElement} The first-page control group.
     */
    function createStartControls(pagination) {
      const controls = documentObject.createElement("div");
      controls.className = `${CONTROL_CLASS} ${CONTROL_CLASS}--start`;

      const firstButton = createIconButton("first", labels.firstPage);
      firstButton.addEventListener("click", () => navigate(pagination, 1));
      controls.append(firstButton);
      return controls;
    }

    /**
     * Creates the control group placed after native pagination items.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {HTMLDivElement} The last-page and direct-jump controls.
     */
    function createEndControls(pagination) {
      const controls = documentObject.createElement("div");
      controls.className = `${CONTROL_CLASS} ${CONTROL_CLASS}--end`;
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", labels.pageJumpGroup);

      const input = documentObject.createElement("input");
      input.className = "ghpj-input";
      input.type = "text";
      input.inputMode = "numeric";
      input.pattern = "[0-9]*";
      input.autocomplete = "off";
      input.setAttribute("aria-label", labels.pageInput);
      input.title = labels.pageInput;

      const jumpButton = createIconButton("jump", labels.jumpToPage, "ghpj-jumpbox-button");
      const lastButton = createIconButton("last", labels.lastPage);

      /**
       * Validates and submits the current direct-jump input value.
       *
       * @returns {void}
       */
      function submitInput() {
        const page = coreApi.parsePositiveInteger(input.value);
        const lastPage = Number(controls.dataset.lastPage);

        if (!page || page > lastPage) {
          setValidity(input, labels.invalidPage(lastPage));
          input.reportValidity();
          return;
        }

        setValidity(input, "");
        navigate(pagination, page);
      }

      jumpButton.addEventListener("click", submitInput);
      lastButton.addEventListener("click", () => {
        navigate(pagination, Number(controls.dataset.lastPage));
      });
      input.addEventListener("input", () => setValidity(input, ""));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitInput();
        }
      });

      const jumpbox = documentObject.createElement("div");
      jumpbox.className = "ghpj-jumpbox";
      jumpbox.append(input, jumpButton);
      controls.append(lastButton, jumpbox);
      return controls;
    }

    /**
     * Synchronizes control state with the current native pagination state.
     *
     * @param {Element} pagination The pagination root element.
     * @param {HTMLElement} startControls Controls before the native items.
     * @param {HTMLElement} endControls Controls after the native items.
     * @returns {void}
     */
    function updateControls(pagination, startControls, endControls) {
      const descriptors = collectDescriptors(pagination);
      if (descriptors.length === 0) {
        startControls.remove();
        endControls.remove();
        return;
      }

      const state = coreApi.getPaginationState(
        descriptors,
        windowObject.location.href,
        getDeclaredTotal(pagination)
      );
      const firstButton = /** @type {HTMLButtonElement|null} */ (
        startControls.querySelector(".ghpj-button--first")
      );
      const lastButton = /** @type {HTMLButtonElement|null} */ (
        endControls.querySelector(".ghpj-button--last")
      );
      const input = /** @type {HTMLInputElement|null} */ (endControls.querySelector(".ghpj-input"));

      endControls.dataset.lastPage = String(state.last);

      if (firstButton) {
        firstButton.disabled = state.current <= 1;
      }

      if (lastButton) {
        lastButton.disabled = state.current >= state.last;
      }

      if (input) {
        input.max = String(state.last);
        input.placeholder = `1-${state.last}`;
      }
    }

    /**
     * Creates or refreshes controls for one supported paginator.
     *
     * @param {Element} pagination The pagination root element.
     * @returns {void}
     */
    function enhance(pagination) {
      const adapter = getAdapter(pagination);
      if (!adapter) {
        return;
      }

      const host = getHost(pagination);
      const mode = classify(pagination);
      pagination.classList.toggle(FIXED_CLASS, fixedEnabled);

      if (mode === null) {
        // Neither page numbers nor a jumpable link: leave the page untouched.
        removeControls(host, ["start", "end", "sequential"]);
        return;
      }

      if (mode !== "numeric") {
        removeControls(host, ["start", "end"]);
        enhanceSequential(pagination, host, mode);
        return;
      }

      removeControls(host, ["sequential"]);

      /** @type {HTMLElement|null} */
      let startControls = /** @type {HTMLElement|null} */ (
        host.querySelector(`:scope > .${CONTROL_CLASS}--start`)
      );
      /** @type {HTMLElement|null} */
      let endControls = /** @type {HTMLElement|null} */ (
        host.querySelector(`:scope > .${CONTROL_CLASS}--end`)
      );

      if (!startControls) {
        startControls = createStartControls(pagination);
        host.prepend(startControls);
      }

      if (!endControls) {
        endControls = createEndControls(pagination);
        host.append(endControls);
      }

      const outlineHover = usesLegacyStyle(pagination, adapter);
      startControls.classList.toggle(OUTLINE_CLASS, outlineHover);
      endControls.classList.toggle(OUTLINE_CLASS, outlineHover);
      updateControls(pagination, startControls, endControls);
    }

    /**
     * Describes every paginator found in the document.
     *
     * Exposed for console diagnostics, for example
     * `GitHubPageJumpController.report()` on a GitHub tab.
     *
     * @returns {import("./types").PaginationReportEntry[]} The scan report.
     */
    function report() {
      /** @type {import("./types").PaginationReportEntry[]} */
      const entries = [];

      documentObject.querySelectorAll(PAGINATION_SELECTOR).forEach((pagination) => {
        const element = /** @type {Element} */ (pagination);
        const host = getHost(element);
        entries.push({
          host: `${element.tagName.toLowerCase()}${host === element ? "" : " > " + host.className}`,
          injected: host.querySelectorAll(`:scope > .${CONTROL_CLASS}`).length,
          mode: /** @type {import("./types").PaginationReportEntry["mode"]} */ (classify(element)),
          root: `${element.tagName.toLowerCase()}.${element.className}`
        });
      });

      return entries;
    }

    /**
     * Removes selected control groups previously injected into one host.
     *
     * @param {Element} host The element that receives controls.
     * @param {readonly string[]} variants The control variants to remove.
     * @returns {void}
     */
    function removeControls(host, variants) {
      const selector = variants
        .map((variant) => `:scope > .${CONTROL_CLASS}--${variant}`)
        .join(",");
      host.querySelectorAll(selector).forEach((controls) => {
        controls.remove();
      });
    }

    /**
     * Reads the canonical list URL a jump starts from.
     *
     * @param {"cursor"|"page"} mode The jump strategy of the current list.
     * @returns {string} The list URL without a cursor or page parameter.
     */
    function getBaseUrl(mode) {
      if (mode === "page" && pageApi) {
        return pageApi.setPageParam(windowObject.location.href, 1);
      }

      return cursorApi
        ? cursorApi.stripAfter(windowObject.location.href)
        : windowObject.location.href;
    }

    /**
     * Resolves the jump index for a list URL, reusing any cached knowledge.
     *
     * @param {"cursor"|"page"} mode The jump strategy of the current list.
     * @param {string} baseUrl The canonical list URL.
     * @returns {import("./types").ListIndex|null} The index, or null when unsupported.
     */
    function getIndex(mode, baseUrl) {
      if (mode === "page") {
        return resolveIndex(
          pageIndexes,
          createPageIndex,
          pageSupported,
          PAGE_CACHE_PREFIX,
          baseUrl
        );
      }

      return resolveIndex(
        cursorIndexes,
        createCursorIndex,
        cursorSupported,
        CURSOR_CACHE_PREFIX,
        baseUrl
      );
    }

    /**
     * Reads or creates an index from the strategy-specific registry.
     *
     * @param {Map<string, import("./types").ListIndex>} registry The per-strategy cache.
     * @param {(function(import("./types").CursorIndexOptions & import("./types").PageIndexOptions): import("./types").ListIndex)|null} factory The index factory.
     * @param {boolean} supported Whether the strategy is usable here.
     * @param {string} cachePrefix The storage key prefix.
     * @param {string} baseUrl The canonical list URL.
     * @returns {import("./types").ListIndex|null} The index, or null when unsupported.
     */
    function resolveIndex(registry, factory, supported, cachePrefix, baseUrl) {
      if (!supported || !factory) {
        return null;
      }

      const existing = registry.get(baseUrl);
      if (existing) {
        return existing;
      }

      const created = factory({
        cache: cursorCache,
        cacheKey: `${cachePrefix}${baseUrl}`,
        fetchPage,
        sleep
      });
      registry.set(baseUrl, created);
      return created;
    }

    /**
     * Creates the page-number window for a list that hides its page numbers.
     *
     * The control renders numbers and gaps only: GitHub's own Previous / Next
     * links stay untouched beside it, in GitHub's own wording, and take care
     * of sequential navigation. The window indexes the list on its own so the
     * numbers are ready before the user reaches for them.
     *
     * @param {"cursor"|"page"} mode The jump strategy of the current list.
     * @returns {HTMLDivElement} The page-number window.
     */
    function createSequentialControls(mode) {
      const controls = documentObject.createElement("div");
      controls.className = `${CONTROL_CLASS} ${CONTROL_CLASS}--sequential`;
      controls.dataset.busy = "false";

      const pages = documentObject.createElement("div");
      pages.className = "ghpj-pages";

      const progress = documentObject.createElement("span");
      progress.className = "ghpj-progress";
      progress.setAttribute("role", "status");
      progress.hidden = true;

      const cancelButton = documentObject.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "ghpj-cancel";
      cancelButton.textContent = labels.cancelIndexing;
      cancelButton.hidden = true;

      /** @type {string|null} */
      let message = null;
      /** @type {import("./types").ListProgress|null} */
      let latestProgress = null;

      /**
       * Reads the index and canonical URL of the current list.
       *
       * @returns {{baseUrl: string, index: import("./types").ListIndex|null}} The jump context.
       */
      function resolveContext() {
        const baseUrl = getBaseUrl(mode);
        return { baseUrl, index: getIndex(mode, baseUrl) };
      }

      /**
       * Renders the progress text for the active strategy.
       *
       * @param {import("./types").ListProgress|null} update The latest progress report.
       * @param {import("./types").ListIndex} index The active index.
       * @returns {string} The localized progress text.
       */
      function progressText(update, index) {
        if (mode === "page") {
          const probed =
            update && typeof update.probed === "number" ? update.probed : index.getKnownPages();
          return labels.probing(probed);
        }

        const indexed =
          update && typeof update.indexed === "number" ? update.indexed : index.getKnownPages();
        return labels.indexing(indexed);
      }

      /**
       * Renders the page-number window, skipping identical rebuilds.
       *
       * @param {number} current The page currently displayed.
       * @param {number} upper The highest reachable page number.
       * @param {boolean} complete Whether the whole list has been indexed.
       * @returns {void}
       */
      function renderPages(current, upper, complete) {
        const signature = `${current}/${upper}/${complete ? 1 : 0}`;
        if (pages.dataset.signature === signature) {
          return;
        }

        pages.dataset.signature = signature;
        pages.textContent = "";

        buildPageWindow(current, upper).forEach((item) => {
          if (item === GAP) {
            const gap = documentObject.createElement("span");
            gap.className = "ghpj-gap";
            gap.setAttribute("aria-hidden", "true");
            gap.textContent = "…";
            pages.append(gap);
            return;
          }

          const page = /** @type {number} */ (item);
          const button = documentObject.createElement("button");
          button.type = "button";
          button.className = page === current ? "ghpj-page ghpj-page--current" : "ghpj-page";
          button.dataset.page = String(page);
          button.textContent = String(page);
          button.setAttribute("aria-label", labels.pageLabel(page));
          button.addEventListener("click", () => goTo(page));

          if (page === current) {
            button.setAttribute("aria-current", "page");
          }

          pages.append(button);
        });

        if (!complete) {
          const tail = documentObject.createElement("span");
          tail.className = "ghpj-gap ghpj-gap--pending";
          tail.setAttribute("aria-hidden", "true");
          tail.textContent = "…";
          pages.append(tail);
        }
      }

      /**
       * Renders the number window from the current index state.
       *
       * @param {import("./types").ListIndex} index The active index.
       * @returns {void}
       */
      function render(index) {
        const current = index.getCurrentPage(windowObject.location.href) || 1;
        const total = index.getTotal();
        const upper = total === null ? Math.max(index.getKnownPages(), current) : total;

        renderPages(current, upper, index.isComplete());

        if (message !== null) {
          progress.textContent = message;
        } else if (controls.dataset.busy === "true" && progress.textContent === "") {
          progress.textContent = progressText(latestProgress, index);
        }

        progress.hidden = message === null && controls.dataset.busy !== "true";
      }

      /**
       * Switches the pager between idle and indexing states.
       *
       * @param {boolean} busy Whether indexing is running.
       * @returns {void}
       */
      function setBusy(busy) {
        controls.dataset.busy = busy ? "true" : "false";
        cancelButton.hidden = !busy;

        if (busy && message !== null) {
          message = null;
          progress.textContent = "";
        }
      }

      /**
       * Navigates to a page the index already knows, or resolves it on demand.
       *
       * @param {number} page The requested page number.
       * @returns {void}
       */
      function goTo(page) {
        const { baseUrl, index } = resolveContext();
        if (!index || page < 1 || index.isRunning()) {
          return;
        }

        const url = index.getPageUrl(page, baseUrl);
        if (url) {
          windowObject.location.assign(url);
          return;
        }

        void runJump(page, index, baseUrl);
      }

      /**
       * Walks or probes the list and navigates to the requested page.
       *
       * @param {number} requestedPage The page the user asked for.
       * @param {import("./types").ListIndex} index The active index.
       * @param {string} baseUrl The canonical list URL.
       * @returns {Promise<void>} Resolves once navigation or validation finished.
       */
      async function runJump(requestedPage, index, baseUrl) {
        setBusy(true);
        render(index);

        try {
          const result = await index.resolvePage(requestedPage, {
            baseUrl,
            onProgress: (update) => {
              latestProgress = update;
              progress.textContent = progressText(update, index);
              render(index);
            }
          });

          if (result.cancelled) {
            return;
          }

          if (result.url) {
            windowObject.location.assign(result.url);
            return;
          }

          const total = result.total === null ? index.getKnownPages() : result.total;
          message = labels.pageMissing(requestedPage, total);
        } catch (_error) {
          // Network and parse failures must leave the host page untouched.
          message = labels.indexFailed;
        } finally {
          setBusy(false);
          render(index);
        }
      }

      /**
       * Indexes the whole list in the background so numbers appear up front.
       *
       * @returns {void}
       */
      function startAutoIndex() {
        if (!autoIndexEnabled) {
          return;
        }

        const state = controls.dataset.autoIndex;
        if (state === "running" || state === "done") {
          return;
        }

        const { baseUrl, index } = resolveContext();
        if (!index) {
          return;
        }

        if (index.isComplete()) {
          controls.dataset.autoIndex = "done";
          render(index);
          return;
        }

        controls.dataset.autoIndex = "running";
        void runAutoIndex(index, baseUrl);
      }

      /**
       * Walks or probes the list once to discover every page number.
       *
       * @param {import("./types").ListIndex} index The active index.
       * @param {string} baseUrl The canonical list URL.
       * @returns {Promise<void>} Resolves once the list is indexed or cancelled.
       */
      async function runAutoIndex(index, baseUrl) {
        setBusy(true);
        render(index);

        try {
          const result = await index.resolveLast({
            baseUrl,
            onProgress: (update) => {
              latestProgress = update;
              progress.textContent = progressText(update, index);
              render(index);
            }
          });

          controls.dataset.autoIndex = result.cancelled ? "idle" : "done";
        } catch (_error) {
          // A failed background pass must not remove the number window.
          controls.dataset.autoIndex = "idle";
          message = labels.indexFailed;
        } finally {
          setBusy(false);
          render(index);
        }
      }

      /**
       * Refreshes the pager from the current index state.
       *
       * @returns {void}
       */
      function refresh() {
        const { index } = resolveContext();
        if (!index) {
          controls.remove();
          return;
        }

        render(index);
      }

      /**
       * Cancels a running background pass.
       *
       * @returns {void}
       */
      function cancel() {
        const { index } = resolveContext();
        if (index) {
          index.cancel();
        }
      }

      cancelButton.addEventListener("click", () => {
        controls.dataset.autoIndex = "idle";
        cancel();
      });

      controls.append(pages, progress, cancelButton);
      sequentialHandlers.set(controls, { cancel, refresh, startAutoIndex });
      return controls;
    }

    /**
     * Inserts the number window between GitHub's own Previous and Next.
     *
     * GitHub renders the pair as Previous-then-Next inside one row — either
     * directly in the host (legacy `.pagination`) or grouped in a
     * `.BtnGroup` (cursor lists). The window becomes the second-to-last child,
     * right before Next, so the row reads Previous ‹ numbers › Next and the
     * reading order matches the visual order.
     *
     * @param {Element} host The element that contains GitHub's pair.
     * @param {HTMLElement} controls The number window to insert.
     * @returns {void}
     */
    function insertBetweenNativeButtons(host, controls) {
      const pair = host.querySelector(":scope > .BtnGroup") || host;
      pair.insertBefore(controls, pair.lastElementChild);
    }

    /**
     * Creates or refreshes the number window for one list that hides its page
     * numbers.
     *
     * The window is inserted between GitHub's own Previous and Next links,
     * which stay untouched in GitHub's own wording and keep handling
     * sequential navigation. The window indexes the list in the background on
     * its first render, so every page number is clickable without waiting for
     * a click to start the work.
     *
     * @param {Element} pagination The pagination root element.
     * @param {Element} host The element that receives controls.
     * @param {"cursor"|"page"} mode The jump strategy of the current list.
     * @returns {void}
     */
    function enhanceSequential(pagination, host, mode) {
      if (mode === "cursor" && !cursorSupported) {
        return;
      }

      if (mode === "page" && !pageSupported) {
        return;
      }

      /** @type {HTMLElement|null} */
      let controls = /** @type {HTMLElement|null} */ (
        host.querySelector(`.${CONTROL_CLASS}--sequential`)
      );

      if (!controls) {
        controls = createSequentialControls(mode);
        insertBetweenNativeButtons(host, controls);
      }

      const handlers = sequentialHandlers.get(controls);
      if (!handlers) {
        return;
      }

      const outlineHover = usesLegacyStyle(pagination, getAdapter(pagination));
      controls.classList.toggle(OUTLINE_CLASS, outlineHover);

      handlers.refresh();
      handlers.startAutoIndex();
    }

    /**
     * Enhances every supported paginator currently in the document.
     *
     * @returns {void}
     */
    function scan() {
      documentObject.querySelectorAll(PAGINATION_SELECTOR).forEach((pagination) => {
        try {
          enhance(pagination);
        } catch (_error) {
          // A single unsupported paginator must never break the host page.
        }
      });
    }

    /**
     * Coalesces repeated DOM updates into one animation-frame scan.
     *
     * @returns {void}
     */
    function scheduleScan() {
      if (scheduledFrame !== null) {
        return;
      }

      scheduledFrame = scheduleFrame(() => {
        scheduledFrame = null;
        scan();
      });
    }

    /**
     * Applies fixed mode to existing paginators and future enhancements.
     *
     * @param {boolean} enabled Whether fixed mode should be active.
     * @returns {void}
     */
    function setFixedMode(enabled) {
      fixedEnabled = Boolean(enabled);
      documentObject.querySelectorAll(PAGINATION_SELECTOR).forEach((pagination) => {
        pagination.classList.toggle(FIXED_CLASS, fixedEnabled);
      });
    }

    /**
     * Removes every control previously injected by this controller.
     *
     * @returns {void}
     */
    function cleanUp() {
      documentObject.querySelectorAll(`.${CONTROL_CLASS}--sequential`).forEach((controls) => {
        const handlers = sequentialHandlers.get(/** @type {HTMLElement} */ (controls));
        if (handlers) {
          handlers.cancel();
        }
      });
      documentObject.querySelectorAll(`.${CONTROL_CLASS}`).forEach((controls) => {
        controls.remove();
      });
      documentObject.querySelectorAll(PAGINATION_SELECTOR).forEach((pagination) => {
        pagination.classList.remove(FIXED_CLASS);
      });
    }

    /**
     * Starts observing GitHub navigation and DOM changes.
     *
     * @returns {void}
     */
    function start() {
      if (started) {
        return;
      }

      started = true;
      observer = new MutationObserverClass(scheduleScan);
      observer.observe(documentObject.documentElement, { childList: true, subtree: true });

      // GitHub uses different events across its partial-navigation implementations.
      documentObject.addEventListener("turbo:load", scheduleScan);
      documentObject.addEventListener("pjax:end", scheduleScan);
      windowObject.addEventListener("popstate", scheduleScan);
      scheduleScan();
    }

    /**
     * Stops observation, removes injected nodes, and cancels pending work.
     *
     * @returns {void}
     */
    function stop() {
      if (!started) {
        return;
      }

      started = false;
      if (observer) {
        observer.disconnect();
      }
      observer = null;
      documentObject.removeEventListener("turbo:load", scheduleScan);
      documentObject.removeEventListener("pjax:end", scheduleScan);
      windowObject.removeEventListener("popstate", scheduleScan);

      if (scheduledFrame !== null) {
        cancelFrame(scheduledFrame);
        scheduledFrame = null;
      }

      cleanUp();
    }

    return Object.freeze({ cleanUp, report, scan, scheduleScan, setFixedMode, start, stop });
  }

  return Object.freeze({
    PAGINATION_ADAPTERS,
    PAGINATION_SELECTOR,
    createPaginationController
  });
}
