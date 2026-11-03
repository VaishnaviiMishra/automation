import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAIN_DIR = path.resolve(__dirname, '../../../test-results/loanwalk-chain');

export type LoanwalkChainStep = 'get' | 'put';

export type LoanwalkChainState = {
  env: string;
  country: string;
  store: string;
  contractEzId: string;
  itemEzId: string;
  screenSizeAttributeKey: string;
  initialScreenSize: string;
  updatedScreenSize?: string;
  step: LoanwalkChainStep;
};

function chainFilePath(env: string, country: string, store: string): string {
  return path.join(CHAIN_DIR, `${env}-${country}-${store}.json`);
}

export function writeLoanwalkChainState(state: LoanwalkChainState): void {
  fs.mkdirSync(CHAIN_DIR, { recursive: true });
  fs.writeFileSync(chainFilePath(state.env, state.country, state.store), JSON.stringify(state, null, 2), 'utf-8');
}

export function readLoanwalkChainState(env: string, country: string, store: string): LoanwalkChainState | undefined {
  const filePath = chainFilePath(env, country, store);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LoanwalkChainState;
}

function assertMatrix(state: LoanwalkChainState, env: string, country: string, store: string): void {
  if (state.env !== env || state.country !== country || state.store !== store) {
    throw new Error(
      `Test Failed: Chain state matrix mismatch.\n` +
        `Expected: ${env}/${country}/${store}\n` +
        `Received: ${state.env}/${state.country}/${state.store}`
    );
  }
}

/** Chain file from GET spec, ready for PUT (step `get` with initialScreenSize). */
export function tryChainAfterGet(env: string, country: string, store: string): LoanwalkChainState | undefined {
  const state = readLoanwalkChainState(env, country, store);
  if (!state) return undefined;
  try {
    assertMatrix(state, env, country, store);
  } catch {
    return undefined;
  }
  if (state.step !== 'get' || !state.initialScreenSize) return undefined;
  return state;
}

export function requireChainAfterGet(env: string, country: string, store: string): LoanwalkChainState {
  const state = tryChainAfterGet(env, country, store);
  if (!state) {
    throw new Error(
      `Test Failed: Loanwalk chain state is missing.\n` +
        `Expected: Run GET first (01-getContractsByType.spec.ts) for ENV=${env} COUNTRY=${country} STORE=${store}\n` +
        `Received: no usable chain file under test-results/loanwalk-chain/\n` +
        `What should have been: GET stores the current screen size, or run the PUT spec alone (standalone GET in that spec).`
    );
  }
  return state;
}

export function requireChainAfterPut(env: string, country: string, store: string): LoanwalkChainState {
  const state = readLoanwalkChainState(env, country, store);
  if (!state) {
    throw new Error(
      `Test Failed: Loanwalk chain state is missing.\n` +
        `Expected: Run GET then PUT before POST.\n` +
        `Received: no chain file.`
    );
  }
  assertMatrix(state, env, country, store);
  if (state.step !== 'put' || !state.updatedScreenSize) {
    throw new Error(
      `Test Failed: Chain not ready for POST.\n` +
        `Expected: step "put" with updatedScreenSize\n` +
        `Received: step ${state.step}, updatedScreenSize ${state.updatedScreenSize ?? 'missing'}\n` +
        `What should have been: Run npm run gmwalk (GET → PUT → POST in order).`
    );
  }
  return state;
}
