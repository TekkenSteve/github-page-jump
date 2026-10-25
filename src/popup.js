/**
 * Boots localization and preference binding for the extension popup.
 *
 * @returns {void}
 */
(function initializePopup() {
  "use strict";

  const shared = globalThis.GitHubPageJumpShared;
  const label = /** @type {HTMLElement|null} */ (document.getElementById("ghpj-fixed-label"));
  const toggle = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("ghpj-fixed-toggle")
  );
  if (!shared || !label || !toggle) {
    return;
  }

  const chromeApi = typeof chrome === "undefined" ? null : chrome;
  const messages = shared.MESSAGES;
  const settings = shared.createSettingsStore(chromeApi);
  const fixedPaginationSetting = shared.SETTING_NAMES.FIXED_PAGINATION;

  // Narrow once so the closures below keep non-nullable element references.
  const labelElement = label;
  const switchButton = toggle;

  /**
   * Renders the fixed-pagination switch state.
   *
   * @param {boolean} enabled Whether fixed pagination is enabled.
   * @returns {void}
   */
  function render(enabled) {
    switchButton.setAttribute("aria-checked", enabled ? "true" : "false");
  }

  /**
   * Optimistically toggles the preference and rolls back failed writes.
   *
   * @returns {Promise<void>}
   */
  async function handleToggleClick() {
    const previousValue = switchButton.getAttribute("aria-checked") === "true";
    const nextValue = !previousValue;
    render(nextValue);

    const saved = await settings.set(fixedPaginationSetting, nextValue);
    if (!saved) {
      render(previousValue);
    }
  }

  labelElement.textContent = messages.fixedPagination;
  switchButton.disabled = !settings.isAvailable;

  void settings.get(fixedPaginationSetting).then(render);
  settings.subscribe(fixedPaginationSetting, render);

  switchButton.addEventListener("click", handleToggleClick);
})();
