"use strict";

const { JSDOM } = require("jsdom");

const GITHUB_URL = "https://github.com/dogle/github-page-jump/issues";

/**
 * Creates a document double backed by jsdom.
 *
 * @param {{body?: string, url?: string}} [options] Initial markup and location.
 * @returns {{dom: JSDOM, document: Document, window: Window & typeof globalThis}} The jsdom handles.
 */
function createDom(options = {}) {
  const { body = "", url = `${GITHUB_URL}?page=3` } = options;
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    url
  });

  return {
    dom,
    document: dom.window.document,
    window: /** @type {Window & typeof globalThis} */ (dom.window)
  };
}

/**
 * Creates a window double with an observable location.
 *
 * The controller only reads `location.href` and calls `location.assign`, so a
 * narrow double keeps navigation assertions deterministic under jsdom.
 *
 * @param {Window} window The jsdom window providing event methods.
 * @param {string} href The current absolute URL.
 * @returns {{window: object, assigned: string[]}} The double and its recorded navigations.
 */
function createWindowDouble(window, href) {
  const assigned = /** @type {string[]} */ ([]);
  const location = {
    href,
    /**
     * Records a navigation request.
     *
     * @param {string} url The requested destination.
     * @returns {void}
     */
    assign(url) {
      assigned.push(url);
    }
  };

  return {
    assigned,
    window: {
      location,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window)
    }
  };
}

/**
 * Creates a deterministic replacement for requestAnimationFrame.
 *
 * @returns {{scheduleFrame: (callback: Function) => number, cancelFrame: (handle: number) => void, flush: () => void}} The scheduler.
 */
function createScheduler() {
  /** @type {Map<number, Function>} */
  const frames = new Map();
  let nextHandle = 1;

  return {
    scheduleFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    flush() {
      const pending = Array.from(frames.values());
      frames.clear();
      pending.forEach((callback) => callback(0));
    }
  };
}

/**
 * Records clicks on native pagination links and cancels jsdom navigation.
 *
 * @param {Document} document The document to observe.
 * @returns {string[]} The hrefs of clicked links, appended in order.
 */
function recordClicks(document) {
  /** @type {string[]} */
  const clicks = /** @type {string[]} */ ([]);

  document.addEventListener("click", (event) => {
    const target = /** @type {Element|null} */ (event.target);
    const anchor = target ? target.closest("a[href]") : null;
    if (anchor) {
      clicks.push(anchor.getAttribute("href") || "");
      event.preventDefault();
    }
  });

  return clicks;
}

module.exports = {
  GITHUB_URL,
  createDom,
  createScheduler,
  createWindowDouble,
  recordClicks
};
