// SPDX-License-Identifier: GPL-2.0-only
/**
 * HLG photos (BT.2100 HLG, tagged for Apple, Windows, Android and Chromium) as the third value of the
 * HDR setting: Gain map / Off / HLG (GR IV 1.20, and 1.21 through its address table). The idea, the
 * HLG curve and the ICC profile are cqkking's (GR Mod PR #53); this is the redesign the maintainer asked
 * for: no look is taken over.
 *
 * What it does, while the HDR setting (`HDR_SWITCH_BYTE`, `hdrgain.ts`) is 2 = HLG:
 *  1. Stills only. ImageTuningStill's slot 7 (0x5393B644) calls the tone selector 0x5393A9E0, which
 *     fills the tuning block (r2) with the pointers the development step then uses: [+8] the look's
 *     tone record (word 1: its colour matrix), [+0xC] its multi-axis record, [+0x14] its gamma
 *     descriptor, [+0x18] its YCbCr record. The call is replaced by `bl stub`. The stub runs the tone
 *     selector, then, when the setting is HLG and the record the camera chose is one of the look
 *     records this module knows, swaps [+8] for that look's HLG record and [+0x14] for the HLG gamma
 *     descriptor. The look's multi-axis record, its YCbCr record, its saturation matrix (word 2 of
 *     the record) and its parameters are not touched; live view (ImageTuningLiveview calls the same
 *     tone selector from another place) is not touched either.
 *  2. The HLG record of a look is a copy of the look's own record whose matrix (word 1) is
 *     M(Rec.709 to Rec.2020) times the look's own matrix, in Q13, computed here at build time from the
 *     tables as the build leaves them (presets, added slots). So the look keeps its colour; the
 *     HLG curve replaces its curve. Looks with curves of their own (Hi-Contrast B&W, Cinema Yellow and
 *     Green, presets on them, added slots with curves) lose those curves under HLG.
 *  3. A record the camera chose that is not in the table (the two paths of the tone selector that
 *     ignore the look) stays as the camera made it, and the frame is not tagged.
 *  4. The stub keeps the answer in HLG_FLAG, one byte: 1 when it swapped, else 0. The JPEG writer's hook
 *     (ExifJpegWriter::SetupAppNInfo's epilogue) adds the APP2 ICC profile when the flag is 1.
 *
 * @decision DEC-HLG-REDESIGN-001: HLG is the third value of the gain map's HDR menu byte (0 Gain map, 1 Off,
 *   2 HLG) and a build with HLG always carries the gain map's code too (`installHdrGainMap`), so the one HDR
 *   line has the three values. HLG is therefore a build option of its own (`hlgPhoto`), exclusive with
 *   `hdrGainMap` (it already includes it). Without HLG every word of the gain map's build is what it was:
 *   the 2-value list and the `tst #1` test are only replaced in HLG builds.
 * @decision DEC-HLG-REDESIGN-002: HDR Tone is not touched (no repoint of T_REC / T_GAM / T_MA, no rename, no
 *   levels): the substitution is made in a stub at the Still call site, keyed on the record pointer the
 *   camera has just chosen, so every variant (0..2) and sub-variant (HDR Tone's column 27) is covered
 *   without knowing which applies.
 * @decision DEC-HLG-REDESIGN-003: the flag (HLG_FLAG) is a byte of the sbrk arena at 0x55839046, between Movie
 *   4K's latch (0x55839045) and Sensor Shift's state (0x55839048). `battery.ts` documents that nothing in the
 *   firmware refers to the 64 bytes from 0x55839040 and that the start-up zero fill is extended over them
 *   (`extendBatteryZeroFill`, which an HLG build now also asks for), so the byte starts at 0; the other
 *   additions' bytes there (battery 0x40, Movie SR 0x44, Movie 4K 0x45) are bytes too. The appended area
 *   was the other candidate; whether the image is writable at run time could not be established, so it
 *   is not used. The flag holds the last still developed, as LOOK_STASH does (`lookstash.ts`): a setting
 *   changed while a burst is processed can tag a picture the other way.
 * @decision DEC-HLG-REDESIGN-004: the APP2 hook tags only a file the camera writes the first time. The two
 *   callers of SetupAppNInfo are told apart by their return address (WRITE_RETURN, written for each
 *   release through `adr`, found by tools/port/addrmap.py), which is right on 1.20 and 1.21; the earlier
 *   test of bit 9 of the return address happened to be inverted on 1.21. A rewritten file is never tagged
 *   (nothing says whether the file being rewritten was HLG). The hook keeps r0 (the APP7 overflow error
 *   reaches the caller), and skips when the header would not fit the writer's buffer (its length is
 *   [writer + 0x1C]: the camera fills the buffer with 0xFF at the start of the write, 0x5382BC18).
 * @decision DEC-HLG-REDESIGN-005: the composed matrices are rounded to Q13 and the rows keep the sum of the
 *   exact product's row (so a look whose rows sum to 8192 stays neutral), the difference going to the
 *   largest coefficient. A coefficient that does not fit an int16 refuses the build.
 */
import { FirmwareError } from '../../types';
import { assembleWords, branchWord, movImmediate } from './arm';
import { Patch, concat, expectWord, u32le } from './build';
import { HDR_SWITCH_BYTE } from './hdrgain';
import { HLG_CURVE_B64, HLG_ICC_B64 } from './hlg-data';
import { adr } from '../target';

function fail(code: string, message: string): never {
  throw new FirmwareError(code, message);
}

/** The value of the HDR setting that means HLG (0 Gain map, 1 Off). */
export const HLG_VALUE = 2;
/** One byte of the sbrk arena (0x55839040..0x55839080): 1 while the last still developed is HLG. */
export const HLG_FLAG = adr(0x55839046);

/** ImageTuningStill's call of the tone selector, and the tone selector. */
export const PIPELINE_SITE = adr(0x5393b88c);
export const TONE_SELECTOR = adr(0x5393a9e0);
/** ExifJpegWriter::SetupAppNInfo's epilogue (`sub sp, fp, #0x14`) and the return address of its write call. */
export const HOOK_SITE = adr(0x53832b60);
export const WRITE_RETURN = adr(0x53832c54);
/** The tone record table's accessor (variant * stride + column): `mov r2,#stride`, `movw r3`, `movt r3`. */
const REC_STRIDE_SITE = adr(0x5394dfb0);
const REC_LOW_SITE = adr(0x5394dfb4);
const REC_HIGH_SITE = adr(0x5394dfbc);
const VARIANTS = 3;
const RECORD_BYTES = 0x54;
const MATRIX_BYTES = 18;
/** The common gamma descriptor's first word (1.11 0x5407DEF4, 1.20 0x540B4DA0). */
const GAMMA_DESC_WORD0 = adr(0x540b4da0);
/** The APP2 segment the hook writes: marker, length 0x240 as the camera counts (marker included), then this. */
const APP2_EXTENT = 0x240;
const APP2_WORDS = 0x89;

const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const HLG_CURVE = unb64(HLG_CURVE_B64);
export const HLG_ICC = unb64(HLG_ICC_B64);
/** 14 bytes of header, the 532-byte profile and two bytes of padding: 137 words. */
export const HLG_APP2_DATA = concat([Uint8Array.from('ICC_PROFILE\0\x01\x01', (c) => c.charCodeAt(0)), HLG_ICC, new Uint8Array(2)]);

/** BT.2087 conversion of linear Rec.709 to linear Rec.2020. */
export const M_709_TO_2020: readonly (readonly number[])[] = [
  [0.6274039, 0.329283, 0.0433131],
  [0.0690973, 0.9195404, 0.0113623],
  [0.0163914, 0.0880133, 0.8955953],
];

/**
 * `M(709 to 2020)` times a look's matrix (nine int16 in Q13, row-major, the rows being the outputs), in
 * Q13. The rows keep the sum of the exact product's row, rounded (the difference goes to the largest
 * coefficient). Throws when a coefficient does not fit an int16.
 */
export function composeLookMatrix(m: ArrayLike<number>): number[] {
  if (m.length !== 9) fail('internal', 'HLG: a matrix has nine coefficients');
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const exact = [0, 1, 2].map((j) => M_709_TO_2020[i][0] * m[j] + M_709_TO_2020[i][1] * m[3 + j] + M_709_TO_2020[i][2] * m[6 + j]);
    const row = exact.map((v) => Math.round(v));
    const delta = Math.round(exact[0] + exact[1] + exact[2]) - (row[0] + row[1] + row[2]);
    if (delta !== 0) row[row.reduce((best, v, j) => (Math.abs(v) > Math.abs(row[best]) ? j : best), 0)] += delta;
    for (const v of row) if (!(v >= -32768 && v <= 32767)) fail('bad-edit', 'HLG: a look’s colour matrix does not fit once converted to Rec.2020');
    out.push(...row);
  }
  return out;
}

const int16s = (b: Uint8Array): number[] => Array.from(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
const int16Bytes = (v: readonly number[]): Uint8Array => new Uint8Array(Int16Array.from(v).buffer);

/** The tone record table as the build leaves it: its address and the number of entries per variant. */
export function toneRecordTable(patch: Patch): { base: number; stride: number } {
  const stride = patch.word(REC_STRIDE_SITE);
  if ((stride & 0xffffff00) >>> 0 !== 0xe3a02000 >>> 0) fail('unexpected-layout', 'HLG: the tone record accessor is not as expected');
  const low = patch.word(REC_LOW_SITE);
  const high = patch.word(REC_HIGH_SITE);
  if ((low & 0xfff0f000) >>> 0 !== 0xe3003000 >>> 0 || (high & 0xfff0f000) >>> 0 !== 0xe3403000 >>> 0) fail('unexpected-layout', 'HLG: the tone record accessor is not as expected');
  return { base: ((movImmediate(high) << 16) | movImmediate(low)) >>> 0, stride: stride & 0xff };
}

export interface HlgLook {
  /** The camera's tone record. */
  record: number;
  /** Its colour matrix before and after the composition. */
  matrix: number[];
  composed: number[];
}

/** Every distinct tone record in the table (all variants), with its matrix and the composed one. */
export function readLooks(patch: Patch): HlgLook[] {
  const { base, stride } = toneRecordTable(patch);
  const seen = new Set<number>();
  const looks: HlgLook[] = [];
  const table = new DataView(patch.readMapped(base, VARIANTS * stride * 4).buffer);
  for (let i = 0; i < VARIANTS * stride; i++) {
    const record = table.getUint32(i * 4, true);
    if (seen.has(record)) continue;
    seen.add(record);
    const word1 = new DataView(patch.readMapped(record + 4, 4).buffer).getUint32(0, true);
    const matrix = int16s(patch.readMapped(word1, MATRIX_BYTES));
    looks.push({ record, matrix, composed: composeLookMatrix(matrix) });
  }
  return looks;
}

/**
 * Install the HLG still pipeline and the APP2 hook. Last of the additions that change the look tables
 * (added slots, presets are in the image already). Returns what was appended, for the tests.
 */
export function installHlgPhoto(patch: Patch): { pairs: number; stub: number; hook: number; descriptor: number; table: number } {
  expectWord(patch, PIPELINE_SITE, branchWord(PIPELINE_SITE, TONE_SELECTOR, 14, true));
  expectWord(patch, HOOK_SITE, 0xe24bd014); // sub sp, fp, #0x14
  expectWord(patch, HOOK_SITE + 4, 0xe89da830); // ldm sp, {r4, r5, fp, sp, pc}
  expectWord(patch, TONE_SELECTOR, 0xe1a0c00d); // mov ip, sp
  expectWord(patch, WRITE_RETURN - 4, branchWord(WRITE_RETURN - 4, adr(0x53832a98), 14, true)); // bl SetupAppNInfo
  expectWord(patch, adr(0x53832a98), 0xe1a0c00d);

  const looks = readLooks(patch);
  const curve = patch.append(HLG_CURVE, 256);
  const descriptor = patch.append(u32le([GAMMA_DESC_WORD0, 1, curve, curve, curve]), 4);
  // One matrix per distinct composed matrix, one record per camera record.
  const matrices = new Map<string, number>();
  const pairs: number[] = [];
  for (const look of looks) {
    const key = look.composed.join(',');
    let at = matrices.get(key);
    if (at === undefined) {
      at = patch.append(int16Bytes(look.composed), 4);
      matrices.set(key, at);
    }
    const copy = new Uint8Array(patch.readMapped(look.record, RECORD_BYTES));
    new DataView(copy.buffer).setUint32(4, at, true);
    pairs.push(look.record, patch.append(copy, 4));
  }
  const table = patch.append(u32le([...pairs, 0, 0]), 4);

  const lo = (v: number): number => v & 0xffff;
  const hi = (v: number): number => v >>> 16;
  const stub = patch.append((at) => assembleWords(
    `push {r0, r4, r5, lr}
     mov r4, r2
     bl #${TONE_SELECTOR}
     movw r5, #${lo(HLG_FLAG)}; movt r5, #${hi(HLG_FLAG)}
     mov r3, #0; strb r3, [r5]
     movw r2, #${lo(HDR_SWITCH_BYTE)}; movt r2, #${hi(HDR_SWITCH_BYTE)}
     ldrb r2, [r2]; cmp r2, #${HLG_VALUE}; bne done
     ldr r0, [r4, #8]
     movw r1, #${lo(table)}; movt r1, #${hi(table)}
     find: ldr r2, [r1]; cmp r2, #0; beq done
     cmp r2, r0; addne r1, r1, #8; bne find
     ldr r2, [r1, #4]; str r2, [r4, #8]
     movw r2, #${lo(descriptor)}; movt r2, #${hi(descriptor)}; str r2, [r4, #0x14]
     mov r3, #1; strb r3, [r5]
     done: pop {r0, r4, r5, pc}`, at), 16);
  patch.setWord(PIPELINE_SITE, branchWord(PIPELINE_SITE, stub, 14, true), 'HLG photo: still tone selector, HLG record and curve');

  const app2 = patch.append(HLG_APP2_DATA, 4);
  // r0 (the result of SetupAppNInfo) stays as it is; r5 is the copy's destination (the epilogue restores it).
  const hook = patch.append((at) => assembleWords(
    `cmp r0, #0; beq out
     movw r1, #${lo(HLG_FLAG)}; movt r1, #${hi(HLG_FLAG)}; ldrb r1, [r1]; cmp r1, #1; bne out
     ldr r1, [fp, #-4]; movw r2, #${lo(WRITE_RETURN)}; movt r2, #${hi(WRITE_RETURN)}; cmp r1, r2; bne out
     ldr r2, [r4, #0x50]; add r2, r2, #${APP2_EXTENT}; ldr r3, [r4, #0x1c]; cmp r2, r3; bhi out
     ldr r2, [r4, #0x18]; ldr r3, [r4, #0x48]; add r3, r2, r3
     ldr r1, [r4, #0x4c]; sub r1, r1, #2; str r1, [r4, #0x4c]
     mov ip, r1, lsr #8; strb ip, [r3, #2]; strb r1, [r3, #3]
     ldr r1, [r4, #0x50]; add r3, r2, r1
     mov r1, #0xff; strb r1, [r3]; mov r1, #0xe2; strb r1, [r3, #1]
     mov r1, #${APP2_EXTENT >> 8}; strb r1, [r3, #2]; mov r1, #${APP2_EXTENT & 255}; strb r1, [r3, #3]
     movw r1, #${lo(app2)}; movt r1, #${hi(app2)}
     add r5, r3, #4; mov r2, #${APP2_WORDS}
     copy: ldr ip, [r1]; add r1, r1, #4; str ip, [r5]; add r5, r5, #4; subs r2, r2, #1; bne copy
     ldr r1, [r4, #0x50]; add r1, r1, #${APP2_EXTENT}; str r1, [r4, #0x50]
     out: sub sp, fp, #0x14
     ldm sp, {r4, r5, fp, sp, pc}`, at), 16);
  patch.setWord(HOOK_SITE, branchWord(HOOK_SITE, hook), 'HLG photo: APP2 ICC profile (CICP HLG) for a still the pipeline made HLG');
  if (HLG_APP2_DATA.length !== APP2_WORDS * 4) fail('internal', 'HLG: APP2 data length');
  return { pairs: pairs.length / 2, stub, hook, descriptor, table };
}

/** Whether a build has the HLG photo mode (its hook is in place of the camera's epilogue). */
export function hlgPhotoInstalled(patch: Patch): boolean {
  return patch.word(PIPELINE_SITE) !== branchWord(PIPELINE_SITE, TONE_SELECTOR, 14, true);
}
