import { describe, expect, it } from 'vitest';
import {
  TransferLogCursor,
  WalletTransferHistory,
  type HttpFetch,
  type TransferLogToken,
} from '../walletTransfers';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WALLET = '0x8F5B8F40E5c49eE791cF6EDA74523cAb08546418';
const OTHER = '0x1111111111111111111111111111111111111111';
const USDC: TransferLogToken = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
};
const HEAD = 1_000_000;
/** Block time used by the fake chain: one block per second from t = 0. */
const blockTime = (block: number) => 1_700_000_000 + block;

interface FakeTransfer {
  block: number;
  logIndex: number;
  from: string;
  to: string;
  value: bigint;
  token?: string;
  /** Extra topic, as ERC-721 emits. */
  nft?: boolean;
}

const pad = (address: string) => `0x${address.toLowerCase().slice(2).padStart(64, '0')}`;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;

interface FakeRpcOptions {
  transfers: FakeTransfer[];
  /** Largest block range each URL accepts; a missing URL always fails. */
  maxSpanByUrl: Record<string, number>;
  /** Leave `blockTimestamp` out of logs, as older nodes do. */
  omitLogTimestamps?: boolean;
  /** Answers GET requests (the Safe Transaction Service). Default: 404. */
  safeService?: (url: string) => HttpResponse;
  /** False: the wallet has no contract code yet. Default: deployed. */
  deployed?: boolean;
  /** Token balances of the wallet by lower-case token address. Default: none. */
  balances?: Record<string, bigint>;
}

type HttpResponse = Awaited<ReturnType<HttpFetch>>;

const notFound = (): HttpResponse => ({ ok: false, status: 404, json: async () => ({}) });
const ok = (body: unknown): HttpResponse => ({ ok: true, status: 200, json: async () => body });

function fakeRpc(options: FakeRpcOptions) {
  const calls: { url: string; method: string; span?: number }[] = [];

  const fetchFn: HttpFetch = async (url, init) => {
    if (init.method === 'GET') return options.safeService ? options.safeService(url) : notFound();
    const { method, params } = JSON.parse(init.body ?? '{}') as { method: string; params: unknown[] };
    const reply = (body: object, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ jsonrpc: '2.0', id: 1, ...body }),
    });

    const maxSpan = options.maxSpanByUrl[url];
    if (maxSpan === undefined) {
      calls.push({ url, method });
      return reply({ error: { message: 'request limit reached' } }, 429);
    }

    if (method === 'eth_blockNumber') {
      calls.push({ url, method });
      return reply({ result: hex(HEAD) });
    }
    if (method === 'eth_getCode') {
      calls.push({ url, method });
      return reply({ result: options.deployed === false ? '0x' : '0x6080' });
    }
    if (method === 'eth_call') {
      calls.push({ url, method });
      const token = (params[0] as { to: string }).to.toLowerCase();
      return reply({ result: hex(options.balances?.[token] ?? 0n) });
    }
    if (method === 'eth_getBlockByNumber') {
      calls.push({ url, method });
      const block = Number.parseInt(params[0] as string, 16);
      return reply({ result: { number: hex(block), timestamp: hex(blockTime(block)) } });
    }
    if (method === 'eth_getLogs') {
      const filter = params[0] as {
        fromBlock: string;
        toBlock: string;
        address: string[];
        topics: (string | null)[];
      };
      const from = Number.parseInt(filter.fromBlock, 16);
      const to = Number.parseInt(filter.toBlock, 16);
      calls.push({ url, method, span: to - from + 1 });
      if (to - from + 1 > maxSpan) {
        return reply({ error: { message: `exceed maximum block range: ${maxSpan}` } });
      }
      if (filter.address.length > 10) {
        // As publicnode does.
        return reply({ error: { message: 'A maximum of 10 addresses is allowed.' } });
      }
      const logs = options.transfers
        .filter((t) => t.block >= from && t.block <= to)
        .filter((t) => filter.address.includes((t.token ?? USDC.address).toLowerCase()))
        .filter((t) => !filter.topics[1] || filter.topics[1] === pad(t.from))
        .filter((t) => !filter.topics[2] || filter.topics[2] === pad(t.to))
        .map((t) => ({
          address: (t.token ?? USDC.address).toLowerCase(),
          topics: [TRANSFER_TOPIC, pad(t.from), pad(t.to), ...(t.nft ? [hex(7)] : [])],
          data: t.nft ? '0x' : hex(t.value),
          blockNumber: hex(t.block),
          ...(options.omitLogTimestamps ? {} : { blockTimestamp: hex(blockTime(t.block)) }),
          transactionHash: `0x${t.block.toString(16).padStart(64, '0')}`,
          logIndex: hex(t.logIndex),
          removed: false,
        }));
      return reply({ result: logs });
    }
    throw new Error(`unexpected RPC method ${method}`);
  };

  return { fetchFn, calls };
}

function cursor(fetchFn: HttpFetch, rpcUrls = ['https://rpc.example']) {
  return new TransferLogCursor({ address: WALLET, tokens: [USDC], rpcUrls, fetchFn });
}

describe('TransferLogCursor', () => {
  it('lists sent and received transfers newest first, with block times', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [
        { block: HEAD - 10, logIndex: 3, from: OTHER, to: WALLET, value: 5_000_000n },
        { block: HEAD - 400, logIndex: 1, from: WALLET, to: OTHER, value: 1_250_000n },
        // Someone else's transfer: never returned.
        { block: HEAD - 20, logIndex: 0, from: OTHER, to: OTHER, value: 9n },
      ],
    });

    const page = await cursor(fetchFn).nextPage(20);

    expect(page.rows.map((r) => [r.blockNumber, r.from, r.to, r.value, r.timestamp])).toEqual([
      [HEAD - 10, OTHER.toLowerCase(), WALLET.toLowerCase(), '5000000', blockTime(HEAD - 10)],
      [HEAD - 400, WALLET.toLowerCase(), OTHER.toLowerCase(), '1250000', blockTime(HEAD - 400)],
    ]);
    expect(page.rows[0].token).toBe(USDC);
  });

  it('returns a self-transfer once although both queries match it', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 5, logIndex: 2, from: WALLET, to: WALLET, value: 1n }],
    });

    const page = await cursor(fetchFn).nextPage(20);

    expect(page.rows).toHaveLength(1);
  });

  it('ignores ERC-721 transfers from a listed contract', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 5, logIndex: 2, from: OTHER, to: WALLET, value: 0n, nft: true }],
    });

    expect((await cursor(fetchFn).nextPage(20)).rows).toEqual([]);
  });

  it('stops after its block budget with hasMore, then continues from there', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      // Older than one page's scan budget (500 000 blocks).
      transfers: [{ block: HEAD - 700_000, logIndex: 0, from: OTHER, to: WALLET, value: 42n }],
    });
    const history = cursor(fetchFn);

    const first = await history.nextPage(20);
    expect(first.rows).toEqual([]);
    expect(first.hasMore).toBe(true);
    // The first page looked at the newest 500 000 blocks and no further.
    expect(first.scannedBackToMs).toBe(blockTime(HEAD - 500_000 + 1) * 1000);

    const second = await history.nextPage(20);
    expect(second.rows.map((r) => r.value)).toEqual(['42']);
  });

  it('hands out buffered rows page by page without rescanning', async () => {
    const transfers = Array.from({ length: 5 }, (_, i) => ({
      block: HEAD - 100 - i,
      logIndex: 0,
      from: OTHER,
      to: WALLET,
      value: BigInt(i + 1),
    }));
    const { fetchFn, calls } = fakeRpc({ maxSpanByUrl: { 'https://rpc.example': 50_000 }, transfers });
    const history = cursor(fetchFn);

    const first = await history.nextPage(2);
    const logCallsAfterFirst = calls.filter((c) => c.method === 'eth_getLogs').length;
    const second = await history.nextPage(2);

    expect(first.rows.map((r) => r.value)).toEqual(['1', '2']);
    expect(second.rows.map((r) => r.value)).toEqual(['3', '4']);
    expect(second.hasMore).toBe(true);
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(logCallsAfterFirst);
  });

  it('falls back to the next endpoint and keeps using it', async () => {
    const { fetchFn, calls } = fakeRpc({
      maxSpanByUrl: { 'https://good.example': 50_000 },
      transfers: [{ block: HEAD - 10, logIndex: 0, from: OTHER, to: WALLET, value: 7n }],
    });
    const history = cursor(fetchFn, ['https://limited.example', 'https://good.example']);

    const page = await history.nextPage(20);

    expect(page.rows.map((r) => r.value)).toEqual(['7']);
    // Only the very first request went to the endpoint that refuses.
    expect(calls.filter((c) => c.url === 'https://limited.example')).toHaveLength(1);
  });

  it('shrinks the block window when every endpoint rejects the range', async () => {
    const { fetchFn, calls } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 10_000 },
      transfers: [{ block: HEAD - 12_345, logIndex: 0, from: OTHER, to: WALLET, value: 9n }],
    });

    const page = await cursor(fetchFn).nextPage(20);

    expect(page.rows.map((r) => r.value)).toEqual(['9']);
    const accepted = calls.filter((c) => c.method === 'eth_getLogs' && (c.span ?? 0) <= 10_000);
    expect(accepted.length).toBeGreaterThan(0);
    expect(Math.max(...accepted.map((c) => c.span ?? 0))).toBe(10_000);
  });

  it('looks up block times when logs do not carry them', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      omitLogTimestamps: true,
      transfers: [{ block: HEAD - 10, logIndex: 0, from: OTHER, to: WALLET, value: 1n }],
    });

    const page = await cursor(fetchFn).nextPage(20);

    expect(page.rows[0].timestamp).toBe(blockTime(HEAD - 10));
  });

  it('asks for at most ten contracts per request', async () => {
    const tokens: TransferLogToken[] = Array.from({ length: 23 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
      symbol: `T${i}`,
      name: `Token ${i}`,
      decimals: 18,
    }));
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [
        // One token from each group of ten.
        { block: HEAD - 5, logIndex: 0, from: OTHER, to: WALLET, value: 1n, token: tokens[0].address },
        { block: HEAD - 6, logIndex: 0, from: OTHER, to: WALLET, value: 2n, token: tokens[12].address },
        { block: HEAD - 7, logIndex: 0, from: WALLET, to: OTHER, value: 3n, token: tokens[22].address },
      ],
    });
    const history = new TransferLogCursor({
      address: WALLET,
      tokens,
      rpcUrls: ['https://rpc.example'],
      fetchFn,
    });

    const page = await history.nextPage(20);

    expect(page.rows.map((r) => [r.token.symbol, r.value])).toEqual([
      ['T0', '1'],
      ['T12', '2'],
      ['T22', '3'],
    ]);
  });

  it('fails with the RPC error when no endpoint answers', async () => {
    const { fetchFn } = fakeRpc({ maxSpanByUrl: {}, transfers: [] });

    await expect(cursor(fetchFn).nextPage(20)).rejects.toThrow('request limit reached');
  });

  it('has nothing to list when no tokens are given', async () => {
    const { fetchFn, calls } = fakeRpc({ maxSpanByUrl: { 'https://rpc.example': 50_000 }, transfers: [] });
    const history = new TransferLogCursor({
      address: WALLET,
      tokens: [],
      rpcUrls: ['https://rpc.example'],
      fetchFn,
    });

    expect(await history.nextPage(20)).toEqual({ rows: [], hasMore: false, scannedBackToMs: null });
    expect(calls).toEqual([]);
  });
});

// ── Safe Transaction Service + RPC logs ───────────────────────────────────────

const SAFE_SERVICE = 'https://safe.example/tx-service/base';

function safeTransfer(over: { hash: string; time: string; from: string; to: string; value: string; type?: string }) {
  return {
    type: over.type ?? 'ERC20_TRANSFER',
    executionDate: over.time,
    blockNumber: 1,
    transactionHash: over.hash,
    from: over.from,
    to: over.to,
    value: over.value,
    tokenAddress: USDC.address,
    tokenInfo: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  };
}

/** A Safe service holding `transfers` (newest first), paged by limit / offset. */
function safeServiceWith(transfers: ReturnType<typeof safeTransfer>[], requests: string[] = []) {
  return (url: string): HttpResponse => {
    requests.push(url);
    const query = new URL(url).searchParams;
    const limit = Number(query.get('limit'));
    const offset = Number(query.get('offset'));
    const next = offset + limit < transfers.length ? `${url}&more` : null;
    return ok({ count: transfers.length, next, results: transfers.slice(offset, offset + limit) });
  };
}

function history(fetchFn: HttpFetch, safeServiceUrl: string | undefined = SAFE_SERVICE) {
  return new WalletTransferHistory({
    address: WALLET,
    tokens: [USDC],
    rpcUrls: ['https://rpc.example'],
    safeServiceUrl,
    fetchFn,
  });
}

const iso = (block: number) => new Date(blockTime(block) * 1000).toISOString();
const txHash = (block: number) => `0x${block.toString(16).padStart(64, '0')}`;

describe('WalletTransferHistory', () => {
  it('pages through the indexer once it knows the Safe', async () => {
    const requests: string[] = [];
    const indexed = [HEAD - 900_000, HEAD - 2_000_000, HEAD - 3_000_000].map((block, i) =>
      safeTransfer({ hash: txHash(block), time: iso(block), from: OTHER, to: WALLET, value: String(i + 1) }),
    );
    const { fetchFn, calls } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [],
      safeService: safeServiceWith(indexed, requests),
    });
    const wallet = history(fetchFn);

    const first = await wallet.nextPage(2);
    expect(first.rows.map((r) => r.value)).toEqual(['1', '2']);
    expect(first.hasMore).toBe(true);
    expect(first.coveredBackToMs).toBe(blockTime(HEAD - 2_000_000) * 1000);
    expect(requests[0]).toBe(`${SAFE_SERVICE}/api/v1/safes/${WALLET}/transfers/?erc20=true&limit=2&offset=0`);

    const logCalls = calls.filter((c) => c.method === 'eth_getLogs').length;
    const second = await wallet.nextPage(2);
    expect(second.rows.map((r) => r.value)).toEqual(['3']);
    expect(second.hasMore).toBe(false);
    // Everything is listed: nothing older is missing.
    expect(second.coveredBackToMs).toBe(0);
    // Later pages come from the indexer alone.
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toHaveLength(logCalls);
  });

  it('adds what the indexer has not caught up with yet, without duplicates', async () => {
    const seenByBoth = { block: HEAD - 100, logIndex: 0, from: OTHER, to: WALLET, value: 5n };
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [
        // Mined seconds ago: on chain, not indexed yet.
        { block: HEAD - 2, logIndex: 0, from: WALLET, to: OTHER, value: 9n },
        seenByBoth,
      ],
      safeService: safeServiceWith([
        safeTransfer({
          hash: txHash(seenByBoth.block),
          time: iso(seenByBoth.block),
          // The service reports checksummed addresses; logs are lower case.
          from: OTHER,
          to: WALLET,
          value: '5',
        }),
      ]),
    });

    const page = await history(fetchFn).nextPage(20);

    expect(page.rows.map((r) => r.value)).toEqual(['9', '5']);
  });

  it('scans RPC logs for a deployed Safe the indexer does not know yet', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 30, logIndex: 0, from: OTHER, to: WALLET, value: 1_000_000n }],
      safeService: safeServiceWith([]),
    });
    const wallet = history(fetchFn);

    const first = await wallet.nextPage(20);
    expect(first.rows.map((r) => r.value)).toEqual(['1000000']);
    // Older blocks are still unscanned.
    expect(first.hasMore).toBe(true);
    expect(first.coveredBackToMs).toBe(blockTime(HEAD - 500_000 + 1) * 1000);

    const second = await wallet.nextPage(20);
    expect(second.rows).toEqual([]);
    expect(second.coveredBackToMs).toBe(blockTime(HEAD - 1_000_000 + 1) * 1000);
  });

  it('asks the chain for nothing more when an undeployed Safe holds no tokens', async () => {
    const { fetchFn, calls } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [],
      safeService: safeServiceWith([]),
      deployed: false,
    });
    const wallet = history(fetchFn);

    // It never sent anything and holds nothing: there is no history to find.
    expect(await wallet.nextPage(20)).toEqual({ rows: [], hasMore: false, coveredBackToMs: 0 });
    expect(await wallet.nextPage(20)).toEqual({ rows: [], hasMore: false, coveredBackToMs: 0 });
    expect(calls.filter((c) => c.method === 'eth_getLogs')).toEqual([]);
  });

  it('stops scanning an undeployed Safe once its receipts add up to its balance', async () => {
    const { fetchFn, calls } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [
        { block: HEAD - 40, logIndex: 0, from: OTHER, to: WALLET, value: 2_000_000n },
        { block: HEAD - 60_000, logIndex: 0, from: OTHER, to: WALLET, value: 3_000_000n },
      ],
      safeService: safeServiceWith([]),
      deployed: false,
      balances: { [USDC.address.toLowerCase()]: 5_000_000n },
    });

    const page = await history(fetchFn).nextPage(20);

    expect(page.rows.map((r) => r.value)).toEqual(['2000000', '3000000']);
    // Both deposits found = the whole balance: complete, without scanning on.
    expect(page.hasMore).toBe(false);
    expect(page.coveredBackToMs).toBe(0);
    const scanned = calls.filter((c) => c.method === 'eth_getLogs').reduce((n, c) => n + (c.span ?? 0), 0);
    // Two requests per window (sent / received); far less than a full page of 500 000 blocks.
    expect(scanned / 2).toBeLessThanOrEqual(200_000);
  });

  it('keeps scanning an undeployed Safe while part of its balance is unexplained', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 40, logIndex: 0, from: OTHER, to: WALLET, value: 2_000_000n }],
      safeService: safeServiceWith([]),
      deployed: false,
      // More than the one deposit found: an older one is still out there.
      balances: { [USDC.address.toLowerCase()]: 5_000_000n },
    });

    const page = await history(fetchFn).nextPage(20);

    expect(page.rows.map((r) => r.value)).toEqual(['2000000']);
    expect(page.hasMore).toBe(true);
    expect(page.coveredBackToMs).toBe(blockTime(HEAD - 500_000 + 1) * 1000);
  });

  it('uses RPC logs when the indexer is unreachable', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 30, logIndex: 0, from: OTHER, to: WALLET, value: 3n }],
      // safeService left out: every GET answers 404.
    });

    expect((await history(fetchFn).nextPage(20)).rows.map((r) => r.value)).toEqual(['3']);
  });

  it('still lists indexed history when the RPC is down', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: {},
      transfers: [],
      safeService: safeServiceWith([
        safeTransfer({ hash: txHash(5), time: iso(5), from: OTHER, to: WALLET, value: '8' }),
      ]),
    });

    expect((await history(fetchFn).nextPage(20)).rows.map((r) => r.value)).toEqual(['8']);
  });

  it('fails when neither source can answer, and can be retried', async () => {
    const { fetchFn } = fakeRpc({ maxSpanByUrl: {}, transfers: [] });
    const wallet = history(fetchFn);

    await expect(wallet.nextPage(20)).rejects.toThrow('request limit reached');
    await expect(wallet.nextPage(20)).rejects.toThrow('request limit reached');
  });

  it('leaves out native ETH transfers reported by the indexer', async () => {
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [],
      safeService: safeServiceWith([
        safeTransfer({ hash: txHash(9), time: iso(9), from: WALLET, to: OTHER, value: '1', type: 'ETHER_TRANSFER' }),
        safeTransfer({ hash: txHash(8), time: iso(8), from: OTHER, to: WALLET, value: '2' }),
      ]),
    });

    expect((await history(fetchFn).nextPage(20)).rows.map((r) => r.value)).toEqual(['2']);
  });

  it('reads RPC logs only when no indexer is configured', async () => {
    const requests: string[] = [];
    const { fetchFn } = fakeRpc({
      maxSpanByUrl: { 'https://rpc.example': 50_000 },
      transfers: [{ block: HEAD - 30, logIndex: 0, from: OTHER, to: WALLET, value: 4n }],
      safeService: safeServiceWith([], requests),
    });
    const wallet = new WalletTransferHistory({
      address: WALLET,
      tokens: [USDC],
      rpcUrls: ['https://rpc.example'],
      fetchFn,
    });

    expect((await wallet.nextPage(20)).rows.map((r) => r.value)).toEqual(['4']);
    expect(requests).toEqual([]);
  });
});
