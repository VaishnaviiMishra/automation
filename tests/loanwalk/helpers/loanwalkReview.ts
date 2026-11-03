import type { APIRequestContext } from '@playwright/test';

export type Feature = {
  attributeKey?: string;
  attributeName?: string;
  attributeValue?: string | number | null;
  newVal?: string | number | null;
  oldVal?: string | number | null;
};

export type ReviewBlock = {
  reviewDttm?: string | null;
  itemChanges?: {
    features?: Feature[] | null;
    comments?: Array<{ createdOn?: string | null }> | null;
    scanDttm?: string | null;
    dmwalkDttm?: string | null;
  } | null;
};

export type ContractItem = {
  ezId?: string;
  inventoryItem?: { ezid?: string; features?: Feature[] | null } | null;
  review?: ReviewBlock | null;
};

export type LoanContract = {
  contractEzId?: string;
  items?: ContractItem[];
};

export type ReviewedItem = {
  contractEzId?: string;
  locationEzId?: string;
  reviewDttm?: string | null;
  originalPrice?: number | null;
  dropPrice?: number | null;
  itemChanges?: {
    features?: Feature[] | null;
    comments?: Array<{ createdOn?: string | null }> | null;
  } | null;
};

export type UpdateDataset = {
  storeId: string;
  contractEzId: string;
  itemEzId: string;
  screenSizeAttributeKey: string;
  screenSizeValues: [string, string];
  expectedDropPriceByScreenSize: Record<string, number>;
  post: {
    headers?: Record<string, string>;
    requireDropPrice: boolean;
  };
  putHeaders?: Record<string, string>;
  request: {
    cartContext: { employeeEzId: string; locationEzId: string };
    item: {
      reviewedDttmLocation: string;
      reviewedDttmUTC: string;
      itemChanges: {
        features: Feature[];
        comments: Array<{ createdOn: string; comments: string; type?: string; commentedBy?: number }>;
        scanDttm: string;
        dmwalkDttm: string;
      };
    };
  };
};

export type ScreenSizeHit = {
  current: string;
  source: string;
  itemEzId: string;
  inventoryValue?: string;
  reviewValue?: string;
};

export type ScreenSizeUpdate = {
  oldVal: string;
  newVal: string;
};

export type FlowItemRef = Pick<
  UpdateDataset,
  'contractEzId' | 'itemEzId' | 'screenSizeAttributeKey' | 'storeId'
>;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcClock(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatLocationClock(date: Date): string {
  return formatUtcClock(new Date(date.getTime() - 5 * 60 * 60 * 1000));
}

export type FlowStamps = {
  utc: string;
  location: string;
  instant: Date;
};

export function reviewStamps(now = new Date()): FlowStamps {
  return { instant: now, utc: formatUtcClock(now), location: formatLocationClock(now) };
}

function featureValue(
  features: Feature[] | null | undefined,
  attributeKey: string,
  field: 'attributeValue' | 'newVal' | 'oldVal'
): string | undefined {
  if (!Array.isArray(features)) return undefined;
  const feature = features.find(
    (entry) => entry.attributeKey === attributeKey || entry.attributeName === attributeKey
  );
  const raw = feature?.[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return String(raw);
}

function findContractItem(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string
): ContractItem | undefined {
  const contract = contracts.find((entry) => String(entry.contractEzId) === contractEzId);
  if (!contract) return undefined;
  return contract.items?.find(
    (item) => String(item.ezId ?? item.inventoryItem?.ezid ?? '') === itemEzId
  );
}

/** Current screen on GET: review newVal when present, else inventory attributeValue. */
export function readScreenSizeFromGet(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string,
  attributeKey: string
): ScreenSizeHit | undefined {
  const item = findContractItem(contracts, contractEzId, itemEzId);
  if (!item) return undefined;

  const id = String(item.ezId ?? item.inventoryItem?.ezid ?? '');
  const inventoryValue = featureValue(item.inventoryItem?.features, attributeKey, 'attributeValue');
  const reviewValue = featureValue(item.review?.itemChanges?.features, attributeKey, 'newVal');
  const current = reviewValue ?? inventoryValue;
  if (!current) return undefined;

  return {
    current,
    inventoryValue,
    reviewValue,
    itemEzId: id,
    source: reviewValue ? 'review.itemChanges.features.newVal' : 'inventoryItem.features.attributeValue',
  };
}

/** Updated screen on POST: use feature newVal (after PUT), not oldVal. */
export function readUpdatedScreenSizeFromPost(
  item: ReviewedItem,
  attributeKey: string
): string | undefined {
  return featureValue(item.itemChanges?.features, attributeKey, 'newVal');
}

export async function fetchContractsFromGet(
  request: APIRequestContext,
  getUrl: string,
  headers: Record<string, string>
): Promise<{ httpStatus: number; contracts: LoanContract[] }> {
  const getRes = await request.get(getUrl, { headers });
  const body = await getRes.json();
  return {
    httpStatus: getRes.status(),
    contracts: (body?.payload?.contracts ?? []) as LoanContract[],
  };
}

export function readScreenForFlowItem(
  contracts: LoanContract[],
  flow: FlowItemRef
): ScreenSizeHit | undefined {
  return readScreenSizeFromGet(
    contracts,
    flow.contractEzId,
    flow.itemEzId,
    flow.screenSizeAttributeKey
  );
}

export function assertScreenSizeReadable(
  hit: ScreenSizeHit | undefined,
  flow: FlowItemRef
): asserts hit is ScreenSizeHit {
  if (!hit?.current) {
    throw new Error(
      `Test Failed: Could not read screen size on GET.\n` +
        `Expected: screen on contract ${flow.contractEzId} item ${flow.itemEzId}\n` +
        `Received: missing\n` +
        `What should have been: GET contracts must include the target item and screen attribute.`
    );
  }
  if (!/^(13|15)$/.test(hit.current)) {
    throw new Error(
      `Test Failed: Screen size is not togglable in this flow.\n` +
        `Expected: 13 or 15\n` +
        `Received: ${hit.current}`
    );
  }
}

export function decideScreenSizeUpdate(current: string): ScreenSizeUpdate | undefined {
  if (current === '13') return { oldVal: '13', newVal: '15' };
  if (current === '15') return { oldVal: '15', newVal: '13' };
  return undefined;
}

export function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function assertDropPriceForScreen(
  item: ReviewedItem,
  screenSize: string,
  expectedBySize: Record<string, number>,
  storeId: string,
  loanEzIds: string[]
): void {
  const mismatches: string[] = [];
  if (item.locationEzId !== storeId) {
    mismatches.push(`locationEzId ${item.locationEzId ?? 'missing'} !== ${storeId}`);
  }
  if (!item.contractEzId || !loanEzIds.includes(item.contractEzId)) {
    mismatches.push(`contractEzId ${item.contractEzId ?? 'missing'} not in [${loanEzIds.join(', ')}]`);
  }
  const expectedDrop = expectedBySize[screenSize];
  if (expectedDrop === undefined) {
    mismatches.push(`no expectedDropPrice for screen size ${screenSize}`);
  } else if (hasValue(item.originalPrice) && item.dropPrice !== expectedDrop) {
    mismatches.push(
      `dropPrice ${item.dropPrice} !== expected ${expectedDrop} for screen size ${screenSize}`
    );
  } else if (hasValue(item.originalPrice) && !hasValue(item.dropPrice)) {
    mismatches.push(`dropPrice missing while originalPrice is ${item.originalPrice}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Test Failed: POST drop price check failed.\n` +
        `Expected: dropPrice ${expectedDrop} for screen size ${screenSize} when originalPrice is set\n` +
        `Received: ${mismatches.join('; ')}\n` +
        `What should have been: requireDropPrice should return the configured drop price for this screen size.`
    );
  }
}
