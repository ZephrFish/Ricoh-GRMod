// SPDX-License-Identifier: GPL-2.0-only
// @mock-exempt: engine worker, host bridge, pixels and preview are external boundaries (same pattern as gr3x-ui.test.mjs)
// The fork's HLG photo mode exists only in the GR IV programs that carry its code (1.11 and 1.20).
// Upstream 0.8.14 added a 1.21 program generated from a 1.20 without HLG: the engine must not offer
// the feature there, and the UI must not send it (DEC-HLG-121-001 in core/src/app/engine.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Gr4Program111 from '../src/fw';
import * as Gr4Program120 from '../src/fw/gr4v120';
import * as Gr4Program121 from '../src/fw/gr4v121';

const mocks = vi.hoisted(() => ({
  engine: { open: vi.fn(), reset: vi.fn(), build: vi.fn(), ratio: vi.fn(), inspect: vi.fn(), heartbeat: vi.fn() },
  host: { available: false, info: { token: 'test', kind: 'test' }, storeGet: vi.fn(), storeSet: vi.fn(), storeDel: vi.fn(), volumes: vi.fn(), sidecar: vi.fn(), join: (...p) => p.join('/') },
}));
vi.mock('../../ui/src/engine', () => ({ engine: mocks.engine, EngineError: class extends Error {} }));
vi.mock('../../ui/src/host', () => ({ host: mocks.host, HostError: class extends Error {}, sha256Hex: async () => 'test-hash', isAndroid: false, isMobile: false }));
vi.mock('../../ui/src/pixels', () => ({ ensureIconFont: vi.fn() }));
vi.mock('../../ui/src/preview', () => ({ decodePreview: vi.fn() }));

const hasHlg = (program) => typeof program.aspect.installHlgPhoto === 'function';

describe('HLG photo mode per GR IV program', () => {
  it('1.11 and 1.20 carry the HLG code, 1.21 does not', () => {
    expect(hasHlg(Gr4Program111)).toBe(true);
    expect(hasHlg(Gr4Program120)).toBe(true);
    expect(hasHlg(Gr4Program121)).toBe(false);
  });
});

describe('the UI only sends HLG where the open firmware offers it', () => {
  let store;
  beforeEach(async () => { vi.resetModules(); vi.stubGlobal('document', { hidden: true }); store = await import('../../ui/src/store'); });
  const base = { hlgPhoto: true, model: 'HDF' };
  it('is on for a GR IV file whose features include hlgPhoto', () => {
    expect(store.hlgPhotoOn({ ...base, info: { family: 'gr4', features: { hlgPhoto: true } } })).toBe(true);
  });
  it('is off for a 1.21 file (no hlgPhoto feature), even with the switch saved on in the project', () => {
    expect(store.hlgPhotoOn({ ...base, info: { family: 'gr4', features: { hdrGainMap: true } } })).toBe(false);
  });
  it('stays off for the Monochrome and with nothing open', () => {
    expect(store.hlgPhotoOn({ ...base, model: 'MONO', info: { family: 'gr4', features: { hlgPhoto: true } } })).toBe(false);
    expect(store.hlgPhotoOn({ ...base, info: undefined })).toBe(false);
  });
});
