"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const core = require("../src/core.js");

const BASE_URL = "https://github.com/dogle/github-page-jump/issues";

describe("parsePositiveInteger", () => {
  it("accepts positive integers", () => {
    assert.equal(core.parsePositiveInteger(1), 1);
    assert.equal(core.parsePositiveInteger("2"), 2);
    assert.equal(core.parsePositiveInteger("  7  "), 7);
  });

  it("rejects zero, negatives, and non-integers", () => {
    assert.equal(core.parsePositiveInteger(0), null);
    assert.equal(core.parsePositiveInteger(-3), null);
    assert.equal(core.parsePositiveInteger("1.5"), null);
    assert.equal(core.parsePositiveInteger("-2"), null);
  });

  it("rejects unsupported types and unsafe integers", () => {
    assert.equal(core.parsePositiveInteger(""), null);
    assert.equal(core.parsePositiveInteger("abc"), null);
    assert.equal(core.parsePositiveInteger(null), null);
    assert.equal(core.parsePositiveInteger(undefined), null);
    assert.equal(core.parsePositiveInteger(Number.MAX_SAFE_INTEGER + 2), null);
  });
});

describe("readPageNumber", () => {
  it("prefers visible text", () => {
    assert.equal(core.readPageNumber({ text: "4" }), 4);
  });

  it("falls back to English and Chinese accessibility labels", () => {
    assert.equal(core.readPageNumber({ ariaLabel: "Page 9" }), 9);
    assert.equal(core.readPageNumber({ ariaLabel: "第 12 页" }), 12);
  });

  it("returns null when no page number is present", () => {
    assert.equal(core.readPageNumber({ text: "Previous", ariaLabel: "Previous page" }), null);
    assert.equal(core.readPageNumber(), null);
  });
});

describe("inferPageParam", () => {
  it("detects the parameter from the current URL", () => {
    assert.equal(core.inferPageParam([], `${BASE_URL}?page=3`), "page");
    assert.equal(core.inferPageParam([], `${BASE_URL}?p=4&q=is%3Aissue`), "p");
  });

  it("detects the parameter from native pagination links", () => {
    const descriptors = [{ href: `${BASE_URL}?p=2`, page: 2 }];
    assert.equal(core.inferPageParam(descriptors, BASE_URL), "p");
  });

  it("defaults to page when nothing matches", () => {
    assert.equal(core.inferPageParam([], BASE_URL), "page");
  });
});

describe("getPaginationState", () => {
  const descriptors = [
    { href: `${BASE_URL}?page=1`, page: 1 },
    { current: true, href: `${BASE_URL}?page=3`, page: 3 },
    { href: `${BASE_URL}?page=9`, page: 9 }
  ];

  it("prefers the marked current descriptor", () => {
    const state = core.getPaginationState(descriptors, `${BASE_URL}?page=7`, null);
    assert.deepEqual(state, { current: 3, last: 9, pageParam: "page" });
  });

  it("falls back to the URL page number", () => {
    const state = core.getPaginationState(
      descriptors.map(({ href, page }) => ({ href, page })),
      `${BASE_URL}?page=5`,
      null
    );
    assert.equal(state.current, 5);
    assert.equal(state.last, 9);
  });

  it("uses the declared total when it exceeds the visible pages", () => {
    const state = core.getPaginationState(descriptors, `${BASE_URL}?page=3`, "42");
    assert.equal(state.last, 42);
  });

  it("never reports a last page below the current one", () => {
    const state = core.getPaginationState([], `${BASE_URL}?page=11`, "1");
    assert.deepEqual(state, { current: 11, last: 11, pageParam: "page" });
  });

  it("defaults to page 1 without descriptors or URL state", () => {
    assert.deepEqual(core.getPaginationState([], BASE_URL, null), {
      current: 1,
      last: 1,
      pageParam: "page"
    });
  });
});

describe("buildPageUrl", () => {
  const descriptors = [
    { href: `${BASE_URL}?page=2&q=is%3Aopen`, page: 2 },
    { href: `${BASE_URL}?page=3&q=is%3Aopen`, page: 3 }
  ];

  it("preserves unrelated query parameters", () => {
    const url = core.buildPageUrl(descriptors, `${BASE_URL}?page=2&q=is%3Aopen`, 6);
    assert.equal(url, `${BASE_URL}?page=6&q=is%3Aopen`);
  });

  it("falls back to the current URL when no template link exists", () => {
    const url = core.buildPageUrl([], `${BASE_URL}?q=is%3Aopen`, 4);
    assert.equal(url, `${BASE_URL}?q=is%3Aopen&page=4`);
  });

  it("drops numeric anchors left by GitHub's partial navigation", () => {
    const url = core.buildPageUrl(descriptors, `${BASE_URL}?page=2#12`, 5);
    assert.equal(url, `${BASE_URL}?page=5&q=is%3Aopen`);
  });

  it("keeps non-numeric anchors", () => {
    const url = core.buildPageUrl([], `${BASE_URL}?page=2#issue-12`, 5);
    assert.equal(url, `${BASE_URL}?page=5#issue-12`);
  });

  it("rejects invalid target pages", () => {
    assert.throws(() => core.buildPageUrl(descriptors, BASE_URL, 0), TypeError);
    assert.throws(() => core.buildPageUrl(descriptors, BASE_URL, "three"), TypeError);
  });
});
