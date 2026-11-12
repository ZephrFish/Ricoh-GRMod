// The "Inspect a firmware file" dialog: what any firmware .bin is (official or modified, verified,
// the features it switches on, ratios, added slots), read by the engine against the open official firmware.
import { useEffect } from 'react';
import type { FirmwareSummary } from '@grmod/core';
import { DropZone, FileButton, Ico, IconCanvas } from './components';
import { modelLabel } from './firmware';
import { t } from './i18n';
import type { Key } from './i18n';
import { closeInspect, fmtSize, inspectFile, softText, useStore } from './store';

/** Every feature flag of a FirmwareSummary as label / on, in the order the pages list them. */
export function featureRows(s: FirmwareSummary): { label: string; on: boolean; detail?: string }[] {
  const bright = s.brightAuto === 'balanced' ? t('brightAutoBalanced') : s.brightAuto ? t('brightAutoBright') : '';
  return [
    { label: t('navSoft'), on: s.adjSoftFocus || (s.softFocus?.length ?? 0) > 0, detail: s.softFocus?.length ? softText(s.softFocus) : s.adjSoftFocus ? 'ADJ' : undefined },
    { label: t('navDate'), on: s.dateStamp },
    { label: t('navMono'), on: s.monoUnlock },
    { label: t('navHdr'), on: !!s.hdrGainMap },
    { label: t('navHlg'), on: s.hlgPhoto },
    { label: t('navBrightAuto'), on: !!s.brightAuto, detail: bright || undefined },
    { label: t('navPreview'), on: !!s.exposurePreview },
    { label: t('navFlash'), on: !!s.directFlash },
    { label: t('navAdjSlots'), on: !!s.adjSlots, detail: s.adjSlots ? String(s.adjSlots) : undefined },
  ];
}

const KIND: Record<FirmwareSummary['kind'], Key> = { official: 'inspectKindOfficial', modified: 'inspectKindModified', bridge: 'inspectKindBridge', unknown: 'inspectKindUnknown' };
const ERROR: Record<'needs-open' | 'unreadable' | 'size', Key> = { 'needs-open': 'inspectNeedsOpen', unreadable: 'inspectUnreadable', size: 'inspectSize' };

export function InspectDialog() {
  const v = useStore((s) => s.inspectView);
  const info = useStore((s) => s.info);
  const model = useStore((s) => s.model);
  const lang = useStore((s) => s.lang);
  useEffect(() => {
    if (!v) return;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeInspect(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [!!v]);
  if (!v) return null;
  const s = v.summary;
  const pick = (f: File[]): void => { void inspectFile(f[0]); };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeInspect(); }}>
      <DropZone onFiles={pick} accept={(f) => /\.bin$/i.test(f.name)} className="dialog inspect">
        <div role="dialog" aria-modal="true" aria-label={t('inspectTitle')}>
          <h3>{t('inspectTitle')}</h3>
          <p className="muted ellipsis" title={v.name}>{v.name} · {fmtSize(v.size)}</p>
          {v.busy && <p><span className="spinner small" /> {t('inspectBusy')}</p>}
          {v.error && <p className="dialog-warn">{t(ERROR[v.error])}</p>}
          {s && (
            <ul className="dialog-lines last">
              <li><b>{t('inspectKind')}</b>: {t(KIND[s.kind])}{s.kind === 'modified' && <> · {t('inspectChanged')} {s.changedBytes}</>}</li>
              <li><b>{t('inspectVerified')}</b>: {t(s.verified ? 'inspectYes' : 'inspectNo')}</li>
              {info && <li><b>{t('inspectRef')}</b>: {modelLabel(model)} {info.version}</li>}
              {s.kind !== 'unknown' && s.kind !== 'bridge' && (
                <>
                  <li><b>{t('inspectFeatures')}</b></li>
                  {featureRows(s).map((f) => <li key={f.label}>{f.label}: {f.on ? <>{t('inspectYes')}{f.detail ? ` · ${f.detail}` : ''}</> : t('inspectNo')}</li>)}
                  <li><b>{t('inspectRatios')}</b>: {s.ratios.length ? s.ratios.map((r) => `${r.name} (${r.ratio})`).join(' / ') : t('inspectNone')}</li>
                  <li><b>{t('inspectExtras')}</b>: {s.extraSlots.length ? s.extraSlots.map((x) => x.name).join(' / ') : t('inspectNone')}</li>
                  <li><b>{t('inspectPictures')}</b>: {s.shutdownPictures?.length ? s.shutdownPictures.map((p) => p.name).join(' / ') : t('inspectNone')}</li>
                  {s.lookLayout && <li><b>{t('inspectLayout')}</b>: {t('inspectLayoutValue', { n: s.lookLayout.hidden.length })}</li>}
                  <li><b>{t('inspectSlots')}</b></li>
                  {s.slots.map((sl) => (
                    <li key={sl.id} className="inspect-slot"><IconCanvas pixels={sl.icon} scale={1} /> {sl.names[lang]}{sl.colorChanged || sl.nameChanged || sl.iconChanged ? ` · ${[sl.colorChanged ? t('copyColor') : '', sl.iconChanged ? t('copyIcon') : '', sl.nameChanged ? t('copyName') : ''].filter(Boolean).join(' / ')}` : ''}</li>
                  ))}
                </>
              )}
            </ul>
          )}
          <div className="dialog-actions">
            <FileButton accept=".bin" onFiles={pick}>{Ico.folder}<span>{t('inspectAgain')}</span></FileButton>
            <button type="button" className="btn primary" onClick={closeInspect}>{t('closeLabel')}</button>
          </div>
        </div>
      </DropZone>
    </div>
  );
}
