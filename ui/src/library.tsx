// QoL wave C: the preset library in the interface: two buttons on a slot's preset row and one dialog.
// The logic (files, compatibility, reuse of a stored fit) is in store.ts, "preset library".
import { useEffect, useMemo, useState } from 'react';
import { Ico } from './components';
import { t } from './i18n';
import { host } from './host';
import {
  applyFromLibrary, closeLibrary, defaultLibraryName, deleteLibraryEntry, libraryFor, loadLibrary, openLibrary, saveToLibrary, slotOf, useStore,
} from './store';
import type { SlotKey } from './store';

/** "Save to library" (when the slot has a fitted preset) and "Apply from library" under a slot's preset. Nothing without the host: the library is its files. */
export function LibraryButtons({ k }: { k: SlotKey }) {
  const ready = useStore((s) => !!slotOf(k, s)?.preset?.result);
  useEffect(() => { void loadLibrary(); }, []);
  if (!host.available) return null;
  return (
    <div className="chips lib-buttons">
      {ready && <button className="btn small" onClick={() => openLibrary(k, 'save')}>{t('libSave')}</button>}
      <button className="btn small" onClick={() => openLibrary(k, 'apply')}>{t('libApply')}</button>
    </div>
  );
}

/** The dialog behind both buttons: a name field in save mode, the entries of this camera family (with a delete each) in apply mode. */
export function LibraryDialog() {
  const picker = useStore((s) => s.libraryPicker);
  // Stable fields only: libraryFor filters and sorts into a fresh array, which as a selector never settles (React error #185).
  const library = useStore((s) => s.library); const model = useStore((s) => s.model);
  const entries = useMemo(() => libraryFor({ library, model }), [library, model]);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!picker) return;
    setName(defaultLibraryName(picker.slot));
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeLibrary(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picker]);
  if (!picker) return null;
  const save = picker.mode === 'save';
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLibrary(); }}>
      <div className="dialog lib-dialog" role="dialog" aria-modal="true" aria-label={save ? t('libTitleSave') : t('libTitleApply')}>
        <h3>{save ? t('libTitleSave') : t('libTitleApply')}</h3>
        {save ? (
          <form className="lib-save" onSubmit={(e) => { e.preventDefault(); void saveToLibrary(picker.slot, name).then((ok) => { if (ok) closeLibrary(); }); }}>
            <label className="small muted" htmlFor="lib-name">{t('libName')}</label>
            <input id="lib-name" className="input" value={name} maxLength={60} autoFocus spellCheck={false} onChange={(e) => setName(e.target.value)} />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={closeLibrary}>{t('cancel')}</button>
              <button type="submit" className="btn primary" disabled={!name.trim()}>{t('libSaveBtn')}</button>
            </div>
          </form>
        ) : (
          <>
            {entries.length === 0 && <p className="small muted">{t('libEmpty')}</p>}
            <ul className="lib-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button className="lib-pick" onClick={() => { void applyFromLibrary(picker.slot, e.id); }}>
                    <span className="lib-name ellipsis">{e.name}</span>
                    <span className="lib-meta small muted">{e.kind.toUpperCase()} · {t(e.family === 'gr3' ? 'libFamilyGr3' : 'libFamilyGr4')} · {e.date ? new Date(e.date).toLocaleDateString() : ''}</span>
                  </button>
                  <button className="btn ghost icon-only" title={t('libDelete')} aria-label={t('libDelete')} onClick={() => { void deleteLibraryEntry(e.id); }}>{Ico.x}</button>
                </li>
              ))}
            </ul>
            <div className="dialog-actions"><button className="btn" onClick={closeLibrary}>{t('done')}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
