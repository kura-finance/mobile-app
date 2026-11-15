/**
 * Shared wallet history engine — one transfer pager + Bridge poll per smart address.
 * Survives remounts when Home preview and All Transactions both subscribe.
 *
 * On-chain rows come from lib/chain/walletTransfers (Safe Transaction Service
 * + Base RPC logs); see that file for what each source covers.
 */

import i18n from '../../../shared/locales/i18n';
import { readAuthToken } from '../../../lib/api/client';
import { filterWalletTxsForDisplay } from '../utils/walletTxFilter';
import { enrichWalletActivities } from '../utils/walletTxEnrichment';
import { reconcileBridgeAndChainTxs } from '../utils/walletTxBridgeDedup';
import { promoteLikelyBridgeFiatFromChain } from '../utils/walletTxBridgeInfer';
import { reconcilePayoutAndChainTxs } from '../utils/walletTxPayoutDedup';
import { fetchBridgeActivities, enrichFiatWithdrawAccountMeta } from './walletBridgeActivity';
import { resolveBridgePollIntervalMs } from './bridgePollConfig';
import type { ExternalAccountResult, PayoutAddressResult } from '../../../lib/api/ramp/client';
import type { WalletTx } from './useWalletHistory';
import { getAddress } from 'viem';
import Logger from '../../../shared/utils/Logger';
import { BLUE_CHIPS } from '../../crypto/config/blueChips';
import { getBaseRpcUrls } from '../config/cardWalletConfig';
import {
  WalletTransferHistory,
  type TransferLogRow,
  type TransferLogToken,
} from '../../../lib/chain/walletTransfers';
import { features } from '../../../config/features';

/** Safe Transaction Service for Base (keyless, rate-limited). */
const SAFE_TX_SERVICE_URL = 'https://api.safe.global/tx-service/base';
/**
 * Added after the configured RPCs for history only: it serves `eth_getLogs`
 * over wider block ranges than most public endpoints.
 */
const LOGS_FALLBACK_RPC_URL = 'https://base-rpc.publicnode.com';
const PAGE_SIZE = 20;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_INITIAL_WINDOW_PAGES = 50;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lazy read avoids a static require cycle with useAppStore (logout reset). */
function readAuthTokenSync(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getUsableAuthToken } = require('../../../lib/security/sessionAccess') as typeof import('../../../lib/security/sessionAccess');
  return getUsableAuthToken();
}

/** One ERC-20 transfer, in the Etherscan-style shape `normalize` was written for. */
interface ChainTransfer {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenDecimal: string | null;
  contractAddress: string;
}

/** Tokens the RPC log scan looks for: everything the app can hold on Base. */
const HISTORY_TOKENS: TransferLogToken[] = BLUE_CHIPS.filter(
  (token) => token.baseAddress !== null && token.trackBalance !== false,
).map((token) => ({
  address: token.baseAddress as string,
  symbol: token.symbol,
  name: token.name,
  decimals: token.decimals,
}));

function checksum(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

function createTransferHistory(smartAddress: string): WalletTransferHistory {
  return new WalletTransferHistory({
    address: checksum(smartAddress),
    tokens: HISTORY_TOKENS,
    rpcUrls: [...new Set([...getBaseRpcUrls(), LOGS_FALLBACK_RPC_URL])],
    safeServiceUrl: SAFE_TX_SERVICE_URL,
  });
}

function chainTransferFromRow(row: TransferLogRow): ChainTransfer {
  return {
    hash: row.hash,
    timeStamp: String(row.timestamp),
    from: checksum(row.from),
    to: checksum(row.to),
    value: row.value,
    tokenSymbol: row.token.symbol,
    tokenName: row.token.name,
    tokenDecimal: String(row.token.decimals),
    contractAddress: row.token.address,
  };
}

function txId(transfer: ChainTransfer): string {
  return [
    transfer.hash,
    (transfer.contractAddress ?? '').toLowerCase(),
    (transfer.from ?? '').toLowerCase(),
    (transfer.to ?? '').toLowerCase(),
    transfer.value ?? '0',
  ].join('-');
}

function normalize(transfer: ChainTransfer, smartAddress: string): WalletTx {
  const myAddr = smartAddress.toLowerCase();
  const fromAddr = (transfer.from ?? '').toLowerCase();
  const toAddr = (transfer.to ?? '').toLowerCase();

  let direction: WalletTx['direction'];
  let counterparty: string;
  let counterpartyName: string | null;

  if (fromAddr === myAddr && toAddr === myAddr) {
    direction = 'self';
    counterparty = transfer.from;
    counterpartyName = i18n.t('card.self');
  } else if (fromAddr === myAddr) {
    direction = 'out';
    counterparty = transfer.to;
    counterpartyName = null;
  } else {
    direction = 'in';
    counterparty = transfer.from;
    counterpartyName = null;
  }

  const decimals = transfer.tokenDecimal ? parseInt(transfer.tokenDecimal, 10) : 18;
  const rawValue = transfer.value ?? '0';
  const amount = parseFloat(rawValue) / Math.pow(10, decimals);
  const tsSeconds = parseInt(transfer.timeStamp ?? '', 10);
  const timestamp = Number.isFinite(tsSeconds)
    ? new Date(tsSeconds * 1000).toISOString()
    : new Date().toISOString();

  return {
    id: txId(transfer),
    source: 'chain',
    hash: transfer.hash,
    timestamp,
    direction,
    counterparty,
    counterpartyName,
    tokenSymbol: transfer.tokenSymbol ?? 'TOKEN',
    tokenDecimals: decimals,
    tokenIconUrl: null,
    amount,
    rawValue,
    fromAddress: transfer.from,
    toAddress: transfer.to,
    tokenContract: transfer.contractAddress,
  };
}

function oldestChainTimestamp(chainTxs: WalletTx[]): number | null {
  if (chainTxs.length === 0) return null;
  let min = Infinity;
  for (const tx of chainTxs) {
    const ts = new Date(tx.timestamp).getTime();
    if (ts < min) min = ts;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * True once history is known to be complete for the last `windowMs`. The pager
 * says how far back it has looked (it scans block ranges, which may hold no
 * transfers at all); the oldest row is the fallback when it cannot tell.
 */
function isInitialWindowCovered(engine: AddressEngine, windowMs: number): boolean {
  const cutoff = Date.now() - windowMs;
  if (engine.coveredBackToMs !== null) return engine.coveredBackToMs <= cutoff;
  const oldest = oldestChainTimestamp(engine.chainTxs);
  if (oldest === null) return true;
  return oldest <= cutoff;
}

function computeMergedTxs(engine: AddressEngine): WalletTx[] {
  const seen = new Set<string>();
  const merged = enrichFiatWithdrawAccountMeta(
    reconcilePayoutAndChainTxs(
      promoteLikelyBridgeFiatFromChain(
        reconcileBridgeAndChainTxs(
          [...engine.chainTxs, ...engine.bridgeTxs]
            .filter((tx) => {
              if (seen.has(tx.id)) return false;
              seen.add(tx.id);
              return true;
            })
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        ),
        {
          userHasBridgeAccounts: engine.bridgeMeta.hasVirtualAccounts,
          apiDepositCount: engine.bridgeMeta.depositCount,
        },
      ),
      engine.bridgeMeta.payoutAddresses,
    ),
    engine.bridgeMeta.payoutAddresses,
    engine.bridgeMeta.externalAccounts,
  );
  return filterWalletTxsForDisplay(enrichWalletActivities(merged));
}

export interface WalletHistoryPublicSnapshot {
  txs: WalletTx[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  initialWindowLoading: boolean;
  loadMore: () => void;
  refresh: () => void;
}

interface AddressEngine {
  smartAddress: string;
  chainTxs: WalletTx[];
  bridgeTxs: WalletTx[];
  bridgeMeta: {
    depositCount: number;
    hasVirtualAccounts: boolean;
    hasPendingFundsReceived: boolean;
    hasPendingPayoutDrains: boolean;
    payoutAddresses: PayoutAddressResult[];
    externalAccounts: ExternalAccountResult[];
  };
  loading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  /** Pager for the on-chain rows; replaced on refresh. */
  history: WalletTransferHistory | null;
  /** How far back on-chain history is complete (Unix ms); null if unknown. */
  coveredBackToMs: number | null;
  initialWindowComplete: boolean;
  initialWindowPages: number;
  bridgeFetchInFlight: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  listeners: Set<() => void>;
  subscriberWindowDays: Map<number, number>;
  nextSubscriberId: number;
  dataVersion: number;
  snapshotByWindow: Map<number, WalletHistoryPublicSnapshot>;
  actions: { loadMore: () => void; refresh: () => void };
  started: boolean;
}

const engines = new Map<string, AddressEngine>();

function engineKey(smartAddress: string): string {
  return smartAddress.trim().toLowerCase();
}

function maxSubscriberWindowDays(engine: AddressEngine): number {
  let max = 0;
  for (const days of engine.subscriberWindowDays.values()) {
    if (days > max) max = days;
  }
  return max;
}

function wantsInitialWindow(engine: AddressEngine): boolean {
  return maxSubscriberWindowDays(engine) > 0;
}

function initialWindowMs(engine: AddressEngine): number {
  return maxSubscriberWindowDays(engine) * MS_PER_DAY;
}

function notify(engine: AddressEngine): void {
  engine.dataVersion += 1;
  engine.snapshotByWindow.clear();
  for (const listener of engine.listeners) listener();
}

function buildSnapshot(engine: AddressEngine, subscriberWindowDays: number): WalletHistoryPublicSnapshot {
  const wantsWindow = subscriberWindowDays > 0;
  return {
    txs: computeMergedTxs(engine),
    loading: engine.loading,
    error: engine.error,
    hasMore: engine.hasMore,
    initialWindowLoading: wantsWindow && !engine.initialWindowComplete,
    loadMore: engine.actions.loadMore,
    refresh: engine.actions.refresh,
  };
}

function getCachedSnapshot(engine: AddressEngine, subscriberWindowDays: number): WalletHistoryPublicSnapshot {
  const cached = engine.snapshotByWindow.get(subscriberWindowDays);
  if (cached) return cached;
  const snapshot = buildSnapshot(engine, subscriberWindowDays);
  engine.snapshotByWindow.set(subscriberWindowDays, snapshot);
  return snapshot;
}

function getOrCreateEngine(smartAddress: string): AddressEngine {
  const key = engineKey(smartAddress);
  let engine = engines.get(key);
  if (!engine) {
    engine = {
      smartAddress,
      chainTxs: [],
      bridgeTxs: [],
      bridgeMeta: {
        depositCount: 0,
        hasVirtualAccounts: false,
        hasPendingFundsReceived: false,
        hasPendingPayoutDrains: false,
        payoutAddresses: [],
        externalAccounts: [],
      },
      loading: false,
      error: null,
      page: 1,
      hasMore: false,
      history: null,
      coveredBackToMs: null,
      initialWindowComplete: true,
      initialWindowPages: 0,
      bridgeFetchInFlight: false,
      pollTimer: null,
      listeners: new Set(),
      subscriberWindowDays: new Map(),
      nextSubscriberId: 1,
      dataVersion: 0,
      snapshotByWindow: new Map(),
      actions: { loadMore: () => {}, refresh: () => {} },
      started: false,
    };
    engine.actions = {
      loadMore: () => loadMore(engine!),
      refresh: () => refresh(engine!),
    };
    engines.set(key, engine);
  }
  return engine;
}

function resetEngineData(engine: AddressEngine, resetWindow: boolean): void {
  engine.chainTxs = [];
  engine.bridgeTxs = [];
  engine.bridgeMeta = {
    depositCount: 0,
    hasVirtualAccounts: false,
    hasPendingFundsReceived: false,
    hasPendingPayoutDrains: false,
    payoutAddresses: [],
    externalAccounts: [],
  };
  engine.page = 1;
  engine.hasMore = false;
  engine.history = null;
  engine.coveredBackToMs = null;
  if (resetWindow) {
    engine.initialWindowComplete = !wantsInitialWindow(engine);
    engine.initialWindowPages = 0;
  }
}

function stopPoll(engine: AddressEngine): void {
  if (engine.pollTimer) {
    clearInterval(engine.pollTimer);
    engine.pollTimer = null;
  }
}

function startPoll(engine: AddressEngine): void {
  stopPoll(engine);
  // Bridge (fiat ramp) activity only exists on the app backend — nothing to poll without it.
  if (!features.fiatRamp) return;
  const token = readAuthTokenSync();
  if (!token) return;
  const intervalMs = resolveBridgePollIntervalMs(engine.bridgeMeta);
  engine.pollTimer = setInterval(() => void fetchBridge(engine), intervalMs);
}

async function fetchBridge(engine: AddressEngine, options?: { force?: boolean }): Promise<void> {
  if (!features.fiatRamp) return;
  if (engine.bridgeFetchInFlight) return;
  const token = await readAuthToken();
  if (!token) return;
  engine.bridgeFetchInFlight = true;
  try {
    const result = await fetchBridgeActivities(options);
    engine.bridgeTxs = result.txs;
    engine.bridgeMeta = {
      depositCount: result.depositCount,
      hasVirtualAccounts: result.hasVirtualAccounts,
      hasPendingFundsReceived: result.hasPendingFundsReceived,
      hasPendingPayoutDrains: result.hasPendingPayoutDrains,
      payoutAddresses: result.payoutAddresses,
      externalAccounts: result.externalAccounts,
    };
    notify(engine);
    if (engine.listeners.size > 0) startPoll(engine);
  } catch {
    // Bridge history is best-effort.
  } finally {
    engine.bridgeFetchInFlight = false;
  }
}

async function fetchPage(engine: AddressEngine, pageNum: number, append: boolean): Promise<void> {
  const { smartAddress } = engine;
  if (!smartAddress) return;

  engine.loading = true;
  if (!append) engine.error = null;
  notify(engine);

  // Page 1 starts over from the chain head; later pages continue the same pager.
  if (!append || !engine.history) engine.history = createTransferHistory(smartAddress);
  const history = engine.history;
  // A refresh replaces the pager: a page still loading for the old one is
  // dropped, and leaves `loading` to the load that replaced it.
  const stale = () => engine.history !== history;

  try {
    let page: Awaited<ReturnType<WalletTransferHistory['nextPage']>> | null = null;
    let lastErr = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        page = await history.nextPage(PAGE_SIZE);
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }

    if (page === null) {
      // Provider messages ("request limit reached", plan upsells…) mean nothing
      // to the user: log the detail, show the app's own wording.
      Logger.warn('WalletHistory', 'Failed to load transfers', { error: lastErr });
      throw new Error(i18n.t('card.failedLoadHistory'));
    }
    if (stale()) return;

    const items = page.rows.map(chainTransferFromRow);
    const normalized = items.map((item) => normalize(item, smartAddress));
    if (!append) {
      engine.chainTxs = normalized;
    } else {
      const seen = new Set(engine.chainTxs.map((tx) => tx.id));
      engine.chainTxs = [
        ...engine.chainTxs,
        ...normalized.filter((tx) => !seen.has(tx.id)),
      ];
    }
    engine.page = pageNum;
    // Not `items.length >= PAGE_SIZE`: a page can be short while older blocks remain.
    engine.hasMore = page.hasMore;
    engine.coveredBackToMs = page.coveredBackToMs;
  } catch (err) {
    if (!stale()) {
      engine.error = err instanceof Error ? err.message : i18n.t('card.failedLoadHistory');
    }
  } finally {
    if (!stale()) {
      engine.loading = false;
      notify(engine);
      maybeAdvanceInitialWindow(engine);
    }
  }
}

function maybeAdvanceInitialWindow(engine: AddressEngine): void {
  if (!wantsInitialWindow(engine) || engine.initialWindowComplete) return;
  if (engine.loading) return;

  if (engine.error) {
    engine.initialWindowComplete = true;
    notify(engine);
    return;
  }
  if (!engine.hasMore) {
    engine.initialWindowComplete = true;
    notify(engine);
    return;
  }
  if (isInitialWindowCovered(engine, initialWindowMs(engine))) {
    engine.initialWindowComplete = true;
    notify(engine);
    return;
  }
  if (engine.initialWindowPages >= MAX_INITIAL_WINDOW_PAGES) {
    engine.initialWindowComplete = true;
    notify(engine);
    return;
  }

  engine.initialWindowPages += 1;
  void fetchPage(engine, engine.page + 1, true);
}

function refresh(engine: AddressEngine): void {
  resetEngineData(engine, true);
  void fetchBridge(engine, { force: true });
  void fetchPage(engine, 1, false);
}

function loadMore(engine: AddressEngine): void {
  if (engine.loading || !engine.hasMore) return;
  if (wantsInitialWindow(engine) && !engine.initialWindowComplete) return;
  void fetchPage(engine, engine.page + 1, true);
}

function syncInitialWindowState(engine: AddressEngine): void {
  const wants = wantsInitialWindow(engine);
  if (!wants) {
    engine.initialWindowComplete = true;
    return;
  }
  if (
    engine.initialWindowComplete
    && !isInitialWindowCovered(engine, initialWindowMs(engine))
  ) {
    engine.initialWindowComplete = false;
    engine.initialWindowPages = 0;
    maybeAdvanceInitialWindow(engine);
  } else if (!engine.initialWindowComplete && !engine.loading) {
    maybeAdvanceInitialWindow(engine);
  }
}

function ensureStarted(engine: AddressEngine): void {
  if (engine.started) {
    syncInitialWindowState(engine);
    return;
  }
  engine.started = true;
  engine.initialWindowComplete = !wantsInitialWindow(engine);
  void fetchPage(engine, 1, false);

  const token = readAuthTokenSync();
  if (token) void fetchBridge(engine);
  startPoll(engine);
}

function maybeStopEngine(engine: AddressEngine): void {
  if (engine.listeners.size > 0) return;
  stopPoll(engine);
  engine.started = false;
  engines.delete(engineKey(engine.smartAddress));
}

export function subscribeWalletHistory(
  smartAddress: string,
  initialWindowDays: number,
  listener: () => void,
): () => void {
  if (!smartAddress) return () => {};

  const engine = getOrCreateEngine(smartAddress);
  const subscriberId = engine.nextSubscriberId++;
  engine.subscriberWindowDays.set(subscriberId, initialWindowDays);
  engine.listeners.add(listener);
  syncInitialWindowState(engine);
  ensureStarted(engine);

  return () => {
    engine.subscriberWindowDays.delete(subscriberId);
    engine.listeners.delete(listener);
    syncInitialWindowState(engine);
    maybeStopEngine(engine);
  };
}

export function getWalletHistorySnapshot(
  smartAddress: string,
  initialWindowDays: number,
): WalletHistoryPublicSnapshot {
  if (!smartAddress) {
    return {
      txs: [],
      loading: false,
      error: null,
      hasMore: false,
      initialWindowLoading: false,
      loadMore: () => {},
      refresh: () => {},
    };
  }
  const engine = getOrCreateEngine(smartAddress);
  return getCachedSnapshot(engine, initialWindowDays);
}

/** Re-fetch Bridge rows when auth becomes available for an active engine. */
export function notifyWalletHistoryAuthChanged(): void {
  const token = readAuthTokenSync();
  for (const engine of engines.values()) {
    if (engine.listeners.size === 0) continue;
    if (token) {
      void fetchBridge(engine);
      startPoll(engine);
    } else {
      stopPoll(engine);
      engine.bridgeTxs = [];
      engine.bridgeMeta = {
        depositCount: 0,
        hasVirtualAccounts: false,
        hasPendingFundsReceived: false,
        hasPendingPayoutDrains: false,
        payoutAddresses: [],
        externalAccounts: [],
      };
      notify(engine);
    }
  }
}

/** Clear in-memory history on logout. */
export function resetWalletHistorySession(): void {
  for (const engine of engines.values()) {
    stopPoll(engine);
  }
  engines.clear();
}
