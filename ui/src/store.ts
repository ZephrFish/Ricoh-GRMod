import { useSyncExternalStore } from 'react';
import { FACTORY_LOOK_IDS, card, color, GR3X_FILM_IDS, GR3X_MAX_CUSTOM_RATIOS, GR3X_T4_CUSTOM, LANGS, MAX_CUSTOM_RATIOS, EXTRA_NAME_MAX, MAX_EXTRA_SLOTS, SHUTDOWN_MAX_PICTURES, SHUTDOWN_NAME_MAX, validateExtraSlotName, validateGr3xRatioName, validateRatioName, validateShutdownName } from '@grmod/core';
import type { CameraModel, ClarityChange, ExtraSlotSpec, FirmwareInfo, FirmwareSummary, LangCode, LookLayout, PresetResult, RatioPreview, RatioSpec, ShutdownPictureSpec, SlotId, SlotRequest, SoftFocusRequest, SoftFocusStrength } from '@grmod/core';
import { engine, EngineError } from './engine';
import { host, HostError, isMobile, sha256Hex } from './host';
import { upload } from './host-android';
import type { ParkedEntry, Volume } from './host';
import { setUiLangPref, t, uiLangPref } from './i18n';
import type { Key } from './i18n';
import { cropToRgb, defaultCrop, ensureIconFont, imageIcon, loadBitmap, textIcon, workingCopy } from './pixels';
import type { Crop } from './pixels';
import { decodePreview } from './preview';
import defaultPhotoUrl from './assets/preview.jpg';

export type Page = 'ic' | 'ratio' | 'wall' | 'copies';
/** One added aspect ratio as typed; `preview` is what the camera would make of it (absent while that is worked out). */
export interface RatioItem { id: string; ratio: string; name: string; preview?: RatioPreview }
export interface PresetState { fileName: string; kind: 'xmp' | 'cube'; text: string; busy: boolean; result?: PresetResult; error?: string }
export interface IconState { mode: 'keep' | 'text' | 'image'; text: string; style: 'film' | 'plain'; image?: string; pixels?: Uint8Array }
/** `halation`: Cinema Yellow / Green with a preset (0.8.2); their Toning becomes the Halation slider. */
export interface SlotState { preset?: PresetState; names: Partial<Record<LangCode, string>>; icon: IconState; halation?: HalationState }
/**
 * An added Image Control slot (style 34, 35, ... in the camera): `key` is `x-` and a random id;
 * `name` as typed (empty: the default name of its place), one name for every language.
 */
/** A slot's halation (the fixed CineStill 800T look): on (always for an added slot), and which level the preview shows (0 = off, 1 Weak, 2 Medium, 3 Strong). */
export interface HalationState { on: boolean; preview: 0 | 1 | 2 | 3; /** Colour the preview shows (chosen in the camera). */ colour?: 'red' | 'white' }
export interface ExtraSlot { key: string; name: string; preset?: PresetState; icon: IconState; halation?: HalationState }
/** A factory Cinema slot (`CY`, `CG`) or the key of an added slot. */
export type SlotKey = SlotId | string;
/**
 * A power-off image. They are built into the firmware and chosen in the camera's End Screen menu
 * (Setup > Display > End Screen > Picture): `menuName` is the name in the camera's list, `menuId`
 * its stable identity, `menuJpeg` the picture file. (GR Mod 0.7 and earlier could also put them on
 * the card with a start-up script; 0.8 only builds them into the firmware.)
 */
export interface WallItem {
  id: string; name: string; blob?: Blob; width: number; height: number; crop: Crop;
  busy: boolean; error?: string; preview?: Uint8Array;
  menuName?: string; menuId?: number; menuJpeg?: Uint8Array;
}
export interface Toast { id: number; text: string; kind: 'ok' | 'error' | 'info'; action?: { label: string; run: () => void } }
export type PreviewMode = 'photo' | 'swatch';
/** What the frame of an added ratio is drawn on. */
export type RatioBackdrop = 'photo' | 'gray';
/** Where the copies page looks: files moved aside on the selected card, or their backups on this computer. */
export type CopySource = 'card' | 'pc';
export interface CopyInfo { busy?: boolean; summary?: FirmwareSummary; failed?: boolean }
/** What went into a firmware this program built, so that a copy of it can be named later. */
export interface BuildRecord { sha256: string; time: number; slots: { id: SlotId; preset?: string }[] }
/** `warn` is an optional caution shown under the lines (used where something is deleted for good). */
/** A guided tour: `overview` is the one of the first start, the others belong to a page. */
export type TourId = 'overview' | Page;
export const TOUR_IDS: readonly TourId[] = ['overview', 'ic', 'ratio', 'wall', 'copies'];
/** The tour being shown: `steps` are the indices of its steps that have something to point at; a replay can be skipped. */
export interface TourState { id: TourId; steps: number[]; index: number; replay: boolean }
/** `reset`: the firmware written is the official one; the dialog asks in red whether the camera's settings were reset first. */
export interface Confirm { title: string; warn?: string; reset?: boolean; lines: string[]; ok: string; resolve: (v: boolean) => void }
/** A firmware file being inspected: `error` is `needs-open` (no official firmware to compare with), `unreadable` (not a file the engine can read) or `size`. */
export interface InspectView { name: string; size: number; busy: boolean; summary?: FirmwareSummary; error?: 'needs-open' | 'unreadable' | 'size';
  /** QoL D1: a second file compared with the first (absent in plain single-file inspect). */
  other?: { name: string; size: number; busy: boolean; summary?: FirmwareSummary; error?: 'unreadable' | 'size' } }
export interface State {
  ready: boolean; page: Page;
  fwName?: string; fwBusy: boolean; info?: FirmwareInfo; raw?: Uint8Array;
  model: CameraModel; lang: LangCode;
  /** The camera language follows the system's (lang is then systemCameraLang()): the app language is "follow system". */
  langAuto: boolean;
  slots: Record<SlotId, SlotState>;
  wall: WallItem[];
  ratios: RatioItem[]; activeRatio?: string; ratioBackdrop: RatioBackdrop;
  /** GR IV rear-LCD Auto curve, off by default. */
  brightAuto: false | 'bright' | 'balanced';
  /** GR IV import fitting; off by default. */
  additiveHue: boolean;
  /** GR IV import fitting; off by default. */
  keepWhite: boolean;
  soft: boolean; dateStamp: boolean; monoUnlock: boolean; hlgPhoto: boolean;
  /** GR IV: Direct Flash, a fifth Flash Mode (GR III / IIIx have the GF-2 mode of their own). */
  directFlash: boolean;
  /** An HDR gain map in the JPEGs (switched in the camera: Shooting menu › HDR). */
  hdr: boolean;
  /** GR IV 1.20: exposure preview as a camera setting (Shooting › Exposure Settings, ADJ lever). */
  exposurePreview: boolean;
  /** ADJ lever slots in the build: 5 (the camera's) to 8 (GR IV). */
  adjSlots: number;
  /** GR IV, experimental: .cube presets of added slots get hue sectors of their own (core color/hue.ts). */
  /** GR III / IIIx: how many films the build has (1..info.features.maxFilms). */
  filmCount: number;
  previewMode: PreviewMode; photoRev: number; activeSlot: SlotKey;
  /** QoL wave C. Preset library entries of both cameras (loaded on first use, see loadLibrary). */
  library: LibraryEntry[];
  /** QoL wave C. What the left side of the photo preview shows: `orig` (the photo as it is, the default) or another slot's key. View state, saved with previewMode. */
  compareWith: string;
  /** The library dialog: which slot it works on and whether it saves that slot's preset or applies an entry to it. */
  libraryPicker?: { slot: SlotKey; mode: 'save' | 'apply' };
  /** Added Image Control slots, in the camera's order (none by default). */
  extras: ExtraSlot[];
  /** Image Control menu order (`f11`..`f30`, or an added slot's key) and hidden keys. Empty = factory order, nothing hidden. */
  lookOrder: string[];
  lookHidden: string[];
  /** GR III / IIIx (round 8): its order (`g11`..`g22`, films `g64`..) and hidden keys, kept apart from GR IV's. */
  lookOrder3: string[];
  lookHidden3: string[];
  volumes: Volume[]; showAll: boolean; volumeId?: string; role?: card.CardRole;
  copySource: CopySource; parked: ParkedEntry[]; backups: ParkedEntry[]; copySel: string[]; copyInfo: Record<string, CopyInfo>; builds: BuildRecord[];
  busy?: string; toasts: Toast[]; confirm?: Confirm; cropId?: string; onlineOpen: boolean;
  /** Why the download dialog is open, when it says so: a 1.12 bridge firmware file is open. */
  onlineReason?: 'bridge-loaded';
  tour?: TourState; toursSeen: TourId[];
  /** QoL wave B: the "Inspect a firmware file" dialog (open while set). */
  inspectView?: InspectView;
  /** QoL D1: the "Restore an earlier version" dialog (open while set). */
  snapshotsView?: { entries: SnapshotEntry[]; busy: boolean };
  /** Android: a firmware file on its way to the camera over Wi-Fi (camera.tsx shows the dialog while it is set). */
  push?: { file: Uint8Array; label: string; stock: boolean };
}

const SLOT_IDS: readonly SlotId[] = GR3X_FILM_IDS;
/** GR IIIx 1.60 and GR III 2.10: one program, one code path in GR Mod. */
export const isGr3 = (m?: CameraModel): boolean => m === 'GR3X_HDF' || m === 'GR3_HDF' || m === 'GR3X' || m === 'GR3';
/** The film count can be chosen (GR III / IIIx: 1..20, each film with Halation in the camera). */
export const filmCountChoosable = (s: State = state): boolean => s.info?.family === 'gr3x' && (s.info.features.maxFilms ?? 9) > 9;
/** The slots of the open firmware the page shows: on GR III / IIIx the first `filmCount`. */
export const shownSlots = (s: State = state): FirmwareInfo['slots'] => (s.info ? (filmCountChoosable(s) ? s.info.slots.slice(0, s.filmCount) : s.info.slots) : []);
const availableSlots = (s: State = state): SlotId[] => s.info ? shownSlots(s).map(slot => slot.id) : (isGr3(s.model) ? [...GR3X_FILM_IDS] : ['CY', 'CG']);
const emptySlot = (): SlotState => ({ names: {}, icon: { mode: 'keep', text: '', style: 'film' } });
const emptySlots = (): Record<SlotId, SlotState> => Object.fromEntries(SLOT_IDS.map(id => [id, emptySlot()])) as Record<SlotId, SlotState>;
let state: State = {
  ready: false, page: 'ic', fwBusy: false, model: 'HDF', lang: cameraLang(), langAuto: uiLangPref() === '',
  slots: emptySlots(), extras: [], lookOrder: [], lookHidden: [], lookOrder3: [], lookHidden3: [], wall: [], ratios: [], ratioBackdrop: 'photo', brightAuto: false, additiveHue: false, keepWhite: false, soft: false, dateStamp: false, monoUnlock: false, hlgPhoto: false, directFlash: false, hdr: false, exposurePreview: false, adjSlots: 5, filmCount: 0, previewMode: 'photo', photoRev: 0, activeSlot: 'CY', library: [], compareWith: 'orig', volumes: [],
  copySource: 'card', parked: [], backups: [], copySel: [], copyInfo: {}, builds: [], showAll: false, toasts: [], onlineOpen: false, toursSeen: [],
};
const listeners = new Set<() => void>();
function set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export const getState = (): State => state;
/**
 * @decision DEC-UI-STORE-001
 * @title useStore refuses an unstable selector outside production builds
 * @status accepted
 * @rationale useSyncExternalStore compares successive snapshots with Object.is; a selector that builds a new array or object per call (filter, map, sort, a literal)
 *   never settles and React throws error #185, which blanked the whole app once (libraryFor in LibraryDialog). Select stable fields and derive with useMemo. In dev and
 *   test, calling the selector twice on the same state and comparing makes that mistake fail loudly at its source. The same snapshot is the server snapshot, so renderToString works.
 */
export function useStore<T>(sel: (s: State) => T): T {
  const snap = (): T => {
    const a = sel(state);
    if (!import.meta.env.PROD && !Object.is(a, sel(state))) throw new Error('useStore: the selector returns a new array/object on every call, so the snapshot never settles (React error #185). Select stable fields and derive the value with useMemo.');
    return a;
  };
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, snap, snap);
}
function setSlot(id: SlotId, patch: Partial<SlotState> | ((s: SlotState) => Partial<SlotState>)): void {
  set((s) => ({ slots: { ...s.slots, [id]: { ...s.slots[id], ...(typeof patch === 'function' ? patch(s.slots[id]) : patch) } } }));
}
const isExtra = (k: SlotKey): boolean => k.startsWith('x-');
/** The preset and icon of a factory or an added slot. */
export function slotOf(k: SlotKey, s: State = state): { preset?: PresetState; icon: IconState } | undefined {
  return isExtra(k) ? s.extras.find((x) => x.key === k) : s.slots[k as SlotId];
}
function patchSlot(k: SlotKey, patch: { preset?: PresetState; icon?: IconState } | ((s: { preset?: PresetState; icon: IconState }) => { preset?: PresetState; icon?: IconState })): void {
  if (!isExtra(k)) { setSlot(k as SlotId, patch as Partial<SlotState>); return; }
  set((s) => ({ extras: s.extras.map((x) => (x.key === k ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)) }));
}
function setWall(id: string, patch: Partial<WallItem>): void {
  set((s) => ({ wall: s.wall.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
}

// ------------------------------------------------------------------ toasts / confirm
let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): number {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind, action }] }));
  setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : action ? 12000 : 4500);
  return id;
}
export function dismissToast(id: number): void { set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })); }
function ask(title: string, lines: string[], ok: string, warn?: string, reset = false): Promise<boolean> {
  return new Promise((resolve) => set({ confirm: { title, warn, lines, ok, resolve, ...(reset ? { reset } : {}) } }));
}
/**
 * The warning for a firmware made from (or being) one of the cameras' newer releases (GR IV 1.20 / 1.21,
 * GR III 2.20 / 2.21, GR IIIx 1.70 / 1.71): a camera that installs it cannot go back to an earlier release.
 */
function newFirmwareWarning(info: FirmwareInfo | undefined): string | null {
  if (!info) return null;
  const newer = info.family === 'gr4' ? ['1.20', '1.21'] : ['2.20', '1.70', '2.21', '1.71'];
  return newer.includes(info.version) ? t('newFwWriteLine') : null;
}
/**
 * Before the official firmware goes back on the camera: settings made with GR Mod's firmware (an
 * added slot or ratio selected, soft focus on the ADJ lever, the date imprint, added slots'
 * parameters) are values the official firmware does not know and may freeze on. The dialog says so
 * in red and its button confirms that the camera was reset to factory defaults.
 */
function askOfficial(lines: string[], warn?: string): Promise<boolean> {
  return ask(t('resetConfirmTitle'), lines, t('resetConfirmOk'), warn, true);
}
export function answerConfirm(v: boolean): void { const c = state.confirm; set({ confirm: undefined }); c?.resolve(v); }
/** Exported for the tests. A code with a plain-language hint (errorHint) shows the hint and the short code; others show code and message. */
export function fail(e: unknown): void {
  const code = e instanceof HostError || e instanceof EngineError ? e.code : '';
  const msg = e instanceof Error ? e.message : String(e);
  console.error(e);
  const hint = code ? errorHint(code, msg) : undefined;
  if (hint) { toast(`${t('error')} · ${t(hint)} (${code})`.slice(0, 220), 'error'); return; }
  toast(`${t('error')}${code ? ` · ${code}` : ''}${msg && msg !== code ? ` · ${msg}` : ''}`.slice(0, 220), 'error');
}

// ------------------------------------------------------------------ QoL wave B: undo for deletes
/**
 * @decision DEC-QOLB-UNDO-001
 * @title One last-deleted record; host files are deleted only when the undo window closes
 * @status accepted
 * @rationale Removing an added slot, a ratio or a picture used to be final at once. The delete now
 *   leaves one record (a new delete replaces it) and a toast with an Undo button. Everything the
 *   item needs to come back is already in memory (preset text, icon, blob, preview), so the only
 *   thing deferred is the removal of its host store files (`preset-<key>`, `wall-<id>`): `commit`
 *   runs when the toast's window ends, or when another delete replaces the record. Deleting the files at once and re-writing them on undo would work too, but a
 *   crash in between would then lose the preset for good; an orphaned file after a crash only costs a few kB.
 */
interface Deleted { family: Family; restore: () => boolean; commit: () => void; timer: ReturnType<typeof setTimeout>; toastId: number }
let lastDeleted: Deleted | undefined;
const UNDO_MS = 12000;
/** Whether a delete can still be taken back. */
export const undoPending = (): boolean => !!lastDeleted;
/** Close the undo window: the deferred file delete runs and the record's own toast goes. */
function flushDeleted(): void { const d = lastDeleted; lastDeleted = undefined; if (d) { clearTimeout(d.timer); dismissToast(d.toastId); d.commit(); } }
/**
 * `restore` puts the item back and returns false (changing nothing) when it cannot: the list is full again
 * (delete one, add one, undo would exceed the cap). The toast's button is bound to this record, not to
 * "whatever is pending now": a superseded toast is dismissed with its record, and a press that still gets through says so.
 */
function recordDeleted(text: string, restore: () => boolean, commit: () => void): void {
  flushDeleted();
  const d: Deleted = { family: familyOf(state.model), restore, commit, timer: setTimeout(() => { if (lastDeleted === d) flushDeleted(); }, UNDO_MS), toastId: 0 };
  lastDeleted = d;
  d.toastId = toast(text, 'info', { label: t('undo'), run: () => { if (lastDeleted === d) undoDelete(); else toast(t('undoGone'), 'info'); } });
}
/** Take the last delete back (the toast's button and Cmd/Ctrl+Z). */
export function undoDelete(): void {
  const d = lastDeleted; if (!d) return;
  lastDeleted = undefined; clearTimeout(d.timer); dismissToast(d.toastId);
  // Compared by camera family, not model: HDF to Standard keeps the same slots, ratios and pictures. Another family has other lists.
  if (d.family !== familyOf(state.model)) { d.commit(); return; }
  if (!d.restore()) { d.commit(); toast(t('undoFull'), 'info'); return; }
  scheduleSave();
}

// ------------------------------------------------------------------ QoL wave B: inspect any firmware file
/**
 * @decision DEC-QOLB-INSPECT-001
 * @title Inspect compares with the open official firmware, so it needs one open
 * @status accepted
 * @rationale engine.inspect (core app/engine.ts) diffs a file against the official firmware the
 *   engine has open and reports kind / verified / features; the summary carries no model or version
 *   of its own. The dialog therefore names the open firmware (family and version) as the reference
 *   and asks for one when none is open, instead of guessing a model from the bytes.
 */
let inspectGen = 0;
export function closeInspect(): void { inspectGen++; set({ inspectView: undefined }); }
export async function inspectFile(file: File): Promise<void> {
  const gen = ++inspectGen;
  const view = { name: file.name, size: file.size };
  if (!state.info) { set({ inspectView: { ...view, busy: false, error: 'needs-open' } }); return; }
  if (file.size < 1_000_000 || file.size > 200_000_000) { set({ inspectView: { ...view, busy: false, error: 'size' } }); return; }
  set({ inspectView: { ...view, busy: true } });
  try {
    const summary = await engine.inspect(new Uint8Array(await file.arrayBuffer()));
    if (gen === inspectGen) set({ inspectView: { ...view, busy: false, summary } });
  } catch (e) {
    console.warn('inspect', e);
    if (gen === inspectGen) set({ inspectView: { ...view, busy: false, error: 'unreadable' } });
  }
}

// ------------------------------------------------------------------ QoL wave B: keyboard shortcuts
/**
 * @decision DEC-QOLB-KEYS-001
 * @title One global handler in the store; it yields to anything that already owns the key
 * @status accepted
 * @rationale Cmd/Ctrl+E (export to a folder, through the build summary), Cmd/Ctrl+Z (undo the last
 *   delete, only while one is pending) and the arrow keys (Left/Right through the Image Control
 *   slots, whose tabs are horizontal; Up/Down through the ratios, a vertical list). The handler is a
 *   plain function of the key event so it can be tested without a DOM, and app.tsx only installs it
 *   on window. It does nothing while the focus is in a field (the browser's own text undo and
 *   caret keys win), while a dialog, the crop editor, the guided tour or a busy overlay is up,
 *   with Alt held, or when a widget already handled the key (`defaultPrevented`: the tab lists,
 *   the compare slider, select menus). Escape is never touched: the dialogs keep their own handlers.
 */
export interface ShortcutKey {
  key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean;
  target?: unknown; preventDefault?: () => void;
}
const typing = (target: unknown): boolean => {
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null;
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName ?? '') || !!el.isContentEditable || !!el.closest?.('[contenteditable="true"],[role="listbox"],[role="menu"],[role="slider"]');
};
/** The slot keys the Image Control page shows as tabs, in order. */
export function slotTabKeys(s: State = state): SlotKey[] {
  return s.info?.family === 'gr3x' ? shownSlots(s).map((x) => x.id) : ['CY', 'CG', ...s.extras.map((x) => x.key)];
}
/** Whether something modal is up (a dialog of the store, the crop editor, the tour, the busy overlay, or any open dialog or menu element: focus stays on a menu's toggle, outside the menu). */
const modalUp = (s: State): boolean =>
  !!(s.confirm || s.inspectView || s.snapshotsView || s.cropId || s.onlineOpen || s.tour || s.busy)
  || (typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]'));
/** Handle a key press; returns whether it was taken. */
export function handleShortcut(e: ShortcutKey): boolean {
  if (e.defaultPrevented || e.altKey || typing(e.target) || modalUp(state)) return false;
  const take = (): true => { e.preventDefault?.(); return true; };
  const mod = !!(e.metaKey || e.ctrlKey), key = e.key.toLowerCase();
  if (mod && !e.shiftKey && key === 'z') { if (!undoPending()) return false; undoDelete(); return take(); }
  if (mod && !e.shiftKey && key === 'e') {
    if (state.page === 'copies' || !state.info) return false;
    if (bridgeLoaded()) askForOfficial(); else void outputFirmware({ kind: 'folder' });
    return take();
  }
  if (mod || e.shiftKey) return false;
  if (state.page === 'ic' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const keys = slotTabKeys(); const at = Math.max(0, keys.indexOf(state.activeSlot));
    const next = keys[Math.max(0, Math.min(keys.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (next === undefined) return false;
    setActiveSlot(next); return take();
  }
  if (state.page === 'ratio' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.ratios.length) {
    const ids = state.ratios.map((r) => r.id); const at = Math.max(0, ids.indexOf(state.activeRatio ?? ''));
    setActiveRatio(ids[Math.max(0, Math.min(ids.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]); return take();
  }
  return false;
}
/** The modifier key's name for hints: Cmd on a Mac, Ctrl elsewhere. */
export const modKeyName = (): string => (typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl');

// ------------------------------------------------------------------ camera families
/**
 * GR IV and GR III / IIIx keep their own work: Image Control slots or films with their presets,
 * added slots, the menu order, pictures, ratios and switches. GR IV's is `project.json` as it
 * always was (older versions of GR Mod read it unchanged; the settings of the program itself are
 * there too); GR III / IIIx's is `project-gr3.json`, its presets `gr3-preset-…` (its films reuse
 * the ids CY and CG). Switching to the other camera keeps this one's work and brings back that one's.
 */
type Family = 'gr4' | 'gr3';
const familyOf = (m: CameraModel): Family => (isGr3(m) ? 'gr3' : 'gr4');
const GR3_PROJECT = 'project-gr3.json';
/** The official file each camera takes (GR IV, GR III, GR IIIx: one file for all of each one's models),
 * kept once downloaded or opened: switching to another camera opens its file again without a download. */
type FwGroup = 'gr4' | 'gr3' | 'gr3x';
const fwGroupOf = (m: CameraModel): FwGroup => (m === 'GR3' || m === 'GR3_HDF' ? 'gr3' : m === 'GR3X' || m === 'GR3X_HDF' ? 'gr3x' : 'gr4');
const fwKey = (g: FwGroup): string => `firmware-${g}.bin`;
/** Up to 0.8.x one file was kept for whichever camera was open. */
const LEGACY_FW_KEY = 'firmware.bin';
const LEGACY_FW_GROUP: Record<string, FwGroup> = { 'fwdc248b.bin': 'gr4', 'fwdc239b.bin': 'gr3', 'fwdc243b.bin': 'gr3x' };
const LEGACY_FW_GROUP_NAME: Record<FwGroup, string> = { gr4: 'fwdc248b.bin', gr3: 'fwdc239b.bin', gr3x: 'fwdc243b.bin' };
/** The kept file of a camera, or null. A file kept by 0.8.x moves to its camera's place first. */
async function keptFirmware(g: FwGroup, legacyName?: string): Promise<Uint8Array | null> {
  const own = await host.storeGet(fwKey(g)).catch(() => null);
  if (own) return own;
  const legacy = await host.storeGet(LEGACY_FW_KEY).catch(() => null);
  if (!legacy) return null;
  // Its camera: by the name it was opened with, else by its size (the two GR III files differ in size, GR IV's is larger).
  const lg = (legacyName ? LEGACY_FW_GROUP[legacyName.toLowerCase()] : undefined) ?? (legacy.length === 30391780 ? 'gr3' : legacy.length === 30391788 ? 'gr3x' : 'gr4');
  // The old file is removed only once it is kept in its new place (else it is moved next time).
  if (await host.storeSet(fwKey(lg), legacy).then(() => true, () => false)) await host.storeDel(LEGACY_FW_KEY).catch(() => undefined);
  return lg === g ? legacy : null;
}
const presetKey = (id: SlotKey, fam: Family = familyOf(state.model)): string => (fam === 'gr3' ? 'gr3-preset-' : 'preset-') + id.toLowerCase();
type FamilyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Each family's saved work as last loaded or saved; the open family's is taken from the state when saved. */
const familyDocs: Record<Family, FamilyDoc | null> = { gr4: null, gr3: null };
/** GR III work found in `project.json` itself (a data folder of the GR III test builds): its presets are `preset-…`. */
let gr3Legacy = false;
/** Changes whenever the open family changes: work still being loaded for the previous one is dropped. */
let familyGen = 0;
/** True while the open family's files are being read: a save meanwhile writes its work as loaded. */
let familyLoading = false;

function familyData(s: State): FamilyDoc {
  return {
    slots: Object.fromEntries(SLOT_IDS.map((id) => [id, {
      preset: s.slots[id].preset ? { fileName: s.slots[id].preset!.fileName, kind: s.slots[id].preset!.kind } : null,
      names: s.slots[id].names,
      icon: { mode: s.slots[id].icon.mode, text: s.slots[id].icon.text, style: s.slots[id].icon.style, image: s.slots[id].icon.image },
      ...(s.slots[id].halation ? { halation: s.slots[id].halation } : {}),
    }])),
    extras: s.extras.map((x) => ({ key: x.key, name: x.name, preset: x.preset ? { fileName: x.preset.fileName, kind: x.preset.kind } : null, icon: { mode: x.icon.mode, text: x.icon.text, style: x.icon.style, image: x.icon.image }, ...(x.halation ? { halation: x.halation } : {}) })),
    lookOrder: s.lookOrder, lookHidden: s.lookHidden, lookOrder3: s.lookOrder3, lookHidden3: s.lookHidden3,
    wall: s.wall.map((w) => ({ id: w.id, name: w.name, kind: 'image', width: w.width, height: w.height, crop: w.crop, ...(w.menuName !== undefined ? { menuName: w.menuName } : {}), ...(w.menuId ? { menuId: w.menuId } : {}) })),
    ratios: s.ratios.map((r) => ({ id: r.id, ratio: r.ratio, name: r.name })),
    brightAuto: s.brightAuto, additiveHue: s.additiveHue, keepWhite: s.keepWhite, soft: s.soft, dateStamp: s.dateStamp, monoUnlock: s.monoUnlock, hlgPhoto: s.hlgPhoto, directFlash: s.directFlash, hdr: s.hdr, exposurePreview: s.exposurePreview, adjSlots: s.adjSlots, filmCount: s.filmCount,
  };
}

/** The part of a family's saved work that needs no file: everything but presets and pictures. */
function parseFamily(doc: FamilyDoc | null): Partial<State> {
  const slots = emptySlots();
  for (const id of SLOT_IDS) {
    const d = doc?.slots?.[id];
    if (!d) continue;
    slots[id].names = d.names || {};
    if (d.icon) slots[id].icon = { mode: d.icon.mode || 'keep', text: d.icon.text || '', style: d.icon.style || 'film', image: d.icon.image };
    // GR III projects up to 0.8.0-gr3exp.9 kept the film's level as a number (1 Weak, 2 Strong).
    const h = validHalation(d.halation === 1 || d.halation === 2 ? { on: true, preview: d.halation === 2 ? 3 : 1 } : d.halation);
    if (h) slots[id].halation = h;
  }
  const extras: ExtraSlot[] = (Array.isArray(doc?.extras) ? doc!.extras : []).slice(0, MAX_EXTRA_SLOTS)
    .filter((x: ExtraSlot) => x && typeof x.key === 'string' && /^x-[a-z0-9]{1,12}$/.test(x.key))
    .map((x: ExtraSlot) => ({ key: x.key, name: String(x.name || '').slice(0, 40), icon: { mode: x.icon?.mode === 'image' ? 'image' : 'text', text: String(x.icon?.text ?? ''), style: x.icon?.style === 'plain' ? 'plain' : 'film', image: x.icon?.image }, ...(validHalation(x.halation) ? { halation: validHalation(x.halation)! } : {}) }));
  const ratios: RatioItem[] = (Array.isArray(doc?.ratios) ? doc!.ratios : []).slice(0, MAX_CUSTOM_RATIOS)
    .filter((r: RatioItem) => r && typeof r.id === 'string' && typeof r.ratio === 'string')
    .map((r: RatioItem) => ({ id: r.id, ratio: r.ratio.slice(0, 24), name: String(r.name || '').slice(0, 80) }));
  return {
    slots, extras, activeSlot: 'CY', wall: [], ratios, activeRatio: ratios[0]?.id,
    lookOrder: normalizeLookOrder(Array.isArray(doc?.lookOrder) ? doc!.lookOrder : [], extras),
    lookHidden: normalizeLookHidden(Array.isArray(doc?.lookHidden) ? doc!.lookHidden : [], extras),
    lookOrder3: gr3SavedKeys(doc?.lookOrder3), lookHidden3: gr3SavedKeys(doc?.lookHidden3).filter((k) => k !== 'g11'),
    brightAuto: doc?.brightAuto === 'balanced' ? 'balanced' : doc?.brightAuto === true || doc?.brightAuto === 'bright' ? 'bright' : false,
    additiveHue: doc?.additiveHue === true,
    keepWhite: doc?.keepWhite === true,
    soft: doc?.soft === true || (!!doc?.softFocus && typeof doc.softFocus === 'object' && Object.keys(doc.softFocus).length > 0),
    dateStamp: doc?.dateStamp === true, monoUnlock: doc?.monoUnlock === true, hlgPhoto: doc?.hlgPhoto === true && doc?.hdr !== true, directFlash: doc?.directFlash === true, hdr: doc?.hdr === true, exposurePreview: doc?.exposurePreview === true, adjSlots: typeof doc?.adjSlots === 'number' && Number.isInteger(doc.adjSlots) && doc.adjSlots >= 5 && doc.adjSlots <= 8 ? doc.adjSlots : 5,
    filmCount: Number.isInteger(doc?.filmCount) && doc!.filmCount >= 0 && doc!.filmCount <= GR3X_FILM_IDS.length ? doc!.filmCount : doc && doc.filmCount === undefined && doc.slots ? 9 : 0,
  };
}

/** The presets and pictures of a family's saved work (read from their files), unless the family changes meanwhile. */
async function loadFamilyFiles(doc: FamilyDoc | null, fam: Family, gen: number): Promise<void> {
  if (!doc || !host.available) return;
  const read = async (key: string): Promise<Uint8Array | null> => {
    const bytes = await host.storeGet(key).catch(() => null);
    // A GR III project kept in project.json: its presets are still under GR IV's names; moved once.
    if (!bytes && fam === 'gr3' && gr3Legacy && key.startsWith('gr3-preset-')) {
      const old = await host.storeGet(key.slice(4)).catch(() => null);
      if (old) await host.storeSet(key, old).catch(() => undefined);
      return old;
    }
    return bytes;
  };
  for (const id of SLOT_IDS) {
    const p = doc.slots?.[id]?.preset;
    if (!p) continue;
    const text = await read(presetKey(id, fam));
    if (gen !== familyGen) return;
    if (text) void runPreset(id, p.fileName, p.kind, new TextDecoder().decode(text));
  }
  for (const x of state.extras) {
    const p = (Array.isArray(doc.extras) ? doc.extras as { key: string; preset?: { fileName: string; kind: 'xmp' | 'cube' } | null }[] : []).find((d) => d.key === x.key)?.preset;
    if (!p) continue;
    const text = await read(presetKey(x.key, fam));
    if (gen !== familyGen) return;
    if (text) void runPreset(x.key, p.fileName, p.kind === 'xmp' ? 'xmp' : 'cube', new TextDecoder().decode(text));
  }
  const wall: WallItem[] = [];
  for (const w of doc.wall || []) {
    // the factory image of the start-up script's rotation (GR Mod 0.7) is in the camera's menu anyway
    if (w.kind === 'factory' || wall.length >= SHUTDOWN_MAX_PICTURES) continue;
    const bytes = await host.storeGet('wall-' + w.id).catch(() => null);
    if (gen !== familyGen) return;
    const menu = { menuName: typeof w.menuName === 'string' ? String(w.menuName).slice(0, 40) : menuNameOf(String(w.name || '')), menuId: validMenuId(w.menuId) ? w.menuId : newMenuId(wall) };
    if (bytes) wall.push({ id: w.id, name: w.name, blob: new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }), width: w.width, height: w.height, crop: w.crop, busy: true, ...menu });
  }
  set({ wall });
  for (const w of wall) void encodeWall(w.id);
}

/** The open family's work to save: the state, but presets and pictures still being read as they were saved. */
function currentFamilyDoc(): FamilyDoc {
  const data = familyData(state), doc = familyDocs[familyOf(state.model)];
  if (!familyLoading || !doc) return data;
  for (const id of SLOT_IDS) if (!data.slots[id].preset && doc.slots?.[id]?.preset) data.slots[id].preset = doc.slots[id].preset;
  for (const x of data.extras) if (!x.preset) x.preset = (Array.isArray(doc.extras) ? doc.extras : []).find((d: { key: string }) => d.key === x.key)?.preset ?? null;
  data.wall = Array.isArray(doc.wall) ? doc.wall : [];
  return data;
}
/** Before the open camera changes family: its work is kept (and saved with the next save). */
function leaveFamily(): void {
  familyDocs[familyOf(state.model)] = currentFamilyDoc();
  familyLoading = false;
  ++familyGen;
}
/** The work of the family now open: what needs no file at once, presets and pictures as they are read. */
function enterFamily(fam: Family): void {
  const gen = familyGen, doc = familyDocs[fam];
  set(parseFamily(doc));
  for (const id of allSlotKeys()) void renderIcon(id);
  if (!doc || !host.available) return;
  familyLoading = true;
  void loadFamilyFiles(doc, fam, gen).finally(() => {
    if (gen !== familyGen) return;
    familyLoading = false;
    scheduleSave();
  });
}

// ------------------------------------------------------------------ persistence
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  if (!host.available || !state.ready || importingProject) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveProject(); }, 400);
}
async function saveProject(): Promise<void> {
  const s = state;
  familyDocs[familyOf(s.model)] = currentFamilyDoc();
  const doc = {
    ...(familyDocs.gr4 ?? {}),
    v: 1, page: s.page, model: s.model, lang: s.lang, langAuto: s.langAuto, uiLang: uiLangPref(), fwName: s.fwName, showAll: s.showAll, previewMode: s.previewMode, ratioBackdrop: s.ratioBackdrop,
    tours: s.toursSeen, toursV: 2,
    compareWith: s.compareWith,
  };
  try {
    await host.storeSet('project.json', JSON.stringify(doc));
    if (familyDocs.gr3) await host.storeSet(GR3_PROJECT, JSON.stringify({ v: 1, ...familyDocs.gr3 }));
    saveFailing = false;
  } catch (e) {
    console.warn('save failed', e);
    // One toast per failure streak: saves are debounced and a full disk would otherwise toast on every edit.
    if (!saveFailing) { saveFailing = true; toast(t('saveFailed'), 'error'); }
  }
}
/** True from the first failed save until the next successful one. */
let saveFailing = false;
/**
 * The project documents (project.json as `doc`, project-gr3.json as `gr3Doc` or null) become the
 * state, then the open camera's kept firmware, presets and pictures are read. Shared by init() and
 * by importing a project, so that old project files keep working through one path.
 */
async function restoreProject(doc: FamilyDoc, gr3Doc: FamilyDoc | null): Promise<void> {
  familyDocs.gr4 = null; familyDocs.gr3 = null; gr3Legacy = false;
  const model: CameraModel = ['GR3', 'GR3_HDF', 'GR3X', 'GR3X_HDF', 'HDF', 'STANDARD', 'MONO'].includes(doc.model) ? doc.model : 'HDF';
  if (gr3Doc && gr3Doc.v === 1) { familyDocs.gr4 = doc; familyDocs.gr3 = gr3Doc; }
  else if (familyOf(model) === 'gr3') { familyDocs.gr3 = doc; gr3Legacy = true; } // a GR III project of the test builds
  else familyDocs.gr4 = doc;
  const fam = familyOf(model), work = familyDocs[fam];
  set({ ...parseFamily(work), model,
    page: doc.page === 'wall' || doc.page === 'copies' || doc.page === 'ratio' || doc.page === 'ic' ? doc.page : doc.page === 'script' ? 'wall' : 'ic',
    ...langOf(doc), fwName: doc.fwName, showAll: !!doc.showAll,
    previewMode: doc.previewMode === 'swatch' ? 'swatch' : 'photo', ratioBackdrop: doc.ratioBackdrop === 'gray' ? 'gray' : 'photo',
    compareWith: typeof doc.compareWith === 'string' && doc.compareWith ? doc.compareWith : 'orig',
    // GR Mod 0.8 changed the power-off page: its tour (which now says where the pictures are chosen) shows once more
    toursSeen: TOUR_IDS.filter((id) => Array.isArray(doc.tours) && doc.tours.includes(id) && (id !== 'wall' || doc.toursV >= 2)) });
  // The kept file of the camera that was open (a 0.8.x data folder: its one file moves to its camera's place).
  const fwRaw = await keptFirmware(fwGroupOf(model), doc.fwName);
  if (fwRaw) await openFirmware(fwRaw, LEGACY_FW_GROUP_NAME[fwGroupOf(model)], false);
  await loadFamilyFiles(work, fam, familyGen);
}
export async function init(): Promise<void> {
  if (!host.available) { set({ ready: true }); return; }
  if (!isMobile) void engine.heartbeat(host.info!.token);
  void ensureIconFont();
  void loadPreviewPhoto();
  void loadBuilds();
  try {
    const raw = await host.storeGet('project.json');
    const doc = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
    if (doc && doc.v === 1) {
      const gr3Raw = await host.storeGet(GR3_PROJECT).catch(() => null);
      await restoreProject(doc, gr3Raw ? JSON.parse(new TextDecoder().decode(gr3Raw)) : null);
    } else {
      const fwRaw = await keptFirmware(fwGroupOf(state.model));
      if (fwRaw) await openFirmware(fwRaw, LEGACY_FW_GROUP_NAME[fwGroupOf(state.model)], false);
    }
  } catch (e) { console.warn('restore failed', e); }
  set({ ready: true });
  // A GR III project found in project.json goes to its own file at once.
  if (gr3Legacy) scheduleSave();
  if (!isMobile) {
    void refreshVolumes();
    setInterval(() => { if (!document.hidden && !state.busy) void refreshVolumes(); }, 2500);
  }
  for (const id of allSlotKeys()) void renderIcon(id);
}

// ------------------------------------------------------------------ guided tours
export function startTour(id: TourId, steps: number[], replay: boolean): void {
  if (state.tour || steps.length === 0) return;
  set({ tour: { id, steps, index: 0, replay } });
}
/** One step on or back; going on from the last step ends the tour. */
export function tourStep(delta: 1 | -1): void {
  const tr = state.tour;
  if (!tr) return;
  const index = tr.index + delta;
  if (index < 0) return;
  if (index >= tr.steps.length) { endTour(); return; }
  set({ tour: { ...tr, index } });
}
/** Forget which tours were seen (and stop the one running): they start by themselves again. */
export function resetTours(): void { set({ tour: undefined, toursSeen: [] }); scheduleSave(); }
/** "Skip all guides": the running guide and every other one count as seen (Guides › Start all guides again undoes it). */
export function skipAllTours(): void { set({ tour: undefined, toursSeen: [...TOUR_IDS] }); scheduleSave(); }
/** Finished or skipped: either way it is not started by itself again. */
export function endTour(): void {
  const tr = state.tour;
  if (!tr) return;
  set((s) => ({ tour: undefined, toursSeen: s.toursSeen.includes(tr.id) ? s.toursSeen : [...s.toursSeen, tr.id] }));
  scheduleSave();
}

// ------------------------------------------------------------------ settings
export function setPage(page: Page): void {
  if (page === 'wall' && isGr3(state.model) && state.info && !state.info.capabilities.menuPictures) return; // power-off pictures: GR III / IIIx with the End Screen menu
  set({ page }); scheduleSave(); if (page === 'copies') void refreshCopies();
}
/**
 * The camera language (whose names Image Control changes) follows the app language: 简体中文 → zh-CN, English → en,
 * following the system → the system's language where the camera has it (else English).
 */
export function cameraLang(): LangCode {
  const ui = uiLangPref();
  return ui === 'zh' ? 'zh-CN' as LangCode : ui === 'en' ? 'en' as LangCode : systemCameraLang();
}
/** The camera language closest to the phone's own: its first language GR IV has, else English. */
export function systemCameraLang(): LangCode {
  const have = LANGS as readonly string[];
  for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const l = raw.toLowerCase();
    if (l.startsWith('zh')) return (/-(tw|hk|mo)|hant/.test(l) ? 'zh-TW' : 'zh-CN') as LangCode;
    const base = l.split('-')[0];
    if (have.includes(base)) return base as LangCode;
  }
  return 'en' as LangCode;
}
/** The app language (and with it the camera language): kept, the work saved with it, then the page reloads in it. */
export async function setAppLanguage(v: '' | 'zh' | 'en'): Promise<void> {
  if (v === uiLangPref()) return;
  setUiLangPref(v, false); // not reloaded here: the work is saved first
  try { sessionStorage.setItem('grmod.uiLangAdopted', v); } catch { /* none */ }
  clearTimeout(saveTimer);
  if (host.available && state.ready) await saveProject();
  if (typeof window !== 'undefined') window.setTimeout(() => window.location.reload(), 60);
}
function langOf(doc: { uiLang?: string }): { lang: LangCode; langAuto: boolean } {
  // The app language is kept by the page (localStorage) and in the saved work: the desktop page's storage goes with
  // its port, so a saved choice the page has lost is taken back (once: the page reloads in it).
  const saved = doc.uiLang === 'zh' || doc.uiLang === 'en' ? doc.uiLang : doc.uiLang === '' || doc.uiLang === 'auto' ? '' : undefined; // 'auto' is what the fork's earlier live switch saved
  if (saved !== undefined && saved !== uiLangPref()) {
    let reloadOnce = false;
    try { reloadOnce = sessionStorage.getItem('grmod.uiLangAdopted') !== saved; sessionStorage.setItem('grmod.uiLangAdopted', saved); } catch { /* no storage: no reload */ }
    if (reloadOnce) setUiLangPref(saved);
  }
  return { lang: cameraLang(), langAuto: uiLangPref() === '' };
}
export function setModel(model: CameraModel): void {
  if (state.busy || state.fwBusy || model === state.model) return;
  const differentFamily = familyOf(state.model) !== familyOf(model);
  ++ratioGen;
  clearTimeout(ratioTimer);
  if (differentFamily) leaveFamily();
  const otherFile = !!state.info && !state.info.models.includes(model);
  if (otherFile) {
    void engine.reset();
    set({ info: undefined, raw: undefined, fwName: undefined,
      copyInfo: {}, copySel: [], ratios: state.ratios.map(({ preview, ...r }) => r) });
  }
  set({ model });
  // The other camera's work comes back (its pictures are encoded again once read).
  if (differentFamily) enterFamily(familyOf(model));
  else for (const w of state.wall) void encodeWall(w.id);
  scheduleSave();
  // That camera's official file, when it was downloaded or opened before, opens again.
  if (otherFile || !state.info) void reopenKept(model);
}
/** The kept file being opened again in the background: a file the user opens meanwhile waits for it. */
let keptOpening: Promise<void> | null = null;
function reopenKept(model: CameraModel): Promise<void> {
  const p = (async () => {
    if (!host.available) return;
    const raw = await keptFirmware(fwGroupOf(model));
    if (!raw || state.model !== model || state.info) return;
    await openFirmware(raw, LEGACY_FW_GROUP_NAME[fwGroupOf(model)], false);
  })().catch(() => undefined);
  keptOpening = p;
  void p.finally(() => { if (keptOpening === p) keptOpening = null; });
  return p;
}

// ------------------------------------------------------------------ firmware
/** Opens a firmware file; false (with a message shown) when it is not the supported official file. */
async function openFirmware(raw: Uint8Array, name: string, persist: boolean): Promise<boolean> {
  if (persist) while (keptOpening) await keptOpening;
  if (state.busy || state.fwBusy) return false;
  ++ratioGen;
  clearTimeout(ratioTimer);
  set({ fwBusy: true });
  try {
    const info = await engine.open(raw);
    const model = info.models.includes(state.model) ? state.model : info.models[0];
    const sameFamily = familyOf(state.model) === familyOf(model);
    if (!sameFamily) leaveFamily();
    set({ info, raw, model, fwName: info.filename, fwBusy: false, copyInfo: {}, copySel: [], });
    // Opening the other camera's firmware brings back that camera's work.
    if (!sameFamily) enterFamily(familyOf(model));
    if (info.family === 'gr3x') set((s) => ({ dateStamp: s.dateStamp && info.features.dateStamp, monoUnlock: s.monoUnlock && info.features.monoUnlock }));
    if (info.family === 'gr3x') ratiosChanged(true);
    if (info.bridge && persist) toast(t('bridgeOpened'), 'info');
    if (persist) { await host.storeSet(fwKey(fwGroupOf(model)), raw); scheduleSave(); }
    for (const id of info.capabilities.presets ? allSlotKeys() : []) {
      void renderIcon(id);
      const p = slotOf(id)?.preset;
      if (p && !p.result && !p.busy) void runPreset(id, p.fileName, p.kind, p.text);
    }
    // Encoded again for every firmware: GR IV and GR III store the pictures differently (4:2:2 / 4:2:0).
    if (info.capabilities.wallpaper || info.capabilities.menuPictures) for (const w of state.wall) void encodeWall(w.id);
    void refreshRatios();
    return true;
  } catch (e) {
    set({ fwBusy: false, info: undefined, raw: undefined, fwName: undefined });
    scheduleSave();
    if (e instanceof EngineError && isBadFirmwareCode(e.code)) toast(t('badFirmware'), 'error');
    else fail(e);
    return false;
  }
}
export async function loadFirmwareFile(file: File): Promise<void> {
  if (file.size < 1_000_000 || file.size > 200_000_000) { toast(t('badFirmware'), 'error'); return; }
  await openFirmware(new Uint8Array(await file.arrayBuffer()), file.name, true);
}
/** The dialog that fetches the official firmware from Ricoh's site. */
export function setOnlineOpen(onlineOpen: boolean, reason?: State['onlineReason']): void {
  set({ onlineOpen, onlineReason: onlineOpen ? reason : undefined });
}
/** Take over a firmware file the shell downloaded; true when it is now the open firmware. */
export async function adoptFirmware(name: string, version: string, data: Uint8Array): Promise<boolean> {
  const ok = await openFirmware(data, name, true);
  if (ok) toast(t('fwDownloaded', { v: version || state.info?.version || '' }), 'ok');
  return ok;
}
/** True while the open firmware is the 1.12 bridge firmware: nothing is written until the official one is open. */
export const bridgeLoaded = (s: State = state): boolean => !!s.info?.bridge;
/** What a write or export does while the bridge firmware is open: offer the official download instead. */
export function askForOfficial(): void { setOnlineOpen(true, 'bridge-loaded'); }

// ------------------------------------------------------------------ presets
const PRESET_ERRORS: Record<string, Key> = {
  'not-xmp': 'errNotXmp', 'no-table': 'errNoTable', 'look-profile-missing': 'errLookMissing', 'unsupported-table': 'errUnsupportedTable', 'bad-table': 'errUnsupportedTable',
  'not-cube': 'errNotXmp', 'bad-cube': 'errBadCube', 'gr3x-cube-only': 'gr3xCubeOnly',
};
/** The newest conversion of each slot: an older one that finishes later is dropped. */
const presetRuns = new Map<SlotKey, number>();
let presetRun = 0;
/**
 * The fitting options a slot's conversion runs with. GR IV added slots also try hue sectors (the
 * conversion keeps them only when they come out closer); additive hue and keep-white are GR IV
 * options. Shared by runPreset and the library's compatibility check (fitKeyOf), so the two cannot disagree.
 */
function fitOptions(id: SlotKey, kind: 'xmp' | 'cube'): { hue?: boolean; additiveHue?: boolean; keepWhite?: boolean } {
  const hue = isExtra(id) && state.info?.family !== 'gr3x';
  return { ...(hue ? { hue: true } : {}), ...(state.info?.family === 'gr4' && state.additiveHue && hue ? { additiveHue: true } : {}), ...(state.info?.family === 'gr4' && state.keepWhite && kind === 'cube' ? { keepWhite: true } : {}) };
}
async function runPreset(id: SlotKey, fileName: string, kind: 'xmp' | 'cube', text: string): Promise<void> {
  patchSlot(id, { preset: { fileName, kind, text, busy: !!state.info?.capabilities.presets } });
  if (!state.info?.capabilities.presets) return;
  const run = ++presetRun;
  presetRuns.set(id, run);
  try {
    const result = await engine.convert(kind, text, fitOptions(id, kind));
    if (presetRuns.get(id) !== run || slotOf(id)?.preset?.text !== text) return; // replaced, removed or converted again meanwhile
    patchSlot(id, { preset: { fileName, kind, text, busy: false, result } });
  } catch (e) {
    if (presetRuns.get(id) !== run || slotOf(id)?.preset?.text !== text) return;
    const code = e instanceof EngineError ? e.code : '';
    patchSlot(id, { preset: { fileName, kind, text, busy: false, error: PRESET_ERRORS[code] ? t(PRESET_ERRORS[code]) : t('errNotXmp') } });
  }
}
/** Text of a preset file whatever its encoding: UTF-8, UTF-16 (with or without BOM) or GB18030. */
export function decodeText(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const n = Math.min(buf.length, 4096);
  let zeros = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) zeros++;
  if (n > 8 && zeros > n / 4) return new TextDecoder(buf[1] === 0 ? 'utf-16le' : 'utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('gb18030').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}
export async function loadPresetFile(id: SlotKey, file: File): Promise<void> {
  if (file.size > 120_000_000) { toast(t('errTooBig'), 'error'); return; }
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  const lower = file.name.toLowerCase();
  const kind: 'xmp' | 'cube' = lower.endsWith('.cube') ? 'cube' : lower.endsWith('.xmp') ? 'xmp' : /LUT_(3D|1D)_SIZE/i.test(text) ? 'cube' : 'xmp';
  setActiveSlot(id);
  if (host.available) await host.storeSet(presetKey(id), text).catch(() => undefined);
  await runPreset(id, file.name, kind, text);
  scheduleSave();
}
export function removePreset(id: SlotKey): void {
  patchSlot(id, { preset: undefined });
  if (host.available) void host.storeDel(presetKey(id)).catch(() => undefined);
  scheduleSave();
}

// ------------------------------------------------------------------ QoL wave C: preset library
/**
 * @decision DEC-QOL-LIBRARY-001
 * @title The preset library lives in its own host store files, apart from both projects
 * @status accepted
 * @rationale A project holds the presets of one camera's slots, so a look imported once had to be
 *   imported again for the other camera, a new project or a reset. The library keeps looks across
 *   projects and camera switches. Files (store keys are lower case, at most 64 characters):
 *   `library.json` is the index `{ v: 1, entries: [{ id, name, kind, family, fileName, date, fit? }] }`
 *   (written last, so an interrupted save leaves only orphan files, never an entry without data),
 *   `library-<id>` is the source file (XMP / CUBE text, UTF-8), `library-<id>-fit` the fitted result
 *   (PresetResult as JSON, typed arrays tagged so they come back exactly). `family` is the camera
 *   family ('gr4' | 'gr3', GR III and IIIx share one) and `fit` the key of the options that produced
 *   the stored result.
 *   Compatibility. (1) An entry is offered to, and applied on, only a slot of its own family: GR IV
 *   and GR III / IIIx fit to different camera models, so a result from one is wrong on the other (the
 *   source file alone could be refitted, but the user saved a look for a camera, not a file; the
 *   library never crosses families). (2) Within the family the stored result is reused, with no
 *   fitting, only when `fit` equals the key the target would fit with now (family, kind, hue sectors
 *   for an added slot, additive hue, keep white: fitKeyOf). Otherwise the source is refitted with the
 *   current options through the normal runPreset path. A result that cannot be read back also falls
 *   back to a refit. Saving under a name already in the library for that family replaces that entry.
 */
export interface LibraryEntry { id: string; name: string; kind: 'xmp' | 'cube'; family: Family; fileName: string; date: number; fit?: string }
const LIBRARY_INDEX = 'library.json';
const libSrcKey = (id: string): string => 'library-' + id;
const libFitKey = (id: string): string => 'library-' + id + '-fit';
/** The options a fit was made with, as a comparable string (null when nothing can be fitted: no preset support). */
function fitKeyOf(id: SlotKey, kind: 'xmp' | 'cube'): string | undefined {
  if (!state.info?.capabilities.presets) return undefined;
  return [familyOf(state.model), kind, JSON.stringify(fitOptions(id, kind))].join('|');
}
const TYPED: Record<string, new (a: number[]) => ArrayLike<number>> = { Int16Array, Uint16Array, Float64Array, Float32Array, Uint8Array } as never;
/** A fit result as JSON; typed arrays are tagged `{ __ta, data }` so that reading it back gives the same arrays. */
function packFit(r: PresetResult): string {
  return JSON.stringify(r, (_k, v) => (ArrayBuffer.isView(v) ? { __ta: v.constructor.name, data: Array.from(v as unknown as ArrayLike<number>) } : v));
}
function unpackFit(text: string): PresetResult | undefined {
  try {
    const r = JSON.parse(text, (_k, v) => (v && typeof v === 'object' && typeof v.__ta === 'string' && TYPED[v.__ta] && Array.isArray(v.data) ? Reflect.construct(TYPED[v.__ta] as never, [v.data]) : v));
    return r && Array.isArray(r.curves) && r.matrixQ13 && r.params ? r as PresetResult : undefined;
  } catch { return undefined; }
}
let libraryLoad: Promise<void> | undefined;
/** Read the library index once (later calls share the first); a missing or damaged index is an empty library. */
export function loadLibrary(): Promise<void> {
  if (!host.available) return Promise.resolve();
  libraryLoad ??= (async () => {
    const raw = await host.storeGet(LIBRARY_INDEX).catch(() => null);
    let entries: LibraryEntry[] = [];
    try {
      const doc = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
      if (doc && doc.v === 1 && Array.isArray(doc.entries)) {
        entries = doc.entries.filter((e: Partial<LibraryEntry>) => e && typeof e.id === 'string' && /^[a-z0-9]{1,40}$/.test(e.id) && typeof e.name === 'string' && (e.kind === 'xmp' || e.kind === 'cube') && (e.family === 'gr4' || e.family === 'gr3')).map((e: LibraryEntry) => ({ id: e.id, name: e.name, kind: e.kind, family: e.family, fileName: String(e.fileName ?? e.name), date: Number(e.date) || 0, ...(typeof e.fit === 'string' ? { fit: e.fit } : {}) }));
      }
    } catch { /* damaged index: start empty rather than refuse to open */ }
    set({ library: entries });
  })();
  return libraryLoad;
}
/** The entries a slot may use: those of the open camera family, newest first. */
export function libraryFor(s: Pick<State, 'library' | 'model'> = state): LibraryEntry[] {
  const fam = familyOf(s.model);
  return s.library.filter((e) => e.family === fam).sort((a, b) => b.date - a.date);
}
async function writeLibraryIndex(entries: LibraryEntry[]): Promise<boolean> {
  try { await host.storeSet(LIBRARY_INDEX, JSON.stringify({ v: 1, entries })); return true; } catch { return false; }
}
/** The name a slot's preset is saved under unless the user types one: the preset's title, else its file name without extension. */
export function defaultLibraryName(id: SlotKey): string {
  const p = slotOf(id)?.preset;
  return (p?.result?.title || p?.fileName.replace(/\.(xmp|cube)$/i, '') || '').trim();
}
export function openLibrary(slot: SlotKey, mode: 'save' | 'apply'): void { set({ libraryPicker: { slot, mode } }); void loadLibrary(); }
export function closeLibrary(): void { set({ libraryPicker: undefined }); }
/** Keep the fitted preset of a slot (with its source file) in the library. False when there is nothing fitted to keep or it could not be written. */
export async function saveToLibrary(id: SlotKey, name: string = defaultLibraryName(id)): Promise<boolean> {
  const p = slotOf(id)?.preset;
  const key = p?.result ? fitKeyOf(id, p.kind) : undefined;
  const clean = name.trim().slice(0, 60);
  if (!host.available || !p?.result || !clean) return false;
  await loadLibrary();
  const fam = familyOf(state.model);
  const old = state.library.find((e) => e.family === fam && e.name === clean);
  const entryId = old?.id ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const entry: LibraryEntry = { id: entryId, name: clean, kind: p.kind, family: fam, fileName: p.fileName, date: Date.now(), ...(key ? { fit: key } : {}) };
  try {
    await host.storeSet(libSrcKey(entryId), p.text);
    await host.storeSet(libFitKey(entryId), packFit(p.result));
  } catch { toast(t('libSaveFailed'), 'error'); return false; }
  const entries = [...state.library.filter((e) => e.id !== entryId), entry];
  if (!(await writeLibraryIndex(entries))) { toast(t('libSaveFailed'), 'error'); return false; }
  set({ library: entries });
  toast(t('libSaved', { name: clean }), 'ok');
  return true;
}
/** Put a library entry on a slot: its stored fit when the options match (no fitting), else a refit of the stored source. */
export async function applyFromLibrary(id: SlotKey, entryId: string): Promise<boolean> {
  const e = state.library.find((x) => x.id === entryId);
  if (!e || !host.available) return false;
  if (e.family !== familyOf(state.model)) { toast(t('libWrongFamily'), 'error'); return false; }
  const src = await host.storeGet(libSrcKey(e.id)).catch(() => null);
  if (!src) { toast(t('libMissing'), 'error'); return false; }
  const text = new TextDecoder().decode(src);
  setActiveSlot(id);
  await host.storeSet(presetKey(id), text).catch(() => undefined);
  const key = fitKeyOf(id, e.kind);
  const stored = key && e.fit === key ? await host.storeGet(libFitKey(e.id)).catch(() => null) : null;
  const result = stored ? unpackFit(new TextDecoder().decode(stored)) : undefined;
  if (result) {
    presetRuns.set(id, ++presetRun); // a conversion still running for this slot is now stale
    patchSlot(id, { preset: { fileName: e.fileName, kind: e.kind, text, busy: false, result } });
  } else await runPreset(id, e.fileName, e.kind, text);
  scheduleSave();
  closeLibrary();
  toast(t('libApplied', { name: e.name }), 'ok');
  return true;
}
/** Delete an entry (after asking): the index first, so a failure halfway leaves orphan files and no broken entry. */
export async function deleteLibraryEntry(entryId: string): Promise<void> {
  const e = state.library.find((x) => x.id === entryId);
  if (!e || !(await ask(t('libDeleteTitle'), [e.name], t('remove')))) return;
  const entries = state.library.filter((x) => x.id !== entryId);
  if (!(await writeLibraryIndex(entries))) { toast(t('libSaveFailed'), 'error'); return; }
  set({ library: entries });
  await host.storeDel(libSrcKey(entryId)).catch(() => undefined);
  await host.storeDel(libFitKey(entryId)).catch(() => undefined);
}

// ------------------------------------------------------------------ QoL wave C: compare two slots
/**
 * @decision DEC-QOL-COMPARE-001
 * @title The left side of the photo preview can be another slot's look; the choice is saved view state
 * @status accepted
 * @rationale The preview split showed the photo before and after one slot, so judging two looks meant
 *   switching tabs and remembering. `compareWith` is `orig` (the default and the fallback) or a slot
 *   key. It is saved with previewMode because that is saved too. It is a key, not a copy of the look,
 *   so it follows later edits of that slot; a slot that was removed or lost its preset, or the active
 *   slot itself, counts as `orig` (compareSlot), never an error. The left image is rendered with the
 *   same applySlot pipeline as the right one, deferred a tick so choosing does not stall the UI.
 */
/** Slots that have a fitted look, in menu order: what the compare choice can offer. */
export function slotsWithLook(s: State = state): SlotKey[] { return allSlotKeys(s).filter((k) => slotOf(k, s)?.preset?.result); }
/** The slot whose look is on the left of the preview, or undefined for the original photo. */
export function compareSlot(s: State = state): SlotKey | undefined {
  const k = s.compareWith;
  return k !== 'orig' && k !== s.activeSlot && slotsWithLook(s).includes(k) ? k : undefined;
}
export function setCompareWith(compareWith: string): void { set({ compareWith }); scheduleSave(); }

// ------------------------------------------------------------------ added slots
/** Every slot key: the two Cinema slots, then the added ones. */
/** The slots of the open firmware (GR IV: Cinema Yellow / Green and the added slots; GR IIIx: its nine films). */
export function allSlotKeys(s: State = state): SlotKey[] {
  const gr3x = s.info ? s.info.family === 'gr3x' : isGr3(s.model);
  return [...availableSlots(s), ...(gr3x ? [] : s.extras.map((x) => x.key))];
}

// ------------------------------------------------------------------ Image Control menu order / hidden looks
const FACTORY_LOOK_NAMES: Record<number, { zh: string; en: string }> = {
  11: { zh: '标准', en: 'Standard' }, 12: { zh: '鲜艳', en: 'Vivid' }, 13: { zh: '单色', en: 'Monotone' },
  14: { zh: '软单色', en: 'Soft Monotone' }, 15: { zh: '硬单色', en: 'Hard Monotone' }, 16: { zh: '高对比度黑白', en: 'Hi-Contrast B&W' },
  17: { zh: '正片', en: 'Positive Film' }, 18: { zh: '电影（黄色）', en: 'Cinema (Yellow)' }, 19: { zh: '电影（绿色）', en: 'Cinema (Green)' },
  20: { zh: '留银冲洗', en: 'Bleach Bypass' }, 21: { zh: '怀旧', en: 'Retro' }, 22: { zh: 'HDR色调', en: 'HDR Tone' },
  23: { zh: '正负逆冲', en: 'Cross Processing' }, 24: { zh: '负片', en: 'Negative Film' }, 25: { zh: '标准（单色）', en: 'Standard (mono)' },
  26: { zh: '柔和（单色）', en: 'Soft (mono)' }, 27: { zh: '高对比度（单色）', en: 'High Contrast (mono)' }, 28: { zh: '颗粒感（单色）', en: 'Grainy (mono)' },
  29: { zh: '无颗粒感（单色）', en: 'Solid (mono)' }, 30: { zh: 'HDR色调（单色）', en: 'HDR Tone (mono)' },
  // Firmware 1.20 (the camera's texts): Pictorialist is offered on no model (not listed, see
  // UNRELEASED_LOOKS), Solarized on the Monochrome (and with the B&W looks unlocked).
  31: { zh: '画意摄影效果', en: 'Pictorialist Effect' }, 32: { zh: '中途曝光效果', en: 'Solarized Effect' },
};
/** GR III / IIIx (round 8): its twelve looks in the camera's menu order, their numbers and names (the camera's texts). */
const GR3_LOOK_IDS: readonly number[] = [11, 12, 13, 14, 15, 16, 22, 17, 18, 19, 20, 21];
const GR3_LOOK_NAMES: Record<number, { zh: string; en: string }> = {
  11: { zh: '标准', en: 'Standard' }, 12: { zh: '鲜艳', en: 'Vivid' }, 13: { zh: '单色', en: 'Monotone' },
  14: { zh: '软单色', en: 'Soft Monotone' }, 15: { zh: '硬单色', en: 'Hard Monotone' }, 16: { zh: '高对比度黑白', en: 'Hi-Contrast B&W' },
  17: { zh: '正片', en: 'Positive Film' }, 18: { zh: '留银冲洗', en: 'Bleach Bypass' }, 19: { zh: '怀旧', en: 'Retro' },
  20: { zh: 'HDR色调', en: 'HDR Tone' }, 21: { zh: '正负逆冲', en: 'Cross Processing' }, 22: { zh: '负片', en: 'Negative Film' },
};
const factoryLookKey = (id: number): string => `f${id}`;
/** GR III's keys: g<look> for its own looks and its films (64..). */
const gr3LookKey = (id: number): string => `g${id}`;
/** Standard and the monochrome looks' Standard: what the camera falls back to for a hidden look that is selected (see guard.ts). */
export const KEEP_VISIBLE = ['f11', 'f25', 'g11'];
/** Added slots are not built on the Monochrome camera (it has no colour looks), so they are not in the order either. */
function lookExtras(s: State): ExtraSlot[] { return s.model === 'MONO' ? [] : s.extras; }
/** The order and hidden looks of the open camera family: GR III / IIIx keeps its own. */
const gr3Order = (s: State): boolean => (s.info ? s.info.family === 'gr3x' : isGr3(s.model));
/** GR III: the films of the build (looks 64..), when they are built. */
function gr3Films(s: State): number { return filmCountChoosable(s) ? s.filmCount : 0; }
/** The menu order can be set: GR IV, and GR III / IIIx (round 8). */
export function lookOrderAvailable(s: State = state): boolean {
  return !gr3Order(s) || (s.info?.family === 'gr3x' && s.info.capabilities.lookLayout === true);
}
/** Every key the order can contain, in the camera's order: GR IV's 20 looks and the added slots; GR III's twelve and its films. */
export function lookKeys(s: State = state): string[] {
  if (gr3Order(s)) return [...GR3_LOOK_IDS.map(gr3LookKey), ...Array.from({ length: gr3Films(s) }, (_, k) => gr3LookKey(64 + k))];
  return [...listedFactoryLooks(s).map(factoryLookKey), ...lookExtras(s).map((x) => x.key)];
}
/**
 * Looks in the firmware's order table that no camera shows: 1.20's 31 (Pictorialist) is not
 * offered on any model, not even the Monochrome, and the B&W unlock leaves it so. It is not listed
 * (it could only be moved or hidden without anything changing on the camera); builds keep it in
 * the order table just before 32, where the official firmware has it.
 */
const UNRELEASED_LOOKS: readonly number[] = [31];
function listedFactoryLooks(s: State = state): number[] { return factoryLooks(s).filter((n) => !UNRELEASED_LOOKS.includes(n)); }
/** The style order to build from the listed keys: the unlisted looks go back where the firmware has them. */
function withUnlisted(styles: number[], s: State): number[] {
  const out = [...styles];
  const official = factoryLooks(s);
  for (const n of UNRELEASED_LOOKS) {
    const i = official.indexOf(n);
    if (i < 0 || out.includes(n)) continue;
    const next = official.slice(i + 1).find((m) => out.includes(m));
    out.splice(next === undefined ? out.length : out.indexOf(next), 0, n);
  }
  return out;
}
/** GR IV's looks: the open firmware's (1.20 adds 31 and 32), 1.11's while none is open. */
function factoryLooks(s: State = state): readonly number[] { return s.info?.looks?.factory ?? FACTORY_LOOK_IDS; }
/** The style number the firmware uses for a key (GR IV 11..30, or 34.. for added slots; GR III 11..22, films 64..). */
export function lookStyleOf(key: string, s: State = state): number | null {
  if (key.startsWith('g')) { const n = Number(key.slice(1)); return gr3Order(s) && lookKeys(s).includes(key) ? n : null; }
  if (key.startsWith('f')) { const n = Number(key.slice(1)); return factoryLooks(s).includes(n) ? n : null; }
  const i = lookExtras(s).findIndex((x) => x.key === key);
  return i < 0 ? null : (s.info?.looks?.extraFirst ?? 34) + i;
}
/** Only on the GR IV Monochrome (its six black-and-white looks). */
export function lookMonoOnly(key: string, s: State = state): boolean {
  const n = lookStyleOf(key, s);
  return !gr3Order(s) && n !== null && (s.info?.looks?.monoOnly ?? [25, 26, 27, 28, 29, 30]).includes(n);
}
/** A display name for the UI: the camera's Chinese/English name, or an added slot's / a film's name. */
export function lookName(key: string, s: State = state): string {
  if (key.startsWith('g')) {
    const n = Number(key.slice(1));
    if (n >= 64) {
      const id = GR3X_FILM_IDS[n - 64];
      const slot = s.info?.slots.find((x) => x.id === id);
      return (id && s.slots[id]?.names[s.lang]) || slot?.defaultName || `GR Mod ${n - 63}`;
    }
    const x = GR3_LOOK_NAMES[n]; if (x) return s.lang.startsWith('zh') ? x.zh : x.en;
    return key;
  }
  if (key.startsWith('f')) {
    const n = Number(key.slice(1));
    // Cinema Yellow / Green carry the name given to their slot (e.g. a preset's), when there is one.
    const own = n === 18 ? s.slots.CY.names[s.lang] : n === 19 ? s.slots.CG.names[s.lang] : undefined;
    if (own) return own;
    const x = FACTORY_LOOK_NAMES[n]; if (x) return s.lang.startsWith('zh') ? x.zh : x.en;
  }
  const x = lookExtras(s).find((e) => e.key === key);
  return x ? extraName(x, s) : key;
}
/** Keep a saved order valid for the keys there are: drop unknown keys, append the missing ones in the camera's order. */
function normalizeOrder(order: readonly string[], keys: readonly string[]): string[] {
  const valid = new Set(keys);
  const out: string[] = [];
  for (const k of order) if (typeof k === 'string' && valid.has(k) && !out.includes(k)) out.push(k);
  for (const k of keys) if (!out.includes(k)) out.push(k);
  return out;
}
function normalizeHidden(hidden: readonly string[], keys: readonly string[]): string[] {
  const valid = new Set(keys);
  return [...new Set(hidden.filter((k) => typeof k === 'string' && valid.has(k) && !KEEP_VISIBLE.includes(k)))];
}
/** GR IV's order for the current extras (projects keep it as saved; see `lookOrderNow`). */
export function normalizeLookOrder(order: readonly string[], extras: readonly ExtraSlot[]): string[] {
  return normalizeOrder(order, [...listedFactoryLooks().map(factoryLookKey), ...extras.map((x) => x.key)]);
}
export function normalizeLookHidden(hidden: readonly string[], extras: readonly ExtraSlot[]): string[] {
  return normalizeHidden(hidden, [...listedFactoryLooks().map(factoryLookKey), ...extras.map((x) => x.key)]);
}
/** GR III's saved order and hidden keys (kept apart from GR IV's), checked like GR IV's when a project opens. */
function gr3SavedKeys(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).filter((k): k is string => typeof k === 'string' && /^g(1[1-9]|2[0-2]|6[4-9]|7\d|8[0-3])$/.test(k));
}
export function lookOrderNow(s: State = state): string[] { return normalizeOrder(gr3Order(s) ? s.lookOrder3 : s.lookOrder, lookKeys(s)); }
export function lookHiddenNow(s: State = state): string[] { return normalizeHidden(gr3Order(s) ? s.lookHidden3 : s.lookHidden, lookKeys(s)); }
/** The layout to build, or undefined when it is the camera's order with nothing hidden. */
export function lookLayoutSpec(s: State = state): LookLayout | undefined {
  if (!lookOrderAvailable(s)) return undefined;
  const order = lookOrderNow(s);
  const hidden = lookHiddenNow(s);
  const factory = lookKeys(s);
  if (hidden.length === 0 && order.every((k, i) => k === factory[i])) return undefined;
  const styles = order.map((k) => lookStyleOf(k, s)!);
  return { order: gr3Order(s) ? styles : withUnlisted(styles, s), hidden: hidden.map((k) => lookStyleOf(k, s)!) };
}
export function hasLookLayout(s: State = state): boolean { return !!lookLayoutSpec(s); }
/** Put the family's order / hidden keys. */
function orderPatch(s: State, patch: { order?: string[]; hidden?: string[] }): Partial<State> {
  if (gr3Order(s)) return { ...(patch.order ? { lookOrder3: patch.order } : {}), ...(patch.hidden ? { lookHidden3: patch.hidden } : {}) };
  return { ...(patch.order ? { lookOrder: patch.order } : {}), ...(patch.hidden ? { lookHidden: patch.hidden } : {}) };
}
export function moveLookTo(key: string, toIndex: number): void {
  set((s) => {
    const order = lookOrderNow(s);
    const from = order.indexOf(key);
    if (from < 0) return orderPatch(s, { order });
    const to = Math.max(0, Math.min(order.length - 1, toIndex));
    if (from === to) return orderPatch(s, { order });
    order.splice(from, 1);
    order.splice(to, 0, key);
    return orderPatch(s, { order });
  });
  scheduleSave();
}
export function moveLook(key: string, delta: number): void {
  set((s) => {
    const order = lookOrderNow(s);
    const from = order.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return orderPatch(s, { order });
    order.splice(from, 1);
    order.splice(to, 0, key);
    return orderPatch(s, { order });
  });
  scheduleSave();
}
export function setLookHidden(key: string, hidden: boolean): void {
  if (KEEP_VISIBLE.includes(key)) { toast(t(gr3Order(state) ? 'lookOrderKeepStandardGr3' : 'lookOrderKeepStandard'), 'info'); return; }
  set((s) => {
    const list = lookHiddenNow(s).filter((k) => k !== key);
    if (hidden) list.push(key);
    return orderPatch(s, { hidden: list });
  });
  scheduleSave();
}
export function resetLookLayout(): void {
  set((s) => orderPatch(s, { order: lookKeys(s), hidden: [] }));
  scheduleSave();
}
/** The name an added slot gets in the camera: what was typed, else `GR Mod <place>`. */
export function extraName(x: ExtraSlot, s: State = state): string {
  const i = s.extras.findIndex((e) => e.key === x.key);
  return x.name.trim() || `GR Mod ${i + 1}`;
}
const EXTRA_NAME_PROBLEMS: Record<string, Key> = { 'too-long': 'extraNameLong', 'bad-char': 'extraNameBad', empty: 'extraNameBad' };
export function extraNameProblem(x: ExtraSlot, s: State = state): string | null {
  const p = validateExtraSlotName(extraName(x, s));
  return p ? t(EXTRA_NAME_PROBLEMS[p]) : null;
}
/** Why an added slot cannot be built yet (null when it can). */
export function extraProblem(x: ExtraSlot, s: State = state): string | null {
  const n = extraNameProblem(x, s);
  if (n) return n;
  if (!x.preset) return t('extraNeedsPreset');
  if (x.preset.busy) return t('converting');
  if (x.preset.error || !x.preset.result) return x.preset.error || t('extraNeedsPreset');
  if (!x.icon.pixels) return t('extraNeedsIcon');
  return null;
}
export function hasExtraErrors(s: State = state): boolean { return s.model !== 'MONO' && s.extras.some((x) => !!extraProblem(x, s)); }
/** What the added slots give the build (none on the Monochrome, which has no colour looks). */
export function extraSpecs(s: State = state): ExtraSlotSpec[] {
  if (s.model === 'MONO') return [];
  return s.extras.map((x) => {
    const r = x.preset!.result!;
    return { name: extraName(x, s), matrixQ13: r.matrixQ13, curves: r.curves, ...(r.postQ9 ? { postQ9: r.postQ9 } : {}), ...(r.hueQ10 ? { hueQ10: r.hueQ10 } : {}), icon: x.icon.pixels!, halation: true };
  });
}

// ------------------------------------------------------------------ halation of an added slot
/** A halation read from a saved project (older ones also kept the settings, now fixed), or null. */
function validHalation(v: unknown): HalationState | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Partial<HalationState>;
  return { on: h.on === true, preview: h.preview === 1 || h.preview === 2 || h.preview === 3 ? h.preview : 0, ...(h.colour === 'white' ? { colour: 'white' as const } : {}) };
}
/** A slot's halation: every added slot has it (the camera switches it); a Cinema slot when it is switched on (with a preset). */
export function halationOf(k: SlotKey, s: State = state): HalationState {
  // GR III / IIIx: every film has it, as GR IV's added slots.
  if (s.info?.family === 'gr3x' && !isExtra(k)) return { ...(s.slots[k as SlotId]?.halation ?? { preview: 0 }), on: true };
  if (isExtra(k)) return { ...(s.extras.find((x) => x.key === k)?.halation ?? { preview: 0 }), on: true };
  return s.slots[k as SlotId]?.halation ?? { on: false, preview: 0 };
}
/** Change a slot's halation (on / off for a Cinema slot, strength, the level the preview shows). */
export function setHalation(key: SlotKey, patch: Partial<HalationState>): void {
  const next = { ...halationOf(key), ...patch };
  if (isExtra(key)) set((s) => ({ extras: s.extras.map((x) => (x.key === key ? { ...x, halation: next } : x)) }));
  else setSlot(key as SlotId, { halation: next });
  scheduleSave();
}
export function addExtraSlot(): void {
  if (state.extras.length >= MAX_EXTRA_SLOTS) { toast(t('extraMax', { n: MAX_EXTRA_SLOTS }), 'info'); return; }
  const key = 'x-' + Math.random().toString(36).slice(2, 10);
  const n = state.extras.length + 1;
  set((s) => ({ extras: [...s.extras, { key, name: '', icon: { mode: 'text', text: `GR${n}`, style: 'film' } }], lookOrder: [...normalizeLookOrder(s.lookOrder, s.extras), key] }));
  void renderIcon(key);
  scheduleSave();
}
export function removeExtraSlot(key: string, undoable = true): void {
  const was = state, index = was.extras.findIndex((x) => x.key === key), item = was.extras[index];
  const orderAt = lookOrderNow(was).indexOf(key), hidden = was.lookHidden.includes(key), active = was.activeSlot === key;
  set((s) => ({ extras: s.extras.filter((x) => x.key !== key), activeSlot: s.activeSlot === key ? 'CY' : s.activeSlot, lookOrder: normalizeLookOrder(s.lookOrder, s.extras.filter((x) => x.key !== key)), lookHidden: s.lookHidden.filter((k) => k !== key) }));
  const file = presetKey(key); // fixed now: the delete may run after a switch to the other family, whose files are named differently
  const del = (): void => { if (host.available) void host.storeDel(file).catch(() => undefined); };
  scheduleSave();
  if (!undoable || !item) { del(); return; }
  recordDeleted(t('undoExtra'), () => {
    if (state.extras.length >= MAX_EXTRA_SLOTS) return false;
    set((s) => {
      const extras = s.extras.slice(); extras.splice(Math.min(index, extras.length), 0, item);
      const order = normalizeLookOrder(s.lookOrder, extras).filter((k) => k !== key); order.splice(orderAt < 0 ? order.length : Math.min(orderAt, order.length), 0, key);
      return { extras, lookOrder: order, lookHidden: hidden ? [...s.lookHidden, key] : s.lookHidden, ...(active ? { activeSlot: key } : {}) };
    });
    return true;
  }, del);
}
/** Set how many slots are added: the last ones are taken away, new empty ones appended. */
export function setExtraCount(n: number): void {
  const want = Math.max(0, Math.min(MAX_EXTRA_SLOTS, Math.round(n)));
  while (state.extras.length < want) addExtraSlot();
  while (state.extras.length > want) removeExtraSlot(state.extras[state.extras.length - 1].key, false);
}
export function setExtraName(key: string, name: string): void {
  set((s) => ({ extras: s.extras.map((x) => (x.key === key ? { ...x, name } : x)) }));
  scheduleSave();
}

// ------------------------------------------------------------------ names
export function nameProblem(info: FirmwareInfo, id: SlotId, lang: LangCode, text: string): string | null {
  if (!text) return null;
  const slot = info.slots.find((s) => s.id === id);
  if (!slot) return null;
  const cap = slot.names[lang].capacity;
  if (text.length > cap) return t('nameTooLong', { n: cap });
  const allowed = info.allowed[lang];
  const bad: string[] = [];
  for (const ch of text) if (ch.length !== 1 || !allowed.includes(ch)) { if (!bad.includes(ch)) bad.push(ch); }
  if (/^\s|\s$/.test(text) && !bad.includes('␣')) bad.push('␣');
  return bad.length ? t('nameBadChar', { c: bad.join(' ') }) : null;
}
export function setName(id: SlotId, lang: LangCode, text: string): void {
  setSlot(id, (s) => ({ names: { ...s.names, [lang]: text } }));
  scheduleSave();
}

// ------------------------------------------------------------------ icons
const iconBitmaps = new Map<string, ImageBitmap>();
async function bitmapOf(dataUrl: string): Promise<ImageBitmap> {
  let b = iconBitmaps.get(dataUrl);
  if (!b) { b = await createImageBitmap(await (await fetch(dataUrl)).blob()); iconBitmaps.set(dataUrl, b); }
  return b;
}
async function renderIcon(id: SlotKey): Promise<void> {
  const info = state.info; const ic = slotOf(id)?.icon;
  if (!ic) return;
  if (!info?.capabilities.presets || ic.mode === 'keep') { if (ic.pixels) patchSlot(id, (s) => ({ icon: { ...s.icon, pixels: undefined } })); return; }
  const tile = info.tiles[ic.style]; const area = info.contentArea[ic.style];
  let pixels: Uint8Array | undefined;
  if (ic.mode === 'text') { await ensureIconFont(); pixels = ic.text.trim() ? textIcon(tile, ic.text, area) : undefined; }
  else if (ic.image) { const b = await bitmapOf(ic.image); pixels = imageIcon(tile, b, b.width, b.height, area); }
  const cur = slotOf(id)?.icon;
  if (cur && cur.mode === ic.mode && cur.text === ic.text && cur.style === ic.style && cur.image === ic.image) patchSlot(id, { icon: { ...cur, pixels } });
}
export function setIcon(id: SlotKey, patch: Partial<IconState>): void {
  patchSlot(id, (s) => ({ icon: { ...s.icon, ...patch } }));
  void renderIcon(id);
  scheduleSave();
}
export async function loadIconImage(id: SlotKey, file: File): Promise<void> {
  try {
    const bmp = await loadBitmap(file);
    const scale = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
    setIcon(id, { mode: 'image', image: c.toDataURL('image/png') });
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ power-off images
const wallBitmaps = new Map<string, ImageBitmap>();
export async function wallBitmap(w: WallItem): Promise<ImageBitmap | null> {
  if (!w.blob) return null;
  let b = wallBitmaps.get(w.id);
  if (!b) { b = await loadBitmap(w.blob); wallBitmaps.set(w.id, b); }
  return b;
}
const encodeGen = new Map<string, number>();
/** A picture of the firmware: the crop as it is, its own fixed size (see core aspect/shutdown.ts). */
async function encodeWall(id: string): Promise<void> {
  const w = state.wall.find((x) => x.id === id);
  if (!w || !state.info) return;
  const gen = (encodeGen.get(id) || 0) + 1; encodeGen.set(id, gen);
  setWall(id, { busy: true, error: undefined });
  try {
    const bmp = await wallBitmap(w);
    if (!bmp) throw new Error('no image');
    const rgb = cropToRgb(bmp, w.crop);
    const jpeg = await engine.menuPicture(rgb);
    if (encodeGen.get(id) !== gen) return;
    setWall(id, { busy: false, menuJpeg: jpeg, preview: rgb, error: undefined });
  } catch {
    if (encodeGen.get(id) !== gen) return;
    setWall(id, { busy: false, menuJpeg: undefined, preview: undefined, error: t('encodeFailed') });
  }
}
/** At most this many images (the camera's menu lists them). */
export const wallMax = (): number => SHUTDOWN_MAX_PICTURES;
export async function addWallFiles(files: File[]): Promise<void> {
  for (const f of files) {
    if (state.wall.length >= wallMax()) { toast(t('wallMax', { n: wallMax() }), 'info'); break; }
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|bmp|gif|avif|heic|heif)$/i.test(f.name)) continue;
    try {
      const bmp = await loadBitmap(f);
      const wc = await workingCopy(bmp);
      bmp.close();
      const id = Math.random().toString(36).slice(2, 10);
      const item: WallItem = { id, name: f.name, blob: wc.blob, width: wc.width, height: wc.height, crop: defaultCrop(wc.width, wc.height), busy: true, menuName: menuNameOf(f.name), menuId: newMenuId(state.wall) };
      set((s) => ({ wall: [...s.wall, item] }));
      if (host.available) void host.storeSet('wall-' + id, new Uint8Array(await wc.blob.arrayBuffer())).catch(() => undefined);
      void encodeWall(id);
    } catch (e) { fail(e); }
  }
  scheduleSave();
}
export function removeWall(id: string): void {
  const index = state.wall.findIndex((w) => w.id === id), item = state.wall[index];
  set((s) => ({ wall: s.wall.filter((w) => w.id !== id) }));
  wallBitmaps.get(id)?.close(); wallBitmaps.delete(id);
  scheduleSave();
  const del = (): void => { if (host.available) void host.storeDel('wall-' + id).catch(() => undefined); };
  if (!item) { del(); return; }
  recordDeleted(t('undoWall'), () => {
    if (state.wall.length >= wallMax()) return false;
    set((s) => { const wall = s.wall.slice(); wall.splice(Math.min(index, wall.length), 0, item); return { wall }; });
    return true;
  }, del);
}
export function moveWall(id: string, toIndex: number): void {
  set((s) => {
    const from = s.wall.findIndex((w) => w.id === id);
    if (from < 0) return {};
    const wall = s.wall.slice(); const [it] = wall.splice(from, 1); wall.splice(Math.max(0, Math.min(wall.length, toIndex)), 0, it);
    return { wall };
  });
  scheduleSave();
}
export function openCrop(id: string | undefined): void { set({ cropId: id }); }

// ------------------------------------------------------------------ power-off images chosen in the camera's menu
const validMenuId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 0xffffffff;
function newMenuId(wall: readonly WallItem[]): number {
  for (;;) {
    const id = 1 + Math.floor(Math.random() * 0xfffffffe);
    // Never one of GR III round 5's picture numbers (k << 24, k <= 8), which share the stored bytes.
    if ((id & 0xffffff) === 0 && id >>> 24 <= 8) continue;
    if (!wall.some((w) => w.menuId === id)) return id;
  }
}
/** A camera-list name from a file name: printable ASCII only, at most SHUTDOWN_NAME_MAX characters. */
export function menuNameOf(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return (stem || 'Picture').slice(0, SHUTDOWN_NAME_MAX).trim();
}
export function setWallName(id: string, menuName: string): void { setWall(id, { menuName }); scheduleSave(); }
const SHUTDOWN_NAME_PROBLEMS: Record<string, Key> = { empty: 'wallNameEmpty', 'too-long': 'wallNameLong', 'bad-char': 'wallNameBad' };
/** Why an image cannot go into the camera's menu (null when it can). */
export function wallMenuProblem(w: WallItem): string | null {
  const p = validateShutdownName(w.menuName ?? '');
  if (p) return t(SHUTDOWN_NAME_PROBLEMS[p], { n: SHUTDOWN_NAME_MAX });
  if (w.busy) return t('converting');
  if (w.error || !w.menuJpeg) return w.error || t('encodeFailed');
  return null;
}
/** The pictures the firmware gets. */
export function menuPictures(s: State = state): ShutdownPictureSpec[] {
  return s.wall.filter((w) => !wallMenuProblem(w)).map((w) => ({ id: w.menuId!, name: w.menuName!.trim() === w.menuName ? w.menuName! : w.menuName!.trim(), jpeg: w.menuJpeg! }));
}
/** Every image is ready (names valid, encoded), and there is at least one. */
export function menuReady(s: State = state): boolean {
  return s.wall.length > 0 && s.wall.length <= SHUTDOWN_MAX_PICTURES && s.wall.every((w) => !wallMenuProblem(w));
}
export function setCrop(id: string, crop: Crop): void { setWall(id, { crop }); set({ cropId: undefined }); void encodeWall(id); scheduleSave(); }

// ------------------------------------------------------------------ import fitting options
/** GR IV: refit with an additive hue-sector correction (PR #21) or with the LUT's white kept (PR #22); both start off. */
export function setAdditiveHue(value: boolean): void {
  if (state.info?.family !== 'gr4') return;
  set({ additiveHue: value }); scheduleSave();
  // Refit current applicable presets too; the existing per-slot run id drops stale results.
  for (const id of allSlotKeys()) {
    const p = slotOf(id)?.preset;
    if (p && isExtra(id)) void runPreset(id, p.fileName, p.kind, p.text);
  }
}
export function setKeepWhite(value: boolean): void {
  if (state.info?.family !== 'gr4') return;
  set({ keepWhite: value }); scheduleSave();
  // Refit current applicable presets too; the existing per-slot run id drops stale results.
  for (const id of allSlotKeys()) {
    const p = slotOf(id)?.preset;
    if (p && p.kind === 'cube') void runPreset(id, p.fileName, p.kind, p.text);
  }
}

// ------------------------------------------------------------------ soft focus
/**
 * The soft focus switch: on, the firmware gets soft focus as a function of the ADJ lever (off /
 * weak / medium / strong, fixed strengths). The clarity table stays official. (GR Mod 0.4.x put
 * fixed strengths on clarity -2 / -3 / -4 instead; such files are still recognised, see `softText`.)
 */
export function setSoft(soft: boolean): void { set({ soft }); scheduleSave(); }
export function softOn(s: State = state): boolean { return !!s.soft; }

// ------------------------------------------------------------------ date imprint, monochrome looks, HLG photo
/** Date imprint: the firmware gets the imprint and its menu (Shooting Assist > Date Imprint); it starts off. */
export function setDateStamp(dateStamp: boolean): void {
  if (dateStamp && !state.info?.features.dateStamp) return;
  set({ dateStamp }); scheduleSave();
}
/** The six looks of the GR IV Monochrome on a colour GR IV. Nothing to unlock on the Monochrome. */
export function setMonoUnlock(monoUnlock: boolean): void {
  if (monoUnlock && !state.info?.features.monoUnlock) return;
  set({ monoUnlock }); scheduleSave();
}
export function monoUnlockOn(s: State = state): boolean {
  if (state.info?.family === 'gr3x') return !!s.monoUnlock && (state.info?.features.monoUnlock ?? false);
  return !!s.monoUnlock && s.model !== 'MONO';
}
/** HLG HDR photo output on slot 22 (HDR Tone). */
/** HLG photo and the HDR gain map exclude each other (see `installExtensions`): turning one on turns the other off. */
export function setHlgPhoto(hlgPhoto: boolean): void { set(hlgPhoto ? { hlgPhoto, hdr: false } : { hlgPhoto }); scheduleSave(); }
export function hlgPhotoOn(s: State = state): boolean {
  return !!s.hlgPhoto && s.model !== 'MONO' && !isGr3(s.model) && !!s.info?.features.hlgPhoto;
}
export const GR3X_SOFT_FOCUS: readonly SoftFocusRequest[] = [
  { level: -1, strength: 'weak' }, { level: -2, strength: 'medium' }, { level: -3, strength: 'strong' },
];
export function setDirectFlash(directFlash: boolean): void {
  if (directFlash && !state.info?.features.directFlash) return;
  set({ directFlash }); scheduleSave();
}
export function directFlashOn(s: State = state): boolean { return !!s.directFlash && !!s.info?.features.directFlash; }
export function setBrightAuto(brightAuto: State['brightAuto']): void {
  if (brightAuto && !state.info?.features.brightAuto) return;
  set({ brightAuto }); scheduleSave();
}
export function brightAutoOf(s: State = state): State['brightAuto'] { return s.info?.features.brightAuto ? s.brightAuto : false; }
export function setHdr(hdr: boolean): void {
  if (hdr && !state.info?.features.hdrGainMap) return;
  set(hdr ? { hdr, hlgPhoto: false } : { hdr }); scheduleSave();
}
export function hdrOn(s: State = state): boolean { return !!s.hdr && !!s.info?.features.hdrGainMap; }
export function setExposurePreview(exposurePreview: boolean): void {
  if (exposurePreview && !state.info?.features.exposurePreview) return;
  set({ exposurePreview }); scheduleSave();
}
export function exposurePreviewOn(s: State = state): boolean { return !!s.exposurePreview && !!s.info?.features.exposurePreview; }
/** ADJ lever slots (5..8): the camera's five unless the firmware can have more. */
export function setAdjSlots(adjSlots: number): void {
  if (!(Number.isInteger(adjSlots) && adjSlots >= 5 && adjSlots <= (state.info?.features.maxAdjSlots ?? 5))) return;
  set({ adjSlots }); scheduleSave();
}
/** The ADJ lever slots the build gets (5: none added). */
export function adjSlotsOf(s: State = state): number { const max = s.info?.features.maxAdjSlots ?? 5; return s.adjSlots > 5 && s.adjSlots <= max ? s.adjSlots : 5; }
/** Any addition that is not a slot or a ratio. */
export function extrasOn(s: State = state): boolean { return !!brightAutoOf(s) || exposurePreviewOn(s) || softOn(s) || !!s.dateStamp || monoUnlockOn(s) || hlgPhotoOn(s) || hasLookLayout(s) || directFlashOn(s) || adjSlotsOf(s) > 5 || hdrOn(s); }
const MINUS = '\u2212';
const strengthLabel = (st: SoftFocusStrength | 'custom'): string => t(st === 'weak' ? 'softWeak' : st === 'medium' ? 'softMedium' : st === 'strong' ? 'softStrong' : 'softCustom');
/** "−2 weak / −3 medium" (−1 first), for confirmations and the copies page. */
export function softText(list: readonly (SoftFocusRequest | ClarityChange)[]): string {
  return [...list].sort((a, b) => b.level - a.level).map((f) => `${f.level < 0 ? MINUS : '+'}${Math.abs(f.level)} ${strengthLabel(f.strength)}`).join(' / ');
}

// ------------------------------------------------------------------ added aspect ratios
const RATIO_PROBLEMS: Record<NonNullable<RatioPreview['problem']>, Key> = {
  'bad-ratio': 'ratioBad', 'ratio-factory': 'ratioIsFactory', 'ratio-portrait': 'ratioPortrait', 'ratio-too-extreme': 'ratioExtreme', 'ratio-quick-view': 'ratioQuick',
  'ratio-metering': 'ratioMetering', 'ratio-conflict': 'ratioConflict', 'ratio-duplicate': 'ratioDup',
};
const NAME_PROBLEMS: Record<string, Key> = { 'too-long': 'ratioNameLong', 'bad-char': 'ratioNameBad', empty: 'ratioNameBad' };
/** How many ratios the open firmware takes. */
export const maxRatios = (s: State = state): number => (s.info?.family === 'gr3x' || (!s.info && isGr3(s.model)) ? GR3X_MAX_CUSTOM_RATIOS : MAX_CUSTOM_RATIOS);
/** Why a row cannot be built (shown in the row), or null. A row without a ratio is simply not built. */
export function ratioProblem(r: RatioItem): string | null {
  if (!r.ratio.trim()) return null;
  if (r.preview?.problem) return t(RATIO_PROBLEMS[r.preview.problem]);
  const n = r.name.trim() ? (state.info?.family === 'gr3x' ? validateGr3xRatioName(r.name.trim()) : validateRatioName(r.name.trim())) : null;
  return n ? t(NAME_PROBLEMS[n]) : null;
}
/** The menu name a row gets: what was typed, else the ratio as written on its icon. */
export const ratioName = (r: RatioItem): string => r.name.trim() || r.preview?.label || r.ratio.trim();
/** The rows that will be built into the firmware, in menu order. */
export function ratioSpecs(s: State = state): RatioSpec[] {
  return s.ratios.filter((r) => r.ratio.trim() && r.preview && !ratioProblem(r)).map((r) => ({ name: ratioName(r), ratio: r.ratio.trim() }));
}
/** True while a filled row is wrong or still being looked at: nothing is written then. */
export function hasRatioErrors(s: State = state): boolean {
  return s.ratios.some((r) => r.ratio.trim() && (!r.preview || !!ratioProblem(r)));
}
let ratioGen = 0; let ratioTimer: ReturnType<typeof setTimeout> | undefined;
/** Work out every row again: whether a row is acceptable depends on the rows before it. */
async function refreshRatios(): Promise<void> {
  const gen = ++ratioGen;
  if (!state.info) return;
  const rows = state.ratios.map((r) => ({ id: r.id, ratio: r.ratio.trim() }));
  const good: string[] = []; const previews = new Map<string, RatioPreview | undefined>();
  for (const r of rows) {
    if (!r.ratio) { previews.set(r.id, undefined); continue; }
    let p: RatioPreview;
    try { p = await engine.ratio(r.ratio, good); } catch { p = { problem: 'bad-ratio' }; }
    if (gen !== ratioGen) return;
    previews.set(r.id, p);
    if (!p.problem) good.push(r.ratio);
  }
  set((s) => ({ ratios: s.ratios.map((r) => (previews.has(r.id) && r.ratio.trim() === rows.find((x) => x.id === r.id)?.ratio ? { ...r, preview: previews.get(r.id) } : r)) }));
}
function ratiosChanged(now = false): void {
  scheduleSave();
  clearTimeout(ratioTimer);
  if (now) void refreshRatios(); else ratioTimer = setTimeout(() => { void refreshRatios(); }, 160);
}
export function addRatio(ratio = ''): void {
  if (state.ratios.length >= maxRatios()) { toast(t('ratioMax', { n: maxRatios() }), 'info'); return; }
  const empty = state.ratios.find((r) => !r.ratio.trim() && !r.name.trim());
  if (empty && !ratio) { set({ activeRatio: empty.id }); return; }
  const id = Math.random().toString(36).slice(2, 10);
  set((s) => ({ ratios: empty ? s.ratios.map((r) => (r.id === empty.id ? { ...r, ratio } : r)) : [...s.ratios, { id, ratio, name: '' }], activeRatio: empty ? empty.id : id }));
  ratiosChanged(true);
}
export function setRatio(id: string, patch: { ratio?: string; name?: string }): void {
  set((s) => ({ ratios: s.ratios.map((r) => (r.id === id ? { ...r, ...patch, preview: patch.ratio !== undefined && patch.ratio.trim() !== r.ratio.trim() ? undefined : r.preview } : r)), activeRatio: id }));
  if (patch.ratio !== undefined) ratiosChanged(); else scheduleSave();
}
export function removeRatio(id: string): void {
  const index = state.ratios.findIndex((r) => r.id === id), item = state.ratios[index], active = state.activeRatio === id;
  set((s) => { const ratios = s.ratios.filter((r) => r.id !== id); return { ratios, activeRatio: s.activeRatio === id ? ratios[0]?.id : s.activeRatio }; });
  ratiosChanged(true);
  if (!item) return;
  recordDeleted(t('undoRatio'), () => {
    if (state.ratios.length >= maxRatios()) return false;
    set((s) => { const ratios = s.ratios.slice(); ratios.splice(Math.min(index, ratios.length), 0, item); return { ratios, ...(active ? { activeRatio: id } : {}) }; });
    ratiosChanged(true);
    return true;
  }, () => undefined);
}
/** GR III / IIIx: how many films (1..maxFilms); the active slot stays among them. */
export function setFilmCount(n: number): void {
  const max = state.info?.features.maxFilms ?? 9;
  const want = Math.max(0, Math.min(max, Math.round(n)));
  set((s) => {
    const ids = (s.info?.slots ?? []).slice(0, want).map((x) => x.id);
    return { filmCount: want, activeSlot: ids.includes(s.activeSlot as SlotId) ? s.activeSlot : (ids[Math.max(0, want - 1)] ?? 'CY') };
  });
  scheduleSave();
}
/**
 * GR III / IIIx: take one film away, as GR IV's added slots: the films after it move up one place
 * (preset, names, icon, halation, their place in the menu order and hidden list), and the count
 * drops by one. Not while a preset of a moving film is still being converted.
 */
export function removeFilm(id: SlotId): void {
  if (!filmCountChoosable()) return;
  const ids = (state.info?.slots ?? []).map((x) => x.id);
  const n = state.filmCount;
  const k = ids.indexOf(id);
  if (k < 0 || k >= n) return;
  if (ids.slice(k, n).some((x) => state.slots[x].preset?.busy)) { toast(t('converting'), 'info'); return; }
  const look = (key: string): string | null => {
    const f = key.startsWith('g') ? Number(key.slice(1)) - 64 : -1;
    if (!(f >= 0 && f < n)) return key;
    return f === k ? null : f > k ? `g${64 + f - 1}` : key;
  };
  set((s) => {
    const slots = { ...s.slots };
    for (let i = k; i < n - 1; i++) slots[ids[i]] = s.slots[ids[i + 1]];
    slots[ids[n - 1]] = emptySlot();
    const a = ids.indexOf(s.activeSlot as SlotId);
    const activeSlot = a < 0 || a < k ? s.activeSlot : a > k ? ids[a - 1] : (ids[Math.min(k, n - 2)] ?? 'CY');
    return {
      slots, filmCount: n - 1, activeSlot,
      lookOrder3: s.lookOrder3.map(look).filter((x): x is string => x !== null),
      lookHidden3: s.lookHidden3.map(look).filter((x): x is string => x !== null),
    };
  });
  scheduleSave();
  // The preset files kept for the films move with them.
  if (host.available) {
    void (async () => {
      for (let i = k; i < n - 1; i++) {
        const text = await host.storeGet(presetKey(ids[i + 1])).catch(() => null);
        if (text) await host.storeSet(presetKey(ids[i]), text).catch(() => undefined);
        else await host.storeDel(presetKey(ids[i])).catch(() => undefined);
      }
      await host.storeDel(presetKey(ids[n - 1])).catch(() => undefined);
    })();
  }
}
export function setActiveRatio(id: string): void { if (state.activeRatio !== id) set({ activeRatio: id }); }

// ------------------------------------------------------------------ preview photo
const PREVIEW_KEY = 'preview.jpg';
let photo: ImageData | null = null;
/** The picture the slot previews are drawn on; changes whenever `photoRev` does. */
export const previewPhoto = (): ImageData | null => photo;
async function loadPreviewPhoto(): Promise<void> {
  try {
    // the user's own choice first, then a `preview.jpg` kept next to the program, then the sample built in
    let bytes = await host.storeGet(PREVIEW_KEY).catch(() => null);
    if (!bytes) bytes = await host.sidecar(PREVIEW_KEY).catch(() => null);
    if (!bytes) bytes = new Uint8Array(await (await fetch(defaultPhotoUrl)).arrayBuffer());
    photo = await decodePreview(bytes);
    set((s) => ({ photoRev: s.photoRev + 1 }));
  } catch (e) { console.warn('preview photo', e); }
}
export async function loadPreviewFile(file: File): Promise<void> {
  try {
    const bmp = await loadBitmap(file);
    const wc = await workingCopy(bmp, 1600);
    bmp.close();
    photo = await decodePreview(wc.blob);
    set((s) => ({ photoRev: s.photoRev + 1, previewMode: 'photo', ratioBackdrop: 'photo' }));
    if (host.available) await host.storeSet(PREVIEW_KEY, new Uint8Array(await wc.blob.arrayBuffer())).catch(() => undefined);
    scheduleSave();
  } catch (e) { fail(e); }
}
export function setPreviewMode(previewMode: PreviewMode): void { set({ previewMode }); scheduleSave(); }
export function setRatioBackdrop(ratioBackdrop: RatioBackdrop): void { set({ ratioBackdrop }); scheduleSave(); }
/** The slot the preview on the right shows. */
export function setActiveSlot(id: SlotKey): void { if (state.activeSlot !== id) set({ activeSlot: id }); }

/** The desktop builds (Windows, macOS, Linux) can eject a card; the development build cannot. */
const canEject = (): boolean => host.info?.kind === 'windows' || host.info?.kind === 'mac' || host.info?.kind === 'linux';
// ------------------------------------------------------------------ volumes
async function listing(root: string): Promise<card.CardListing> {
  const rootEntries = await host.list(root);
  const scriptDir = rootEntries.find((e) => e.dir && e.name.toLowerCase() === card.SCRIPT_DIR);
  return { root: rootEntries, script: scriptDir ? await host.list(host.join(root, scriptDir.name)) : [] };
}
let refreshing = false;
export async function refreshVolumes(): Promise<void> {
  if (!host.available || refreshing) return;
  refreshing = true;
  try {
    const volumes = await host.volumes(state.showAll);
    let volumeId = state.volumeId;
    if (!volumeId || !volumes.some((v) => v.id === volumeId)) volumeId = (volumes.find((v) => v.removable) || volumes[0])?.id;
    let role: card.CardRole | undefined;
    const v = volumes.find((x) => x.id === volumeId);
    if (v) { try { role = card.cardRole(await listing(v.root)); } catch { role = undefined; } }
    const same = JSON.stringify(volumes) === JSON.stringify(state.volumes) && volumeId === state.volumeId && role === state.role;
    if (!same) set({ volumes, volumeId, role });
    if (state.page === 'copies') void refreshCopies();
  } catch { /* shell gone or busy */ } finally { refreshing = false; }
}
export function selectVolume(id: string): void { set({ volumeId: id, role: undefined, parked: [], copySel: state.copySource === 'card' ? [] : state.copySel }); void refreshVolumes(); }
export function setShowAll(v: boolean): void { set({ showAll: v }); scheduleSave(); void refreshVolumes(); }

// ------------------------------------------------------------------ output
export interface SlotChange { id: SlotId; parts: string[]; labels: string[]; request: SlotRequest }
export function pendingChanges(s: State = state): SlotChange[] {
  if (!s.info?.capabilities.presets) return [];
  const out: SlotChange[] = [];
  if (!s.info || s.model === 'MONO') return out;
  for (const id of availableSlots(s)) {
    const sl = s.slots[id]; const off = s.info.slots.find((x) => x.id === id)!;
    const req: SlotRequest = { slot: id }; const parts: string[] = []; const labels: string[] = [];
    if (sl.preset?.result) { const r = sl.preset.result; req.preset = { matrixQ13: r.matrixQ13, curves: r.curves, ...(r.postQ9 ? { postQ9: r.postQ9 } : {}) }; parts.push(`${t('preset')} ${sl.preset.result.title || sl.preset.fileName}`); labels.push(t('preset')); }
    if (sl.icon.mode !== 'keep' && sl.icon.pixels) { req.icon = sl.icon.pixels; parts.push(t('icon')); labels.push(t('icon')); }
    const names: Partial<Record<LangCode, string>> = {};
    for (const lang of LANGS) {
      const v = sl.names[lang];
      if (v && v !== off.names[lang].text && !nameProblem(s.info, id, lang, v)) names[lang] = v;
    }
    if (Object.keys(names).length) { req.names = names; parts.push(`${t('name')} ${Object.values(names).join(' / ')}`); labels.push(`${t('name')} “${Object.values(names)[0]}”`); }
    // GR III / IIIx: every film has Halation. Builds with a film count set it in the camera (the level
    // here is the preview's); legacy builds without a film count fix it in the build (Weak, or Strong
    // for the preview's Medium / Strong).
    if (s.info.family === 'gr3x') {
      const h = sl.halation;
      if (h && h.preview > 0 && !filmCountChoosable(s)) { req.halation = h.preview === 1 ? 1 : 2; parts.push(`${t('halation')} ${t(h.preview === 1 ? 'haloWeak' : 'haloStrong')}`); labels.push(t('halation')); }
    } else if (req.preset && sl.halation?.on) { req.halation = true; parts.push(t('halation')); labels.push(t('halation')); }
    if (parts.length) out.push({ id, parts, labels, request: req });
  }
  return out;
}
export function hasNameErrors(s: State = state): boolean {
  if (!s.info?.capabilities.presets) return false;
  if (!s.info) return false;
  return availableSlots(s).some((id) => LANGS.some((lang) => !!nameProblem(s.info!, id, lang, s.slots[id].names[lang] || '')));
}
const stamp = (): string => { const d = new Date(); const p = (n: number): string => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** A stamp whose `GRMOD\parked-<stamp>` folder does not exist on the card yet (two writes can fall into the same second). */
async function freshStamp(root: string): Promise<string> {
  const base = stamp();
  let taken: string[] = [];
  try { taken = (await host.list(host.join(root, card.PARK_ROOT))).map((e) => e.name.toLowerCase()); } catch { /* no such folder yet */ }
  for (let n = 1; n < 100; n++) {
    const s = n === 1 ? base : `${base}-${n}`;
    if (!taken.includes(`parked-${s}`.toLowerCase())) return s;
  }
  return base;
}

async function runPlan(root: string, steps: card.PlanStep[]): Promise<number> {
  let moved = 0;
  for (const st of steps) {
    if (st.op === 'move') { await host.move(host.join(root, ...st.from), host.join(root, ...st.to)); moved++; }
    else {
      const res = await host.write(host.join(root, ...st.path), st.data);
      if (res.size !== st.data.length || res.sha256 !== (await sha256Hex(st.data))) throw new HostError('verify', t('verifyFailed'));
    }
  }
  return moved;
}
type Dest = { kind: 'card' } | { kind: 'folder' } | { kind: 'camera' } | { kind: 'phone' };
async function destination(dest: Dest): Promise<{ root: string; volume?: Volume } | null> {
  // The phone app: to the camera over Wi-Fi, or into the phone's own files.
  if (dest.kind === 'camera' || dest.kind === 'phone') return { root: '' };
  if (dest.kind === 'card') {
    const v = state.volumes.find((x) => x.id === state.volumeId);
    if (!v) { toast(t('noCard'), 'error'); return null; }
    return { root: v.root, volume: v };
  }
  const path = await host.pickDirectory(t('pickFolder'));
  return path ? { root: path } : null;
}
function doneToast(root: string, volume: Volume | undefined, moved: number, file: string): void {
  const text = (volume ? t('written', { p: host.join(root, file) }) : t('exported', { p: root })) + (moved ? ` · ${t('parked', { n: moved })}` : '');
  if (volume && canEject()) {
    toast(text, 'ok', { label: t('eject'), run: () => { host.eject(volume.id).then(() => { toast(t('ejected'), 'ok'); void refreshVolumes(); }).catch(fail); } });
  } else toast(text, 'ok', { label: t('reveal'), run: () => { void host.reveal(host.join(root, file)); } });
}

/** Turn a card into a firmware card holding `file` (what is in the way, such as a start-up script of GR Mod 0.7's power-off images, is moved aside). */
async function firmwareToCard(volume: Volume, file: Uint8Array): Promise<number | null> {
  if (!(await preflightCard(volume, file.length))) return null; // QoL D1: refused (toasted) before anything is moved aside or written
  return runPlan(volume.root, card.planFirmwareCard(await listing(volume.root), file, await freshStamp(volume.root), firmwareFilename()));
}

/** The update file name the open firmware's camera looks for (GR IV fwdc248b, GR IIIx fwdc243b, GR III fwdc239b). */
const firmwareFilename = (): card.FirmwareFilename => {
  const name = state.info?.filename;
  return (card.FIRMWARE_FILES as readonly string[]).includes(name ?? '') ? name as card.FirmwareFilename : card.FIRMWARE_FILE;
};

export async function outputFirmware(dest: Dest, stock = false): Promise<void> {
  if (!state.info?.models.includes(state.model)) return;
  if (!stock && !state.info.capabilities.build) { toast(t('fwCannotBuild'), 'info'); return; }
  if (state.busy || state.fwBusy || !state.info || !state.raw) return;
  if (bridgeLoaded()) { askForOfficial(); return; }
  const sourceInfo = state.info, sourceRaw = state.raw, sourceModel = state.model;
  const changes = stock ? [] : pendingChanges();
  const ratios = stock ? [] : ratioSpecs();
  if (!stock && state.info.family === 'gr3x' && ratios.length === 0) { toast(t('gr3xNeedRatio'), 'info'); return; }
  const soft = !stock && softOn();
  const dateStamp = !stock && !!state.dateStamp && !!state.info.features.dateStamp;
  const monoUnlock = !stock && monoUnlockOn();
  const hlgPhoto = !stock && hlgPhotoOn();
  const directFlash = !stock && directFlashOn();
  const hdr = !stock && hdrOn();
  const exposurePreview = !stock && exposurePreviewOn();
  const brightAuto = stock ? false : brightAutoOf();
  const adjSlots = stock ? 5 : adjSlotsOf();
  if (!stock && (hasNameErrors() || hasRatioErrors())) return;
  if (!stock && hasExtraErrors()) { toast(t('extraIncomplete'), 'error'); return; }
  const extras = stock ? [] : extraSpecs();
  // GR III / IIIx: power-off pictures only on GR III / IIIx (End Screen › Picture, as
  // GR IV); elsewhere pictures left from a GR IV project are not sent.
  const noPictures = stock || (state.info?.family === 'gr3x' && !state.info.capabilities.menuPictures);
  if (!noPictures && state.wall.length > 0 && !menuReady()) { toast(t('wallMenuIncomplete'), 'error'); return; }
  const pictures = noPictures ? [] : menuPictures();
  const films = filmCountChoosable() ? state.filmCount : 0;
  const lookLayout = stock ? undefined : lookLayoutSpec();
  if (!stock && changes.length === 0 && ratios.length === 0 && !soft && !dateStamp && !monoUnlock && !hlgPhoto && !directFlash && !hdr && !exposurePreview && !brightAuto && adjSlots === 5 && extras.length === 0 && pictures.length === 0 && films === 0 && !lookLayout) { toast(t('nothingToDo'), 'info'); return; }
  const fresh = newFirmwareWarning(sourceInfo);
  // The cannot-go-back warning is a paragraph (the dialog's lines are cut to one line each).
  // GR III / IIIx cannot take a firmware over Wi-Fi (only the GR IV's camera has that interface).
  if (dest.kind === 'camera' && sourceInfo.family !== 'gr4') { toast(t('pushOnlyGr4'), 'info'); return; }
  // everything that leaves for a camera (also a file saved on the phone for it) is confirmed first
  const toCamera = dest.kind === 'card' || dest.kind === 'camera' || dest.kind === 'phone';
  if (stock && !(await askOfficial([t('copyOfficial')], fresh && toCamera ? fresh : undefined))) return;
  // @decision DEC-QOLB-SUMMARY-001: the summary of what the build contains is asked before every
  // modified build, to the card, the camera, the device and a folder alike (upstream asks only for the
  // first three). Cancel returns before the destination is chosen and before engine.build runs.
  // Its lines are 0.8.12's short form.
  if (!stock) {
    // The check before writing: only what changes, by name; with a count where one item holds several.
    const named = (name: string, n: number, unit: Key = 'chkCount'): string => (n > 1 ? `${name}  ·  ${t(unit, { n })}` : name);
    const lines = changes.map((c) => named(state.info?.family === 'gr3x' ? (state.slots[c.id].names[state.lang] || state.info.slots.find(s => s.id === c.id)?.defaultName || c.id) : t(('slot' + c.id) as Key), c.labels.length, 'chkChanges'));
    if (ratios.length) lines.push(named(t('chkRatios'), ratios.length));
    if (soft) lines.push(t('navSoft'));
    if (films) lines.push(named(t('extraTitle'), films));
    if (dateStamp) lines.push(t('navDate'));
    if (monoUnlock) lines.push(t(state.info?.family === 'gr3x' ? 'gr3xReplicaTitle' : 'navMono'));
    if (brightAuto) lines.push(t('navBrightAuto'));
    if (hlgPhoto) lines.push(t('navHlg'));
    if (directFlash) lines.push(t('navFlash'));
    if (hdr) lines.push(t('navHdr'));
    if (exposurePreview) lines.push(t('navPreview'));
    if (adjSlots > 5) lines.push(`${t('navAdjSlots')}  ·  ${t('chkCount', { n: adjSlots })}`);
    if (extras.length) lines.push(named(t('extraTitle'), extras.length));
    if (lookLayout) lines.push(lookLayout.hidden.length ? `${t('icViewOrder')}  ·  ${t('chkHidden', { n: lookLayout.hidden.length })}` : t('icViewOrder'));
    if (pictures.length) lines.push(named(t('navWall'), pictures.length, 'chkPictures'));
    const [title, ok] = dest.kind === 'camera' ? [t('pushTitle'), t('pushStart')] : dest.kind === 'phone' ? [t('saveTitle'), t('saveStart')]
      : dest.kind === 'card' ? [t('confirmTitle'), t('confirmOk')] : [t('exportConfirmTitle'), t('exportConfirmOk')];
    if (!(await ask(title, lines, ok, fresh ?? undefined))) return;
  }
  const target = await destination(dest);
  if (!target || state.info !== sourceInfo || state.raw !== sourceRaw || state.model !== sourceModel || state.fwBusy) return;
  // QoL D1: a card that cannot hold the file is refused before the (seconds-long) build, not mid-write; a folder is not checked.
  if (target.volume && !(await preflightCard(target.volume, sourceRaw.length))) return;
  try {
    let file: Uint8Array;
    if (stock) file = sourceRaw;
    else {
      set({ busy: t('building') });
      const clarity = soft && sourceInfo.features.softFocus === 'clarity' ? [...GR3X_SOFT_FOCUS] : [];
      const built = await engine.build(changes.map((c) => c.request), ratios, clarity,
        { ...(brightAuto ? { brightAuto } : {}), adjSoftFocus: soft && sourceInfo.features.softFocus === 'adj', dateStamp, monoUnlock, ...(hlgPhoto ? { hlgPhoto } : {}), ...(directFlash ? { directFlash } : {}), ...(hdr ? { hdrGainMap: true } : {}), ...(exposurePreview ? { exposurePreview: true } : {}), ...(adjSlots > 5 ? { adjSlots } : {}), ...(extras.length ? { extraSlots: extras } : {}), ...(pictures.length ? { shutdownPictures: pictures } : {}),
          ...(films ? { filmCount: films } : {}), ...(lookLayout ? { lookLayout } : {}) });
      if (!Object.values(built.checks).every((v) => v === true)) throw new EngineError('selfcheck-failed', 'self-check');
      file = built.file;
      void recordBuild(file, changes);
    }
    if (dest.kind === 'camera') { set({ busy: undefined, push: { file, label: firmwareFilename(), stock } }); return; }
    if (dest.kind === 'phone') {
      set({ busy: t('writing') });
      // Android: Download/GR Mod/…; iOS: wherever the user puts it in the Files app (or nowhere: cancelled)
      const r = await upload(file, { to: 'download', name: firmwareFilename() }) as { path?: string; cancelled?: boolean };
      set({ busy: undefined });
      if (!r.cancelled) toast(t('savedTo', { p: r.path ?? '' }), 'ok');
      return;
    }
    set({ busy: t('writing') });
    let moved = 0;
    if (target.volume) { const m = await firmwareToCard(target.volume, file); if (m === null) { set({ busy: undefined }); void refreshVolumes(); return; } moved = m; }
    else await runPlan(target.root, [{ op: 'write', path: [firmwareFilename()], data: file }]);
    set({ busy: undefined });
    doneToast(target.root, target.volume, moved, firmwareFilename());
    if (!stock) void takeSnapshot('build');
  } catch (e) { set({ busy: undefined }); fail(e); }
  void refreshVolumes();
}


export function wallReady(s: State = state): boolean { return menuReady(s); }
export function closePush(): void { set({ push: undefined }); }

// ------------------------------------------------------------------ copies moved aside on the card, and their backups
const BUILDS_KEY = 'builds.json';
async function loadBuilds(): Promise<void> {
  try {
    const raw = await host.storeGet(BUILDS_KEY);
    const list = raw ? JSON.parse(new TextDecoder().decode(raw)) : [];
    if (Array.isArray(list)) set({ builds: list.filter((b) => b && typeof b.sha256 === 'string' && Array.isArray(b.slots)).slice(-400) });
  } catch { /* start empty */ }
}
async function recordBuild(file: Uint8Array, changes: SlotChange[]): Promise<void> {
  try {
    const sha256 = await sha256Hex(file);
    const slots = changes.map((c) => { const p = state.slots[c.id].preset; return { id: c.id, preset: c.request.preset && p ? p.result?.title || p.fileName : undefined }; });
    const builds = [...state.builds.filter((b) => b.sha256 !== sha256), { sha256, time: Date.now(), slots }].slice(-400);
    set({ builds });
    await host.storeSet(BUILDS_KEY, JSON.stringify(builds));
  } catch (e) { console.warn('record build', e); }
}

export const copyKey = (source: CopySource, e: ParkedEntry): string => `${source}|${e.path}|${e.size}|${e.mtime}`;
export const copyList = (s: State = state): ParkedEntry[] => (s.copySource === 'card' ? s.parked : s.backups);
const isFirmwareCopy = (e: ParkedEntry): boolean => /(^|\/)[^/]+\.bin$/i.test(e.path) && e.size >= 1_000_000 && e.size <= 120_000_000;

let copiesBusy = false; let copiesAgain = false;
/** Re-read both lists; selections of files that are gone are dropped. */
export async function refreshCopies(): Promise<void> {
  if (!host.available) return;
  if (copiesBusy) { copiesAgain = true; return; }
  copiesBusy = true;
  try {
    const v = state.volumes.find((x) => x.id === state.volumeId);
    const [parked, b] = await Promise.all([
      v ? host.parked(v.id).catch(() => [] as ParkedEntry[]) : Promise.resolve([] as ParkedEntry[]),
      host.backups().catch(() => ({ dir: '', entries: [] as ParkedEntry[] })),
    ]);
    if (v?.id !== state.volumes.find((x) => x.id === state.volumeId)?.id) return; // another card was chosen meanwhile
    const backups = b.entries || [];
    if (JSON.stringify(parked) !== JSON.stringify(state.parked) || JSON.stringify(backups) !== JSON.stringify(state.backups)) {
      const present = new Set((state.copySource === 'card' ? parked : backups).map((e) => e.path));
      set({ parked, backups, copySel: state.copySel.filter((p) => present.has(p)) });
    }
  } finally {
    copiesBusy = false;
    if (copiesAgain) { copiesAgain = false; void refreshCopies(); }
  }
  void inspectCopies();
}

let inspecting = false;
/** Look into the firmware files of the list being shown, one at a time. */
async function inspectCopies(): Promise<void> {
  if (inspecting || !state.info) return;
  inspecting = true;
  try {
    for (;;) {
      const source = state.copySource; const volumeId = state.volumeId;
      const next = copyList().find((e) => isFirmwareCopy(e) && !state.copyInfo[copyKey(source, e)]);
      if (!next || state.page !== 'copies' || !state.info) break;
      const key = copyKey(source, next);
      set((s) => ({ copyInfo: { ...s.copyInfo, [key]: { busy: true } } }));
      try {
        const raw = source === 'card' ? await host.parkedRead(volumeId || '', next.path) : await host.backupRead(next.path);
        const summary = await engine.inspect(raw);
        set((s) => ({ copyInfo: { ...s.copyInfo, [key]: { summary } } }));
      } catch {
        set((s) => ({ copyInfo: { ...s.copyInfo, [key]: { failed: true } } }));
      }
    }
  } finally { inspecting = false; }
}

export function setCopySource(copySource: CopySource): void {
  if (copySource === state.copySource) return;
  set({ copySource, copySel: [] });
  void refreshCopies();
}
export function toggleCopies(paths: string[], on?: boolean): void {
  set((s) => {
    const sel = new Set(s.copySel);
    const turnOn = on ?? !paths.every((p) => sel.has(p));
    for (const p of paths) { if (turnOn) sel.add(p); else sel.delete(p); }
    return { copySel: [...sel] };
  });
}
export const fmtSize = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`);

/** Delete the selected copies (or all of the list being shown) for good. */
export async function deleteCopies(all: boolean): Promise<void> {
  const source = state.copySource; const list = copyList();
  const targets = all ? list : list.filter((e) => state.copySel.includes(e.path));
  const v = state.volumes.find((x) => x.id === state.volumeId);
  if (state.busy || targets.length === 0 || (source === 'card' && !v)) return;
  const where = source === 'card' ? host.join(v!.root, card.PARK_ROOT) : t('copiesPc');
  const total = targets.reduce((a, e) => a + e.size, 0);
  if (!(await ask(t('copiesDeleteTitle'), [t('copiesCount', { n: targets.length, s: fmtSize(total) }), where], t('copiesDelete'), t('copiesDeleteBody')))) return;
  try {
    set({ busy: t('copiesDeleting') });
    const paths = targets.map((e) => e.path);
    const res = source === 'card' ? await host.parkedDelete(v!.id, paths) : await host.backupsDelete(paths);
    set({ busy: undefined });
    if (res.failed.length) toast(t('copiesDeleteFailed', { n: res.failed.length }), 'error');
    else toast(t('copiesDeleted', { n: res.deleted.length, s: fmtSize(total) }), 'ok');
  } catch (e) { set({ busy: undefined }); fail(e); }
  await refreshCopies();
  void refreshVolumes();
}

/** Copy the selected card files to this computer, then show what is there. */
export async function backupCopies(): Promise<void> {
  const v = state.volumes.find((x) => x.id === state.volumeId);
  const targets = state.parked.filter((e) => state.copySel.includes(e.path));
  if (state.busy || state.copySource !== 'card' || !v || targets.length === 0) return;
  try {
    set({ busy: t('copiesBackingUp') });
    const res = await host.parkedBackup(v.id, targets.map((e) => e.path));
    set({ busy: undefined });
    if (res.failed.length) toast(t('copiesBackupFailed', { n: res.failed.length }), 'error');
    if (res.saved.length) {
      toast(t('copiesBackedUp', { n: res.saved.length }), 'ok', { label: t('reveal'), run: () => { void host.backupsReveal(res.saved[0].dest); } });
      set({ copySource: 'pc', copySel: [] });
      await refreshCopies();
      // show exactly what was saved
      const saved = new Set(res.saved.map((x) => x.dest));
      set({ copySel: state.backups.filter((e) => saved.has(e.path)).map((e) => e.path) });
    }
  } catch (e) { set({ busy: undefined }); fail(e); }
}
export function revealBackups(): void { void host.backupsReveal(); }

/** The one selected copy, when it is a firmware that may be written back to a card. */
export function writableCopy(s: State = state): { entry: ParkedEntry; summary: FirmwareSummary } | null {
  if (s.copySel.length !== 1) return null;
  const entry = copyList(s).find((e) => e.path === s.copySel[0]);
  const summary = entry && s.copyInfo[copyKey(s.copySource, entry)]?.summary;
  return entry && summary && summary.verified && summary.kind !== 'unknown' ? { entry, summary } : null;
}
/** A one-line description of a firmware copy, for the confirmation. */
export function describeCopy(summary: FirmwareSummary, s: State = state): string[] {
  if (summary.kind === 'official') return [t('copyOfficial')];
  if (summary.kind === 'bridge') return [t('copyBridge')];
  const build = s.builds.find((b) => b.sha256 === summary.sha256);
  const lines = summary.slots.map((sl) => {
    const preset = build?.slots.find((x) => x.id === sl.id)?.preset;
    const parts = [sl.colorChanged ? preset || t('copyColor') : '', sl.iconChanged ? t('copyIcon') : '', sl.nameChanged ? t('copyName') : ''].filter(Boolean);
    return `${sl.names[s.lang]}  ·  ${parts.join(' / ') || t('original')}`;
  });
  if (summary.ratios.length) lines.push(t('ratioLine', { n: summary.ratios.length, l: summary.ratios.map((r) => r.name).join(' / ') }));
  if (summary.adjSoftFocus) lines.push(t('softAdjLine'));
  if (summary.brightAuto) lines.push(t(summary.brightAuto === 'balanced' ? 'brightAutoBalanced' : 'brightAutoBright'));
  if (summary.dateStamp) lines.push(t('dateLine'));
  if (summary.monoUnlock) lines.push(t(state.info?.family === 'gr3x' ? 'gr3xReplicaLine' : 'monoLine'));
  if (summary.hlgPhoto) lines.push(t('hlgLine'));
  if (summary.directFlash) lines.push(t('flashLine'));
  if (summary.hdrGainMap) lines.push(t('hdrLine'));
  if (summary.exposurePreview) lines.push(t(summary.directFlash ? 'previewLine' : 'previewLineNoFlash'));
  if (summary.adjSlots) lines.push(t('adjSlotsLine', { n: summary.adjSlots }));
  if (summary.extraSlots?.length) lines.push(t('extraLine', { n: summary.extraSlots.length, l: summary.extraSlots.map((x) => x.name).join(' / ') }));
  if (summary.lookLayout) lines.push(t('lookOrderLine', { n: summary.lookLayout.hidden.length }));
  if (summary.shutdownPictures?.length) lines.push(t('wallMenuLine', { n: summary.shutdownPictures.length, l: summary.shutdownPictures.map((p) => p.name).join(' / ') }));
  if (summary.softFocus?.length) lines.push(t('softLine', { l: softText(summary.softFocus) }));
  return lines;
}
/** Put the selected firmware copy (from the card's parked files or from a backup) on the card as the firmware to install. */
export async function writeCopy(): Promise<void> {
  if (!state.info?.models.includes(state.model)) return;
  const sourceInfo = state.info, sourceModel = state.model;
  const pick = writableCopy(); const source = state.copySource;
  const v = state.volumes.find((x) => x.id === state.volumeId);
  if (state.busy || state.fwBusy || !state.info) return;
  if (bridgeLoaded()) { askForOfficial(); return; }
  if (!pick) return;
  if (!v) { toast(t('noCard'), 'error'); return; }
  const official = pick.summary.kind === 'official';
  const fresh = newFirmwareWarning(sourceInfo) ?? undefined;
  if (!(await (official ? askOfficial(describeCopy(pick.summary), fresh) : ask(t('confirmTitle'), describeCopy(pick.summary), t('confirmOk'), fresh)))) return;
  if (state.info !== sourceInfo || state.model !== sourceModel || state.fwBusy) return;
  if (!(await preflightCard(v, pick.entry.size))) return; // QoL D1: the card must hold the copy before it is read
  try {
    set({ busy: t('opening') });
    const file = source === 'card' ? await host.parkedRead(v.id, pick.entry.path) : await host.backupRead(pick.entry.path);
    // look at the bytes that will actually be written, not at what was seen earlier
    const now = await engine.inspect(file.slice());
    if (!now.verified || now.sha256 !== pick.summary.sha256) throw new EngineError('selfcheck-failed', t('copyUnverified'));
    set({ busy: t('writing') });
    const moved = await firmwareToCard(v, file);
    set({ busy: undefined });
    if (moved !== null) doneToast(v.root, v, moved, firmwareFilename());
  } catch (e) { set({ busy: undefined }); fail(e); }
  await refreshCopies();
  void refreshVolumes();
}

// ================================================================== QoL wave A
// Plain-language error hints, project export / import, and the app's own UI language. Kept in one
// section (and one block of i18n keys) so that it merges cleanly beside other work on this file.

// ------------------------------------------------------------------ plain-language error hints
/**
 * @decision DEC-QOL-HINT-001
 * @title Known error codes get a plain-language hint; the short code stays for bug reports
 * @status accepted
 * @rationale fail() used to toast `Error · code · message`, which means nothing to most users. The
 *   codes below are the user-actionable ones thrown by the engine (core FirmwareError / JpegError)
 *   and the host (shell/internal/server/errors.go, plus the client-side `offline` / `no-host`). A host
 *   `io` error carries only the OS text, so card-full and card-removed are told apart by that text.
 *   Unknown codes keep the old `code · message` format.
 */
/** Codes meaning "this is not a firmware file GR Mod can open" (also used by openFirmware's own toast). */
const FIRMWARE_CODES = ['unsupported-firmware', 'too-short', 'unexpected-layout', 'bad-checksum', 'bad-footer', 'bad-stream', 'bad-stream-length', 'bad-decoded-length', 'bad-models'];
export const isBadFirmwareCode = (code: string): boolean => code === 'unsupported-firmware' || code.startsWith('bad-') || code === 'too-short';
const ERROR_HINTS: Record<string, Key> = {
  ...Object.fromEntries(FIRMWARE_CODES.map((c) => [c, 'hintFirmware' as Key])),
  'gr3x-unsupported': 'hintUnsupportedHere', 'feature-unsupported': 'hintUnsupportedHere', 'bad-hlg': 'hintConflict', 'no-space': 'hintFwFull',
  'too-many-ratios': 'hintTooMany', 'too-many-pictures': 'hintTooMany',
  'not-found': 'hintNotFound', forbidden: 'hintDenied', 'too-large': 'errTooBig', network: 'fwNetError', checksum: 'fwChecksum',
  offline: 'hintOffline', 'no-host': 'hintOffline',
};
/** The hint for an error code (and message, for the host's catch-all `io`), or undefined for a code without one. */
export function errorHint(code: string, message = ''): Key | undefined {
  if (code === 'io') {
    if (/no space left|not enough space|disk (is )?full|enospc|quota/i.test(message)) return 'hintCardFull';
    if (/read-only file system|write.protect|erofs|permission denied|access is denied|eacces|eperm/i.test(message)) return 'hintWriteProtected';
    if (/not ready|no such device|enodev|input\/output error|i\/o error|removed|unplugged|no longer available/i.test(message)) return 'hintRemoved';
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(ERROR_HINTS, code) ? ERROR_HINTS[code] : undefined;
}

// ------------------------------------------------------------------ project export / import
/**
 * @decision DEC-QOL-PROJECT-001
 * @title A project file is one JSON document holding both family docs and every file they point at
 * @status accepted
 * @rationale The project is spread over the host store: project.json (GR IV doc plus app settings),
 *   project-gr3.json, one preset file per slot (`preset-*`, `gr3-preset-*`), the power-off pictures
 *   (`wall-*`) and the preview photo. Exporting only the two docs would restore names and order but
 *   lose every preset and picture, so the export lists the store and takes those prefixes. All files
 *   are base64 (presets are text, pictures binary; one encoding keeps the reader simple). The official
 *   firmware (`firmware-*.bin`) and build history are left out: the first is Ricoh's and large, the
 *   second belongs to this computer. Import writes new files first, the docs next and removes stale
 *   project files last, so a failure part-way never leaves the docs pointing at files that are gone.
 */
export const PROJECT_FORMAT = 'grmod-project';
export const PROJECT_FORMAT_VERSION = 1;
const PROJECT_FILE_RE = /^(preset-|gr3-preset-|wall-)[a-z0-9._-]{1,56}$|^preview\.jpg$/;
const PROJECT_MAX_FILES = 600;
export interface ProjectExport {
  format: typeof PROJECT_FORMAT; formatVersion: number; appVersion: string; exported: string;
  project: FamilyDoc; projectGr3: FamilyDoc | null; files: Record<string, string>;
}
/** Thrown for a file that is not a (supported) project export; `code` is `bad-project` or `project-too-new`. */
export class ProjectFileError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const bad = (m: string): ProjectFileError => new ProjectFileError('bad-project', m);
function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** The project documents as they would be saved now (the open family's from the live state). */
function projectDocs(): { doc: FamilyDoc; gr3: FamilyDoc | null } {
  const s = state;
  familyDocs[familyOf(s.model)] = currentFamilyDoc();
  const doc = { ...(familyDocs.gr4 ?? {}), v: 1, page: s.page, model: s.model, lang: s.lang, fwName: s.fwName, showAll: s.showAll, previewMode: s.previewMode, ratioBackdrop: s.ratioBackdrop, tours: s.toursSeen, toursV: 2, langAuto: s.langAuto, uiLang: uiLangPref(), compareWith: s.compareWith };
  return { doc, gr3: familyDocs.gr3 ? { v: 1, ...familyDocs.gr3 } : null };
}
/** Everything needed to restore the work, read from the host store and the live state. */
export async function buildProjectExport(): Promise<ProjectExport> {
  const { doc, gr3 } = projectDocs();
  const files: Record<string, string> = {};
  for (const { key } of await host.storeList()) {
    if (!PROJECT_FILE_RE.test(key)) continue;
    const bytes = await host.storeGet(key);
    if (bytes) files[key] = toBase64(bytes);
  }
  return { format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION, appVersion: host.info?.version ?? '', exported: new Date().toISOString(), project: doc, projectGr3: gr3, files };
}
/** Checks the format, version and shape of an export; throws ProjectFileError, returns the export otherwise. */
export function parseProjectExport(text: string): ProjectExport {
  let p: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { p = JSON.parse(text); } catch { throw bad('not JSON'); }
  if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) throw bad('not a GR Mod project');
  if (!Number.isInteger(p.formatVersion) || p.formatVersion < 1) throw bad('no format version');
  if (p.formatVersion > PROJECT_FORMAT_VERSION) throw new ProjectFileError('project-too-new', `format ${p.formatVersion}`);
  if (!p.project || typeof p.project !== 'object' || p.project.v !== 1) throw bad('no project document');
  if (p.projectGr3 != null && (typeof p.projectGr3 !== 'object' || p.projectGr3.v !== 1)) throw bad('bad GR III document');
  if (!p.files || typeof p.files !== 'object' || Array.isArray(p.files)) throw bad('no files');
  const keys = Object.keys(p.files);
  if (keys.length > PROJECT_MAX_FILES) throw bad('too many files');
  for (const k of keys) {
    if (!PROJECT_FILE_RE.test(k)) throw bad(`unexpected file ${k.slice(0, 40)}`);
    if (typeof p.files[k] !== 'string') throw bad(`bad data for ${k}`);
    try { fromBase64(p.files[k]); } catch { throw bad(`bad data for ${k}`); }
  }
  return { format: PROJECT_FORMAT, formatVersion: p.formatVersion, appVersion: String(p.appVersion ?? ''), exported: String(p.exported ?? ''), project: p.project, projectGr3: p.projectGr3 ?? null, files: p.files };
}
let importingProject = false;
/** Replace the project in the host store with an export's, then load it the way init() does. */
export async function applyProjectExport(p: ProjectExport): Promise<void> {
  // A pending undo record belongs to the project being replaced: its deferred file delete runs now (before the import writes) and Undo no longer applies.
  flushDeleted();
  importingProject = true; clearTimeout(saveTimer);
  // The interface language is a setting of the app, not project content: the import keeps the current one (startup, init(), still restores the saved one).
  // @decision DEC-TOURS-KEEP-001: the guides already seen are an app setting too. An import or a snapshot
  // restore keeps them (the union with the file's), so an older snapshot or a project from a fresh install
  // does not start every guide again (the first-run guides could not be skipped).
  const tours = [...new Set([...state.toursSeen, ...(Array.isArray(p.project.tours) ? (p.project.tours as TourId[]) : [])])];
  const project = { ...p.project, uiLang: uiLangPref(), tours, toursV: 2 };
  try {
    const have = (await host.storeList()).map((k) => k.key).filter((k) => PROJECT_FILE_RE.test(k));
    for (const [key, b64] of Object.entries(p.files)) await host.storeSet(key, fromBase64(b64));
    await host.storeSet('project.json', JSON.stringify(project));
    if (p.projectGr3) await host.storeSet(GR3_PROJECT, JSON.stringify(p.projectGr3));
    else await host.storeDel(GR3_PROJECT).catch(() => undefined);
    for (const key of have) if (!(key in p.files)) await host.storeDel(key).catch(() => undefined);
    // The old work is dropped before the new is read; the kept firmware of the new camera is reopened by restoreProject.
    familyLoading = false; ++familyGen;
    set({ info: undefined, raw: undefined, fwName: undefined, copyInfo: {}, copySel: [] });
    await restoreProject(project, p.projectGr3);
    saveFailing = false;
  } finally { importingProject = false; }
}
/** The header-menu action: save the project as one downloaded file. */
export async function exportProject(): Promise<void> {
  if (!host.available || state.busy) return;
  set({ busy: t('projectWorking') });
  try {
    const p = await buildProjectExport();
    const d = new Date(), pad = (n: number): string => String(n).padStart(2, '0');
    const name = `grmod-project-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.grmod.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(p)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const n = Object.keys(p.files).length;
    toast(t(n === 0 ? 'projectExported0' : n === 1 ? 'projectExported1' : 'projectExported', { n }), 'ok');
  } catch (e) { fail(e); } finally { set({ busy: undefined }); }
}
/** The header-menu action: validate a chosen file, confirm the replacement, then import it. Bad input toasts and changes nothing. */
export async function importProject(file: File): Promise<void> {
  if (!host.available || state.busy) return;
  let p: ProjectExport;
  try {
    if (file.size > 400_000_000) throw bad('too large');
    p = parseProjectExport(await file.text());
  } catch (e) {
    console.warn('project file rejected', e);
    toast(e instanceof ProjectFileError && e.code === 'project-too-new' ? t('projectTooNew') : t('projectBad'), 'error');
    return;
  }
  if (!(await ask(t('projectImportTitle'), [t('projectImportLine', { v: p.appVersion || '?', n: Object.keys(p.files).length })], t('projectImportOk'), t('projectImportWarn')))) return;
  set({ busy: t('projectWorking') });
  // A pending delete is committed before the snapshot, so neither the snapshot nor the import races its deferred storeDel.
  flushDeleted();
  try { await takeSnapshot('import'); await applyProjectExport(p); toast(t('projectImported'), 'ok'); }
  catch (e) { fail(e); }
  finally { set({ busy: undefined }); }
}

// ================================================================== QoL batch D1
// Card preflight, project snapshots, "New project" and comparing two firmware files. One section
// (and one block of i18n keys at the end of each dictionary) so that it merges cleanly beside other work.

// ------------------------------------------------------------------ card preflight
/**
 * @decision DEC-QOLD1-PREFLIGHT-001
 * @title Check space and presence of a card with a fresh volume list before any write to it
 * @status accepted
 * @rationale A full card used to fail mid-write (after the old firmware was moved aside). The
 *   check runs in firmwareToCard (every card write: a build, a stock copy, writeCopy) with the exact
 *   size, and once earlier with the source size so that a hopeless card is refused before the
 *   build and, in writeCopy, before the copy is read. The cached `state.volumes` can be minutes old, so the host is asked
 *   again. A card needs the file plus 1 MiB of margin (the file system's own bookkeeping); moves
 *   into `GRMOD\parked-*` are renames on the same volume and need nothing. Folder exports never
 *   reach this. Volume carries no read-only flag on any platform (shell/internal/platform), so a
 *   write-protected card cannot be seen beforehand: the host's write error (EROFS / "write
 *   protected" / permission denied, code `io`; `forbidden` for the rest) is mapped to a
 *   write-protect hint after the fact by errorHint(). A volume that reports no size at all is not checked.
 */
export const CARD_MARGIN = 1 << 20;
/** True when `v` is still mounted and has room for `need` bytes; otherwise toasts why (needed vs free) and returns false. */
export async function preflightCard(v: Volume, need: number): Promise<boolean> {
  let volumes: Volume[];
  try { volumes = await host.volumes(state.showAll); }
  catch (e) { fail(e); return false; }
  const fresh = volumes.find((x) => x.id === v.id);
  if (JSON.stringify(volumes) !== JSON.stringify(state.volumes)) set({ volumes });
  if (!fresh) { toast(t('preflightGone', { c: v.id }), 'error'); void refreshVolumes(); return false; }
  if (fresh.total === 0 && fresh.free === 0) return true;
  if (fresh.free < need + CARD_MARGIN) { toast(t('preflightSpace', { c: fresh.id, need: fmtSize(need + CARD_MARGIN), free: fmtSize(fresh.free) }), 'error'); return false; }
  return true;
}

// ------------------------------------------------------------------ project snapshots
/**
 * @decision DEC-QOLD1-SNAP-001
 * @title Snapshots are project exports kept in the host store, newest 10, listed by a small index
 * @status accepted
 * @rationale A snapshot is exactly what buildProjectExport() makes, so restoring one is
 *   applyProjectExport() (the import path, with its write-new-first ordering). Files: `snapshot-<ms>.json`
 *   (key rules: lower case, at most 64 characters) and `snapshots.json` (the index: time, reason,
 *   a content signature and counts for the dialog, so the list needs no big reads). Neither matches
 *   PROJECT_FILE_RE, so they are never part of an export or touched by an import. A snapshot is
 *   taken before an import, before New project, before a restore (so a restore can be undone) and
 *   after a successful build; one identical to the newest (same signature) is skipped. The index is
 *   written before the oldest files are deleted, so a crash leaves an orphan file, never an index
 *   entry without data. All work is serialised, and a failure never blocks the action: it warns once
 *   until a snapshot succeeds again.
 */
export type SnapshotReason = 'import' | 'new' | 'build' | 'restore';
export interface SnapshotEntry { id: string; time: number; reason: SnapshotReason; sig: string; model: string; slots: number; extras: number; ratios: number; pictures: number }
export const SNAPSHOT_KEEP = 10;
const SNAP_INDEX = 'snapshots.json';
const snapKey = (id: string): string => `snapshot-${id}.json`;
/** FNV-1a over the content, to skip a snapshot that equals the newest. */
function contentSig(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length.toString(36)}-${h.toString(36)}`;
}
async function readSnapIndex(): Promise<SnapshotEntry[]> {
  try {
    const raw = await host.storeGet(SNAP_INDEX);
    const j = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
    const list: unknown = j && j.v === 1 ? j.entries : [];
    return Array.isArray(list) ? (list as SnapshotEntry[]).filter((e) => e && typeof e.id === 'string' && /^[0-9]{1,16}$/.test(e.id) && typeof e.time === 'number') : [];
  } catch { return []; }
}
/** What a project export holds, in numbers (the open camera's family: its edited slots, added slots, ratios and pictures). */
function snapshotCounts(p: ProjectExport): Pick<SnapshotEntry, 'model' | 'slots' | 'extras' | 'ratios' | 'pictures'> {
  const model: CameraModel = ['GR3', 'GR3_HDF', 'GR3X', 'GR3X_HDF', 'HDF', 'STANDARD', 'MONO'].includes(p.project.model) ? p.project.model : 'HDF';
  const d: FamilyDoc = familyOf(model) === 'gr3' ? (p.projectGr3 ?? p.project) : p.project;
  const edited = Object.values((d.slots ?? {}) as Record<string, { preset?: unknown; names?: Record<string, string>; icon?: { mode?: string } }>)
    .filter((x) => x && (x.preset || Object.values(x.names ?? {}).some((n) => !!n) || (x.icon?.mode && x.icon.mode !== 'keep'))).length;
  const n = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  return { model, slots: edited, extras: n(d.extras), ratios: n(d.ratios), pictures: n(d.wall) };
}
let snapChain: Promise<unknown> = Promise.resolve();
let snapWarned = false;
/** Take a snapshot of the project now. Never throws; resolves to false (and warns once) when it could not be kept. */
export function takeSnapshot(reason: SnapshotReason): Promise<boolean> {
  const run = snapChain.then(async () => {
    if (!host.available) return false;
    try {
      const p = await buildProjectExport();
      const body = JSON.stringify(p);
      const sig = contentSig(JSON.stringify({ project: p.project, projectGr3: p.projectGr3, files: p.files }));
      const index = await readSnapIndex();
      if (index.length && index[index.length - 1].sig === sig) return true;
      let time = Date.now();
      if (index.length && time <= index[index.length - 1].time) time = index[index.length - 1].time + 1;
      const entry: SnapshotEntry = { id: String(time), time, reason, sig, ...snapshotCounts(p) };
      await host.storeSet(snapKey(entry.id), body);
      const all = [...index, entry].sort((a, b) => a.time - b.time);
      const dropped = all.slice(0, Math.max(0, all.length - SNAPSHOT_KEEP)), kept = all.slice(dropped.length);
      await host.storeSet(SNAP_INDEX, JSON.stringify({ v: 1, entries: kept }));
      for (const d of dropped) await host.storeDel(snapKey(d.id)).catch(() => undefined);
      snapWarned = false;
      return true;
    } catch (e) {
      console.warn('snapshot', e);
      if (!snapWarned) { snapWarned = true; toast(t('snapshotFailed'), 'info'); }
      return false;
    }
  });
  snapChain = run.catch(() => undefined);
  return run;
}
/** The snapshots whose data is still in the store, newest first. */
async function listSnapshots(): Promise<SnapshotEntry[]> {
  const have = new Set((await host.storeList().catch(() => [])).map((k) => k.key));
  return (await readSnapIndex()).filter((e) => have.has(snapKey(e.id))).sort((a, b) => b.time - a.time);
}
export function closeSnapshots(): void { set({ snapshotsView: undefined }); }
/** The "Restore an earlier version…" dialog: reads the list. */
export async function openSnapshots(): Promise<void> {
  if (!host.available || state.busy) return;
  set({ snapshotsView: { entries: [], busy: true } });
  const entries = await listSnapshots();
  if (state.snapshotsView) set({ snapshotsView: { entries, busy: false } });
}
/** Restore snapshot `id` through the import path, after a confirm; the current state is snapshotted first so that this can be undone. */
export async function restoreSnapshot(id: string): Promise<void> {
  if (!host.available || state.busy) return;
  const entry = (state.snapshotsView?.entries ?? []).find((e) => e.id === id);
  let p: ProjectExport;
  try {
    const raw = await host.storeGet(snapKey(id));
    if (!raw) throw bad('snapshot missing');
    p = parseProjectExport(new TextDecoder().decode(raw));
  } catch (e) { console.warn('snapshot unreadable', e); toast(t('snapshotMissing'), 'error'); void openSnapshots(); return; }
  const when = new Date(entry?.time ?? Number(id)).toLocaleString();
  closeSnapshots();
  if (!(await ask(t('snapshotRestoreTitle'), [`${when} · ${t(('snapshotReason_' + (entry?.reason ?? 'build')) as Key)}`, snapshotSummary(entry ?? { ...snapshotCounts(p) })], t('snapshotRestoreOk'), t('snapshotRestoreWarn')))) return;
  set({ busy: t('projectWorking') });
  try {
    // The version being restored is already in memory (`p`): the snapshot below may prune it from the store when the list is full.
    await takeSnapshot('restore');
    flushDeleted();
    await applyProjectExport(p);
    toast(t('snapshotRestored'), 'ok');
  } catch (e) { fail(e); }
  finally { set({ busy: undefined }); }
}
/** "GR IV HDF · 3 slots · 2 added slots · 1 ratio" for the dialog's rows. */
export function snapshotSummary(e: Pick<SnapshotEntry, 'model' | 'slots' | 'extras' | 'ratios' | 'pictures'>): string {
  return [e.model, t('snapshotSlots', { n: e.slots }), t('snapshotExtras', { n: e.extras }), t('snapshotRatios', { n: e.ratios }), ...(e.pictures ? [t('snapshotPictures', { n: e.pictures })] : [])].join(' · ');
}

// ------------------------------------------------------------------ New project
/**
 * @decision DEC-QOLD1-NEW-001
 * @title New project resets the open camera family's work only, after a snapshot
 * @status accepted
 * @rationale Slots, added slots, look order, ratios, power-off pictures and the switches live in
 *   one FamilyDoc per family (GR IV; GR III / IIIx). The reset is enterFamily() on an empty doc
 *   (the same path as switching camera), so emptySlots() and parseFamily() define "fresh". Kept:
 *   the open official firmware, the preset library (`lib-*`), the other family's doc, and the
 *   app settings (uiLang, camera language, model, tours seen, preview choices). The new doc is saved
 *   before this family's files (`preset-*` or `gr3-preset-*`, and the `wall-*` pictures its doc
 *   named) are deleted, so a crash never leaves a doc pointing at missing files. The preview
 *   photo is a setting, not work, and stays.
 */
export async function newProject(): Promise<void> {
  if (!host.available || state.busy) return;
  if (!(await ask(t('newProjectTitle'), [t('newProjectLine')], t('newProjectOk'), t('newProjectWarn')))) return;
  set({ busy: t('projectWorking') });
  try {
    await takeSnapshot('new');
    flushDeleted();
    const fam = familyOf(state.model);
    const doc = currentFamilyDoc();
    const wallIds = (Array.isArray(doc.wall) ? doc.wall : []).map((w: { id: string }) => String(w.id));
    familyDocs[fam] = null; familyLoading = false; ++familyGen;
    enterFamily(fam);
    set({ compareWith: 'orig' });
    clearTimeout(saveTimer);
    await saveProject();
    const prefix = fam === 'gr3' ? 'gr3-preset-' : 'preset-';
    const stale = (await host.storeList()).map((k) => k.key).filter((k) => (k.startsWith(prefix) && PROJECT_FILE_RE.test(k)) || (k.startsWith('wall-') && wallIds.includes(k.slice(5))));
    for (const k of stale) await host.storeDel(k).catch(() => undefined);
    toast(t('newProjectDone'), 'ok');
  } catch (e) { fail(e); }
  finally { set({ busy: undefined }); }
}

// ------------------------------------------------------------------ compare two firmware files
/**
 * @decision DEC-QOLD1-COMPARE-001
 * @title The second file is inspected the same way, against the same open official firmware
 * @status accepted
 * @rationale engine.inspect reports each file relative to the open official firmware, so two
 *   summaries are comparable row by row without a second reference. The comparison itself (compare.ts)
 *   is a pure function of the two summaries; the dialog only lays it out. Single-file inspect is
 *   unchanged: `other` is simply absent until a second file is chosen, and choosing a new first file clears it.
 */
export async function inspectCompare(file: File): Promise<void> {
  const v = state.inspectView; if (!v?.summary) return;
  const gen = inspectGen;
  const side = { name: file.name, size: file.size };
  if (file.size < 1_000_000 || file.size > 200_000_000) { set({ inspectView: { ...v, other: { ...side, busy: false, error: 'size' } } }); return; }
  set({ inspectView: { ...v, other: { ...side, busy: true } } });
  const put = (other: NonNullable<InspectView['other']>): void => { if (gen === inspectGen && state.inspectView) set({ inspectView: { ...state.inspectView, other } }); };
  try { put({ ...side, busy: false, summary: await engine.inspect(new Uint8Array(await file.arrayBuffer())) }); }
  catch (e) { console.warn('inspect compare', e); put({ ...side, busy: false, error: 'unreadable' }); }
}
export function closeCompare(): void { const v = state.inspectView; if (v?.other) set({ inspectView: { ...v, other: undefined } }); }
// ================================================================== QoL batch D2
// ------------------------------------------------------------------ export a slot's look as a .cube
/**
 * @decision DEC-QOL-EXPORTCUBE-UI-001
 * @title "Export look as .cube" renders core's exportSlotCube from the slot's fitted params
 * @status accepted
 * @rationale The file is made by core (color/export-cube.ts, DEC-QOL-EXPORTCUBE-001 defines what it
 *   represents: the slot model applied to a Standard sRGB picture, colour and tone only, no halation
 *   or grain). The UI side only picks the camera model by family (GR III / IIIx: GR3X_CAMERA, else
 *   GR IV's), names the file after the slot (what the camera menu shows, made file-name safe) and
 *   downloads it the way the project export does. It needs a fitted result; a slot without one has
 *   no button.
 */
/** The name a slot has in the camera's menu, for file names: an added slot's name, else the language's name of a built-in one. */
export function slotLabel(k: SlotKey, s: State = state): string {
  if (isExtra(k)) { const x = s.extras.find((e) => e.key === k); return x ? extraName(x, s) : k; }
  const id = k as SlotId, off = s.info?.slots.find((x) => x.id === id);
  return s.slots[id]?.names[s.lang] || (s.info?.family === 'gr3x' ? off?.defaultName : id === 'CG' ? t('slotCG') : t('slotCY')) || id;
}
const fileSafe = (n: string): string => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'look';
function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
/** The .cube text of a slot's fitted look and the name it downloads as; undefined without a fitted result. */
export function slotCube(k: SlotKey, s: State = state): { name: string; text: string } | undefined {
  const params = slotOf(k, s)?.preset?.result?.params;
  if (!params) return undefined;
  const name = slotLabel(k, s);
  return { name: fileSafe(name) + '.cube', text: color.exportSlotCube(params, { title: name, camera: s.info?.family === 'gr3x' ? 'gr3x' : 'gr4' }) };
}
export function exportSlotCubeFile(k: SlotKey): void {
  try {
    const c = slotCube(k);
    if (!c) { toast(t('exportCubeNone'), 'error'); return; }
    downloadText(c.name, c.text, 'text/plain');
    toast(t('exportCubeDone', { name: c.name }), 'ok');
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ duplicate an added slot
/**
 * @decision DEC-QOL-DUPLICATE-001
 * @title Duplicating an added slot copies its fitted look and file, never re-fits, and sits right after the source
 * @status accepted
 * @rationale A user who wants a variant of an added slot (same look, another name or icon) should not
 *   have to import and fit the file again. The copy takes the source's icon (pixels copied, not shared),
 *   halation, hidden state and preset (the fitted result is immutable, so it is shared by reference; the
 *   source file is stored again under the new key, as an imported file is). It is inserted right after
 *   the source in both `extras` and the menu order. The name is the source's name with a numeric suffix
 *   (" 2", " 3", ... the first one no added slot has; a number already at the end of the name is kept unless the name without it is another slot's), the base cut so the whole stays within
 *   EXTRA_NAME_MAX and so passes validateExtraSlotName whenever the source's name did. A source whose
 *   fit is still running is refitted for the copy instead of copied half done. The limit
 *   MAX_EXTRA_SLOTS is the same as for adding (the button is disabled with the reason).
 */
/** Why an added slot cannot be duplicated now (the limit), or null. */
export function duplicateExtraProblem(s: State = state): string | null {
  return s.extras.length >= MAX_EXTRA_SLOTS ? t('extraDuplicateFull', { n: MAX_EXTRA_SLOTS }) : null;
}
/** The name for a copy of `name`: a number suffix not used by another added slot, within EXTRA_NAME_MAX. */
export function duplicateName(name: string, taken: readonly string[]): string {
  // a trailing number is only a copy's suffix when the name without it is another slot's ("Warm 2" next to "Warm"); "Warm 400" keeps its 400
  const m = /^(.*\S)\s+\d+$/.exec(name);
  const base = m && taken.includes(m[1]) ? m[1] : name;
  for (let n = 2; n < 1000; n++) {
    const suffix = ' ' + n;
    const cand = base.slice(0, Math.max(1, EXTRA_NAME_MAX - suffix.length)).trimEnd() + suffix;
    if (!taken.includes(cand)) return cand;
  }
  return base;
}
/** Make a copy of an added slot right after it. Returns the new key, or undefined at the limit / for an unknown key. */
export function duplicateExtraSlot(key: string): string | undefined {
  const src = state.extras.find((x) => x.key === key);
  if (!src) return undefined;
  const full = duplicateExtraProblem();
  if (full) { toast(full, 'info'); return undefined; }
  const newKey = 'x-' + Math.random().toString(36).slice(2, 10);
  const name = duplicateName(extraName(src), state.extras.map((x) => extraName(x)));
  const p = src.preset;
  const copy: ExtraSlot = {
    key: newKey, name,
    icon: { ...src.icon, ...(src.icon.pixels ? { pixels: new Uint8Array(src.icon.pixels) } : {}) },
    ...(src.halation ? { halation: { ...src.halation } } : {}),
    ...(p ? { preset: { ...p } } : {}),
  };
  const hidden = state.lookHidden.includes(key);
  set((s) => {
    const at = s.extras.findIndex((x) => x.key === key);
    const extras = s.extras.slice(); extras.splice(at + 1, 0, copy);
    const order = normalizeLookOrder(s.lookOrder, s.extras); order.splice(order.indexOf(key) + 1, 0, newKey);
    return { extras, lookOrder: order, lookHidden: hidden ? [...s.lookHidden, newKey] : s.lookHidden, activeSlot: newKey };
  });
  if (p && host.available) void host.storeSet(presetKey(newKey), p.text).catch(() => undefined);
  if (p?.busy) void runPreset(newKey, p.fileName, p.kind, p.text); // the source's conversion is not finished: the copy runs its own
  if (!copy.icon.pixels) void renderIcon(newKey);
  scheduleSave();
  toast(t('extraDuplicated', { name }), 'ok');
  return newKey;
}

// ------------------------------------------------------------------ batch preset import
/**
 * @decision DEC-QOL-BATCH-001
 * @title Several preset files at once fill empty slots in order, never overwrite, and ask before adding slots
 * @status accepted
 * @rationale Importing a pack of looks meant one drop per slot. With several .xmp / .cube files the
 *   targets are, in order: the slot the files were dropped on or picked for (the active slot when none
 *   is given) if it has no usable preset, then every other slot without one in menu order (built-in
 *   slots, then added slots). A slot "has a preset" when it holds one that did not fail: a failed
 *   conversion is replaced, a good look never is. Files beyond the free slots are skipped, unless
 *   the camera is a GR IV (the only family with added slots) and there is room under
 *   MAX_EXTRA_SLOTS: then, once the free slots are filled, one ask() offers to add that many slots for them (declining skips them).
 *   Fitting runs one file after another through the ordinary loadPresetFile / runPreset path, so
 *   options, storage and stale-run guards are identical to a single import; the busy overlay shows
 *   "i of n". A final toast counts applied, skipped and failed files and names the failed ones. One
 *   file behaves exactly as before (loadPresetFile on the given slot, replacing what is there).
 */
const hasUsablePreset = (k: SlotKey, s: State = state): boolean => { const p = slotOf(k, s)?.preset; return !!p && !p.error; };
/** The slots a batch of files goes to, in order (see DEC-QOL-BATCH-001): `from` first when it is free, then the other free slots. */
export function batchTargets(from: SlotKey = state.activeSlot, s: State = state): SlotKey[] {
  const keys = allSlotKeys(s), free = keys.filter((k) => !hasUsablePreset(k, s));
  return keys.includes(from) && free.includes(from) ? [from, ...free.filter((k) => k !== from)] : free;
}
/** How many more slots could be added for a batch (GR IV only; not on the Monochrome, which builds none). */
const batchRoom = (s: State = state): number => (s.info && s.info.family !== 'gr3x' && s.model !== 'MONO' ? Math.max(0, MAX_EXTRA_SLOTS - s.extras.length) : 0);
export async function loadPresetFiles(files: File[], from?: SlotKey): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) { await loadPresetFile(from ?? state.activeSlot, files[0]); return; }
  if (state.busy) return;
  const slots = batchTargets(from);
  const rest = files.slice(slots.length);
  const failed: string[] = []; let applied = 0, skipped = rest.length, firstSlot: SlotKey | undefined;
  const caps = !!state.info?.capabilities.presets;
  /** Fit `list` into `into` one after another; `done` of `total` files are behind when it starts (for the progress text). */
  const run = async (into: SlotKey[], list: File[], done: number, total: number): Promise<void> => {
    firstSlot ??= into[0];
    set({ busy: t('batchProgress', { i: done + 1, n: total }) });
    try {
      for (let i = 0; i < list.length; i++) {
        set({ busy: t('batchProgress', { i: done + i + 1, n: total }) });
        try { await loadPresetFile(into[i], list[i]); } catch { /* counted below */ }
        const p = slotOf(into[i])?.preset;
        if (p && p.fileName === list[i].name && !p.error && (p.result || !caps)) applied++; else failed.push(list[i].name);
      }
    } finally { set({ busy: undefined }); }
  };
  const room = Math.min(rest.length, batchRoom());
  if (slots.length) await run(slots, files.slice(0, slots.length), 0, slots.length + room);
  // the free slots are used up: offer added slots for the files that are left (GR IV, room under the limit)
  if (room > 0 && await ask(t('batchAddTitle'), [t('batchAddLine', { n: rest.length }), t('batchAddFiles', { n: room, names: rest.slice(0, room).map((f) => f.name).join(', ') })], t('batchAddOk'))) {
    const before = new Set(state.extras.map((x) => x.key));
    for (let i = 0; i < room; i++) addExtraSlot();
    const added = state.extras.map((x) => x.key).filter((k) => !before.has(k));
    await run(added, rest.slice(0, added.length), slots.length, slots.length + added.length);
    skipped = rest.length - added.length;
  }
  if (firstSlot) setActiveSlot(firstSlot);
  const parts = [t('batchDone', { n: applied })];
  if (skipped) parts.push(t('batchSkipped', { n: skipped }));
  if (failed.length) parts.push(t('batchFailed', { n: failed.length, names: failed.slice(0, 3).join(', ') + (failed.length > 3 ? ` +${failed.length - 3}` : '') }));
  toast(parts.join(' · '), failed.length ? 'error' : 'ok');
}

// ------------------------------------------------------------------ library rename, search and sort
/**
 * @decision DEC-QOL-LIBRARY-002
 * @title Renaming only edits the index; search and sort are pure views over the entries
 * @status accepted
 * @rationale An entry's files are keyed by its id (DEC-QOL-LIBRARY-001), so renaming rewrites only
 *   library.json (one write: nothing can be left half done) and keeps the id, date and files. Names
 *   stay unique per family, as saving enforces (same trimmed, 60-character, exact comparison): a
 *   clash is refused with 'exists' and nothing is written. Search matches the name or the file name,
 *   case-insensitive, on the trimmed query; sort is newest first (the default, so a fresh save is at
 *   the top) or by name (locale-aware, case-insensitive). Both are functions of the list so the
 *   dialog holds only the query and the sort choice, and they are tested without the dialog. The box
 *   shows only above LIBRARY_SEARCH_MIN entries, where scanning by eye stops being easy.
 */
export const LIBRARY_SEARCH_MIN = 5;
export type LibrarySort = 'new' | 'name';
export type RenameResult = 'ok' | 'empty' | 'exists' | 'missing' | 'failed';
/** Rename an entry. 'empty' for a blank name, 'exists' when another entry of its family has it, 'missing' for an unknown id, 'failed' when the index could not be written. */
export async function renameLibraryEntry(entryId: string, name: string): Promise<RenameResult> {
  const clean = name.trim().slice(0, 60);
  const e = state.library.find((x) => x.id === entryId);
  if (!e) return 'missing';
  if (!clean) return 'empty';
  if (clean === e.name) return 'ok';
  if (state.library.some((x) => x.id !== entryId && x.family === e.family && x.name === clean)) return 'exists';
  const entries = state.library.map((x) => (x.id === entryId ? { ...x, name: clean } : x));
  if (!(await writeLibraryIndex(entries))) { toast(t('libSaveFailed'), 'error'); return 'failed'; }
  set({ library: entries });
  return 'ok';
}
/** The entries whose name or file name contains the query (case-insensitive); all of them for a blank query. */
export function searchLibrary(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const q = query.trim().toLowerCase();
  return q ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.fileName.toLowerCase().includes(q)) : entries.slice();
}
/** Newest first (ties keep their order), or by name. */
export function sortLibrary(entries: readonly LibraryEntry[], by: LibrarySort): LibraryEntry[] {
  const out = entries.slice();
  return by === 'name' ? out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || b.date - a.date) : out.sort((a, b) => b.date - a.date);
}
