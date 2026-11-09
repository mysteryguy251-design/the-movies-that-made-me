import * as SQLite from 'expo-sqlite';
import type { Film, FilmSource, JournalDraft, JournalEntry } from './types';

// Keep the SAME database filename: the existing archive is preserved.
const DATABASE_NAME = 'cinema-journal-prototype.db';
let ready: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!ready) {
    ready = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS films (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          year INTEGER,
          director TEXT,
          genres_json TEXT NOT NULL DEFAULT '[]',
          runtime_minutes INTEGER,
          description TEXT,
          source TEXT NOT NULL,
          saved_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS journal_entries (
          id TEXT PRIMARY KEY NOT NULL,
          film_id TEXT NOT NULL,
          watched_on TEXT NOT NULL,
          rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
          moods_json TEXT NOT NULL DEFAULT '[]',
          note TEXT NOT NULL DEFAULT '',
          memorable_moment TEXT NOT NULL DEFAULT '',
          personal_connection TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_journal_film_date
          ON journal_entries (film_id, watched_on DESC, created_at DESC);
        -- Drafts live independently of saved journal entries.
        -- They are removed automatically when their film is deleted.
        CREATE TABLE IF NOT EXISTS journal_drafts (
          draft_key TEXT PRIMARY KEY NOT NULL,
          film_id TEXT NOT NULL,
          draft_json TEXT NOT NULL,
          target_entry_id TEXT NOT NULL,
          deep_mode INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_drafts_film ON journal_drafts (film_id);
        -- User-curated shelves. These do not own their movies or entries.
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_films (
          collection_id TEXT NOT NULL,
          film_id TEXT NOT NULL,
          added_at TEXT NOT NULL,
          PRIMARY KEY (collection_id, film_id),
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_collection_films_film
          ON collection_films (film_id);
      `);
      return db;
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

type FilmRow = {
  id: string;
  title: string;
  year: number | null;
  director: string | null;
  genres_json: string;
  runtime_minutes: number | null;
  description: string | null;
  source: FilmSource;
};

export async function listFilms(): Promise<Film[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FilmRow>(
    'SELECT id, title, year, director, genres_json, runtime_minutes, description, source FROM films ORDER BY saved_at DESC'
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year,
    director: row.director,
    genres: JSON.parse(row.genres_json) as string[],
    runtimeMinutes: row.runtime_minutes,
    description: row.description,
    source: row.source,
  }));
}

export async function saveFilm(film: Film): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO films (id, title, year, director, genres_json, runtime_minutes, description, source, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, year=excluded.year, director=excluded.director,
       genres_json=excluded.genres_json, runtime_minutes=excluded.runtime_minutes,
       description=excluded.description, source=excluded.source`,
    film.id,
    film.title,
    film.year,
    film.director,
    JSON.stringify(film.genres),
    film.runtimeMinutes,
    film.description,
    film.source,
    new Date().toISOString()
  );
}

// CASCADE intentionally removes linked journal entries. The UI must confirm this.
export async function deleteFilm(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM films WHERE id = ?', id);
}

type JournalRow = {
  id: string;
  film_id: string;
  watched_on: string;
  rating: number | null;
  moods_json: string;
  note: string;
  memorable_moment: string;
  personal_connection: string;
  created_at: string;
  updated_at: string;
};

function toJournalEntry(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    filmId: row.film_id,
    watchedOn: row.watched_on,
    rating: row.rating,
    moods: JSON.parse(row.moods_json) as string[],
    note: row.note,
    memorableMoment: row.memorable_moment,
    personalConnection: row.personal_connection,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listJournalEntries(filmId: string): Promise<JournalEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JournalRow>(
    `SELECT id, film_id, watched_on, rating, moods_json, note,
            memorable_moment, personal_connection, created_at, updated_at
       FROM journal_entries WHERE film_id = ?
       ORDER BY watched_on DESC, created_at DESC`,
    filmId
  );
  return rows.map(toJournalEntry);
}

export async function saveJournalEntry(entry: JournalEntry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO journal_entries
      (id, film_id, watched_on, rating, moods_json, note,
       memorable_moment, personal_connection, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       watched_on=excluded.watched_on,
       rating=excluded.rating,
       moods_json=excluded.moods_json,
       note=excluded.note,
       memorable_moment=excluded.memorable_moment,
       personal_connection=excluded.personal_connection,
       updated_at=excluded.updated_at`,
    entry.id,
    entry.filmId,
    entry.watchedOn,
    entry.rating,
    JSON.stringify(entry.moods),
    entry.note,
    entry.memorableMoment,
    entry.personalConnection,
    entry.createdAt,
    entry.updatedAt
  );
}

export async function deleteJournalEntry(id: string, filmId: string): Promise<void> {
  const db = await getDb();
  // Check film ID as well so deletion always applies to the intended movie.
  await db.runAsync('DELETE FROM journal_entries WHERE id = ? AND film_id = ?', id, filmId);
}

// --- Milestone 6: personal film collections and version 2 archive backups ---
// Milestone 7: archive insights used by display-only filters and sorting.
// Reading existing journal entries requires no schema changes or migration.
export type ArchiveFilmInsight = {
  filmId: string;
  reflectionCount: number;
  lastRating: number | null; // Most recent recorded non-null rating.
  moods: string[];            // Union of moods across saved reflections.
};

export async function getArchiveFilmInsights(): Promise<ArchiveFilmInsight[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    film_id: string;
    rating: number | null;
    moods_json: string;
  }>(`SELECT film_id, rating, moods_json FROM journal_entries
      ORDER BY watched_on DESC, created_at DESC`);
  const byFilm = new Map<string, ArchiveFilmInsight>();
  for (const row of rows) {
    let insight = byFilm.get(row.film_id);
    if (!insight) {
      insight = { filmId: row.film_id, reflectionCount: 0, lastRating: null, moods: [] };
      byFilm.set(row.film_id, insight);
    }
    insight.reflectionCount += 1;
    if (insight.lastRating === null && row.rating !== null) insight.lastRating = row.rating;
    const moods: unknown = JSON.parse(row.moods_json);
    if (Array.isArray(moods)) {
      for (const mood of moods) {
        if (typeof mood === 'string' && !insight.moods.includes(mood)) insight.moods.push(mood);
      }
    }
  }
  return [...byFilm.values()];
}

export type FilmCollection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  filmCount: number;
};

export type CollectionMembership = { collectionId: string; filmId: string };

type CollectionRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  film_count: number;
};

export async function listCollections(): Promise<FilmCollection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CollectionRow>(
    `SELECT c.id, c.name, c.created_at, c.updated_at,
       COUNT(cf.film_id) AS film_count
     FROM collections c LEFT JOIN collection_films cf ON cf.collection_id = c.id
     GROUP BY c.id ORDER BY c.created_at DESC, c.name COLLATE NOCASE ASC`
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, createdAt: r.created_at,
    updatedAt: r.updated_at, filmCount: r.film_count,
  }));
}

function cleanCollectionName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 70) throw new Error('Use a name between 1 and 70 characters.');
  return trimmed;
}

export async function createCollection(name: string): Promise<string> {
  const db = await getDb();
  const title = cleanCollectionName(name);
  const conflict = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM collections WHERE name = ? COLLATE NOCASE', title
  );
  if (conflict) throw new Error('You already have a collection with that name.');
  const id = `collection-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const now = new Date().toISOString();
  await db.runAsync('INSERT INTO collections(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    id, title, now, now);
  return id;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const db = await getDb();
  const title = cleanCollectionName(name);
  const conflict = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM collections WHERE name = ? COLLATE NOCASE AND id != ?', title, id
  );
  if (conflict) throw new Error('You already have a collection with that name.');
  const result = await db.runAsync(
    'UPDATE collections SET name = ?, updated_at = ? WHERE id = ?', title, new Date().toISOString(), id
  );
  if (!result.changes) throw new Error('This collection no longer exists.');
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDb();
  // Only the collection and its membership links are deleted.
  await db.runAsync('DELETE FROM collections WHERE id = ?', id);
}

export async function listCollectionFilmIds(id: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ film_id: string }>(
    'SELECT film_id FROM collection_films WHERE collection_id = ? ORDER BY added_at DESC', id
  );
  return rows.map((r) => r.film_id);
}

export async function setCollectionFilm(id: string, filmId: string, included: boolean): Promise<void> {
  const db = await getDb();
  if (included) {
    await db.runAsync(
      `INSERT OR IGNORE INTO collection_films(collection_id, film_id, added_at)
       SELECT c.id, f.id, ? FROM collections c CROSS JOIN films f
       WHERE c.id = ? AND f.id = ?`,
      new Date().toISOString(), id, filmId
    );
    // If the link already exists, IGNORE is expected. Check the link itself.
    const check = await db.getFirstAsync<{ ok: number }>(
      'SELECT 1 as ok FROM collection_films WHERE collection_id = ? AND film_id = ?', id, filmId
    );
    if (!check) throw new Error('Save the film to your archive before adding it to this collection.');
  } else {
    await db.runAsync('DELETE FROM collection_films WHERE collection_id = ? AND film_id = ?', id, filmId);
  }
}

export type ArchiveBackupV1 = {
  format: 'movie-journal-backup'; version: 1; exportedAt: string;
  films: Film[]; entries: JournalEntry[];
};
export type ArchiveBackup = {
  format: 'movie-journal-backup'; version: 2; exportedAt: string;
  films: Film[]; entries: JournalEntry[];
  collections: Array<Pick<FilmCollection, 'id' | 'name' | 'createdAt' | 'updatedAt'>>;
  collectionFilms: CollectionMembership[];
};

export async function createArchiveBackup(): Promise<ArchiveBackup> {
  const db = await getDb();
  const [films, entriesRows, collectionsRows, memberships] = await Promise.all([
    listFilms(),
    db.getAllAsync<JournalRow>(
      `SELECT id, film_id, watched_on, rating, moods_json, note, memorable_moment,
              personal_connection, created_at, updated_at FROM journal_entries ORDER BY created_at ASC`
    ),
    db.getAllAsync<{id: string; name: string; created_at: string; updated_at: string}>(
      'SELECT id, name, created_at, updated_at FROM collections ORDER BY created_at ASC'
    ),
    db.getAllAsync<{collection_id: string; film_id: string}>(
      'SELECT collection_id, film_id FROM collection_films'
    ),
  ]);
  return {
    format: 'movie-journal-backup', version: 2, exportedAt: new Date().toISOString(),
    films, entries: entriesRows.map(toJournalEntry),
    collections: collectionsRows.map((r) => ({
      id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at,
    })),
    collectionFilms: memberships.map((m) => ({ collectionId: m.collection_id, filmId: m.film_id })),
  };
}

// Imported JSON is untrusted. Validate all references before starting the transaction.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isText(value: unknown, max = 100_000): value is string {
  return typeof value === 'string' && value.length <= max;
}
function optionalText(value: unknown, max = 20_000): value is string | null {
  return value === null || isText(value, max);
}
function isArrayOfText(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 50 && value.every((item) => isText(item, 200));
}
function validateBackup(value: unknown): ArchiveBackup {
  if (!isObject(value) || value.format !== 'movie-journal-backup' ||
      (value.version !== 1 && value.version !== 2) || !isText(value.exportedAt, 60) ||
      !Array.isArray(value.films) || !Array.isArray(value.entries)) {
    throw new Error('Not a supported Movie Journal backup (version 1 or 2).');
  }
  if (value.films.length > 5000 || value.entries.length > 25000) {
    throw new Error('Backup exceeds the prototype import limit.');
  }
  const filmIds = new Set<string>();
  const films: Film[] = value.films.map((f) => {
    if (!isObject(f) || !isText(f.id, 300) || !f.id || !isText(f.title, 1000) || !f.title.trim() ||
        !(f.year === null || (Number.isInteger(f.year) && Number(f.year) >= 1888 && Number(f.year) <= 2100)) ||
        !optionalText(f.director, 2000) || !isArrayOfText(f.genres) ||
        !(f.runtimeMinutes === null || (Number.isInteger(f.runtimeMinutes) && Number(f.runtimeMinutes) >= 0 && Number(f.runtimeMinutes) <= 100000)) ||
        !optionalText(f.description) || (f.source !== 'manual' && f.source !== 'wikidata')) {
      throw new Error('A movie record in this backup is invalid.');
    }
    if (filmIds.has(f.id)) throw new Error('The backup contains duplicate movie IDs.');
    filmIds.add(f.id);
    return f as Film;
  });
  const entryIds = new Set<string>();
  const entries: JournalEntry[] = value.entries.map((e) => {
    if (!isObject(e) || !isText(e.id, 300) || !e.id || !isText(e.filmId, 300) ||
        !filmIds.has(e.filmId) || !isText(e.watchedOn, 10) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(e.watchedOn) ||
        !(e.rating === null || (Number.isInteger(e.rating) && Number(e.rating) >= 1 && Number(e.rating) <= 5)) ||
        !isArrayOfText(e.moods) || !isText(e.note) || !isText(e.memorableMoment) ||
        !isText(e.personalConnection) || !isText(e.createdAt, 60) || !isText(e.updatedAt, 60)) {
      throw new Error('A journal entry in this backup is invalid.');
    }
    if (entryIds.has(e.id)) throw new Error('The backup contains duplicate journal IDs.');
    entryIds.add(e.id);
    return e as JournalEntry;
  });
  if (value.version === 1) {
    return { format: 'movie-journal-backup', version: 2, exportedAt: value.exportedAt,
      films, entries, collections: [], collectionFilms: [] };
  }
  if (!Array.isArray(value.collections) || !Array.isArray(value.collectionFilms) ||
      value.collections.length > 2000 || value.collectionFilms.length > 100000) {
    throw new Error('Invalid collections data in the backup.');
  }
  const collectionIds = new Set<string>();
  const collections: ArchiveBackup['collections'] = value.collections.map((c) => {
    if (!isObject(c) || !isText(c.id, 300) || !c.id || !isText(c.name, 70) ||
        !c.name.trim() || !isText(c.createdAt, 60) || !isText(c.updatedAt, 60)) {
      throw new Error('An invalid collection was found in the backup.');
    }
    if (collectionIds.has(c.id)) throw new Error('Duplicate collection IDs in the backup.');
    collectionIds.add(c.id);
    return c as ArchiveBackup['collections'][number];
  });
  const membershipKeys = new Set<string>();
  const collectionFilms: CollectionMembership[] = value.collectionFilms.map((m) => {
    if (!isObject(m) || !isText(m.collectionId, 300) || !collectionIds.has(m.collectionId) ||
        !isText(m.filmId, 300) || !filmIds.has(m.filmId)) {
      throw new Error('An invalid collection-to-film link was found in the backup.');
    }
    const key = JSON.stringify([m.collectionId, m.filmId]);
    if (membershipKeys.has(key)) throw new Error('Duplicate collection membership in the backup.');
    membershipKeys.add(key);
    return m as CollectionMembership;
  });
  return {format: 'movie-journal-backup', version: 2, exportedAt: value.exportedAt,
    films, entries, collections, collectionFilms};
}

export async function mergeArchiveBackup(value: unknown): Promise<{
  filmsAdded: number; entriesAdded: number; collectionsAdded: number; membershipsAdded: number;
}> {
  const backup = validateBackup(value);
  const db = await getDb();
  let filmsAdded = 0;
  let entriesAdded = 0;
  let collectionsAdded = 0;
  let membershipsAdded = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const film of backup.films) {
      const result = await tx.runAsync(
        `INSERT OR IGNORE INTO films
         (id, title, year, director, genres_json, runtime_minutes, description, source, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        film.id, film.title, film.year, film.director,
        JSON.stringify(film.genres), film.runtimeMinutes, film.description, film.source, backup.exportedAt
      );
      filmsAdded += result.changes;
    }
    for (const entry of backup.entries) {
      const result = await tx.runAsync(
        `INSERT OR IGNORE INTO journal_entries
         (id, film_id, watched_on, rating, moods_json, note,
         memorable_moment, personal_connection, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id, entry.filmId, entry.watchedOn, entry.rating, JSON.stringify(entry.moods),
        entry.note, entry.memorableMoment, entry.personalConnection,
        entry.createdAt, entry.updatedAt
      );
      entriesAdded += result.changes;
    }
    for (const collection of backup.collections) {
      const result = await tx.runAsync(
        'INSERT OR IGNORE INTO collections(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        collection.id, collection.name, collection.createdAt, collection.updatedAt
      );
      collectionsAdded += result.changes;
    }
    for (const membership of backup.collectionFilms) {
      const result = await tx.runAsync(
        `INSERT OR IGNORE INTO collection_films(collection_id, film_id, added_at)
          VALUES (?, ?, ?)`,
        membership.collectionId, membership.filmId, backup.exportedAt
      );
      membershipsAdded += result.changes;
    }
  });
  return { filmsAdded, entriesAdded, collectionsAdded, membershipsAdded };
}

// Milestone 4: read-only overview for the home screen. No schema changes.
export type RecentReflection = JournalEntry & {
  filmTitle: string;
  filmYear: number | null;
};

export async function getJournalOverview(): Promise<{
  totalReflections: number;
  recent: RecentReflection[];
}> {
  const db = await getDb();
  const count = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM journal_entries'
  );
  const rows = await db.getAllAsync<JournalRow & { film_title: string; film_year: number | null }>(
    `SELECT j.id, j.film_id, j.watched_on, j.rating, j.moods_json, j.note,
            j.memorable_moment, j.personal_connection, j.created_at, j.updated_at,
            f.title AS film_title, f.year AS film_year
       FROM journal_entries j
       INNER JOIN films f ON f.id = j.film_id
       ORDER BY j.updated_at DESC
       LIMIT 6`
  );
  return {
    totalReflections: count?.total ?? 0,
    recent: rows.map((row) => ({
      ...toJournalEntry(row),
      filmTitle: row.film_title,
      filmYear: row.film_year,
    })),
  };
}


// --- Milestone 5.2: local autosaved *unfinished* reflections ---
// Keep drafts out of journal_entries until the user explicitly presses Save.
export type StoredJournalDraft = {
  key: string;
  filmId: string;
  draft: JournalDraft;
  targetEntryId: string;
  deep: boolean;
  updatedAt: string;
};

type StoredDraftRow = {
  draft_key: string;
  film_id: string;
  draft_json: string;
  target_entry_id: string;
  deep_mode: number;
  updated_at: string;
};

export async function getLocalJournalDraft(key: string, filmId: string): Promise<StoredJournalDraft | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<StoredDraftRow>(
    `SELECT draft_key, film_id, draft_json, target_entry_id, deep_mode, updated_at
       FROM journal_drafts WHERE draft_key = ? AND film_id = ?`, key, filmId
  );
  if (!row) return null;
  const parsed: unknown = JSON.parse(row.draft_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This draft cannot be read. No journal entries were changed.');
  }
  const item = parsed as Partial<JournalDraft>;
  if (typeof item.watchedOn !== 'string' ||
      !(item.rating === null || (Number.isInteger(item.rating) && Number(item.rating) >= 1 && Number(item.rating) <= 5)) ||
      !Array.isArray(item.moods) || !item.moods.every((v) => typeof v === 'string') ||
      typeof item.note !== 'string' || typeof item.memorableMoment !== 'string' ||
      typeof item.personalConnection !== 'string') {
    throw new Error('This draft has an invalid format. No journal entries were changed.');
  }
  return {
    key: row.draft_key,
    filmId: row.film_id,
    targetEntryId: row.target_entry_id,
    draft: {
      watchedOn: item.watchedOn,
      rating: item.rating ?? null,
      moods: item.moods as string[],
      note: item.note,
      memorableMoment: item.memorableMoment,
      personalConnection: item.personalConnection,
    },
    deep: row.deep_mode === 1,
    updatedAt: row.updated_at,
  };
}

export async function upsertLocalJournalDraft(
  key: string, filmId: string, targetEntryId: string, draft: JournalDraft, deep: boolean
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO journal_drafts (draft_key, film_id, draft_json, target_entry_id, deep_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(draft_key) DO UPDATE SET
       film_id = excluded.film_id,
       draft_json = excluded.draft_json,
       target_entry_id = excluded.target_entry_id,
       deep_mode = excluded.deep_mode,
       updated_at = excluded.updated_at`,
    key, filmId, JSON.stringify(draft), targetEntryId, deep ? 1 : 0, new Date().toISOString()
  );
}

export async function deleteLocalJournalDraft(key: string, filmId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM journal_drafts WHERE draft_key = ? AND film_id = ?', key, filmId);
}
