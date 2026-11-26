# HLG as a third HDR setting: research for the redesign

Read-only research, 2026-11-24. Nothing tracked was edited. Scripts and dumps are in `tmp/hlg-re/`:
`fwre.py` (xrefs, BL callers, disassembly through capstone in `tmp/hlg-re/venv`), `cmpfn.py` (compares a
function between releases with branch offsets masked), `mat.py` / `allmat.py` (matrix checks),
`hook.py` (disassembles the PR's hook block), `extract.test.ts` (pulls RTOS and ICONBIN out of the
official files with core's `Firmware`), and `dumps/*.s`. Run them with `tmp/hlg-re/p VER CMD ...`.

Sources read: the PR (`upstream-pr`, 265036b): `core/src/fw/gr4v120/aspect/hlg.ts`, `core/src/fw/aspect/hlg.ts`,
`docs/HLG_PHOTO.md`. The gain map on `origin/main` (13a66e3): `gr4v120/aspect/hdrgain.ts`,
`gr4v120/aspect/datestamp-menu.ts` (lines 812..1000), `gr4v120/aspect/guard.ts`, `gr4v120/aspect/build.ts`
(lines 1192..1267), `gr4v120/aspect/slots.ts`, `gr4v120/aspect/lookstash.ts`, `gr4v120/profile.ts`,
`core/src/color/camera.ts`, `core/src/color/hue.ts`.

Addresses are 1.20 unless marked. "Found" means read from the official image; "inferred" means it
follows from code but I did not prove it; "unknown" means I could not establish it.

---

## Summary of what I found

1. The gain map is **both** a build option (`features.hdrGainMap`, the app's switch) and a camera menu
   line (`hdrStillLine`, "HDR", after Color Space). The runtime flag is one byte of the user settings,
   `HDR_SWITCH_BYTE = 0x550832A8 + 4 + 0x10A` (offset 0x10E of the settings object), bit 0: 0 On, 1 Off.
   A third value fits without moving anything.
2. The look tables are read in exactly one function, `0x5393A9E0` (I call it the tone selector), through
   four accessors called back to back at `0x5393AF70..0x5393AFA0`. The tables are **two-dimensional**:
   `index = variant * 38 + column`, where the variant (0..2) comes from the ImageTuning project type
   (`0x5394DCC4`). The tone selector is shared by `ImageTuningStill` and `ImageTuningLiveview`. One
   word can substitute the HLG matrix and curve for any look at run time, without touching the tables.
3. The PR's HLG matrix is **already a composition**: it equals `M(709->2020) x M(Standard)` to the
   last unit. Composing with each look's own matrix is exact and fits in Q13. The HLG curve has to
   replace the look's curve, but only 8 of the 9 gamma descriptors carry curves of their own; most
   colour looks share one descriptor that applies none.
4. Three defects in the current PR that the redesign should not inherit:
   - it repoints only variant 0 of each table (`T_xxx_BASE + 22*4`), so on a camera whose project
     type selects variant 1 or 2 the HLG tables are not used, while the APP2 tag still is;
   - on 1.21 its APP2 hook reads the wrong writer field: it picks `[r4,#8]` or `[r4,#0xC]` from bit 9 of
     the caller's return address, which is right on 1.11 and 1.20 and inverted on 1.21;
   - it forces `r0 = 1` on return from `SetupAppNInfo`, so the APP7 overflow error (`r0 = 0`) is lost.
   On 1.20 and 1.21 its `T_MA[22]` repoint is a no-op (the entry already holds that pointer); on 1.11
   it gives HDR Tone Standard's multi-axis record. The two ports therefore behave differently.

---

## 1. How the gain map's on/off reaches the camera

**Build time.** `features.hdrGainMap` (app: `ui/src/store/output.ts:221` sets it; engine
`core/src/app/engine.ts:1171`). In `gr4v120/aspect/build.ts` it installs the module (after the date
imprint and halation), the menu line and the list:

```
1192  const hdrDraw = features.hdrGainMap ? hdrTopDraw(patch, HDR_SWITCH_BYTE) : 0;
1193  const stillLines: StillLine[] = hdrDraw ? [hdrStillLine(hdrDraw)] : [];
1246  if (features.hdrGainMap) installHdrMenu(patch, HDR_SWITCH_BYTE);
1267  installSettingsGuard(..., ...(features.hdrGainMap ? { hdr: true } : {}), ...)
```

So without the build option the camera has neither the gain map nor the line. With it, the camera
menu line switches it at run time. It is both.

**Where the flag lives.** `hdrgain.ts:83`:
`HDR_SWITCH_BYTE = adr(0x550832a8) + 4 + 0x10a` (= 0x550833B6 on 1.20; 0x550832A8 maps to itself on
1.21, `gr4-121-map.json`; 1.11: `0x55084DD8 + 4 + 0x10A`, `fw/aspect/hdrgain.ts:83`). Padding byte
between 0x108 and 0x10C that `UserDataInitValue` never writes, saved with the settings and the user
modes. Every camera has 0 there, so 0 means On.

**Who reads and writes it** (all on `origin/main`):

| Site | What it does with the byte |
|---|---|
| `hdrgain.ts:302..303`, the wrapper of `JpegEncodeMacroProcess::Execute` (0x53727E10) | `ldrb r2,[r2]; tst r2,#1; bne off`: bit 0 set skips the gain map |
| `datestamp-menu.ts:844` `hdrTopDraw` | `tst r3,#1`: menu line icon ON / OFF, title text 1018 "HDR" |
| `datestamp-menu.ts:974` `installHdrMenu` | list of two values: count `mov r0,#2`; draw (OFF icon 329 + text 2, ON icon 330 + text 1); set `eor r3,r1,#1; strb`; current `and #1; eor #1; cmp` |
| `guard.ts:141` | on settings load / save / user-mode recall: `ldrb r2,[r0,#0x10e]; cmp r2,#1; movhi r2,#0; strbhi` (anything above 1 becomes 0, On) |

**A third value.** Keep 0 = Gain map (every camera's current value), 1 = Off, 2 = HLG. What changes:

- gain map wrapper: `tst r2,#1; bne off` becomes `cmp r2,#0; bne off` (value 2 has bit 0 clear, so
  today's test would run the gain map under HLG);
- `hdrTopDraw`: three-way icon choice;
- list: count 3, draw / set / current written for 0..2 (the `eor` trick only works for two values; the
  exposure-preview list `exposure.ts:341..357` is a three-value precedent with its own texts and icon);
- guard: `cmp r2,#2; movhi r2,#0`.

Compatibility: an older GR Mod build that meets value 2 clamps it to 0 in its guard, and its wrapper
(`tst #1`) runs the gain map anyway, so a downgrade falls back to the gain map. Safe.

**Cost in texts and icons.** "Off" is the camera's text 2 and icon 329. "Gain map" needs a new text in
21 languages (or reuse "On", text 1, which reads oddly next to "HLG"). "HLG" needs one new text, the same
string in every language. That is 2 text ids through `widenTextRows` + `installTexts` (as
`EP_TEXT_IDS` 1020/1021 do). Icons: none strictly needed (ON 330 for both Gain map and HLG); one new
40 x 40 icon if HLG should look different on the menu line, as `EP_ICON_ID` 734 was added.

---

## 2. Where the pipeline picks matrix, curve and multi-axis table

**The accessors** (1.20, `dumps/120-tonesel.s` and `fwre.py 120 dis 0x5394df9c`):

```
5394df9c  mov ip,sp ; push {r3,r4,fp,ip,lr,pc} ; sub fp,ip,#4 ; mov r4,r1
5394dfac  bl  0x5394dcc4              ; variant: ImageTuning project type, 0..2
5394dfb0  mov r2,#0x26                ; 38 columns per variant
5394dfb4  movw r3,#0x4800 / movt r3,#0x5505     ; T_REC_BASE
5394dfb8  mla r0,r2,r0,r4             ; variant*38 + column
5394dfc0  ldr r0,[r3,r0,lsl #2]
```

Same shape at `0x5394DFC8` (T_MA, 0x55054554), `0x5394DFF4` (YCbCr records, 0x55053CE4) and
`0x5394E020` (T_GAM, 0x55054158). Each has exactly one caller.

`0x5394DCC4` caches its result in 0x553A299C; it calls 0x5390FB04 and maps the result: 0 or 1 stay,
2/3/5/6 give 1, 4 gives 2; its error path names `src/Utility/ImageTuningCommon.cpp`,
"ImageTuning Unknown Project." and `SystemConfig_GetProjectType`. GR Mod already knows the three
variants (`profile.ts:41 TABLE_VARIANTS = 3`, and `slotInfo` checks they agree). Which variant a
GR IV, a GR IV HDF and a GR IV Monochrome use: **unknown**. In 1.20 the three rows of T_REC and T_MA
are identical; T_GAM differs only in row 2, columns 31 and 32.

**The one caller, the tone selector `0x5393A9E0`.** It reads the frame's style from `[r7,#0x79C]`, maps
it to a column through the byte table 0x5407A53C (0..24 to 0..24, 25..32 to 28..35), handles a few
sub-variants, then on the look path:

```
5393af68  mov r1,sl ; mov r0,r6 ; bl 0x5394df9c ; str r0,[r4,#8]     ; tone record (word 1 = matrix)
5393af78  mov r1,sl ; mov r0,r6 ; bl 0x5394dfc8 ; str r0,[r4,#0xc]   ; multi-axis record
5393af88  mov r1,sl ; mov r0,r6 ; bl 0x5394dff4 ; str r0,[r4,#0x18]  ; YCbCr record
5393af98  mov r1,sl ; mov r0,r6 ; bl 0x5394e020 ; ldr r3,[fp,#-0x34] ; str r0,[r4,#0x14] ; gamma descriptor
```

`r4` is the tuning parameter block the caller passes in r2, `r5` is `this`, `sl` the column. Two
other paths (taken when byte `[r1+0x82B2]` is set) fill `[r4,#8]`, `[r4,#0x14]` from per-variant
tables that ignore the look (`0x5393AB08..` and `0x5393AE90..`); what that flag means is **unknown**.
All three paths join at `0x5393AB78`.

Sub-variants worth knowing (`0x5393AAB8..0x5393AAE8`, `0x5393B1E4`, `0x5393AF1C..`): style 22 (HDR Tone)
uses **column 27** instead of 22 when `[r7,#0x7A9] == 1`; style 20 uses 25/26 by `[r7,#0x7A7]`;
style 32 uses 0x23..0x25 by `[r7,#0x7BA]`. So the PR's `T_xxx[22]` repoint does not cover HDR Tone when
that byte is 1, while its APP2 check (style byte 0x79C == 22) still fires: such a file would be tagged
HLG without being HLG. What setting byte 0x7A9 is: **unknown**.

**Who calls the tone selector.** Three callers, each slot 7 of a vtable whose RTTI names the class:

| Class (typeinfo name) | vtable | slot 7 | call to the tone selector |
|---|---|---|---|
| `11ImageTuning` | 0x5407A590 | 0x5393B26C | 0x5393B4B4 |
| `16ImageTuningStill` | 0x5407AC90 | 0x5393B644 | **0x5393B88C** `bl 0x5393a9e0` (r0 = this, r1 = config, r2 = r4 block) |
| `19ImageTuningLiveview` | 0x5407AD28 | 0x5393BC20 | 0x5393BE74 |

After the call, `ImageTuningStill` hands `r4` to the modules (`0x5393CA08`, `0x5393D0F4`,
`0x53942190`, ...).

**Can one hook substitute HLG for any look, tables untouched? Yes, two ways, one word each:**

- (a) at the Still call site `0x5393B88C`: `bl stub`, where the stub calls `0x5393A9E0` and, when HLG
  is on, overwrites `[r4,#8]` (tone record) and `[r4,#0x14]` (gamma descriptor). Live view keeps SDR
  because it calls the tone selector from 0x5393BE74. It also overrides the two non-look paths.
- (b) at the look path's last accessor call `0x5393AFA0` (`bl 0x5394e020`): `bl stub`; the stub calls
  the accessor, and when HLG is on and `[r5]` (the vptr) is `ImageTuningStill`'s vtable, returns the
  HLG descriptor in r0 and writes the HLG record to `[r4,#8]`. Only the look path changes.

Both compose with the added slots, which relocate the tables by rewriting the accessors' movw/movt
(`slots.ts:386..392`) and hook `0x5393AA94` and `0x53939148`, not these words. Both are keyed on the
record pointer the camera just chose, so variants and sub-variants (column 27) are covered without
knowing which applies.

**1.21 and 1.11.**

| | 1.11 | 1.20 | 1.21 |
|---|---|---|---|
| tone selector | 0x53912C40 | 0x5393A9E0 | 0x5393BFA8 |
| look-path accessor calls (REC, MA, YCbCr, GAM) | 0x53912D48 / D58 / D68 / D78 | 0x5393AF70 / 80 / 90 / A0 | 0x5393C538 / 48 / 58 / 68 |
| accessors | 0x53925F84 / FB0 / FDC / 0x53926008 | 0x5394DF9C / DFC8 / DFF4 / E020 | 0x5394F564 / 590 / 5BC / 5E8 |
| columns per variant | 34 (`mov r2,#0x22`) | 38 | 38 |
| ImageTuningStill vtable, slot 7, call | 0x54043FD8, 0x53913854, 0x53913A9C | 0x5407AC90, 0x5393B644, 0x5393B88C | 0x5407C480, 0x5393CC0C, 0x5393CE54 |
| ImageTuningLiveview slot 7, call | 0x53913E30, 0x53914084 | 0x5393BC20, 0x5393BE74 | 0x5393D1E8, 0x5393D43C |

1.21's tone selector is 1.20's word for word except the two movw/movt of the read-only table 0x5407A53C
(`cmpfn.py 120 121`: 548 words, 2 differ). The Still slot 7 differs only in movw of read-only data that
moved by 0x17F0. 1.11 has the same structure and sub-variant checks (`dumps/111-tonesel.s`). None of
the new addresses is in `gr4-121-map.json` yet; they would go through `addrmap.py` as usual.

---

## 3. The colour question

GR Mod's own model of a slot (`core/src/color/camera.ts`, `hue.ts`): linear signal, slot matrix M1
(Q13, tone record word 1), the hue-sector ("multi-axis") stage, clip, base curve S, the slot's three
curves (gamma descriptor), then the post-curve saturation matrix (tone record word 2). `hue.ts` notes
the multi-axis position "is that method's assumption, not yet checked on a camera".

What the 1.20 tables hold (`allmat.py`): 34 distinct tone records over 3 x 38 entries, 31 distinct
matrices, 9 gamma descriptors, 5 multi-axis records. HDR Tone (column 22) shares Standard's tone record
(0x5501BD58, column 11) and the common gamma descriptor 0x540B4978; its own effect is the HDR Tone
filter, not these tables.

**Matrix: compose, do not replace.** The PR's `HLG_MATRIX` is exactly `M(709->2020) x M(Standard)`:

```
HLG                      [[5546, 2769, -123], [807, 7629, -244], [-9, 1131, 7070]]
M709->2020 x Std(Q13)    [[5546, 2769, -123], [807, 7628, -244], [-9, 1131, 7070]]
Standard 0x5408051c      [[8736, 32, -576], [224, 8288, -320], [-192, 448, 7936]]   (1.11: 0x54049850, same values)
```

(one unit moved to keep the row sum at 8192). So each look can get `M(709->2020) x M_look`, computed at
build time from the patched image (after presets and added slots). Rows keep summing to 8192, so grey
stays grey. The largest coefficient over all factory looks is 13696 in Q13, well inside int16. Fidelity
of this part: exact apart from Q13 rounding, *if* the matrix output is linear Rec.709. The PR assumes
that; I have not proved it.

The catch is the multi-axis stage after it: with the conversion in M1 the hue sectors see Rec.2020
values, so colours fall into different sectors and each sector's matrix acts in the other basis. Two
ways to deal with it:
- keep the look's multi-axis record as it is (cheap; saturated colours near sector boundaries shift a
  little; the size of the error can be computed offline with `hue.ts` before any camera test);
- give each look a conjugated block `C x H_k x C^-1` (C = 709->2020), 2160 bytes per distinct block
  (5 in 1.20): each sector's transform is then right again, the sector boundaries stay where the
  hardware puts them. I have not checked whether the copies-per-sector rule in `hue.ts` survives the
  conjugation.
The PR's "neutral multi-axis" choice is not a colour decision on 1.20/1.21: `T_MA[22]` is already
0x54081348 there, so the repoint does nothing. On 1.11 `T_MA[22]` is 0x5404A690 and the PR sets
Standard's 0x54049DE8.

**Curve: HLG has to replace it.** HLG is a transfer function; a tagged file whose signal is not HLG is
wrong. What a look loses depends on whether it has curves of its own:
- descriptor word 1 byte 4 is 0 for the common descriptor (0x540B4978: `540b4da0 00000000 ...`) that most
  colour looks use, and 1 for the 8 others (CY 0x540B1E98 `00000101`, Hi-Contrast B&W 0x540B55BC,
  Solarized 0x540B4DA8, ...). The PR's descriptor is `[0x540B4DA0, 1, curve, curve, curve]`. I infer
  byte 4 enables the slot curves (the looks with byte 4 = 0 then show S alone); I did not find the
  reader of that byte. Byte 5 is the "through Toning" flag GR Mod already uses (`slots.ts:342`,
  `lookstash.ts:121`).
- For the looks that share the common descriptor, replacing the curve with `HLG o S^-1` loses nothing
  of the look's own: their character is matrix, multi-axis and parameters.
- For the 8 with own curves (Hi-Contrast B&W, Cinema Yellow / Green, the 1.20 effects, presets on CY/CG,
  added slots with curves) there is a choice:
  - replace (the PR): lose their per-channel balance and contrast;
  - compose per channel at build time, `c(x) = HLG( S^-1( L_c(x) ) )`: equals the PR's curve where the
    look's curve is the identity, keeps the look's tonal shape relative to S, and keeps its highlight
    roll-off (so less HLG headroom on those looks). 3 x 512 bytes per such descriptor. Whether the
    Cinema "Toning" path (byte 5 = 1) still works on composed curves is **unknown**.

**Post-curve saturation matrix** (word 2, shared array 0x5501BD34): acts on the HLG signal instead of
the SDR one; the saturation setting still works but not identically. Keep.

**YCbCr record** (0x55053CE4): JPEG decoders undo YCbCr with BT.601 whatever the ICC says, so keep it.

---

## 4. The APP2 condition

What the PR does at the hook (`dumps/pr-hook-block.s`, 176 bytes before the 548-byte APP2 payload):

```
0000  ldr r1,[fp,#-4]          ; caller's return address
0004  tst r1,#0x200            ; bit 9 picks the writer field
0008  ldreq r1,[r4,#8]         ; write
000c  ldrne r1,[r4,#0xc]       ; rewrite
0018  ldr r1,[r1,#8]
0024  ldrb r1,[r1,#0x79c]      ; the frame's style
0028  cmp r1,#0x16 ; bne out
...   APP7 length - 2, APP2 header FF E2 02 40, copy 0x89 words, [r4,#0x50] += 0x240
00a4  out: mov r0,#1           ; forces success
00a8  sub sp,fp,#0x14 ; ldm sp,{r4,r5,fp,sp,pc}
```

`SetupAppNInfo` (1.20 0x53832A98; 1.11 0x5380BE88; 1.21 0x53833960) has two callers:

| | write (uses `[r4,#8]`) return address | rewrite (uses `[r4,#0xC]`) return address | bit 9 right? |
|---|---|---|---|
| 1.11 | 0x5380C044 (bit 9 = 0) | 0x5380C294 (bit 9 = 1) | yes |
| 1.20 | 0x53832C54 (0) | 0x53832EA4 (1) | yes |
| 1.21 | 0x53833B1C (**1**) | 0x53833D6C (**0**) | **no, inverted** |

So on 1.21 a normal write reads `[r4,#0xC]`. What that field holds during a normal write is
**unknown**; if it is null the hook skips and the file has no APP2. The 1.21 camera report ("it
worked", 2026-11-17) does not say whether the APP2 was there. Worth checking one 1.21 HLG file
(`exiftool -icc_profile:all` or look for `FF E2 02 3E` after APP7).

Also: the hook site is the function's epilogue, reached with `r0 = 0` from the APP7 overflow branch
(`0x53832B08 movhs r0,#0; bhs 0x53832b60`); the block always ends with `mov r0,#1`.

**State available at the hook.** `r4` = the ExifJpegWriter (`+0x18` buffer, `+0x48` APP7 offset,
`+0x4C` APP7 length, `+0x50` end of the header, `+8` / `+0xC` the write / rewrite source object, each
with the frame record at `+8`), `r5` = the APPn info (`+0x28` APP7 payload length), `r0` = result, `fp`
frame (caller's lr at `[fp,#-4]`). Any absolute address can be read.

**New condition.** `cmp r0,#0; beq out` first (keep the error), then a flag instead of the style:
- simplest: `HDR_SWITCH_BYTE == 2` at write time. Wrong if the setting changes between development
  and write, and for a rewrite it reflects today's setting, not the file's;
- better: a per-frame word set by the pipeline stub of section 2 (1 when it substituted the HLG
  record and curve for a still, else 0). The tag then follows what the pipeline did. It needs a
  word: every zero-filled word before the heap (0x55839014..0x5583903C) is already taken on
  `origin/main` (hdrgain, lookstash, shutdown, battery, directflash, slots, awb2, and others; `git grep
  "adr(0x558390"`). Candidates: a field of the gain map's heap state (`HDR_STATE_WORD`), or a word of
  the appended area if the image is writable at run time (not checked). Same caveat `lookstash.ts` documents for LOOK_STASH (a look
  changed while a picture is processed).
- rewrite: no flag gives the original file's truth. Options: never inject on rewrite (an HLG file
  rewritten in camera loses its tag), or find where the rewrite source keeps per-file state. What
  the camera rewrites, and when, is **unknown** to me.

The lr-bit test should go in any case.

---

## 5. Reusing the hook site and the landing block

The hook site (`sub sp,fp,#0x14` in the epilogue, 1.20 0x53832B60, 1.21 0x53833A28, 1.11 0x5380BF50) and
the landing block's payload part (APP7 trim, APP2 header, copy loop, `+0x240`) can stay.

Every word the new design changes, relative to the PR:

**Removed (back to the camera's words):**
- `T_REC[22]`, `T_GAM[22]`, `T_MA[22]` repoints (3 words in the RAM image);
- the "HDR" name: text 323 (1.11: 306) in 21 native rows and 21 relocated rows, plus the appended
  string and descriptor;
- HDR Tone level: icon 800 (1.11: 782) in the catalogue, the `LOOKUP_BOUNDS` raise it caused, the
  scale ids at `HDR_SCALE_SHOOTING` and `HDR_SCALE_PLAYBACK`, the four intense tables, the ASCII bls,
  the two formatter mov/b pairs (11 words), and the 96000 bytes of scale pixels in ICONBIN. (The PR's
  doc also claims a patched value count `cmp r0,#4`; the code only checks those two words.)

**Changed:**
- landing block words 0x00..0x2C (11 instructions: lr test, field load, style check) become
  `cmp r0,#0; beq out; movw/movt; ldr; cmp; bne out` (about 7);
- landing block word 0xA4 `mov r0,#1` goes (keep r0);
- the gain map's wrapper test `tst r2,#1` becomes `cmp r2,#0` (one instruction of `hdrgain.ts`);
- `hdrTopDraw`, the HDR list's count / draw / set / current, the guard's clamp (section 1).

**Added:**
- one word at the pipeline site (0x5393B88C or 0x5393AFA0; 1.21 0x5393CE54 or 0x5393C568; 1.11
  0x53913A9C or 0x53912D78) and its stub;
- per-look HLG tone records and composed matrices (34 records x (84 + 20) bytes, about 3.5 KB on
  1.20, plus added slots), a lookup table from the camera's record pointer to the HLG one (pairs of
  words), one HLG gamma descriptor (or one per own-curve descriptor if curves are composed);
- two texts, optionally one icon.

Unknown record pointer (not in the lookup): leave the frame SDR and its flag 0, so no file is tagged
HLG unless both matrix and curve were substituted.

---

## 6. What survives as it is

| Piece | Survives? |
|---|---|
| `HLG_CURVE` (256 x 14-bit, `HLG o S^-1`) | yes, as the curve for looks without own curves. It assumes S is the same in 1.11 and 1.20/1.21 (the PR uses one curve for all three; not checked here) |
| gamma descriptor `[GAMMA_DESC_WORD0, 1, c, c, c]` | yes; `GAMMA_DESC_WORD0` is the common descriptor's word 0 in every release (1.11 0x5407DEF4, 1.20 0x540B4DA0, 1.21 0x540B6590) |
| `HLG_MATRIX` | as the Standard case only; generalised to `M(709->2020) x M_look` |
| ToneRecord copy (`STD_REC_VA` + word 1) | the idea yes, the source no: copy each look's own record. On 1.20 `STD_REC_VA` 0x5501C118 is column 0, not Standard (0x5501BD58); harmless today because the records differ only in word 1 |
| `STD_MA_DESC_VA` | no (no-op on 1.20/1.21, different meaning on 1.11) |
| ICC profile (532 bytes, CICP 9/18/0/1), `ICC_PROFILE\0\x01\x01` header, 2-byte pad, copy loop, APP7 trim | yes |
| hook site | yes |
| landing block | payload and its second half yes; the condition (11 words) and the final `mov r0,#1` no |
| 1.21 map entries | `HOOK_SITE` (0x53833A28), `GAMMA_DESC_WORD0`, `RAM_SRC` (0x543B4900), T tables (same place): yes. `HDR_SCALE_*`, `HDR_INTENSE_*`, `HDR_FORMATTER*`, `TEXT_CATALOG`/`NATIVE_TEXT_ROOTS` use for 323, `STD_REC_VA`, `STD_MA_DESC_VA`: no longer needed. New entries: the pipeline site and its stub's targets, the ImageTuningStill vtable |
| package feature bit (DEC-HLG-MARK-002) | yes, as the build marker |

---

## Recommended design

Common to every option: one HDR line, `Off / Gain map / HLG` (0 Gain map, 1 Off, 2 HLG); HDR Tone keeps
its tables, name, icon and levels; the APP2 hook keyed on a per-frame flag, keeping `r0`; no lr test.

**Option A: per-look composition, look path only (recommended).**
Hook `0x5393AFA0` (look path, last accessor). When the setting is 2 and `this` is an
`ImageTuningStill`: swap `[r4,#8]` for the look's composed record (`M709->2020 x M_look`) and the
descriptor for HLG; keep the look's multi-axis record; set the frame flag. Looks with own curves get
`HLG o S^-1` (replace) in a first version.
Trade-offs: the look's colour survives in the matrix and multi-axis stage; per-look curves are lost for
8 descriptors; the non-look paths (`[r1+0x82B2]` set) stay SDR, untagged. About 4 KB of data.

**Option B: as A, plus composed curves and conjugated multi-axis blocks.**
Own-curve descriptors get `HLG o S^-1 o L_c`; multi-axis blocks get `C x H_k x C^-1`.
Trade-offs: closest to the look, but both pieces are colour-science choices the hardware does not
dictate, and need camera comparisons per look; about 23 KB more data (5 blocks x 2160 bytes, 8 descriptors x 3 x 512 bytes); the Toning path of CY/CG is an
open question.

**Option C: one HLG rendering for every look (simplest).**
At the Still call site `0x5393B88C`, swap in the PR's Standard-based record and curve whatever the look.
Trade-offs: least code and data (the PR's data as it is), but every look renders as Standard under HLG,
which drops the look's colour, the reason looks exist. Only worth it as a first camera test of the
runtime switch.

## Questions only the maintainer can decide

1. Is HLG a camera menu value (Off / Gain map / HLG, chosen per shot) or a build option that changes
   what "On" means? And does HLG need the gain map's build option, or can a build carry HLG alone?
2. Which value is the default for a camera that has never seen HLG: keep 0 = Gain map (no change for
   current users), as assumed above?
3. Look colour under HLG: A, B or C. In particular, may looks with their own curves lose them?
4. Text for the gain map value ("Gain map", or reuse "On"), and whether HLG gets its own icon.
5. Rewrite: drop the tag on files the camera rewrites, or spend RE time on per-file state?
6. Should live view preview HLG (it would look flat on the LCD) or stay SDR, as both A and C do?
7. Whether to fix the PR's variant-0-only repoint and 1.21 lr test upstream before the redesign lands,
   given the PR is open and camera-tested on 1.21.

## What must be tested on a camera

1. On a GR IV, a GR IV HDF and a GR IV Monochrome: the variant each uses (dump 0x553A299C, or check
   that HLG renders on each).
2. A 1.21 file from the current PR: is the APP2 ICC there? (Confirms or refutes the lr-bit finding.)
3. The three-value menu: line icon, list, value kept over power cycles and user modes, downgrade to a
   build without HLG.
4. HLG on, every factory look plus one preset slot and one added slot: matrix and curve swapped
   (picture is HLG), APP2 present; HLG off and Gain map: unchanged gain map files; Off: camera's file.
5. Live view stays SDR under HLG; playback of an HLG JPEG and its thumbnails on the camera.
6. HDR Tone with whatever sets byte 0x7A9 to 1 (column 27): still swapped under the new design.
7. RAW + JPEG, burst, and changing the setting while a burst is processed (flag per frame).
8. In-camera RAW development with HLG on and off; and a rewrite of an HLG JPEG (does it keep the tag).
9. A large APP7 (long maker note) to see the overflow path returns failure, not a broken file.
10. Combined builds: added slots, halation, date imprint (they hook the same pipeline function and the
    JPEG step).
