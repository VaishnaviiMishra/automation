/**
 * Loanwalk API path templates.
 * Registry key = spec short name (not the HTTP path).
 * Add a key here when a new use-case spec needs a route.
 */

export type EndpointKey =
  | 'getContractsByStoreAndDate'
  | 'getContractByDmWalk'
  | 'postReviewItemByLoanEzId'
  | 'getContractsByType'
  | 'getContractsWithCustTxn'
  | 'getReviewHistoryByDmwalkTrue'
  | 'getReviewHistoryByDmwalkFalse'
  | 'updateReviewTimestamps';

export type EndpointTemplate = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  requiredParams: string[];
  queryKeys?: string[];
  domain: 'loanwalk';
};

export const endpoints = {
  getContractsByStoreAndDate: {
    method: 'GET',
    path: '/loanwalk/contracts/v2/store/{storeId}',
    requiredParams: ['storeId'],
    queryKeys: ['fromDate', 'toDate', 'pageNo', 'pageSize'],
    domain: 'loanwalk',
  },
  getContractByDmWalk: {
    method: 'GET',
    path: '/loanwalk/contracts/dmwalk/store/{storeId}',
    requiredParams: ['storeId'],
    queryKeys: ['fromDate', 'toDate', 'pageNo', 'pageSize'],
    domain: 'loanwalk',
  },
  postReviewItemByLoanEzId: {
    method: 'POST',
    path: '/loanwalk/reviewedItems/store/{storeId}',
    requiredParams: ['storeId'],
    domain: 'loanwalk',
  },
  getContractsByType: {
    method: 'GET',
    path: '/loanwalk/contracts/contractType/{contractType}/store/{storeId}',
    requiredParams: ['storeId', 'contractType'],
    queryKeys: ['fromDate', 'toDate', 'pageNo', 'pageSize'],
    domain: 'loanwalk',
  },
  getContractsWithCustTxn: {
    method: 'GET',
    path: '/loanwalk/contracts/v2/store/{storeId}',
    requiredParams: ['storeId'],
    queryKeys: ['fromDate', 'toDate', 'pageNo', 'pageSize', 'includeCustTxnSummary'],
    domain: 'loanwalk',
  },
  getReviewHistoryByDmwalkTrue: {
    method: 'GET',
    path: '/loanwalk/reviewHistory/store/{storeId}',
    requiredParams: ['storeId'],
    queryKeys: ['fromContractDate', 'toContractDate', 'dmwalk'],
    domain: 'loanwalk',
  },
  getReviewHistoryByDmwalkFalse: {
    method: 'GET',
    path: '/loanwalk/reviewHistory/store/{storeId}',
    requiredParams: ['storeId'],
    queryKeys: ['fromContractDate', 'toContractDate', 'dmwalk'],
    domain: 'loanwalk',
  },
  updateReviewTimestamps: {
    method: 'PUT',
    path: '/loanwalk/reviewedItems/v2',
    requiredParams: [],
    domain: 'loanwalk',
  },
} as const satisfies Record<EndpointKey, EndpointTemplate>;
