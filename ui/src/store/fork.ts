import { shownSlots, state } from './core';
import type { SlotKey, State } from './core';
import { outputFirmware } from './output';
import { setActiveSlot } from './photo';
import { setActiveRatio } from './ratios';
import { undoDelete, undoPending } from './undo';
// SPDX-License-Identifier: GPL-2.0-only
/**
 * The fork's own parts of the store (ZephrFish/Ricoh-GRMod), kept out of upstream's files so that
 * upstream's releases merge with as little overlap as possible:
 *
 *   keyboard shortcuts (over upstream's undo, store/undo.ts)
 *
 * The other tools the fork once had here (undo, the preset library, inspect / compare firmware, compare
 * two slots, the card space check, export .cube, duplicate and batch import) are upstream's since 0.9.4
 * (store/undo.ts, library.ts, inspect.ts, compare.ts, output.ts, cube.ts, duplicate.ts, batch.ts).
 *
 * @decision DEC-FORK-STORE-001: one fork module instead of the code spread over upstream's parts. It
 * imports from them like any other part. The error hints that `fail`
 * shows live in core.ts, because core is the part every other one imports and imports none itself.
 */

// ------------------------------------------------------------------ keyboard shortcuts
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
  !!(s.confirm || s.inspectView || s.libraryPicker || s.cropId || s.onlineOpen || s.tour || s.busy)
  || (typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]'));
/** Handle a key press; returns whether it was taken. */
export function handleShortcut(e: ShortcutKey): boolean {
  if (e.defaultPrevented || e.altKey || typing(e.target) || modalUp(state)) return false;
  const take = (): true => { e.preventDefault?.(); return true; };
  const mod = !!(e.metaKey || e.ctrlKey), key = e.key.toLowerCase();
  if (mod && !e.shiftKey && key === 'z') { if (!undoPending()) return false; undoDelete(); return take(); }
  if (mod && !e.shiftKey && key === 'e') {
    if (state.page === 'copies' || !state.info) return false;
    void outputFirmware({ kind: 'folder' });
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

