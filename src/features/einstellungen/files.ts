/** Dateien lesen und schreiben – in der installierten App über den Ordnerdialog, im Browser als Download. */
import { FolderStore, isDesktopApp, pickFolder } from '../../data/platform';
import { parseJson } from './backup';
import { isInsideFolder } from './model';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Liest eine gewählte JSON-Datei. Wirft mit einem deutschen Satz, wenn sie nicht lesbar ist. */
export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error('Diese Datei ist zu groß für einen Spielstand (über 64 MB).');
  return parseJson(await file.text());
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Speichert eine Sicherung. In der installierten App fragt Wayfarer nach einem Ordner und legt
 * die Datei dort ab; im Browser wird sie heruntergeladen. Gibt zurück, wo die Datei liegt –
 * oder null, wenn die Auswahl abgebrochen wurde.
 */
export async function saveBackupFile(
  name: string,
  text: string,
  campaignLocation: string,
): Promise<string | null> {
  if (!isDesktopApp()) {
    downloadText(name, text);
    return 'im Download-Ordner des Browsers';
  }
  const folder = await pickFolder('Ordner für die Sicherung wählen');
  if (!folder) return null;
  if (isInsideFolder(campaignLocation, folder))
    throw new Error(
      'Bitte einen Ordner außerhalb des Kampagnenordners wählen. Im Kampagnenordner würde Wayfarer die Sicherung bei jedem Start mitlesen.',
    );
  await new FolderStore(folder).write(name, text);
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + separator + name;
}

/** Fehlertext aus allem, was geworfen werden kann (die Tauri-Seite wirft Sätze als string). */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Das hat nicht geklappt.';
}
