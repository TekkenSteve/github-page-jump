/**
 * Shared structural types for the extension sources.
 *
 * The runtime ships plain JavaScript, so these declarations exist only for
 * `tsc --noEmit` and editor IntelliSense.
 */

export interface PageDescriptor {
  current?: boolean;
  href?: string;
  page: number;
}

export interface DomPageDescriptor extends PageDescriptor {
  element: HTMLElement;
}

export interface PaginationState {
  current: number;
  last: number;
  pageParam: string;
}

export interface Messages {
  cancelIndexing: string;
  firstPage: string;
  fixedPagination: string;
  indexFailed: string;
  indexing: (indexed: number) => string;
  invalidPage: (lastPage: number) => string;
  jumpToPage: string;
  lastPage: string;
  pageInput: string;
  pageJumpGroup: string;
  pageLabel: (page: number) => string;
  pageMissing: (page: number, total: number) => string;
  probing: (probed: number) => string;
}

export interface SettingDefinition {
  defaultValue: unknown;
  normalize: (value: unknown) => unknown;
  storageKey: string;
}

/**
 * Settings are registered with their own normalizers, so consumers receive the
 * documented concrete type and cast through their own JSDoc annotations.
 */
export interface SettingsStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (name: string) => Promise<any>;
  isAvailable: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (name: string, value: any) => Promise<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe: (name: string, listener: (value: any) => void) => () => void;
}

export interface SharedApi {
  MESSAGES: Messages;
  SETTING_DEFINITIONS: Record<string, SettingDefinition>;
  SETTING_NAMES: Record<string, string>;
  createSettingsStore: (chromeApi: unknown) => SettingsStore;
}

export interface CoreApi {
  PAGE_PARAM_CANDIDATES: readonly string[];
  buildPageUrl: (
    descriptors: PageDescriptor[],
    currentUrl: string,
    targetPage: number | string
  ) => string;
  getPaginationState: (
    descriptors: PageDescriptor[],
    currentUrl: string,
    declaredTotal: number | string | null | undefined
  ) => PaginationState;
  inferPageParam: (descriptors: PageDescriptor[], currentUrl: string) => string;
  parsePositiveInteger: (value: number | string | null | undefined) => number | null;
  readPageNumber: (item?: { ariaLabel?: string; text?: string }) => number | null;
}

export interface PaginationAdapter {
  hostSelector: string | null;
  legacy: boolean;
  selector: string;
}

export interface PaginationControllerOptions {
  autoIndex?: boolean;
  document: Document;
  labels: Messages;
  window: Window & typeof globalThis;
  MutationObserver?: typeof MutationObserver;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  createCursorIndex?: (options: CursorIndexOptions) => ListIndex;
  createPageIndex?: (options: PageIndexOptions) => ListIndex;
  fetchPage?: (url: string) => Promise<string>;
  sessionStorage?: Storage | null;
  sleep?: (ms: number) => Promise<void>;
}

export interface SequentialHandlers {
  cancel: () => void;
  refresh: () => void;
  startAutoIndex: () => void;
}

export interface PaginationController {
  cleanUp: () => void;
  report: () => PaginationReportEntry[];
  scan: () => void;
  scheduleScan: () => void;
  setFixedMode: (enabled: boolean) => void;
  start: () => void;
  stop: () => void;
}

export interface PaginationReportEntry {
  host: string;
  injected: number;
  mode: "numeric" | "cursor" | "page" | null;
  root: string;
}

export interface PaginationApi {
  PAGINATION_ADAPTERS: readonly PaginationAdapter[];
  PAGINATION_SELECTOR: string;
  createPaginationController: (options: PaginationControllerOptions) => PaginationController;
}

export interface CursorCache {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove?: (key: string) => void;
}

export interface ListProgress {
  indexed: number;
  total: number | null;
}

export interface CursorIndexOptions {
  fetchPage: (url: string) => Promise<string>;
  cache?: CursorCache | null;
  cacheKey?: string;
  cacheTtlMs?: number;
  maxHops?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  throttleMs?: number;
}

export interface CursorResolution {
  cancelled: boolean;
  total: number | null;
  url: string | null;
}

export interface ListProgress {
  indexed?: number;
  probed?: number;
  total: number | null;
}

export interface ListIndexContext {
  baseUrl: string;
  onProgress?: (progress: ListProgress) => void;
}

/**
 * The jump strategies share one index contract so the controls stay generic.
 */
export interface ListIndex {
  cancel: () => void;
  getCurrentPage: (url: string) => number | null;
  getKnownPages: () => number;
  getPageUrl: (page: number, baseUrl: string) => string | null;
  getTotal: () => number | null;
  isComplete: () => boolean;
  isRunning: () => boolean;
  reset: () => void;
  resolveLast: (context: ListIndexContext) => Promise<CursorResolution>;
  resolvePage: (targetPage: number, context: ListIndexContext) => Promise<CursorResolution>;
}

export interface CursorApi {
  DEFAULT_CACHE_TTL_MS: number;
  DEFAULT_MAX_HOPS: number;
  DEFAULT_THROTTLE_MS: number;
  createCursorIndex: (options: CursorIndexOptions) => ListIndex;
  extractNextCursor: (html: string) => string | null;
  readAfter: (url: string) => string | null;
  stripAfter: (url: string) => string;
  withAfter: (url: string, cursor: string) => string;
}

export interface PageIndexOptions {
  fetchPage: (url: string) => Promise<string>;
  cache?: CursorCache | null;
  cacheKey?: string;
  cacheTtlMs?: number;
  maxPages?: number;
  now?: () => number;
  pageParam?: string;
  sleep?: (ms: number) => Promise<void>;
  throttleMs?: number;
}

export interface PageApi {
  DEFAULT_CACHE_TTL_MS: number;
  DEFAULT_MAX_PAGES: number;
  DEFAULT_THROTTLE_MS: number;
  createPageIndex: (options: PageIndexOptions) => ListIndex;
  hasNextPage: (html: string, nextPage: number, pageParam?: string) => boolean;
  readPageParam: (url: string, pageParam?: string) => number | null;
  setPageParam: (url: string, page: number, pageParam?: string) => string;
}
