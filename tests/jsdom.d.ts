/**
 * Minimal jsdom declarations for the test helpers.
 *
 * jsdom ships without bundled types and `@types/jsdom` pulls a large
 * dependency tree (parse5, undici-types, tough-cookie), so the helpers declare
 * only the narrow surface they use.
 */

declare module "jsdom" {
  export interface JSDOMOptions {
    pretendToBeVisual?: boolean;
    url?: string;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
  }
}
