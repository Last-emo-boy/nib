import { app } from 'electron';
import { INFO_FILE } from '@nib/daemon';

app.whenReady().then(() => {
  console.log('ready', INFO_FILE, process.versions.electron);
  app.quit();
});
