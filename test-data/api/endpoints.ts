/**
 * Loanwalk API path templates.
 * Registry key = spec short name (not the HTTP path).
 * Add a key here when a new use-case spec needs a route.
 */

export type EndpointKey =
  | 'getContractsByType'
  | 'postReviewedItemPriceDrop'
  | 'putUpdateReviewedItems';

export type EndpointTemplate = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  requiredParams: string[];
  queryKeys?: string[];
  domain: 'loanwalk';
};

export const endpoints = {
  getContractsByType: {
    method: 'GET',
    path: '/loanwalk/contracts/contractType/{contractType}/store/{storeId}',
    requiredParams: ['storeId', 'contractType'],
    queryKeys: ['fromDate', 'toDate', 'pageNo', 'pageSize'],
    domain: 'loanwalk',
  },
  postReviewedItemPriceDrop: {
    method: 'POST',
    path: '/loanwalk/reviewedItems/store/{storeId}',
    requiredParams: ['storeId'],
    domain: 'loanwalk',
  },
  putUpdateReviewedItems: {
    method: 'PUT',
    path: '/loanwalk/reviewedItems/v2',
    requiredParams: [],
    domain: 'loanwalk',
  },
} as const satisfies Record<EndpointKey, EndpointTemplate>;
