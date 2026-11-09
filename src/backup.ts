import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { createArchiveBackup, mergeArchiveBackup } from './database';

export async function exportBackup(): Promise<{ films: number; entries: number; collections: number }> {
  const backup = await createArchiveBackup();
  // Use a unique filename to avoid a collision if a user exports twice on one day.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File(Paths.cache, `movie-journal-backup-${stamp}.json`);
  file.create();
  file.write(JSON.stringify(backup, null, 2));
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing files is unavailable on this device.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save your movie journal backup',
  });
  // Sharing panel opening is not proof the user actually saved the file.
  return { films: backup.films.length, entries: backup.entries.length, collections: backup.collections.length };
}

export async function pickBackup(): Promise<unknown | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error('No file was selected.');
  // Maximum 5 MB for this first release; avoids processing unexpected huge files.
  if (asset.size !== undefined && asset.size > 5_000_000) {
    throw new Error('This backup is too large for the prototype (5 MB limit).');
  }
  const file = new File(asset.uri);
  const text = await file.text();
  if (text.length > 5_000_000) throw new Error('This backup is too large for the prototype.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('This is not a valid JSON backup file.');
  }
}

export async function importBackup(payload: unknown): Promise<{ filmsAdded: number; entriesAdded: number; collectionsAdded: number; membershipsAdded: number }> {
  return mergeArchiveBackup(payload);
}
