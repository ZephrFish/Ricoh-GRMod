// SPDX-License-Identifier: GPL-2.0-only
// @mock-exempt: engine worker, host bridge, pixels and preview are external boundaries (same pattern as qol-b-ui.test.mjs)
// The fork's project snapshots and New project, and its write-protect hint after upstream's card check, on the real UI store
// with an in-memory host store (storeGet/storeSet/storeDel/storeList behave as the Go host's key/value store does).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  engine: { open: vi.fn(), reset: vi.fn(), build: vi.fn(), ratio: vi.fn(), inspect: vi.fn(), heartbeat: vi.fn() },
  host: {
    available: true, info: { token: 'test', kind: 'test', version: '9.9.9' },
    storeGet: vi.fn(), storeSet: vi.fn(), storeDel: vi.fn(), storeList: vi.fn(), pickDirectory: vi.fn(), write: vi.fn(),
    volumes: vi.fn(), list: vi.fn(), move: vi.fn(), sidecar: vi.fn(), join: (...p) => p.join('/'),
  },
}));
vi.mock('../../ui/src/engine', () => ({ engine: mocks.engine, EngineError: class extends Error {} }));
vi.mock('../../ui/src/host', () => ({ host: mocks.host, HostError: class extends Error {}, sha256Hex: async () => 'test-hash', isAndroid: false, isMobile: false }));
vi.mock('../../ui/src/pixels', () => ({ ensureIconFont: vi.fn() }));
vi.mock('../../ui/src/preview', () => ({ decodePreview: vi.fn() }));

const info = () => ({
  family: 'gr3x', version: '1.60', filename: 'fwdc243b.bin', models: ['GR3X_HDF'],
  capabilities: { build: true, presets: false, wallpaper: false, factoryEntry: false, bridge: false },
  features: { softFocus: 'clarity', dateStamp: false, monoUnlock: false },
  slots: [], factoryRatios: ['3:2', '1:1'], factoryEntry: { files: [] },
});
const MB = 1 << 20;
const card = (free) => ({ id: 'E:', root: '/card', label: 'CARD', fs: 'FAT32', total: 64 * 1024 * MB, free, removable: true, bus: 'USB' });
const local = new Map(), session = new Map();
let store, mem;
const stored = () => [...mem.keys()];
const snapIndex = () => JSON.parse(mem.get('snapshots.json') ?? '{"entries":[]}').entries;
beforeEach(async () => {
  local.clear(); session.clear();
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  mem = new Map();
  mocks.host.available = true;
  mocks.engine.open.mockReset().mockResolvedValue(info());
  mocks.engine.ratio.mockImplementation(async ratio => ({ label: ratio, actual: ratio, sizes: [[6000, 4000]] }));
  mocks.engine.build.mockResolvedValue({ file: new Uint8Array([9, 2]), checks: { integrity: true } });
const enc = (d) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
  mocks.host.storeGet.mockImplementation(async (k) => (mem.has(k) ? mem.get(k) : null));
  mocks.host.storeSet.mockImplementation(async (k, d) => { mem.set(k, typeof d === 'string' ? d : new TextDecoder().decode(d)); });
  mocks.host.storeDel.mockImplementation(async (k) => { mem.delete(k); });
  mocks.host.storeList.mockImplementation(async () => [...mem.entries()].map(([key, v]) => ({ key, size: enc(v).length })));
  mocks.host.storeGet.mockImplementation(async (k) => (mem.has(k) ? enc(mem.get(k)) : null));
  mocks.host.pickDirectory.mockReset().mockResolvedValue('/chosen');
  mocks.host.write.mockImplementation(async (_p, data) => ({ size: data.length, sha256: 'test-hash' }));
  mocks.host.list.mockResolvedValue([]); mocks.host.move.mockResolvedValue();
  mocks.host.volumes.mockResolvedValue([card(8 * 1024 * MB)]);
  vi.stubGlobal('document', { hidden: true });
  // the page's storage (the app language lives in localStorage; sessionStorage guards the one-off adoption reload); kept across vi.resetModules() like a restart
  const storageOf = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } });
  vi.stubGlobal("localStorage", storageOf(local)); vi.stubGlobal("sessionStorage", storageOf(session));
  store = await import('../../ui/src/store');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = () => vi.advanceTimersByTimeAsync(1);
const confirmed = async (p, yes = true) => { await flush(); expect(store.getState().confirm).toBeTruthy(); store.answerConfirm(yes); await p; await flush(); };
const start = async () => { await store.adoptFirmware('fwdc243b.bin', '1.60', new Uint8Array([1])); store.addRatio('4:3'); await flush(); await store.refreshVolumes(); };
const lastToast = () => store.getState().toasts.at(-1)?.text ?? '';

describe('the write-protect hint (upstream checks the space, ui/test/card-preflight.test.mjs)', () => {
  it('maps a write-protect failure of the host to a write-protect hint', () => {
    for (const m of ['open /card/fwdc243b.bin: read-only file system', 'The media is write protected.', 'permission denied']) expect(store.errorHint('io', m)).toBe('hintWriteProtected');
    expect(store.errorHint('io', 'no space left on device')).toBe('hintCardFull');
  });
});

describe('project snapshots', () => {
  it('takes one before an import, and the import then replaces the project', async () => {
    store.addExtraSlot();
    const exported = await store.buildProjectExport();
    store.addExtraSlot();
    expect(store.getState().extras).toHaveLength(2);
    const file = { size: 100, text: async () => JSON.stringify(exported) };
    const p = store.importProject(file);
    await confirmed(p);
    const idx = snapIndex();
    expect(idx).toHaveLength(1);
    expect(idx[0]).toMatchObject({ reason: 'import', extras: 2 });
    expect(stored()).toContain(`snapshot-${idx[0].id}.json`);
    expect(store.getState().extras).toHaveLength(1);
    // never part of a project export
    expect(Object.keys((await store.buildProjectExport()).files).some((k) => k.startsWith('snapshot'))).toBe(false);
  });
  it('takes one after a successful build, not after a refused one', async () => {
    await start();
    await confirmed(store.outputFirmware({ kind: 'folder' }, false), false);
    expect(snapIndex()).toHaveLength(0);
    await confirmed(store.outputFirmware({ kind: 'folder' }));
    expect(snapIndex().map((e) => e.reason)).toEqual(['build']);
    expect(snapIndex()[0]).toMatchObject({ ratios: 1 });
  });
  it('keeps the newest 10 and deletes the files of the rest; an unchanged project is not snapshotted twice', async () => {
    for (let i = 0; i < 13; i++) { store.setSoft(i % 2 === 0); store.setAdjSlots(5 + (i % 3)); store.setDateStamp(i % 4 < 2); await store.takeSnapshot('build'); }
    const idx = snapIndex();
    expect(idx.length).toBe(10);
    expect(stored().filter((k) => k.startsWith('snapshot-')).sort()).toEqual(idx.map((e) => `snapshot-${e.id}.json`).sort());
    const n = idx.length; await store.takeSnapshot('build'); await store.takeSnapshot('build');
    expect(snapIndex().length).toBe(n);
    expect(stored().every((k) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(k))).toBe(true);
  });
  it('restores through the import path, and snapshots the current state first so the restore can be undone', async () => {
    store.setSoft(true);
    await store.takeSnapshot('build');
    const old = snapIndex()[0];
    store.setSoft(false); store.addExtraSlot();
    await store.openSnapshots(); await flush();
    expect(store.getState().snapshotsView.entries.map((e) => e.id)).toEqual([old.id]);
    const p = store.restoreSnapshot(old.id);
    await confirmed(p);
    expect(store.getState().soft).toBe(true);
    expect(store.getState().extras).toHaveLength(0);
    const idx = snapIndex();
    expect(idx.map((e) => e.reason)).toEqual(['build', 'restore']);
    // the restore snapshot holds what was open before: soft off, one added slot
    expect(idx[1]).toMatchObject({ extras: 1 });
    const back = JSON.parse(mem.get(`snapshot-${idx[1].id}.json`));
    expect(back.project.soft).toBe(false);
    // and restoring that one brings the added slot back
    await store.openSnapshots(); await flush();
    await confirmed(store.restoreSnapshot(idx[1].id));
    expect(store.getState().extras).toHaveLength(1);
  });
  it('reopens the kept official firmware after a restore, although the restore shows the busy overlay meanwhile', async () => {
    await start();
    expect(store.getState().info).toBeTruthy();
    expect([...mem.keys()].some((k) => k.startsWith('firmware-'))).toBe(true);
    await store.takeSnapshot('build');
    const id = snapIndex()[0].id;
    mocks.engine.open.mockClear();
    await store.openSnapshots(); await flush();
    await confirmed(store.restoreSnapshot(id));
    expect(mocks.engine.open).toHaveBeenCalledTimes(1);
    expect(store.getState().info?.version).toBe('1.60');
    expect(store.getState().busy).toBeUndefined();
  });
  it('restoring the oldest of a full list works even though the new snapshot prunes it', async () => {
    for (let i = 0; i < 12; i++) { store.setSoft(i % 2 === 0); store.setAdjSlots(5 + (i % 3)); store.setDateStamp(i % 4 < 2); await store.takeSnapshot('build'); }
    expect(snapIndex().length).toBe(10);
    const oldest = snapIndex()[0]; const want = JSON.parse(mem.get(`snapshot-${oldest.id}.json`)).project.soft;
    store.setSoft(!want); store.addExtraSlot();
    await store.openSnapshots(); await flush();
    await confirmed(store.restoreSnapshot(oldest.id));
    expect(store.getState().soft).toBe(want);
    expect(stored().includes(`snapshot-${oldest.id}.json`)).toBe(false);
    expect(snapIndex().length).toBe(10);
  });
  it('a failing store does not block the action and warns once', async () => {
    await start();
    mocks.host.storeSet.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await confirmed(store.outputFirmware({ kind: 'folder' }));
    expect(mocks.host.write).toHaveBeenCalledTimes(1);
    await store.takeSnapshot('build'); await store.takeSnapshot('build');
    expect(store.getState().toasts.filter((x) => /automatic backup/.test(x.text))).toHaveLength(1);
  });
});

describe('New project', () => {
  it('resets only the open family, keeps the library, the other family and the interface language, and snapshots first', async () => {
    // gr4 doc with 2 ratios, gr3 doc with 2 ratios, GR III open
    const doc = (extra = {}) => ({ v: 1, ratios: [{ id: 'r1', ratio: '4:3', name: '' }, { id: 'r2', ratio: '16:9', name: '' }], ...extra });
    await store.applyProjectExport({ format: 'grmod-project', formatVersion: 1, appVersion: '1', exported: '', files: {}, project: doc({ model: 'GR3X_HDF', uiLang: 'zh', lang: 'ja', tours: ['overview'], toursV: 2 }), projectGr3: doc() });
    expect(store.getState().ratios).toHaveLength(2);
    // an import keeps the current app language (review fix #9), so the user picks zh here
    await store.setAppLanguage('zh');
    mem.set('library.json', '{"v":1,"entries":[]}'); mem.set('lib-a', 'x');
    mem.set('gr3-preset-cy', '<xmp/>'); mem.set('preset-cy', '<other-family/>'); mem.set('preview.jpg', 'photo');
    const before = mem.get('project.json');
    store.setSoft(true);
    await confirmed(store.newProject());
    const s = store.getState();
    expect(s.ratios).toEqual([]); expect(s.soft).toBe(false); expect(s.extras).toEqual([]);
    expect(local.get('grmod.uiLang')).toBe('zh'); expect(s.lang).toBe('en'); // the camera language changes with the page's reload, not live expect(s.model).toBe('GR3X_HDF'); expect(s.toursSeen).toEqual(['overview']);
    expect(snapIndex().map((e) => e.reason)).toEqual(['new']);
    expect(snapIndex()[0]).toMatchObject({ ratios: 2 });
    // files: this family's preset gone, everything else kept
    expect(stored()).not.toContain('gr3-preset-cy');
    for (const k of ['library.json', 'lib-a', 'preset-cy', 'preview.jpg']) expect(stored()).toContain(k);
    // docs: the other family's work is untouched, this one is empty
    const gr4 = JSON.parse(mem.get('project.json')), gr3 = JSON.parse(mem.get('project-gr3.json'));
    expect(gr4.ratios).toHaveLength(2); expect(gr4.uiLang).toBe('zh');
    expect(gr3.ratios).toEqual([]); expect(gr3.soft).toBe(false);
    expect(before).toBeTruthy();
    // the snapshot brings the old work back
    await store.openSnapshots(); await flush();
    await confirmed(store.restoreSnapshot(snapIndex()[0].id));
    expect(store.getState().ratios).toHaveLength(2); expect(store.getState().soft).toBe(true);
  });
  it('Cancel changes nothing and snapshots nothing', async () => {
    store.setSoft(true);
    await confirmed(store.newProject(), false);
    expect(store.getState().soft).toBe(true);
    expect(snapIndex()).toEqual([]);
  });
});
