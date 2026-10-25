"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const shared = require("../src/shared.js");

const FIXED_PAGINATION = shared.SETTING_NAMES.FIXED_PAGINATION;

/**
 * @typedef {object} ChromeApiDouble
 * @property {(changes: Object<string, {newValue: *}>, areaName?: string) => void} emit Emits a storage change.
 * @property {() => Object<string, *>} snapshot Reads the in-memory store.
 * @property {*} runtime The runtime double.
 * @property {*} storage The storage double.
 */

/**
 * Creates an in-memory chrome.storage.sync double.
 *
 * @param {{data?: Object<string, *>, failGet?: boolean, failSet?: boolean}} [options] Failure and seed options.
 * @returns {ChromeApiDouble} A minimal Chrome API double with emit support.
 */
function createChromeApi(options = {}) {
  const { data = {}, failGet = false, failSet = false } = options;
  /** @type {Object<string, *>} */
  const store = { ...data };
  /** @type {Array<function(Object<string, {newValue: *}>, string): void>} */
  const listeners = [];

  const chromeApi = /** @type {any} */ ({
    runtime: /** @type {{lastError: {message: string}|null}} */ ({ lastError: null }),
    storage: {
      sync: {
        get(
          /** @type {Object<string, *>} */ defaults,
          /** @type {function(Object<string, *>): void} */ callback
        ) {
          chromeApi.runtime.lastError = failGet ? { message: "read failed" } : null;
          callback({ ...defaults, ...store });
          chromeApi.runtime.lastError = null;
        },
        set(/** @type {Object<string, *>} */ update, /** @type {function(): void} */ callback) {
          if (!failSet) {
            Object.assign(store, update);
          }
          chromeApi.runtime.lastError = failSet ? { message: "write failed" } : null;
          callback();
          chromeApi.runtime.lastError = null;
        }
      },
      onChanged: {
        addListener(/** @type {function(Object<string, {newValue: *}>, string): void} */ listener) {
          listeners.push(listener);
        },
        removeListener(
          /** @type {function(Object<string, {newValue: *}>, string): void} */ listener
        ) {
          const index = listeners.indexOf(listener);
          if (index !== -1) {
            listeners.splice(index, 1);
          }
        }
      }
    }
  });

  return Object.assign(chromeApi, {
    /**
     * Emits a storage change to every registered listener.
     *
     * @param {Object<string, {newValue: *}>} changes The changed entries.
     * @param {string} [areaName] The storage area name.
     * @returns {void}
     */
    emit(changes, areaName = "sync") {
      listeners.slice().forEach((listener) => listener(changes, areaName));
    },
    /**
     * Reads the in-memory store, for assertions.
     *
     * @returns {Object<string, *>} The stored entries.
     */
    snapshot() {
      return { ...store };
    }
  });
}

describe("labels", () => {
  it("exposes one English bundle in GitHub's own voice", () => {
    assert.equal(shared.MESSAGES.firstPage, "Go to first page");
    assert.equal(shared.MESSAGES.pageLabel(3), "Page 3");
    assert.equal(shared.MESSAGES.invalidPage(9), "Enter a whole number from 1 to 9");
    assert.equal(
      shared.MESSAGES.pageMissing(11, 10),
      "Page 11 does not exist, this list has 10 pages"
    );
  });
});

describe("settings store", () => {
  it("exposes availability of synchronized storage", () => {
    assert.equal(shared.createSettingsStore(createChromeApi()).isAvailable, true);
    assert.equal(shared.createSettingsStore(null).isAvailable, false);
    assert.equal(shared.createSettingsStore({}).isAvailable, false);
  });

  it("returns registered defaults when storage is empty", async () => {
    const settings = shared.createSettingsStore(createChromeApi());
    assert.equal(await settings.get(FIXED_PAGINATION), false);
  });

  it("normalizes stored values", async () => {
    const settings = shared.createSettingsStore(createChromeApi({ data: { fixedPagination: 1 } }));
    assert.equal(await settings.get(FIXED_PAGINATION), true);
  });

  it("falls back to defaults when Chrome reports a read error", async () => {
    const settings = shared.createSettingsStore(
      createChromeApi({ data: { fixedPagination: true }, failGet: true })
    );
    assert.equal(await settings.get(FIXED_PAGINATION), false);
  });

  it("writes normalized values and reports success", async () => {
    const chromeApi = createChromeApi();
    const settings = shared.createSettingsStore(chromeApi);
    assert.equal(await settings.set(FIXED_PAGINATION, 1), true);
    assert.deepEqual(chromeApi.snapshot(), { fixedPagination: true });
  });

  it("reports failed writes without throwing", async () => {
    const chromeApi = createChromeApi({ failSet: true });
    const settings = shared.createSettingsStore(chromeApi);
    assert.equal(await settings.set(FIXED_PAGINATION, true), false);
    assert.deepEqual(chromeApi.snapshot(), {});
  });

  it("resolves to defaults and skips writes when storage is unavailable", async () => {
    const settings = shared.createSettingsStore(null);
    assert.equal(await settings.get(FIXED_PAGINATION), false);
    assert.equal(await settings.set(FIXED_PAGINATION, true), false);
  });

  it("notifies subscribers about sync-area changes only", () => {
    const chromeApi = createChromeApi();
    const settings = shared.createSettingsStore(chromeApi);
    /** @type {Array<*>} */
    const seen = [];
    const unsubscribe = settings.subscribe(FIXED_PAGINATION, (value) => seen.push(value));

    chromeApi.emit({ fixedPagination: { newValue: 1 } }, "sync");
    chromeApi.emit({ fixedPagination: { newValue: 0 } }, "local");
    unsubscribe();
    chromeApi.emit({ fixedPagination: { newValue: true } }, "sync");

    assert.deepEqual(seen, [true]);
  });

  it("tolerates missing change events", () => {
    const settings = shared.createSettingsStore({ storage: { sync: {} } });
    assert.equal(typeof settings.subscribe(FIXED_PAGINATION, () => {}), "function");
  });

  it("rejects unregistered settings", async () => {
    const settings = shared.createSettingsStore(createChromeApi());
    assert.throws(() => settings.subscribe("unknown", () => {}), RangeError);
    assert.throws(() => settings.get("unknown"), RangeError);
    assert.throws(() => settings.set("unknown", true), RangeError);
  });
});
