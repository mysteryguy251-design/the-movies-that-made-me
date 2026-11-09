import type { Film, FilmSearchResult } from './types';

/**
 * Replace this with a working public project URL or contact email before
 * using Wikimedia APIs. See the README and Wikimedia's User-Agent policy.
 */
const API_CONTACT = 'sauravmajumdar67@gmail.com';
const API = 'https://www.wikidata.org/w/api.php';


const USER_AGENT = `MovieJournalPrototype/0.1 (${API_CONTACT})`;

const headers = {
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
  'Api-User-Agent': USER_AGENT,
};

type Snak = {
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: unknown };
  };
};
type Entity = {
  labels?: Record<string, { value: string }>;
  claims?: Record<string, Snak[]>;
};

type SearchApiResult = {
  search?: Array<{ id: string; label: string; description?: string }>;
  error?: { info?: string };
};
type EntitiesApiResult = {
  entities?: Record<string, Entity>;
  error?: { info?: string };
};

async function request<T>(params: Record<string, string>): Promise<T> {
  const url = `${API}?${new URLSearchParams({
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    ...params,
  }).toString()}`;
  const response = await fetch(url, { headers });
  if (response.status === 429 || response.status === 503) {
    throw new Error('Wikidata is busy or rate-limiting requests. Try again later.');
  }
  
if (!response.ok) {
  const body = await response.text();

  console.log('Wikidata HTTP status:', response.status);
  console.log('Wikidata response:', body.slice(0, 500));

  throw new Error(
    `Wikidata request failed (${response.status}). ` +
    body.replace(/<[^>]*>/g, ' ').trim().slice(0, 180)
  );
}
  const json = (await response.json()) as T & { error?: { info?: string } };
  if (json.error) {
    throw new Error(json.error.info || 'Wikidata returned an error.');
  }
  return json;
}

function yearFromDescription(description: string): number | null {
  const match = description.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
  return match ? Number(match[0]) : null;
}

function isFilmDescription(description: string): boolean {
  const normalized = description.toLowerCase();
  if (/film director|film producer|film series|film festival|film company|film studio|film character|film soundtrack|film awards|filmography/.test(normalized)) {
    return false;
  }
  return /\b(film|movie|motion picture|documentary)\b/.test(normalized);
}

export async function searchFilms(term: string): Promise<FilmSearchResult[]> {
  const query = term.trim();
  if (query.length < 2) return [];
  const result = await request<SearchApiResult>({
    action: 'wbsearchentities',
    language: 'en',
    uselang: 'en',
    type: 'item',
    search: query,
    limit: '30',
  });
  return (result.search || [])
    .filter((item) => isFilmDescription(item.description || ''))
    .slice(0, 15)
    .map((item) => ({
      id: item.id,
      title: item.label,
      description: item.description || 'Film',
      year: yearFromDescription(item.description || ''),
    }));
}

function firstClaim(entity: Entity, property: string): unknown | undefined {
  const statement = (entity.claims?.[property] || []).find(
    (item) => item.mainsnak?.snaktype === 'value' && item.mainsnak?.datavalue
  );
  return statement?.mainsnak?.datavalue?.value;
}

function claimEntityIds(entity: Entity, property: string, limit = 5): string[] {
  const claims = entity.claims?.[property] || [];
  return claims
    .map((item) => item.mainsnak?.datavalue?.value as { id?: string } | undefined)
    .map((v) => v?.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, limit);
}

function releaseYear(entity: Entity): number | null {
  const date = firstClaim(entity, 'P577') as { time?: string } | undefined;
  const match = date?.time?.match(/^[+-]?(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function minutes(entity: Entity): number | null {
  const data = firstClaim(entity, 'P2047') as { amount?: string; unit?: string } | undefined;
  if (!data?.amount) return null;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // Wikidata quantity units: Q7727 = minute, Q11574 = second.
  if (data.unit?.endsWith('/Q7727')) return Math.round(amount);
  if (data.unit?.endsWith('/Q11574')) return Math.round(amount / 60);
  return null; // Unknown measurement unit: don't guess.
}

async function getEntities(ids: string[], props: string): Promise<Record<string, Entity>> {
  if (ids.length === 0) return {};
  const response = await request<EntitiesApiResult>({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props,
    languages: 'en',
    languagefallback: '1',
  });
  return response.entities || {};
}

export async function getFilmDetails(result: FilmSearchResult): Promise<Film> {
  const entities = await getEntities([result.id], 'labels|claims');
  const entity = entities[result.id];
  if (!entity) throw new Error('This film was not found in Wikidata.');

  const directorIds = claimEntityIds(entity, 'P57', 3);
  const genreIds = claimEntityIds(entity, 'P136', 5);
  const labels = await getEntities([...new Set([...directorIds, ...genreIds])], 'labels');
  const text = (id: string) => labels[id]?.labels?.en?.value ?? null;
  const director = directorIds.map(text).filter((s): s is string => Boolean(s)).join(', ') || null;
  const genres = genreIds.map(text).filter((s): s is string => Boolean(s));

  return {
    id: result.id,
    title: entity.labels?.en?.value || result.title,
    year: releaseYear(entity) ?? result.year,
    director,
    genres,
    runtimeMinutes: minutes(entity),
    description: result.description,
    source: 'wikidata',
  };
}
