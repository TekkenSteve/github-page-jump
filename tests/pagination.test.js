"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const pagination = /** @type {import("../src/types").PaginationApi} */ (
  require("../src/pagination.js")
);
const cursor = require("../src/cursor.js");
const shared = require("../src/shared.js");
const {
  GITHUB_URL,
  createDom,
  createScheduler,
  createWindowDouble,
  recordClicks
} = require("./helpers/dom.js");

const LABELS = shared.MESSAGES;
const DEFAULT_URL = `${GITHUB_URL}?page=3`;

/**
 * Builds React-style GitHub pagination markup.
 *
 * @param {{current?: number, last?: number, total?: number|null}} [options] Page layout options.
 * @returns {string} The markup fragment.
 */
function reactPagination(options = {}) {
  const { current = 3, last = 9, total = null } = options;
  const items = [1, 2, current, last]
    .filter((page, index, pages) => pages.indexOf(page) === index)
    .sort((left, right) => left - right)
    .map((page) =>
      page === current
        ? `<span aria-current="page">${page}</span>`
        : `<a href="?page=${page}" aria-label="Page ${page}">${page}</a>`
    )
    .join("");

  return `<nav data-component="Pagination" aria-label="Pagination" ${
    total ? `data-total-pages="${total}"` : ""
  }><div data-hidden-viewport-ranges="true">${items}</div></nav>`;
}

/**
 * Builds legacy Rails-style GitHub pagination markup.
 *
 * @returns {string} The markup fragment.
 */
function legacyPagination() {
  return `<div class="paginate-container"><div class="pagination">
    <span class="previous_page">Previous</span>
    <a href="?page=2">2</a>
    <em class="current">3</em>
    <a href="?page=9">9</a>
    <span class="next_page">Next</span>
  </div></div>`;
}

/**
 * Builds cursor-style GitHub pagination markup without page numbers.
 *
 * @returns {string} The markup fragment.
 */
function cursorPagination() {
  return `<div class="paginate-container"><div class="BtnGroup" data-test-selector="pagination">
    <button class="btn BtnGroup-item" disabled="disabled">Previous</button>
    <a rel="nofollow" class="btn BtnGroup-item" href="?after=CURSOR1">Next</a>
  </div></div>`;
}

/**
 * Builds the last page of a cursor chain: only a `before=` link remains and
 * GitHub renders Next as a disabled button.
 *
 * @returns {string} The markup fragment.
 */
function lastPageCursorPagination() {
  return `<div class="paginate-container"><div class="BtnGroup" data-test-selector="pagination">
    <a rel="nofollow" class="btn BtnGroup-item" href="?before=CURSOR3&amp;tab=stars">Previous</a>
    <button class="btn BtnGroup-item" disabled="disabled">Next</button>
  </div></div>`;
}

/**
 * @typedef {{cancelFrame: (handle: number) => void, flush: () => void, scheduleFrame: (callback: FrameRequestCallback) => number}} Scheduler
 */

/**
 * Creates a controller wired to deterministic doubles.
 *
 * @param {string} body The initial document markup.
 * @param {string} [url] The current page URL.
 * @param {object} [overrides] Additional controller dependencies.
 * @returns {{assigned: string[], clicks: string[], controller: import("../src/types").PaginationController, document: Document, scheduler: Scheduler}} The controller and its observable dependencies.
 */
function setup(body, url = DEFAULT_URL, overrides = {}) {
  const { document, window } = createDom({ body, url });
  const scheduler = createScheduler();
  const { window: windowDouble, assigned } = createWindowDouble(window, url);
  const clicks = recordClicks(document);
  const controller = pagination.createPaginationController({
    cancelFrame: scheduler.cancelFrame,
    document,
    labels: LABELS,
    MutationObserver: window.MutationObserver,
    scheduleFrame: scheduler.scheduleFrame,
    sessionStorage: null,
    window: /** @type {any} */ (windowDouble),
    ...overrides
  });

  return { assigned, clicks, controller, document, scheduler };
}

/**
 * Dispatches an Enter keypress on a page-number input.
 *
 * @param {HTMLInputElement} input The direct-jump input.
 * @returns {void}
 */
function pressEnter(input) {
  const view = input.ownerDocument ? input.ownerDocument.defaultView : null;
  if (!view) {
    throw new Error("The input is not attached to a window");
  }

  input.dispatchEvent(new view.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
}

/**
 * Reads an injected button from a control group.
 *
 * @param {HTMLElement} root The control group.
 * @param {string} selector The button selector.
 * @returns {HTMLButtonElement} The matching button.
 */
function getButton(root, selector) {
  return /** @type {HTMLButtonElement} */ (root.querySelector(selector));
}

/**
 * Dispatches an input event on a page-number input.
 *
 * @param {HTMLInputElement} input The direct-jump input.
 * @returns {void}
 */
function typeIn(input) {
  const view = input.ownerDocument ? input.ownerDocument.defaultView : null;
  if (!view) {
    throw new Error("The input is not attached to a window");
  }

  input.dispatchEvent(new view.Event("input"));
}

/**
 * Reads injected control groups from a pagination root.
 *
 * @param {Document} document The enhanced document.
 * @returns {{end: HTMLElement, input: HTMLInputElement, start: HTMLElement}} The control handles.
 */
function getControls(document) {
  const start = /** @type {HTMLElement} */ (document.querySelector(".ghpj-controls--start"));
  const end = /** @type {HTMLElement} */ (document.querySelector(".ghpj-controls--end"));
  const input = /** @type {HTMLInputElement} */ (end.querySelector(".ghpj-input"));
  return { end, input, start };
}

/**
 * Reads the page numbers rendered by an injected pager.
 *
 * @param {Document} document The enhanced document.
 * @returns {number[]} The rendered page numbers in document order.
 */
function pageNumbers(document) {
  return Array.from(document.querySelectorAll(".ghpj-page")).map((button) =>
    Number(button.textContent)
  );
}

/**
 * Reads one rendered page button.
 *
 * @param {Document} document The enhanced document.
 * @param {number} page The page number to look up.
 * @returns {HTMLButtonElement} The matching page button.
 */
function getPageButton(document, page) {
  return /** @type {HTMLButtonElement} */ (
    document.querySelector(`.ghpj-page[data-page="${page}"]`)
  );
}

/**
 * Drains pending microtasks and timers.
 *
 * @param {number} [times] The number of event loop turns to wait.
 * @returns {Promise<void>} Resolves after the event loop settles.
 */
async function settleAll(times = 60) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe("createPaginationController", () => {
  it("requires document, labels, and window", () => {
    const empty = /** @type {any} */ ({});
    assert.throws(() => pagination.createPaginationController(empty), TypeError);
    assert.throws(
      () =>
        pagination.createPaginationController(
          /** @type {any} */ ({ document: empty, labels: LABELS })
        ),
      TypeError
    );
  });
});

describe("injected controls", () => {
  it("adds first, last, and jump controls to React pagination", () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const host = /** @type {HTMLElement} */ (
      document.querySelector("[data-hidden-viewport-ranges]")
    );
    const { end, input, start } = getControls(document);

    assert.ok(host.querySelector(":scope > .ghpj-controls--start"));
    assert.ok(host.querySelector(":scope > .ghpj-controls--end"));
    assert.ok(start.querySelector(".ghpj-button--first"));
    assert.ok(end.querySelector(".ghpj-button--last"));
    assert.equal(end.getAttribute("role"), "group");
    assert.equal(end.getAttribute("aria-label"), LABELS.pageJumpGroup);
    assert.equal(input.getAttribute("aria-label"), LABELS.pageInput);
    assert.equal(end.dataset.lastPage, "9");
    assert.equal(input.placeholder, "1-9");
  });

  it("uses the declared total when GitHub exposes more pages", () => {
    const { controller, document, scheduler } = setup(reactPagination({ total: 42 }));
    controller.start();
    scheduler.flush();

    assert.equal(getControls(document).end.dataset.lastPage, "42");
  });

  it("disables the first-page control on the first page", () => {
    const { controller, document, scheduler } = setup(reactPagination({ current: 1 }));
    controller.start();
    scheduler.flush();

    const { end, start } = getControls(document);
    assert.equal(getButton(start, ".ghpj-button--first").disabled, true);
    assert.equal(getButton(end, ".ghpj-button--last").disabled, false);
  });

  it("disables the last-page control on the last page", () => {
    const { controller, document, scheduler } = setup(reactPagination({ current: 9 }));
    controller.start();
    scheduler.flush();

    const { end, start } = getControls(document);
    assert.equal(getButton(start, ".ghpj-button--first").disabled, false);
    assert.equal(getButton(end, ".ghpj-button--last").disabled, true);
  });

  it("injects into legacy containers with outline styling", () => {
    const { controller, document, scheduler } = setup(legacyPagination());
    controller.start();
    scheduler.flush();

    const host = /** @type {HTMLElement} */ (
      document.querySelector(".paginate-container > .pagination")
    );
    const { end, start } = getControls(document);

    assert.ok(host.querySelector(":scope > .ghpj-controls--start"));
    assert.equal(start.classList.contains("ghpj-controls--outline"), true);
    assert.equal(end.classList.contains("ghpj-controls--outline"), true);
  });

  it("leaves documents without pagination untouched", () => {
    const { controller, document, scheduler } = setup("");
    controller.start();
    scheduler.flush();

    assert.equal(document.querySelectorAll(".ghpj-controls").length, 0);
  });

  it("does not duplicate controls on repeated scans", () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();
    controller.scan();
    scheduler.flush();

    assert.equal(document.querySelectorAll(".ghpj-controls--start").length, 1);
    assert.equal(document.querySelectorAll(".ghpj-controls--end").length, 1);
  });
});

describe("navigation", () => {
  it("clicks the native link when the target page is visible", () => {
    const { assigned, clicks, controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    getButton(getControls(document).end, ".ghpj-button--last").click();

    assert.deepEqual(clicks, ["?page=9"]);
    assert.deepEqual(assigned, []);
  });

  it("falls back to a built URL for hidden target pages", () => {
    const { assigned, clicks, controller, document, scheduler } = setup(
      reactPagination({ total: 20 })
    );
    controller.start();
    scheduler.flush();

    getButton(getControls(document).end, ".ghpj-button--last").click();

    assert.deepEqual(clicks, []);
    assert.deepEqual(assigned, [`${GITHUB_URL}?page=20`]);
  });

  it("jumps to a typed page on Enter", () => {
    const { assigned, controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const { input } = getControls(document);
    input.value = "7";
    pressEnter(input);

    assert.deepEqual(assigned, [`${GITHUB_URL}?page=7`]);
  });

  it("jumps when the jump button is clicked", () => {
    const { assigned, controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const { end, input } = getControls(document);
    input.value = "5";
    getButton(end, ".ghpj-jumpbox-button").click();

    assert.deepEqual(assigned, [`${GITHUB_URL}?page=5`]);
  });
});

describe("input validation", () => {
  it("marks out-of-range values invalid without navigating", () => {
    const { assigned, controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const { input } = getControls(document);
    input.value = "99";
    pressEnter(input);

    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(input.validationMessage, LABELS.invalidPage(9));
    assert.deepEqual(assigned, []);
  });

  it("rejects non-numeric input", () => {
    const { assigned, controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const { input } = getControls(document);
    input.value = "abc";
    pressEnter(input);

    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.deepEqual(assigned, []);
  });

  it("clears the invalid state while typing", () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const { input } = getControls(document);
    input.value = "99";
    pressEnter(input);
    assert.equal(input.getAttribute("aria-invalid"), "true");

    typeIn(input);
    assert.equal(input.getAttribute("aria-invalid"), "false");
  });
});

describe("lifecycle", () => {
  it("toggles fixed mode on every paginator", () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();

    const nav = /** @type {HTMLElement} */ (document.querySelector("nav"));
    controller.setFixedMode(true);
    assert.equal(nav.classList.contains("ghpj-pagination--fixed"), true);

    controller.setFixedMode(false);
    assert.equal(nav.classList.contains("ghpj-pagination--fixed"), false);
  });

  it("removes injected nodes and stops observing on stop", async () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    scheduler.flush();
    controller.setFixedMode(true);
    controller.stop();

    const nav = /** @type {HTMLElement} */ (document.querySelector("nav"));
    assert.equal(document.querySelectorAll(".ghpj-controls").length, 0);
    assert.equal(nav.classList.contains("ghpj-pagination--fixed"), false);

    document.body.insertAdjacentHTML("beforeend", reactPagination());
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.flush();

    assert.equal(document.querySelectorAll(".ghpj-controls--end").length, 0);
  });

  it("re-enhances paginators added after partial navigation", async () => {
    const { controller, document, scheduler } = setup("");
    controller.start();
    scheduler.flush();

    document.body.insertAdjacentHTML("beforeend", reactPagination());
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.flush();

    assert.equal(document.querySelectorAll(".ghpj-controls--end").length, 1);
  });

  it("ignores repeated start calls", () => {
    const { controller, document, scheduler } = setup(reactPagination());
    controller.start();
    controller.start();
    scheduler.flush();

    assert.equal(document.querySelectorAll(".ghpj-controls--start").length, 1);
  });
});

describe("cursor pagination", () => {
  const STAR_URL = `${GITHUB_URL}?tab=stars`;

  /**
   * Serves a deterministic cursor chain of `CURSOR1`, `CURSOR2`, ... values.
   *
   * @param {number} totalPages The number of pages in the chain.
   * @returns {{fetchPage: (url: string) => Promise<string>, requested: string[]}} The fetch double.
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
        const current = after ? Number(after.replace("CURSOR", "")) + 1 : 1;
        if (current >= totalPages) {
          return Promise.resolve("<div>last page</div>");
        }

        return Promise.resolve(
          `<a rel="nofollow" href="${STAR_URL}&amp;after=CURSOR${current}">Next</a>`
        );
      }
    };
  }

  /**
   * @typedef {{assigned: string[], clicks: string[], controller: import("../src/types").PaginationController, document: Document, requested: string[], scheduler: Scheduler}} CursorSetup
   */

  /**
   * Creates a controller for a cursor-paginated list.
   *
   * Background indexing is opt-in here so request counts stay assertable.
   *
   * @param {number} totalPages The number of pages in the chain.
   * @param {object} [overrides] Additional controller dependencies.
   * @returns {CursorSetup} The controller and its doubles.
   */
  function setupCursor(totalPages, overrides = {}) {
    const chain = createChainFetch(totalPages);
    const context = setup(cursorPagination(), STAR_URL, {
      autoIndex: false,
      fetchPage: chain.fetchPage,
      sleep: () => Promise.resolve(),
      ...overrides
    });

    return { ...context, requested: chain.requested };
  }

  /**
   * Reads the injected cursor pager.
   *
   * @param {Document} document The enhanced document.
   * @returns {HTMLElement} The cursor pager.
   */
  function getCursorControls(document) {
    return /** @type {HTMLElement} */ (document.querySelector(".ghpj-controls--sequential"));
  }

  it("inserts the number window between GitHub's own Previous and Next", () => {
    const { controller, document, scheduler } = setupCursor(5);
    controller.start();
    scheduler.flush();

    const controls = getCursorControls(document);
    assert.ok(controls);
    assert.ok(controls.querySelector(".ghpj-pages"));
    assert.equal(controls.querySelector(".ghpj-nav"), null);
    assert.equal(document.querySelector(".ghpj-input"), null);
    assert.equal(document.querySelector(".ghpj-controls--start"), null);
    assert.equal(document.querySelector(".ghpj-controls--end"), null);

    // The row reads Previous ‹ numbers › Next, in DOM order.
    const previous = /** @type {HTMLElement|null} */ (controls.previousElementSibling);
    const next = /** @type {HTMLElement|null} */ (controls.nextElementSibling);
    assert.equal(previous && previous.textContent, "Previous");
    assert.equal(next && next.getAttribute("href"), "?after=CURSOR1");
    assert.equal(document.querySelector(".ghpj-native-hidden"), null);
    assert.equal(controls.parentElement && controls.parentElement.className, "BtnGroup");
  });

  it("labels page buttons with GitHub's own Page N convention", async () => {
    const { controller, document, scheduler } = setupCursor(5, { autoIndex: true });
    controller.start();
    scheduler.flush();
    await settleAll();

    assert.equal(getPageButton(document, 3).getAttribute("aria-label"), "Page 3");
  });

  it("keeps the number window on the last page of a cursor chain", async () => {
    const chain = createChainFetch(5);
    const { controller, document, scheduler } = setup(
      lastPageCursorPagination(),
      `${STAR_URL}&after=CURSOR4`,
      {
        autoIndex: true,
        fetchPage: chain.fetchPage,
        sleep: () => Promise.resolve()
      }
    );
    controller.start();
    scheduler.flush();
    await settleAll();

    // GitHub's last page carries no `after=` link, only `before=` plus a
    // disabled Next button; the window must survive that markup.
    const controls = getCursorControls(document);
    assert.ok(controls);
    assert.deepEqual(pageNumbers(document), [1, 2, 3, 4, 5]);
    assert.ok(getPageButton(document, 5).hasAttribute("aria-current"));
    assert.equal(document.querySelectorAll(".ghpj-gap--pending").length, 0);

    // And it still sits between Previous and the disabled Next button.
    const previous = /** @type {HTMLElement|null} */ (controls.previousElementSibling);
    const next = /** @type {HTMLElement|null} */ (controls.nextElementSibling);
    assert.equal(previous && previous.textContent, "Previous");
    assert.equal(next && next.tagName, "BUTTON");
    assert.equal(next && next.hasAttribute("disabled"), true);
  });

  it("keeps numeric containers on the numeric adapter", () => {
    const { controller, document, scheduler } = setup(legacyPagination());
    controller.start();
    scheduler.flush();

    assert.ok(document.querySelector(".ghpj-controls--start"));
    assert.equal(document.querySelector(".ghpj-controls--sequential"), null);
  });

  it("jumps to the first page without indexing", () => {
    const chain = createChainFetch(5);
    const { controller, document, scheduler, assigned } = setup(
      cursorPagination(),
      `${STAR_URL}&after=CURSOR1`,
      {
        autoIndex: false,
        fetchPage: chain.fetchPage,
        sleep: () => Promise.resolve()
      }
    );
    controller.start();
    scheduler.flush();

    getPageButton(document, 1).click();

    assert.deepEqual(assigned, [STAR_URL]);
    assert.deepEqual(chain.requested, []);
  });

  it("indexes the whole chain without waiting for a click", async () => {
    const { controller, document, scheduler, requested } = setupCursor(5, { autoIndex: true });
    controller.start();
    scheduler.flush();
    await settleAll();

    const controls = getCursorControls(document);
    assert.deepEqual(pageNumbers(document), [1, 2, 3, 4, 5]);
    assert.equal(requested.length, 5);
    assert.equal(controls.dataset.autoIndex, "done");
  });

  it("jumps straight to an indexed page without more requests", async () => {
    const { controller, document, scheduler, assigned, requested } = setupCursor(5, {
      autoIndex: true
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    const indexed = requested.length;
    getPageButton(document, 3).click();
    await settleAll(2);

    assert.deepEqual(assigned, [`${STAR_URL}&after=CURSOR2`]);
    assert.equal(requested.length, indexed);
  });

  it("renders an ellipsis window for long lists", async () => {
    const { controller, document, scheduler } = setupCursor(24, { autoIndex: true });
    controller.start();
    scheduler.flush();
    await settleAll();

    assert.deepEqual(pageNumbers(document), [1, 2, 3, 4, 5, 24]);
    assert.equal(document.querySelectorAll(".ghpj-gap").length, 1);
  });

  it("cancels indexing from the pager", async () => {
    const { controller, document, scheduler, requested } = setupCursor(24, { autoIndex: true });
    controller.start();
    scheduler.flush();

    const controls = getCursorControls(document);
    getButton(controls, ".ghpj-cancel").click();
    await settleAll();

    assert.ok(requested.length < 24);
    assert.equal(controls.dataset.busy, "false");
    assert.equal(controls.dataset.autoIndex, "idle");
  });

  it("reports indexing failures without navigating", async () => {
    const { controller, document, scheduler, assigned } = setup(cursorPagination(), STAR_URL, {
      autoIndex: true,
      fetchPage: () => Promise.reject(new Error("GitHub responded with 429")),
      sleep: () => Promise.resolve()
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    const controls = getCursorControls(document);
    const progress = /** @type {HTMLElement} */ (document.querySelector(".ghpj-progress"));
    assert.deepEqual(assigned, []);
    assert.equal(progress.textContent, LABELS.indexFailed);
    assert.equal(progress.hidden, false);
    assert.equal(controls.dataset.busy, "false");
  });

  it("removes the injected window on stop and leaves GitHub's pair intact", async () => {
    const { controller, document, scheduler } = setupCursor(5, { autoIndex: true });
    controller.start();
    scheduler.flush();

    const host = /** @type {HTMLElement} */ (
      /** @type {HTMLElement} */ (getCursorControls(document)).parentElement
    );

    controller.stop();

    assert.equal(document.querySelectorAll(".ghpj-controls").length, 0);
    assert.ok(host.querySelector('a[href*="after="]'));
    assert.ok(host.querySelector("button[disabled]"));
  });

  it("reuses the indexed chain across scans", async () => {
    const { controller, document, scheduler, assigned, requested } = setupCursor(5, {
      autoIndex: true
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    const firstPass = requested.length;
    controller.scan();
    getPageButton(document, 2).click();
    await settleAll(2);

    assert.equal(requested.length, firstPass);
    assert.deepEqual(assigned, [`${STAR_URL}&after=CURSOR1`]);
  });
});

describe("page-parameter pagination", () => {
  const REPO_URL = `${GITHUB_URL}?tab=repositories`;

  /**
   * Builds the numberless profile pagination GitHub serves for repositories.
   *
   * @returns {string} The markup fragment.
   */
  function pagePagination() {
    return `<div class="paginate-container"><div role="navigation" aria-label="Pagination" class="pagination">
      <span class="previous_page disabled">Previous</span>
      <a class="next_page" rel="next" href="/sverrejoh?page=2&amp;tab=repositories">Next</a>
    </div></div>`;
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
      /**
       * Serves one list page.
       *
       * @param {string} url The requested URL.
       * @returns {Promise<string>} The page markup.
       */
      fetchPage(url) {
        const page = Number(new URL(url).searchParams.get("page") || 1);
        probed.push(page);

        return Promise.resolve(
          page >= totalPages
            ? '<span class="next_page disabled">Next</span>'
            : `<a class="next_page" rel="next" href="?page=${page + 1}">Next</a>`
        );
      }
    };
  }

  /**
   * @typedef {{assigned: string[], clicks: string[], controller: import("../src/types").PaginationController, document: Document, probed: number[], scheduler: Scheduler}} PageSetup
   */

  /**
   * Creates a controller for a page-parameter list.
   *
   * @param {number} totalPages The number of pages in the list.
   * @param {string} [url] The current page URL.
   * @param {object} [overrides] Additional controller dependencies.
   * @returns {PageSetup} The controller and its doubles.
   */
  function setupPage(totalPages, url = REPO_URL, overrides = {}) {
    const list = createListFetch(totalPages);
    const context = setup(pagePagination(), url, {
      autoIndex: false,
      fetchPage: list.fetchPage,
      sleep: () => Promise.resolve(),
      ...overrides
    });

    return { ...context, probed: list.probed };
  }

  /**
   * Reads the injected sequential pager.
   *
   * @param {Document} document The enhanced document.
   * @returns {HTMLElement} The sequential pager.
   */
  function getPageControls(document) {
    return /** @type {HTMLElement} */ (document.querySelector(".ghpj-controls--sequential"));
  }

  it("inserts the number window between GitHub's own Previous and Next", async () => {
    const { controller, document, scheduler } = setupPage(4, REPO_URL, { autoIndex: true });
    controller.start();
    scheduler.flush();
    await settleAll();

    const controls = getPageControls(document);
    assert.ok(controls);
    assert.equal(controls.querySelector(".ghpj-nav"), null);
    assert.equal(document.querySelector(".ghpj-controls--start"), null);

    // The row reads Previous ‹ numbers › Next, in DOM order.
    const previous = /** @type {HTMLElement|null} */ (controls.previousElementSibling);
    const next = /** @type {HTMLElement|null} */ (controls.nextElementSibling);
    assert.equal(previous && previous.classList.contains("previous_page"), true);
    assert.equal(next && next.classList.contains("next_page"), true);
    assert.equal(next && next.getAttribute("rel"), "next");
  });

  it("probes for the total without waiting for a click", async () => {
    const { controller, document, scheduler } = setupPage(4, REPO_URL, { autoIndex: true });
    controller.start();
    scheduler.flush();
    await settleAll();

    const controls = getPageControls(document);
    assert.deepEqual(pageNumbers(document), [1, 2, 3, 4]);
    assert.equal(controls.dataset.autoIndex, "done");
  });

  it("jumps to any probed page without another request", async () => {
    const { controller, document, scheduler, assigned, probed } = setupPage(10, REPO_URL, {
      autoIndex: true
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    const probedBefore = probed.length;
    getPageButton(document, 10).click();
    await settleAll(2);

    assert.deepEqual(assigned, [`${REPO_URL}&page=10`]);
    assert.equal(probed.length, probedBefore);
  });

  it("marks the rendered page as current on the last page", async () => {
    const { controller, document, scheduler } = setupPage(4, `${REPO_URL}&page=4`, {
      autoIndex: true
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    assert.ok(getPageButton(document, 4).hasAttribute("aria-current"));
    assert.equal(getPageButton(document, 4).className.includes("ghpj-page--current"), true);
  });

  it("returns to the first page by clicking 1", async () => {
    const { controller, document, scheduler, assigned } = setupPage(4, `${REPO_URL}&page=2`, {
      autoIndex: true
    });
    controller.start();
    scheduler.flush();
    await settleAll();

    getPageButton(document, 1).click();
    await settleAll(2);

    assert.deepEqual(assigned, [REPO_URL]);
  });

  it("reports a diagnostic summary for console troubleshooting", () => {
    const { controller, scheduler } = setupPage(4);
    controller.start();
    scheduler.flush();

    const report = controller.report();

    assert.equal(report.length, 1);
    assert.equal(report[0].mode, "page");
    assert.equal(report[0].injected, 1);
  });
});
