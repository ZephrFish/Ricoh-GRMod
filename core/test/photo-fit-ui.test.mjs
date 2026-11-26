// SPDX-License-Identifier: GPL-2.0-only
// @mock-exempt: engine worker, host bridge, pixels and preview are external boundaries (same pattern as ui/test/library.test.mjs)
// The fork's photo-weighted .cube fit (f058f38, PR 42) beside upstream's batch import and preset library (0.9.4),
// on the real UI store with an in-memory host: its cache keys are ones the desktop host accepts, and the library's
// fit key counts the photo fit, so a stored fit is reused only when it was made the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '../src/index';

const mocks = vi.hoisted(() => ({
  engine: { open: vi.fn(), reset: vi.fn(), convert: vi.fn(), heartbeat: vi.fn(), ratio: vi.fn() },
  host: {
    available: true, info: { token: 'test', kind: 'test' },
    storeGet: vi.fn(), storeSet: vi.fn(), storeDel: vi.fn(), pickDirectory: vi.fn(), write: vi.fn(),
    volumes: vi.fn(), sidecar: vi.fn(), join: (...p) => p.join('/'),
  },
}));
vi.mock('../../ui/src/engine', () => ({ engine: mocks.engine, EngineError: class extends Error {} }));
vi.mock('../../ui/src/host', () => ({ host: mocks.host, HostError: class extends Error {}, sha256Hex: async (b) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex') /* a real hash: the fit cache (PR 42) is keyed by it */, isAndroid: false, isMobile: false }));
vi.mock('../../ui/src/pixels', () => ({ ensureIconFont: vi.fn(), textIcon: vi.fn(() => new Uint8Array(1)), imageIcon: vi.fn(() => new Uint8Array(1)) }));
vi.mock('../../ui/src/preview', () => ({ decodePreview: vi.fn() }));

const caps = { build: true, presets: true, wallpaper: false, factoryEntry: false, bridge: false };
const gr4 = () => ({
  family: 'gr4', version: '1.11', filename: 'fwdc248b.bin', models: ['HDF'], capabilities: caps,
  features: { softFocus: 'clarity', dateStamp: false, monoUnlock: false }, slots: [{ id: 'CY' }, { id: 'CG' }],
  contentArea: { film: { x0: 0, y0: 0, x1: 1, y1: 1 }, plain: { x0: 0, y0: 0, x1: 1, y1: 1 } }, factoryRatios: ['3:2'], factoryEntry: { files: [] }, tiles: { film: new Uint8Array(1), plain: new Uint8Array(1) },
});
const ident = () => [0, 1, 2].map(() => Float64Array.from({ length: 17 }, (_, i) => i / 16));
const fitted = (title) => ({
  kind: 'cube', title, meanDE: 1, p95DE: 2, warnings: [], unsupported: [],
  params: { M1: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ck: ident() },
  matrixQ13: new Int16Array([8192, 0, 0, 0, 8192, 0, 0, 0, 8192]), curves: [new Uint16Array([0, 65535]), new Uint16Array([0, 65535]), new Uint16Array([0, 65535])],
});
const file = (name, body = 'LUT_3D_SIZE 2 ' + name) => ({ name, size: 10, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

let store, files;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  files = new Map();
  mocks.host.available = true;
  mocks.host.storeSet.mockImplementation(async (key, value) => { files.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value); });
  mocks.host.storeDel.mockImplementation(async (key) => { files.delete(key); });
  mocks.host.storeGet.mockImplementation(async (key) => files.get(key) ?? null);
  mocks.host.volumes.mockResolvedValue([]); mocks.host.sidecar.mockResolvedValue(null);
  mocks.engine.reset.mockResolvedValue(true);
  mocks.engine.convert.mockImplementation(async (_kind, text) => fitted('Look ' + text.length));
  mocks.engine.open.mockResolvedValue(gr4());
  vi.stubGlobal('document', { hidden: true });
  store = await import('../../ui/src/store');
  await store.adoptFirmware('fwdc248b.bin', '1.11', new Uint8Array([1]));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('photo fit with upstream\'s batch import', () => {
  it('every key it stores is one the desktop host accepts (the photo fit\'s cache included)', async () => {
    mocks.engine.convert.mockImplementation(async (_k, text) => fitted(text));
    store.setExtraCount(1); await vi.advanceTimersByTimeAsync(5);
    expect(store.getState().photoFit).toBe(true); // on by default: .cube imports go through the cache
    const done = store.loadPresetFiles([file('1.cube', 'one'), file('2.cube', 'two')]);
    await vi.advanceTimersByTimeAsync(5); await done; await vi.advanceTimersByTimeAsync(5);
    const keys = mocks.host.storeSet.mock.calls.map((c) => c[0]);
    expect(keys.some((k) => k.startsWith('fit-'))).toBe(true);
    // shell/internal/server/store.go keyPattern
    for (const k of keys) expect(k, k).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
  });
});

describe('photo fit with upstream\'s preset library', () => {
  const index = () => JSON.parse(new TextDecoder().decode(files.get('library.json')));
  beforeEach(async () => {
    await store.loadPresetFile('CY', file('warm.cube', 'LUT_3D_SIZE 2 warm'));
    mocks.engine.convert.mockClear();
  });
  it('an entry saved with the photo fit is reused, without fitting, while the switch is on', async () => {
    expect(store.getState().slots.CY.preset?.photoFit).toBe(true);
    await store.saveToLibrary('CY', 'Warm');
    expect(index().entries[0].fit).toContain('"photoFit":true');
    await store.applyFromLibrary('CG', index().entries[0].id);
    expect(mocks.engine.convert).not.toHaveBeenCalled();
    expect(store.getState().slots.CG.preset?.photoFit).toBe(true);
  });
  it('refits from the stored source when the options differ (the photo fit switched, or an added slot with hue sectors)', async () => {
    await store.saveToLibrary('CY', 'Warm');
    const id = index().entries[0].id;
    store.setPhotoFit(false);
    await store.applyFromLibrary('CG', id);
    expect(mocks.engine.convert).toHaveBeenCalledWith('cube', 'LUT_3D_SIZE 2 warm', {});
    expect(store.getState().slots.CG.preset?.photoFit).toBeUndefined();
    store.setExtraCount(1);
    mocks.engine.convert.mockClear();
    const x = store.getState().extras[0].key;
    await store.applyFromLibrary(x, id);
    expect(mocks.engine.convert).toHaveBeenCalledWith('cube', 'LUT_3D_SIZE 2 warm', { hue: true });
  });
});
