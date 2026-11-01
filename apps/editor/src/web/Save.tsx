import { useT } from '../app/i18n.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { Icon } from '../ui/Icon.tsx';
import { canLinkFiles, download, pickFolder, pickSaveFile } from './files.ts';
import type { LocalConnection } from './local.ts';

/** On the website: where the open design is saved, and saving it to a file (or downloading it). */
export function WebSave() {
  const t = useT();
  const save = useEditor((s) => s.webSave);
  const conn = useEditor((s) => s.conn) as LocalConnection | undefined;
  if (!conn) return null;
  const toFile = async () => {
    if (!canLinkFiles) { download(`${conn.name}.pen`, conn.text(), 'application/json'); return; }
    if (save?.file) { await conn.save(true); return; }
    const h = await pickSaveFile(conn.name);
    if (h) await conn.linkFile(h);
  };
  const folder = async () => {
    const dir = await pickFolder();
    if (dir) { await conn.linkFolder(dir); toast(dir.name); }
  };
  const onDisk = save?.where === 'disk';
  return (
    <>
      <span className="web-save" title={save?.error ?? ''}>{onDisk ? <Icon name="check" size={13} /> : null}{onDisk ? t.savedToFile(save!.file!) : t.keptInBrowser}</span>
      {!onDisk && <button className="text-button" onClick={() => void toFile()}><Icon name="download" size={15} />{!canLinkFiles ? t.downloadPen : save?.file ? t.saveAgainTo(save.file) : t.saveToFile}</button>}
      {canLinkFiles && !conn.folder && <button className="text-button" title={t.allowFolder} onClick={() => void folder()}><Icon name="folder" size={15} /></button>}
      {onDisk && <button className="text-button" title={t.downloadPen} onClick={() => download(`${conn.name}.pen`, store.get().conn ? conn.text() : '', 'application/json')}><Icon name="download" size={15} /></button>}
    </>
  );
}
