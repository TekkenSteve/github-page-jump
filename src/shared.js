/**
 * Shared labels and preference services for content scripts and the popup.
 *
 * Shared structural types live in `types.d.ts`.
 */

/**
 * Publishes shared label and preference services.
 *
 * @param {object} root The global object that receives the browser API.
 * @param {() => import("./types").SharedApi} factory Creates the shared API.
 * @returns {void}
 */
(function initializeShared(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GitHubPageJumpShared = api;
})(globalThis, createShared);

/**
 * Creates the shared label and settings API.
 *
 * @returns {import("./types").SharedApi} The public shared API.
 */
function createShared() {
  "use strict";

  /** @type {Record<string, string>} */
  const SETTING_NAMES = Object.freeze({
    FIXED_PAGINATION: "fixedPagination"
  });

  /** @type {Record<string, import("./types").SettingDefinition>} */
  const SETTING_DEFINITIONS = Object.freeze({
    [SETTING_NAMES.FIXED_PAGINATION]: Object.freeze({
      defaultValue: false,
      normalize: Boolean,
      storageKey: "fixedPagination"
    })
  });

  /**
   * The single label bundle, written in GitHub's own English UI voice so the
   * injected controls read like the surrounding page: page numbers carry no
   * text, Previous / Next stay GitHub's own links, and accessible names follow
   * GitHub's `Page N` convention.
   *
   * @type {import("./types").Messages}
   */
  const MESSAGES = Object.freeze({
    cancelIndexing: "Cancel indexing",
    firstPage: "Go to first page",
    fixedPagination: "Fixed pagination",
    indexFailed: "Indexing failed, please retry",
    indexing: /** @param {number} indexed */ (indexed) => `Indexing page ${indexed}`,
    invalidPage: /** @param {number} lastPage */ (lastPage) =>
      `Enter a whole number from 1 to ${lastPage}`,
    jumpToPage: "Jump to page",
    lastPage: "Go to last page",
    pageInput: "Enter a page number and press Enter",
    pageJumpGroup: "Page jump",
    pageLabel: /** @param {number} page */ (page) => `Page ${page}`,
    pageMissing: /** @param {number} page, @param {number} total */ (page, total) =>
      `Page ${page} does not exist, this list has ${total} pages`,
    probing: /** @param {number} probed */ (probed) => `Probing page ${probed}`
  });

  /**
   * Resolves a registered setting definition.
   *
   * @param {string} name The public setting name.
   * @returns {import("./types").SettingDefinition} The registered definition.
   * @throws {RangeError} When the setting is not registered.
   */
  function getSettingDefinition(name) {
    const definition = SETTING_DEFINITIONS[name];
    if (!definition) {
      throw new RangeError(`Unknown setting: ${name}`);
    }

    return definition;
  }

  /**
   * Creates a normalized adapter around chrome.storage.sync.
   *
   * @param {*} chromeApi The Chrome extension API, when available.
   * @returns {import("./types").SettingsStore} The settings service.
   */
  function createSettingsStore(chromeApi) {
    const storage = chromeApi && chromeApi.storage;
    const storageArea = storage && storage.sync;
    const changeEvent = storage && storage.onChanged;
    const runtime = chromeApi && chromeApi.runtime;
    const isAvailable = Boolean(storageArea);

    /**
     * Checks for a Chrome runtime error inside an API callback.
     *
     * @returns {boolean} True when the current callback has an error.
     */
    function hasRuntimeError() {
      // Chrome exposes lastError only while the storage callback is running.
      return Boolean(runtime && runtime.lastError);
    }

    /**
     * Reads and normalizes a registered setting.
     *
     * @param {string} name The public setting name.
     * @returns {Promise<*>} The stored value or its registered default.
     */
    function get(name) {
      const definition = getSettingDefinition(name);
      if (!isAvailable) {
        return Promise.resolve(definition.defaultValue);
      }

      return new Promise((resolve) => {
        const defaults = { [definition.storageKey]: definition.defaultValue };
        storageArea.get(defaults, (/** @type {Record<string, *>} */ result) => {
          const value = hasRuntimeError() ? definition.defaultValue : result[definition.storageKey];
          resolve(definition.normalize(value));
        });
      });
    }

    /**
     * Writes a normalized value for a registered setting.
     *
     * @param {string} name The public setting name.
     * @param {*} value The value to normalize and store.
     * @returns {Promise<boolean>} Whether the storage operation succeeded.
     */
    function set(name, value) {
      const definition = getSettingDefinition(name);
      if (!isAvailable) {
        return Promise.resolve(false);
      }

      return new Promise((resolve) => {
        const update = { [definition.storageKey]: definition.normalize(value) };
        storageArea.set(update, () => resolve(!hasRuntimeError()));
      });
    }

    /**
     * Provides a stable unsubscribe function when change events are unavailable.
     *
     * @returns {void}
     */
    function unsubscribeNoop() {}

    /**
     * Observes changes to a registered synchronized setting.
     *
     * @param {string} name The public setting name.
     * @param {function(*): void} listener Receives normalized setting values.
     * @returns {() => void} Removes the storage listener.
     */
    function subscribe(name, listener) {
      const definition = getSettingDefinition(name);
      if (!changeEvent || typeof changeEvent.addListener !== "function") {
        return unsubscribeNoop;
      }

      /**
       * Filters Chrome storage changes for the subscribed setting.
       *
       * @param {Object<string, {newValue: *}>} changes Changed storage entries.
       * @param {string} areaName The Chrome storage area name.
       * @returns {void}
       */
      const handleChange = (changes, areaName) => {
        const change = areaName === "sync" && changes[definition.storageKey];
        if (change) {
          listener(definition.normalize(change.newValue));
        }
      };

      changeEvent.addListener(handleChange);

      /**
       * Removes the registered Chrome storage change listener.
       *
       * @returns {void}
       */
      return function unsubscribe() {
        if (typeof changeEvent.removeListener === "function") {
          changeEvent.removeListener(handleChange);
        }
      };
    }

    return Object.freeze({ get, isAvailable, set, subscribe });
  }

  return Object.freeze({
    MESSAGES,
    SETTING_DEFINITIONS,
    SETTING_NAMES,
    createSettingsStore
  });
}
