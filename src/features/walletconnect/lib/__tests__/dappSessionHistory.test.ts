import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    getAllKeys: async () => [...store.keys()],
  },
}));

import {
  dappSessionStorageKey,
  loadDappSessionHistory,
  type DappSessionRecord,
} from '../dappSessionHistory';

const LOCAL_USER = 'local:0x9858effd232b4033e47d90003d41ec34ecaeda94';

function record(id: string): DappSessionRecord {
  return {
    id,
    name: id,
    url: `https://${id}`,
    connectedAt: 1,
    lastSeenAt: 2,
    status: 'disconnected',
  };
}

function seed(userId: string, records: DappSessionRecord[]) {
  store.set(dappSessionStorageKey(userId), JSON.stringify(records));
}

describe('loadDappSessionHistory', () => {
  beforeEach(() => store.clear());

  it('returns the records saved for the user', async () => {
    seed(LOCAL_USER, [record('app.example')]);
    seed('account-1', [record('other.example')]);

    expect(await loadDappSessionHistory(LOCAL_USER)).toEqual([record('app.example')]);
    // Someone else's history is left alone when the user already has their own.
    expect(store.has(dappSessionStorageKey('account-1'))).toBe(true);
  });

  it('moves the history of the single former account to the on-device wallet', async () => {
    seed('account-1', [record('app.example')]);

    expect(await loadDappSessionHistory(LOCAL_USER)).toEqual([record('app.example')]);
    expect(store.has(dappSessionStorageKey('account-1'))).toBe(false);
    // Saved under the new id, so the next load does not depend on the old key.
    expect(await loadDappSessionHistory(LOCAL_USER)).toEqual([record('app.example')]);
  });

  it('moves nothing when several former accounts left history on the device', async () => {
    seed('account-1', [record('one.example')]);
    seed('account-2', [record('two.example')]);

    expect(await loadDappSessionHistory(LOCAL_USER)).toEqual([]);
    expect(store.has(dappSessionStorageKey('account-1'))).toBe(true);
    expect(store.has(dappSessionStorageKey('account-2'))).toBe(true);
  });

  it('never takes the history of another on-device wallet', async () => {
    seed('local:0x0000000000000000000000000000000000000001', [record('app.example')]);

    expect(await loadDappSessionHistory(LOCAL_USER)).toEqual([]);
  });

  it('does not move history into an account (backend) user', async () => {
    seed('account-1', [record('app.example')]);

    expect(await loadDappSessionHistory('account-2')).toEqual([]);
    expect(store.has(dappSessionStorageKey('account-1'))).toBe(true);
  });
});
