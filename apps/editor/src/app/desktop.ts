/** What the desktop app's preload exposes; undefined in a plain browser. */
export interface DesktopApi {
  platform: string;
  pickFile(): Promise<string | undefined>;
  pickSavePath(suggested: string): Promise<string | undefined>;
  openDocument(path: string): void;
  openDashboard(): void;
  openSettings(): void;
  revealInFolder(path: string): void;
  openExternal(url: string): void;
  mcpClients(): Promise<McpClientStatus[]>;
  configureMcp(id: string): Promise<McpClientStatus>;
  onCommand(listener: (command: string) => void): () => void;
}

export interface McpClientStatus {
  id: string;
  name: string;
  /** Whether the client seems to be installed. */
  found: boolean;
  /** Whether its config already lists nib. */
  configured: boolean;
  /** The command its nib entry runs, when that is not this app. */
  elsewhere?: string;
  /** Where the config lives, or the command that changes it. */
  where: string;
  error?: string;
}

export const desktop: DesktopApi | undefined = (window as unknown as { nibDesktop?: DesktopApi }).nibDesktop;

/** Open a document: a window of its own in the desktop app, this tab in a browser. */
export function openDocument(path: string): void {
  if (desktop) { desktop.openDocument(path); return; }
  location.hash = new URLSearchParams({ file: path }).toString();
  location.reload();
}

export function openDashboard(): void {
  if (desktop) { desktop.openDashboard(); return; }
  sessionStorage.removeItem('nib-file');
  location.hash = '';
  location.reload();
}
