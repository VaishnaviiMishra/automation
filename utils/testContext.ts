/**
 * TestContext for ENV + COUNTRY + STORE dataset injection.
 *
 * Datasets live under `test-data/datasets/{env}/{country}/{store}/`.
 * Per-endpoint request params live in the dataset JSON under `params`
 * (e.g. data/loanwalk/getContractsByType.json).
 *
 * Configured for now: stg / usa / 23005.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints, type EndpointKey, type EndpointTemplate } from '../test-data/api/endpoints';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASETS_ROOT = path.join(__dirname, '../test-data/datasets');

export type StoreConfig = {
  baseUrl: string;
  apiKeyEnvVar: string;
  storeId: string;
  country?: string;
  label?: string;
  defaultHeaders?: Record<string, string>;
};

type QueryValue = string | number | boolean | undefined | null;

type EndpointDatasetFile = {
  params?: Record<string, QueryValue>;
  [key: string]: unknown;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function fillPath(template: string, params: Record<string, QueryValue>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing path param "{${key}}" for template ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildUrl(baseUrl: string, pathname: string, query?: Record<string, QueryValue>): string {
  const base = baseUrl.replace(/\/$/, '');
  const pathPart = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (!query) return `${base}${pathPart}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}${pathPart}?${qs}` : `${base}${pathPart}`;
}

function resolveBaseUrl(env: string, config: StoreConfig): string {
  if (env === 'stg') {
    return process.env.STG_SERVICE_BASE_URL ?? config.baseUrl;
  }
  return process.env.QA_SERVICE_BASE_URL ?? config.baseUrl;
}

export type TestContext = {
  meta: { env: string; country: string; store: string };
  config: StoreConfig;
  headers: Record<string, string>;
  url: (endpointKey: EndpointKey, extra?: Record<string, QueryValue>) => string;
  params: (endpointKey: EndpointKey) => Record<string, QueryValue>;
  data: <T = unknown>(relativeKey: string) => T;
};

export function createTestContext(options?: {
  env?: string;
  country?: string;
  store?: string;
}): TestContext {
  const env = options?.env ?? process.env.ENV ?? 'stg';
  const country = options?.country ?? process.env.COUNTRY ?? 'usa';
  const store = options?.store ?? process.env.STORE ?? '23005';
  const storeRoot = path.join(DATASETS_ROOT, env, country, store);

  if (!fs.existsSync(storeRoot)) {
    throw new Error(
      `Store dataset not found: ${storeRoot}. Create datasets/${env}/${country}/${store}/ or set ENV, COUNTRY, and STORE to valid values.`
    );
  }

  const config = readJson<StoreConfig>(path.join(storeRoot, 'config.json'));

  const apiKey = process.env[config.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(
      `Missing API key. Set ${config.apiKeyEnvVar} in .env for ${config.label ?? store}.`
    );
  }

  const headers: Record<string, string> = {
    ...(config.defaultHeaders ?? {}),
    'api-key': apiKey,
  };

  function endpointDatasetPath(endpointKey: EndpointKey): string {
    const { domain } = endpoints[endpointKey];
    return path.join(storeRoot, 'data', domain, `${endpointKey}.json`);
  }

  function loadEndpointParams(endpointKey: EndpointKey): Record<string, QueryValue> {
    const filePath = endpointDatasetPath(endpointKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Endpoint dataset not found: ${filePath}`);
    }
    const dataset = readJson<EndpointDatasetFile>(filePath);
    return {
      locationId: store,
      storeId: store,
      ...(dataset.params ?? {}),
    };
  }

  return {
    meta: { env, country, store },
    config,
    headers,
    params(endpointKey) {
      return loadEndpointParams(endpointKey);
    },
    url(endpointKey, extra) {
      const template = endpoints[endpointKey];
      const merged = { ...loadEndpointParams(endpointKey), ...(extra ?? {}) };
      for (const key of template.requiredParams) {
        if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
          throw new Error(`Missing required param "${key}" for endpoint ${endpointKey} (STORE=${store})`);
        }
      }
      const pathFilled = fillPath(template.path, merged);
      const query: Record<string, QueryValue> = {};
      for (const q of (template as EndpointTemplate).queryKeys ?? []) {
        if (merged[q] !== undefined && merged[q] !== null) query[q] = merged[q];
      }
      return buildUrl(resolveBaseUrl(env, config), pathFilled, query);
    },
    data<T = unknown>(relativeKey: string) {
      const filePath = path.join(storeRoot, 'data', `${relativeKey}.json`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Store data file not found: ${filePath}`);
      }
      return readJson<T>(filePath);
    },
  };
}

/** Countries to run when COUNTRY is unset. If COUNTRY is set, only keep it when allowed. */
export function resolveCountriesForPilot(defaultCountries: string[]): string[] {
  if (process.env.COUNTRY) {
    return defaultCountries.includes(process.env.COUNTRY) ? [process.env.COUNTRY] : [];
  }
  return defaultCountries;
}

/**
 * Stores to run when STORE is unset.
 * If STORE is set, only keep it when it appears in `defaultStores` for this country/spec.
 */
export function resolveStoresForPilot(defaultStores: string[]): string[] {
  if (process.env.STORE) {
    return defaultStores.includes(process.env.STORE) ? [process.env.STORE] : [];
  }
  return defaultStores;
}

/** Envs to run when ENV is unset — use defaultEnvs for multi-env pilots. */
export function resolveEnvsForPilot(defaultEnvs: string[]): string[] {
  if (process.env.ENV) return [process.env.ENV];
  return defaultEnvs;
}

/**
 * True when `test-data/datasets/{env}/{country}/{store}/data/{dataKey}.json` exists.
 * Use in pilot loops so missing store datasets are skipped (not failed).
 *
 * @example dataKey: 'loanwalk/getContractsByType'
 */
export function datasetExists(options: {
  env?: string;
  country?: string;
  store?: string;
  dataKey: string;
}): boolean {
  const env = options.env ?? process.env.ENV ?? 'stg';
  const country = options.country ?? process.env.COUNTRY ?? 'usa';
  const store = options.store ?? process.env.STORE ?? '23005';
  const filePath = path.join(DATASETS_ROOT, env, country, store, 'data', `${options.dataKey}.json`);
  return fs.existsSync(filePath);
}
