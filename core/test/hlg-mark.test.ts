// SPDX-License-Identifier: GPL-2.0-only
/**
 * The fork's HLG marker in the GR Mod build record (DEC-HLG-MARK-004): bit 6 of the fourth feature byte, beside
 * upstream's framing guides (bit 4, followed by the guides' bytes) and distances in feet (bit 5). Every combination
 * of the three is built on the official 1.20 and 1.21 files and read back, from the record and through inspect:
 * each one is there exactly when it was asked for, so no two share a bit and none is mistaken for another. On 1.11
 * (no framing guides, no feet) HLG is the only bit of its fourth byte, alone and behind a third byte that is zero
 * or not.
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

type Flag = 'hlgPhoto' | 'framing' | 'distanceFeet';
const FLAGS: Flag[] = ['hlgPhoto', 'framing', 'distanceFeet'];
/** Every non-empty combination of the three, alone and together. */
const COMBOS: Flag[][] = Array.from({ length: 7 }, (_, n) => FLAGS.filter((_, i) => ((n + 1) >> i) & 1));

describe.each(files)('HLG, framing guides and feet on GR IV %s', (_release, file) => {
  for (const combo of COMBOS) {
    it(`${combo.join(' + ')}: each reads back exactly when it was built`, async () => {
      const eng = await Engine.open(new Uint8Array(readFileSync(file)));
      expect(eng.info.features).toMatchObject({ hlgPhoto: true, framing: true, distanceFeet: true });
      const on = (f: Flag): boolean => combo.includes(f);
      const g = guides();
      const b = await eng.buildFirmware([], [], [], { ...(on('hlgPhoto') ? { hlgPhoto: true } : {}), ...(on('framing') ? { framing: g } : {}), ...(on('distanceFeet') ? { distanceFeet: true } : {}) });
      expect(Object.values(b.checks).every((v) => v === true)).toBe(true);
      const rec = read120(rtosOf(b.file));
      expect(rec).not.toBeNull();
      expect(!!rec!.hlgPhoto).toBe(on('hlgPhoto'));
      expect(!!rec!.distanceFeet).toBe(on('distanceFeet'));
      if (on('framing')) expect(rec!.framing).toEqual(g); else expect(rec!.framing).toBeUndefined();
      // nothing else of the fourth byte (or the third) is read into the record
      for (const k of ['constantLight', 'sensorShift', 'movie4k', 'movieSr', 'movieExposure', 'hdrGainMap', 'customGrid'] as const) expect(rec![k], k).toBeFalsy();
      const s = await eng.inspect(b.file);
      expect(s.verified).toBe(true);
      expect(!!s.hlgPhoto).toBe(on('hlgPhoto'));
      expect(!!s.distanceFeet).toBe(on('distanceFeet'));
      if (on('framing')) expect(s.framing).toEqual(g); else expect(s.framing).toBeUndefined();
    }, 600_000);
  }
});

describe.skipIf(!existsSync(file111))('HLG on GR IV 1.11: the fourth feature byte', () => {
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
