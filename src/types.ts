export type FilmSource = 'wikidata' | 'manual';

export type Film = {
  id: string;
  title: string;
  year: number | null;
  director: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  description: string | null;
  source: FilmSource;
};

export type FilmSearchResult = {
  id: string;
  title: string;
  description: string;
  year: number | null;
};

export type JournalDraft = {
  watchedOn: string; // YYYY-MM-DD, user-selected local calendar date
  rating: number | null; // 1-5, optional
  moods: string[];
  note: string;
  memorableMoment: string;
  personalConnection: string;
};

export type JournalEntry = JournalDraft & {
  id: string;
  filmId: string;
  createdAt: string;
  updatedAt: string;
};
