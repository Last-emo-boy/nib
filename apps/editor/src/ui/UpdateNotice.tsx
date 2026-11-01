import { useEffect, useState } from 'react';
import { desktop, type UpdateState } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';

/** The desktop app's update state, as it changes. */
export function useUpdate(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState | undefined>();
  useEffect(() => {
    if (!desktop?.updateState) return;
    void desktop.updateState().then(setState);
    return desktop.onUpdate(setState);
  }, []);
  return state;
}

/** A newer nib: restart into it once it is downloaded, or get it from its release page. */
export function UpdateNotice() {
  const t = useT();
  const s = useUpdate();
  const [hidden, setHidden] = useState<string | undefined>();
  if (!s || !s.version || hidden === s.version || (s.status !== 'ready' && !(s.status === 'available' && !s.installs))) return null;
  return (
    <div className="update-notice">
      <span>{s.status === 'ready' ? t.updateReady(s.version) : t.updateOut(s.version)}</span>
      {s.status === 'ready'
        ? <button className="dash-button primary" onClick={() => void desktop!.installUpdate()}>{t.restartToUpdate}</button>
        : <button className="dash-button primary" onClick={() => s.url && desktop!.openExternal(s.url)}>{t.download}</button>}
      <button className="dash-button" onClick={() => setHidden(s.version)}>{t.later}</button>
    </div>
  );
}

/** For Settings: the version, a check, what it found, and whether nib checks by itself. */
export function UpdateSettings() {
  const t = useT();
  const s = useUpdate();
  if (!desktop?.updateState || !s) return null;
  const line = s.status === 'checking' ? t.checkingUpdates
    : s.status === 'current' ? t.upToDate
    : s.status === 'downloading' ? t.downloadingUpdate(s.version ?? '')
    : s.status === 'ready' ? t.updateReady(s.version ?? '')
    : s.status === 'available' ? t.updateOut(s.version ?? '')
    : s.status === 'error' ? `${t.updateFailed} ${s.error ?? ''}` : '';
  return (
    <div className="update-settings">
      <div className="client-row">
        <div className="client-name"><span>nib {s.current}</span>{line && <span className="dim">{line}</span>}</div>
        {s.status === 'ready'
          ? <button className="dash-button primary" onClick={() => void desktop!.installUpdate()}>{t.restartToUpdate}</button>
          : s.status === 'available' && !s.installs
            ? <button className="dash-button" onClick={() => s.url && desktop!.openExternal(s.url)}>{t.download}</button>
            : <button className="dash-button" disabled={s.status === 'checking' || s.status === 'downloading'} onClick={() => void desktop!.checkForUpdates()}>{t.checkForUpdates}</button>}
      </div>
      <label className="pref-row">
        <span>{t.checkAutomatically}</span>
        <input type="checkbox" checked={s.automatic} onChange={(e) => void desktop!.setAutomaticUpdates(e.target.checked)} />
      </label>
    </div>
  );
}
