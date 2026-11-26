// SPDX-License-Identifier: GPL-2.0-only
/**
 * The fork's HLG marker in the GR Mod build record (DEC-HLG-MARK-005): bit 6 of the fifth feature byte, announced by
 * bit 7 of the fourth. Upstream 0.9.4 took bit 6 of the fourth byte for subject recognition and bit 7 for the fifth
 * byte, whose bits 0 to 2 are white balance per look, halation for every look and the lock button's Protect.
 * On the official 1.20 and 1.21 files, HLG is built alone, with each of its neighbours (framing guides, which put
 * their bytes between the fourth and fifth byte; feet; subject recognition; Protect), each neighbour without HLG,
 * and all of them together; then HLG with the two fifth-byte features that need an added slot. Each one is read back,
 * from the record and through inspect, exactly when it was asked for, so no two share a bit and none is mistaken for
 * another. On 1.11 (none of those features) HLG's fourth byte is only the "more" bit, behind a third byte that is
 * zero or not.
 *
 * Needs GRMOD_GR4_120_FIRMWARE, GRMOD_GR4_121_FIRMWARE and testdata/private/official.bin (1.11); each case is
 * skipped when its file is missing.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Engine, fw } from '../src';
import { readExtensionFeatures as read120 } from '../src/fw/gr4v120/aspect/package';
import { readExtensionFeatures as read111 } from '../src/fw/aspect/package';
import { defaultFramingGuides } from '../src/fw/gr4v120/aspect/framing';
import type { FramingGuides } from '../src/fw/gr4v120/aspect/framing';

const files = [['1.20', process.env.GRMOD_GR4_120_FIRMWARE], ['1.21', process.env.GRMOD_GR4_121_FIRMWARE]].filter(([, f]) => !!f && existsSync(f)) as [string, string][];
const file111 = new URL('../testdata/private/official.bin', import.meta.url).pathname;

const rtosOf = (file: Uint8Array): Uint8Array => {
  const d = new fw.Firmware(file).decoded;
  const r = fw.sectionsOf(d).find((x) => x.name === 'RTOS')!;
  return d.subarray(r.offset, r.offset + r.size);
};

/** A guide set that is not the camera's: a red centre cross on the first preset. */
function guides(): FramingGuides {
  const g = defaultFramingGuides();
  g.presets[0].elements = [{ kind: 'centre', mark: 'cross', size: 28, box: 0, colour: 4, width: 2 }];
  return g;
}

type Flag = 'hlgPhoto' | 'framing' | 'distanceFeet' | 'subjectAf' | 'lockProtect';
const NEIGHBOURS: Flag[] = ['framing', 'distanceFeet', 'subjectAf', 'lockProtect'];
/** HLG alone, HLG with each neighbour, each neighbour alone, and everything together. */
const COMBOS: Flag[][] = [['hlgPhoto'], ...NEIGHBOURS.map((n): Flag[] => ['hlgPhoto', n]), ...NEIGHBOURS.map((n): Flag[] => [n]), ['hlgPhoto', ...NEIGHBOURS]];
const curve = Array.from({ length: 256 }, (_, i) => Math.min(16383, Math.round(16383 * Math.pow(i / 255, 0.8))));
const slot = { name: 'HLG mate', matrixQ13: [9100, -600, -308, -300, 8800, -308, -100, -700, 8992], curves: [curve, curve, curve] as [number[], number[], number[]], icon: new Uint8Array(1600 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 13) & 255)) };

describe.each(files)('HLG and its neighbours in the feature bytes on GR IV %s', (_release, file) => {
  for (const combo of COMBOS) {
    it(`${combo.join(' + ')}: each reads back exactly when it was built`, async () => {
      const eng = await Engine.open(new Uint8Array(readFileSync(file)));
      expect(eng.info.features).toMatchObject({ hlgPhoto: true, framing: true, distanceFeet: true, subjectAf: true, lockProtect: true });
      const on = (f: Flag): boolean => combo.includes(f);
      const g = guides();
      const b = await eng.buildFirmware([], [], [], { ...(on('hlgPhoto') ? { hlgPhoto: true } : {}), ...(on('framing') ? { framing: g } : {}), ...(on('distanceFeet') ? { distanceFeet: true } : {}), ...(on('subjectAf') ? { subjectAf: true } : {}), ...(on('lockProtect') ? { lockProtect: true } : {}) });
      expect(Object.values(b.checks).every((v) => v === true)).toBe(true);
      const rec = read120(rtosOf(b.file));
      expect(rec).not.toBeNull();
      for (const f of ['hlgPhoto', 'distanceFeet', 'subjectAf', 'lockProtect'] as const) expect(!!rec![f], f).toBe(on(f));
      if (on('framing')) expect(rec!.framing).toEqual(g); else expect(rec!.framing).toBeUndefined();
      // nothing else of the fourth and fifth bytes (or the third) is read into the record
      for (const k of ['constantLight', 'sensorShift', 'movie4k', 'movieSr', 'movieExposure', 'hdrGainMap', 'customGrid', 'wbPerLook', 'halationAll'] as const) expect(rec![k], k).toBeFalsy();
      const s = await eng.inspect(b.file);
      expect(s.verified).toBe(true);
      for (const f of ['hlgPhoto', 'distanceFeet', 'subjectAf', 'lockProtect'] as const) expect(!!s[f], f).toBe(on(f));
      if (on('framing')) expect(s.framing).toEqual(g); else expect(s.framing).toBeUndefined();
    }, 600_000);
  }
  for (const hlg of [true, false]) {
    it(`${hlg ? 'HLG + ' : ''}white balance per look + halation for every look (an added slot): each reads back exactly when it was built`, async () => {
      const eng = await Engine.open(new Uint8Array(readFileSync(file)));
      const b = await eng.buildFirmware([], [], [], { extraSlots: [slot], wbPerLook: true, halationAll: true, lockProtect: true, ...(hlg ? { hlgPhoto: true } : {}) });
      expect(Object.values(b.checks).every((v) => v === true)).toBe(true);
      const rec = read120(rtosOf(b.file));
      expect(rec!).toMatchObject({ wbPerLook: true, halationAll: true, lockProtect: true });
      expect(!!rec!.hlgPhoto).toBe(hlg);
      expect(rec!.subjectAf).toBeFalsy();
      const s = await eng.inspect(b.file);
      expect(s.verified).toBe(true);
      expect(s).toMatchObject({ wbPerLook: true, halationAll: true, lockProtect: true });
      expect(!!s.hlgPhoto).toBe(hlg);
    }, 600_000);
  }
});

describe.skipIf(!existsSync(file111))('HLG on GR IV 1.11: the fourth and fifth feature bytes', () => {
  it('reads back alone, behind a zero third byte, and behind a third byte with the battery percentage', async () => {
    const eng = await Engine.open(new Uint8Array(readFileSync(file111)));
    expect(eng.info.version).toBe('1.11');
    expect(eng.info.features.hlgPhoto).toBe(true);
    const alone = await eng.buildFirmware([], [], [], { hlgPhoto: true });
    expect(Object.values(alone.checks).every((v) => v === true)).toBe(true);
    expect(read111(rtosOf(alone.file))).toMatchObject({ hlgPhoto: true });
    expect(read111(rtosOf(alone.file))?.batteryPercent).toBeFalsy();
    const withBattery = await eng.buildFirmware([], [], [], { hlgPhoto: true, batteryPercent: true });
    expect(read111(rtosOf(withBattery.file))).toMatchObject({ hlgPhoto: true, batteryPercent: true });
    const batteryOnly = await eng.buildFirmware([], [], [], { batteryPercent: true });
    const r = read111(rtosOf(batteryOnly.file));
    expect(r?.batteryPercent).toBe(true);
    expect(r?.hlgPhoto).toBeFalsy();
    expect((await eng.inspect(withBattery.file)).hlgPhoto).toBe(true);
    expect((await eng.inspect(batteryOnly.file)).hlgPhoto).toBeFalsy();
  }, 600_000);
});
