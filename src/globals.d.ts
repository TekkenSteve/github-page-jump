/**
 * Global declarations for the UMD namespaces published by the source modules.
 */

import type {
  CoreApi,
  CursorApi,
  PageApi,
  PaginationApi,
  PaginationController,
  SharedApi
} from "./types";

declare global {
  // eslint-disable-next-line no-var
  var GitHubPageJumpController: PaginationController;
  // eslint-disable-next-line no-var
  var GitHubPageJumpCore: CoreApi;
  // eslint-disable-next-line no-var
  var GitHubPageJumpCursor: CursorApi;
  // eslint-disable-next-line no-var
  var GitHubPageJumpPageIndex: PageApi;
  // eslint-disable-next-line no-var
  var GitHubPageJumpPagination: PaginationApi | null;
  // eslint-disable-next-line no-var
  var GitHubPageJumpShared: SharedApi;
}

export {};
