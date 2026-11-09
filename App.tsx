import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { deleteFilm, getArchiveFilmInsights, getJournalOverview, listFilms, saveFilm } from './src/database';
import type { ArchiveFilmInsight, RecentReflection } from './src/database';
import { getFilmDetails, searchFilms } from './src/wikidata';
import { JournalModal } from './src/JournalModal';
import { BackupModal } from './src/BackupModal';
import { CollectionsScreen } from './src/CollectionsScreen';
import type { Film, FilmSearchResult } from './src/types';

const P = {
  bg: '#101613',
  surface: '#1D2722',
  raised: '#25322B',
  border: '#34453B',
  light: '#F7F1E7',
  muted: '#B2BDB4',
  gold: '#DFC18A',
  rust: '#C68F72',
  danger: '#EDACA2',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const CARD_COLORS = ['#344A3C', '#4C3F3F', '#3B4556', '#584D38', '#3B514C', '#4D3E50'];
type Tab = 'home' | 'discover' | 'archive' | 'collections';
type ArchiveSort = 'added' | 'title' | 'year' | 'rating';
type ArchiveView = 'grid' | 'list';
type ReflectionFilter = 'all' | 'written' | 'unwritten';
const NO_INSIGHT: ArchiveFilmInsight = { filmId: '', reflectionCount: 0, lastRating: null, moods: [] };
function labelGenre(value: string): string {
  return value.replace(/ film$/i, '').trim();
}

const EMPTY_OVERVIEW: { totalReflections: number; recent: RecentReflection[] } = {
  totalReflections: 0, recent: [],
};

function shade(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return CARD_COLORS[n % CARD_COLORS.length];
}

function FilmCover({ film, small = false }: { film: Pick<Film, 'id' | 'title' | 'year'>; small?: boolean }) {
  const motif = (film.id.split('').reduce((v, char) => (v * 31 + char.charCodeAt(0)) >>> 0, 0)) % 3;
  return (
    <View style={[styles.cover, small ? styles.coverSmall : styles.coverLarge,
      { backgroundColor: shade(film.id) }, motif === 1 && styles.coverVariantSecond]}>
      <View style={[styles.coverRule, motif === 1 && styles.coverRuleHeavy]}/>
      {motif === 2 && <View style={[styles.coverDiamond, small && styles.coverDiamondSmall]}/>} 
      <Text style={[styles.coverLabel, small && { fontSize: 7 }]}>{motif === 0 ? 'FRAME NOTES' : motif === 1 ? 'THE FILM ARCHIVE' : 'A PERSONAL CINEMA'}</Text>
      <Text numberOfLines={small ? 3 : 4} style={[styles.coverTitle, small && styles.coverTitleSmall,
        motif === 1 && styles.coverTitleAlternate]}>{film.title}</Text>
      <Text style={styles.coverYear}>{film.year ?? '—'}</Text>
      <View style={[styles.coverRule, motif === 1 && styles.coverRuleHeavy]}/>
    </View>
  );
}

function Action({ text, onPress, outline = false, disabled = false }: {
  text: string; onPress: () => void; outline?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.action, outline && styles.actionOutline, disabled && { opacity: 0.45 }, pressed && { opacity: 0.75 }]}>
      <Text style={[styles.actionText, outline && styles.actionTextOutline]}>{text}</Text>
    </Pressable>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.sectionHead}>
    <Text style={styles.eyebrow}>{eyebrow}</Text>
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>;
}

function Main() {
  const [tab, setTab] = useState<Tab>('home');
  const [query, setQuery] = useState('');
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>('added');
  const [archiveView, setArchiveView] = useState<ArchiveView>('grid');
  const [reflectionFilter, setReflectionFilter] = useState<ReflectionFilter>('all');
  const [genreFilter, setGenreFilter] = useState('');
  const [moodFilter, setMoodFilter] = useState('');
  const [showArchiveFilters, setShowArchiveFilters] = useState(false);
  const [archiveInsights, setArchiveInsights] = useState<Record<string, ArchiveFilmInsight>>({});
  const [collectionsRevision, setCollectionsRevision] = useState(0);
  const [results, setResults] = useState<FilmSearchResult[]>([]);
  const [saved, setSaved] = useState<Film[]>([]);
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [working, setWorking] = useState(false);
  const [detailsWorking, setDetailsWorking] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Film | null>(null);
  const [journalFilm, setJournalFilm] = useState<Film | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualDirector, setManualDirector] = useState('');
  const [manualGenres, setManualGenres] = useState('');
  const requestId = useRef(0);
  const savedIds = new Set(saved.map((film) => film.id));

  const refresh = useCallback(async () => {
    const [films, stats, insights] = await Promise.all([listFilms(), getJournalOverview(), getArchiveFilmInsights()]);
    setSaved(films);
    setOverview(stats);
    setArchiveInsights(Object.fromEntries(insights.map((item) => [item.filmId, item])));
    setCollectionsRevision((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh().catch((e) => Alert.alert('Local archive error', String(e)));
  }, [refresh]);

  useEffect(() => {
    const id = ++requestId.current;
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setWorking(false);
      setError('');
      return;
    }
    setWorking(true);
    setError('');
    const timer = setTimeout(() => {
      searchFilms(text)
        .then((films) => { if (id === requestId.current) setResults(films); })
        .catch((e) => {
          if (id === requestId.current) {
            setResults([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => { if (id === requestId.current) setWorking(false); });
    }, 600);
    return () => clearTimeout(timer);
  }, [query]);

  const openResult = async (result: FilmSearchResult) => {
    Keyboard.dismiss();
    setDetailsWorking(true);
    setError('');
    try { setDetail(await getFilmDetails(result)); }
    catch (e) { Alert.alert('Film details unavailable', String(e)); }
    finally { setDetailsWorking(false); }
  };

  const handleSave = async (film: Film) => {
    try {
      await saveFilm(film);
      await refresh();
      setDetail(null);
      setManualOpen(false);
      setTab('archive');
    } catch (e) { Alert.alert('Could not save film', String(e)); }
  };

  const handleManual = async () => {
    const title = manualTitle.trim();
    const yearString = manualYear.trim();
    const year = yearString ? Number(yearString) : null;
    if (!title) { Alert.alert('Movie title required', 'Enter a movie title.'); return; }
    if (yearString && (!Number.isInteger(year) || year! < 1888 || year! > new Date().getFullYear() + 3)) {
      Alert.alert('Invalid release year', 'Enter a valid four-digit year or leave it blank.');
      return;
    }
    await handleSave({
      id: `manual-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      title, year, director: manualDirector.trim() || null,
      genres: manualGenres.split(',').map((g) => g.trim()).filter(Boolean),
      runtimeMinutes: null, description: null, source: 'manual',
    });
    setManualTitle(''); setManualYear(''); setManualDirector(''); setManualGenres('');
  };

  const askDelete = (film: Film) => Alert.alert(
    'Remove film and reflections?',
    `Removing ${film.title} permanently deletes its film record and all its journal entries on this device. Export a backup first if you want to keep them.`,
    [{ text: 'Cancel', style: 'cancel' }, {
      text: 'Remove', style: 'destructive', onPress: () => {
        deleteFilm(film.id)
          .then(async () => { await refresh(); setJournalFilm(null); setDetail(null); })
          .catch((e) => Alert.alert('Could not delete film', String(e)));
      },
    }]
  );

  const openSaved = (film: Film) => setJournalFilm(film);
  const closeJournal = () => {
    setJournalFilm(null);
    refresh().catch((e) => Alert.alert('Could not refresh archive', String(e)));
  };
  const goDiscover = () => setTab('discover');
  // Display-only filters. Saved films, journal entries and shelves are never changed.
  const genreChoices = [...new Set(saved.flatMap((film) => film.genres.map(labelGenre)))]
    .filter(Boolean).sort((a, b) => a.localeCompare(b));
  const moodChoices = [...new Set(Object.values(archiveInsights).flatMap((entry) => entry.moods))]
    .sort((a, b) => a.localeCompare(b));
  const filtered = saved.filter((film) => {
    const insight = archiveInsights[film.id] || NO_INSIGHT;
    const matchesText = `${film.title} ${film.director || ''} ${film.year ?? ''}`
      .toLowerCase().includes(archiveQuery.trim().toLowerCase());
    const matchesStatus = reflectionFilter === 'all' ||
      (reflectionFilter === 'written' ? insight.reflectionCount > 0 : insight.reflectionCount === 0);
    const matchesGenre = !genreFilter || film.genres.some((genre) => labelGenre(genre) === genreFilter);
    const matchesMood = !moodFilter || insight.moods.includes(moodFilter);
    return matchesText && matchesStatus && matchesGenre && matchesMood;
  }).sort((a, b) => archiveSort === 'title'
    ? a.title.localeCompare(b.title)
    : archiveSort === 'year'
      ? (b.year ?? -1) - (a.year ?? -1) || a.title.localeCompare(b.title)
      : archiveSort === 'rating'
        ? (archiveInsights[b.id]?.lastRating ?? -1) - (archiveInsights[a.id]?.lastRating ?? -1) || a.title.localeCompare(b.title)
        : 0);
  const activeFilters = reflectionFilter !== 'all' || Boolean(genreFilter) || Boolean(moodFilter) || archiveQuery.trim().length > 0;
  const resetFilters = () => {
    setArchiveQuery(''); setReflectionFilter('all'); setGenreFilter(''); setMoodFilter('');
  };


  const searchRow = (film: FilmSearchResult) => (
    <Pressable accessibilityRole="button" onPress={() => openResult(film)}
      style={({ pressed }) => [styles.searchRow, pressed && { opacity: 0.75 }]}>
      <FilmCover film={film} small/>
      <View style={styles.searchCopy}>
        <Text style={styles.searchTitle} numberOfLines={2}>{film.title}</Text>
        <Text style={styles.rowMeta}>{film.year ?? 'Unknown year'}</Text>
        <Text numberOfLines={3} style={styles.rowDescription}>{film.description || 'Tap to view film details'}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );

  const archiveCard = (film: Film) => {
    const insight = archiveInsights[film.id] || NO_INSIGHT;
    const hasJournal = insight.reflectionCount > 0;
    if (archiveView === 'list') {
      return <Pressable accessibilityRole="button" key={film.id} accessibilityLabel={`Open ${film.title}`}
        onPress={() => openSaved(film)} style={({ pressed }) => [styles.archiveRow, pressed && { opacity: 0.74 }]}>
        <FilmCover film={film} small/>
        <View style={styles.archiveRowInfo}>
          <Text style={styles.archiveRowTitle} numberOfLines={2}>{film.title}</Text>
          <Text style={styles.archiveRowMeta} numberOfLines={2}>{film.year ?? 'Year unknown'}{film.director ? ` · ${film.director}` : ''}</Text>
          <Text style={styles.archiveRowGenre} numberOfLines={1}>{film.genres.slice(0, 2).map(labelGenre).join(' · ') || 'Your personal archive'}</Text>
          <Text style={[styles.archiveStatus, hasJournal && styles.archiveStatusWritten]}>
            {hasJournal ? `${insight.reflectionCount} ${insight.reflectionCount === 1 ? 'reflection' : 'reflections'}` : 'Not journaled yet'}
            {insight.lastRating !== null ? `   ★ ${insight.lastRating}/5` : ''}
          </Text>
        </View>
        <Text style={styles.archiveChevron}>›</Text>
      </Pressable>;
    }
    return <Pressable accessibilityRole="button" key={film.id} accessibilityLabel={`Open ${film.title}`}
      onPress={() => openSaved(film)} style={({ pressed }) => [styles.archiveItem, pressed && { opacity: 0.74 }]}>
      <FilmCover film={film}/>
      <Text style={styles.archiveTitle} numberOfLines={2}>{film.title}</Text>
      <Text style={styles.rowMeta}>{film.year ?? 'Year unknown'}{insight.lastRating !== null ? `   ★ ${insight.lastRating}` : ''}</Text>
      <Text style={[styles.archiveStatus, hasJournal && styles.archiveStatusWritten]} numberOfLines={1}>
        {hasJournal ? `${insight.reflectionCount} ${insight.reflectionCount === 1 ? 'reflection' : 'reflections'}` : 'Not journaled yet'}
      </Text>
    </Pressable>;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={P.bg}/>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" onPress={() => setTab('home')} style={styles.brandWrap}>
          <View style={styles.brandIcon}><Text style={styles.brandIconText}>✦</Text></View>
          <View>
            <Text style={styles.brandName}>FRAME NOTES</Text>
            <Text style={styles.brandCaption}>A PRIVATE CINEMA JOURNAL</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Backup and restore" onPress={() => setBackupOpen(true)} style={styles.backupButton}>
          <Text style={styles.backupText}>BACKUP ↗</Text>
        </Pressable>
      </View>

      {tab === 'home' ? (
        <ScrollView style={styles.mainScroll} contentContainerStyle={styles.scrollBody}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>YOUR LIFE, ONE FILM AT A TIME</Text>
            <Text style={styles.heroHeading}>Some films{'\n'}stay with us.</Text>
            <Text style={styles.heroCopy}>Keep the moments, thoughts and feelings they left behind.</Text>
            <Action text="+ Remember a film" onPress={goDiscover}/>
            <View style={styles.heroStrip}>
              <View style={styles.stripDots}>{[1, 2, 3, 4, 5, 6].map((n) => <View key={n} style={styles.stripDot}/>)}</View>
              <Text style={styles.stripType}>YOUR PERSONAL FILM STORY</Text>
            </View>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricNumber}>{saved.length}</Text><Text style={styles.metricLabel}>Films in your archive</Text></View>
            <View style={styles.metricSeparator}/>
            <View style={styles.metric}><Text style={styles.metricNumber}>{overview.totalReflections}</Text><Text style={styles.metricLabel}>Personal reflections</Text></View>
          </View>

          <SectionTitle eyebrow="FROM YOUR JOURNAL" title="Recent memories"/>
          {overview.recent.length ? overview.recent.slice(0, 3).map((entry) => {
            const film = saved.find((f) => f.id === entry.filmId);
            const memory = entry.note || entry.memorableMoment || entry.personalConnection;
            return <Pressable key={entry.id} accessibilityRole="button"
              onPress={() => { if (film) openSaved(film); }}
              style={({ pressed }) => [styles.memoryCard, pressed && { opacity: 0.8 }]}>
              <View style={styles.memoryHead}>
                <Text style={styles.memoryFilm} numberOfLines={1}>{entry.filmTitle}</Text>
                <Text style={styles.memoryDate}>{entry.watchedOn}</Text>
              </View>
              {entry.moods.length > 0 && <Text style={styles.memoryMood}>{entry.moods.slice(0, 3).join('  ·  ')}</Text>}
              <Text style={styles.memoryText} numberOfLines={3}>{memory || 'A film you took the time to remember.'}</Text>
              <Text style={styles.memoryLink}>VIEW REFLECTION  ↗</Text>
            </Pressable>;
          }) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Your story starts here.</Text>
              <Text style={styles.emptyCopy}>Save a film, add your first reflection, and it will appear on this page.</Text>
              <Pressable onPress={() => setTab(saved.length ? 'archive' : 'discover')}>
                <Text style={styles.inlineLink}>{saved.length ? 'OPEN MY ARCHIVE  →' : 'FIND YOUR FIRST FILM  →'}</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.sectionBetween}>
            <SectionTitle eyebrow="ON YOUR SHELF" title="My film archive"/>
            <Pressable accessibilityRole="button" onPress={() => setTab('archive')}><Text style={styles.inlineLink}>SEE ALL →</Text></Pressable>
          </View>
          {saved.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
              {saved.slice(0, 8).map((film) => (
                <Pressable key={film.id} accessibilityRole="button" onPress={() => openSaved(film)} style={styles.shelfItem}>
                  <FilmCover film={film} small/>
                  <Text style={styles.shelfTitle} numberOfLines={2}>{film.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : <Text style={styles.mutedNote}>Films you save will appear here.</Text>}
          <Text style={styles.footerQuote}>“A movie is never just a movie.”</Text>
        </ScrollView>
      ) : tab === 'discover' ? (
        <View style={styles.listScreen}>
          <View style={styles.pageHead}>
            <Text style={styles.eyebrow}>ADD TO YOUR STORY</Text>
            <Text style={styles.pageTitle}>Find a film.</Text>
            <Text style={styles.pageCopy}>Search the catalogue or add a movie yourself.</Text>
            <TextInput accessibilityLabel="Search movie titles" style={styles.input} autoCorrect={false}
              placeholder="Search movie titles..." placeholderTextColor="#91A197"
              selectionColor={P.gold} value={query} onChangeText={setQuery} returnKeyType="search"/>
            {query.trim().length < 2 && <View style={styles.suggestions}>
              {['Interstellar', 'Past Lives', 'Spirited Away'].map((term) => (
                <Pressable key={term} onPress={() => setQuery(term)} style={styles.chip}>
                  <Text style={styles.chipText}>{term}</Text>
                </Pressable>
              ))}
            </View>}
            <Pressable accessibilityRole="button" onPress={() => setManualOpen(true)} style={styles.manualButton}>
              <Text style={styles.manualText}>＋ Add a film manually</Text>
            </Pressable>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {(working || detailsWorking) && <ActivityIndicator style={{ marginTop: 12 }} color={P.gold}/>}
          </View>
          <FlatList key="discover-list" data={results} keyExtractor={(item) => item.id} renderItem={({ item }) => searchRow(item)}
            keyboardShouldPersistTaps="handled" contentContainerStyle={styles.searchList}
            ListEmptyComponent={query.trim().length >= 2 && !working && !error ?
              <Text style={styles.emptyList}>No matching films. Try another title or enter it manually.</Text> :
              <Text style={styles.emptyList}>A film can be a memory, a feeling, or a turning point. Which one will you add next?</Text>}/>
        </View>
      ) : tab === 'archive' ? (
        <View style={styles.listScreen}>
          <View style={styles.pageHead}>
            <Text style={styles.eyebrow}>A HOME FOR WHAT YOU'VE WATCHED</Text>
            <Text style={styles.pageTitle}>Your archive.</Text>
            <Text style={styles.pageCopy}>{saved.length} saved {saved.length === 1 ? 'film' : 'films'} · Tap a film to write or revisit a reflection.</Text>
            <TextInput accessibilityLabel="Filter saved films" style={styles.input}
              placeholder="Find a film in your archive..." placeholderTextColor="#91A197"
              value={archiveQuery} onChangeText={setArchiveQuery}/>
            <View style={styles.archiveToolbar}>
              <Text style={styles.archiveCount}>{filtered.length} of {saved.length} films</Text>
              <View style={styles.viewOptions}>
                {([['grid', '▦ Grid'], ['list', '☷ List']] as const).map(([view, label]) => (
                  <Pressable key={view} accessibilityRole="button" accessibilityState={{ selected: archiveView === view }}
                    onPress={() => setArchiveView(view)} style={[styles.viewButton, archiveView === view && styles.viewButtonSelected]}>
                    <Text style={[styles.viewButtonText, archiveView === view && styles.viewButtonTextSelected]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortOptions}>
              {([['added', 'Recently added'], ['title', 'A–Z'], ['year', 'Release year'], ['rating', 'Your rating']] as const).map(([sort, label]) => (
                <Pressable key={sort} accessibilityRole="button" accessibilityState={{ selected: archiveSort === sort }}
                  onPress={() => setArchiveSort(sort)} style={[styles.sortChip, archiveSort === sort && styles.sortChipSelected]}>
                  <Text style={[styles.sortChipText, archiveSort === sort && styles.sortChipTextSelected]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.filterBar}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchiveFilters }}
                onPress={() => setShowArchiveFilters((v) => !v)} style={styles.filterToggle}>
                <Text style={styles.filterToggleText}>{showArchiveFilters ? '⌄ Hide filters' : '⚑ Filters'}{activeFilters ? '  •' : ''}</Text>
              </Pressable>
              {activeFilters && <Pressable accessibilityRole="button" onPress={resetFilters} style={styles.filterClear}>
                <Text style={styles.filterClearText}>Clear all</Text>
              </Pressable>}
            </View>
          </View>
          <FlatList key={`archive-${archiveView}`} data={filtered} keyExtractor={(film) => film.id}
            numColumns={archiveView === 'grid' ? 2 : 1} renderItem={({ item }) => archiveCard(item)}
            columnWrapperStyle={archiveView === 'grid' ? styles.gridRow : undefined}
            keyboardShouldPersistTaps="handled" contentContainerStyle={styles.archiveList}
            ListHeaderComponent={showArchiveFilters ? (
            <View style={styles.filterPanel}>
              <Text style={styles.filterHeading}>REFLECTIONS</Text>
              <View style={styles.filterWrap}>
                {([['all', 'All films'], ['written', 'With reflections'], ['unwritten', 'To journal']] as const).map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: reflectionFilter === value }}
                    onPress={() => setReflectionFilter(value)} style={[styles.sortChip, reflectionFilter === value && styles.sortChipSelected]}>
                    <Text style={[styles.sortChipText, reflectionFilter === value && styles.sortChipTextSelected]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.filterHeading}>GENRE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroller}>
                {['', ...genreChoices].map((genre) => (
                  <Pressable key={genre || 'all-genres'} accessibilityRole="button" accessibilityState={{ selected: genreFilter === genre }}
                    onPress={() => setGenreFilter(genre)} style={[styles.sortChip, genreFilter === genre && styles.sortChipSelected]}>
                    <Text style={[styles.sortChipText, genreFilter === genre && styles.sortChipTextSelected]} numberOfLines={1}>{genre || 'Any genre'}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.filterHeading}>HOW IT FELT</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroller}>
                {['', ...moodChoices].map((mood) => (
                  <Pressable key={mood || 'all-moods'} accessibilityRole="button" accessibilityState={{ selected: moodFilter === mood }}
                    onPress={() => setMoodFilter(mood)} style={[styles.sortChip, moodFilter === mood && styles.sortChipSelected]}>
                    <Text style={[styles.sortChipText, moodFilter === mood && styles.sortChipTextSelected]}>{mood || 'Any feeling'}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.filterNote}>Feelings come from your saved reflections, not unfinished drafts.</Text>
            </View>
            ) : null}
            ListEmptyComponent={<View style={styles.emptyArchive}>
              <Text style={styles.emptyTitle}>{saved.length ? 'No matching films.' : 'An archive of your own.'}</Text>
              <Text style={styles.emptyCopy}>{saved.length ? 'Try a different search or clear your filters.' : 'Start saving movies and collecting your reflections here.'}</Text>
              {activeFilters && <Action text="Clear filters" outline onPress={resetFilters}/>} 
              {!saved.length && <Action text="Discover films" onPress={goDiscover}/>} 
            </View>}/>
        </View>
      ) : (
        <CollectionsScreen active={tab === 'collections'} films={saved}
          onOpenFilm={openSaved} revision={collectionsRevision}/>
      )}

      <View style={styles.bottomNav}>
        {([['home', '⌂', 'Home'], ['discover', '⌕', 'Discover'], ['archive', '▤', 'Archive'], ['collections', '◇', 'Shelves']] as const).map(([id, symbol, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            onPress={() => { Keyboard.dismiss(); setTab(id); }}
            style={[styles.navItem, tab === id && styles.navItemActive]}>
            <Text style={[styles.navSymbol, tab === id && styles.navSymbolActive]}>{symbol}</Text>
            <Text style={[styles.navLabel, tab === id && styles.navLabelActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalOverlay}><View style={styles.modalSheet}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.eyebrow}>FILM DETAILS</Text>
            <Text style={styles.pageTitle}>{detail?.title}</Text>
            <Text style={styles.detailInfo}>{detail?.year ?? 'Year unavailable'} · {detail?.runtimeMinutes ? `${detail.runtimeMinutes} min` : 'Runtime unavailable'}</Text>
            <Text style={styles.detailInfo}>Directed by {detail?.director || 'Unknown'}</Text>
            <Text style={styles.detailInfo}>Genres: {detail?.genres.length ? detail.genres.join(' · ') : 'Not available'}</Text>
            {!!detail?.description && <Text style={styles.detailDescription}>{detail.description}</Text>}
            {detail?.source === 'wikidata' && <Text style={styles.source}>Film metadata: Wikidata, CC0</Text>}
            <View style={styles.modalActions}>
              {detail && !savedIds.has(detail.id) && <Action text="Save to my archive" onPress={() => handleSave(detail)}/>}
              {detail && savedIds.has(detail.id) && <Action text="Open in my archive" onPress={() => { const film = saved.find((f) => f.id === detail.id); setDetail(null); if (film) setJournalFilm(film); }}/>}
              <Action text="Close" outline onPress={() => setDetail(null)}/>
            </View>
          </ScrollView>
        </View></View>
      </Modal>

      <Modal visible={manualOpen} transparent animationType="slide" onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalSheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>
            <Text style={styles.eyebrow}>SOMETHING RARE?</Text>
            <Text style={styles.pageTitle}>Add a film.</Text>
            <Text style={styles.pageCopy}>A missing film shouldn't mean a missing memory.</Text>
            <TextInput style={styles.input} placeholder="Film title *" placeholderTextColor="#91A197" value={manualTitle} onChangeText={setManualTitle}/>
            <TextInput style={styles.input} placeholder="Release year (optional)" placeholderTextColor="#91A197" value={manualYear} keyboardType="number-pad" onChangeText={setManualYear}/>
            <TextInput style={styles.input} placeholder="Director (optional)" placeholderTextColor="#91A197" value={manualDirector} onChangeText={setManualDirector}/>
            <TextInput style={styles.input} placeholder="Genres, separated by commas" placeholderTextColor="#91A197" value={manualGenres} onChangeText={setManualGenres}/>
            <View style={styles.modalActions}>
              <Action text="Save film" onPress={handleManual}/>
              <Action text="Cancel" outline onPress={() => setManualOpen(false)}/>
            </View>
          </ScrollView>
        </View></View>
      </Modal>
      <JournalModal film={journalFilm} onClose={closeJournal} onRemoveFilm={askDelete}/>
      <BackupModal visible={backupOpen} onClose={() => setBackupOpen(false)} onImported={refresh}/>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><Main/></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg },
  topBar: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: P.border },
  brandWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: { height: 37, width: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: P.gold },
  brandIconText: { fontSize: 25, color: '#1C261F' },
  brandName: { color: P.light, fontWeight: '800', letterSpacing: 1.8, fontSize: 12 },
  brandCaption: { color: P.muted, fontSize: 8, marginTop: 3, letterSpacing: 1.1 },
  backupButton: { borderWidth: 1, borderColor: P.border, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 9 },
  backupText: { fontSize: 9, color: P.gold, fontWeight: '700', letterSpacing: 0.9 },
  mainScroll: { flex: 1 },
  scrollBody: { paddingBottom: 35, paddingHorizontal: 19 },
  hero: { marginTop: 18, borderWidth: 1, borderColor: '#52604E', borderRadius: 20, backgroundColor: '#27362C', padding: 20, overflow: 'hidden' },
  eyebrow: { color: P.gold, fontSize: 9, fontWeight: '700', letterSpacing: 1.65 },
  heroHeading: { color: P.light, fontSize: 33, fontFamily: SERIF, lineHeight: 39, marginTop: 10, marginBottom: 9 },
  heroCopy: { color: '#D3D9D1', fontSize: 13, lineHeight: 20, marginBottom: 17, maxWidth: 280 },
  heroStrip: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderColor: '#5F6E5F', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stripDots: { flexDirection: 'row', gap: 5 },
  stripDot: { width: 7, height: 11, borderRadius: 2, borderWidth: 1, borderColor: '#90A28D' },
  stripType: { fontSize: 8, letterSpacing: 1, color: '#B5C4B4' },
  metrics: { flexDirection: 'row', backgroundColor: P.surface, borderRadius: 15, borderWidth: 1, borderColor: P.border, padding: 15, marginTop: 14, marginBottom: 26 },
  metric: { flex: 1, paddingHorizontal: 9 },
  metricNumber: { color: P.light, fontFamily: SERIF, fontSize: 30 },
  metricLabel: { color: P.muted, fontSize: 11, lineHeight: 16 },
  metricSeparator: { width: 1, backgroundColor: P.border },
  sectionHead: { gap: 6, marginBottom: 14 },
  sectionTitle: { color: P.light, fontFamily: SERIF, fontSize: 27 },
  memoryCard: { padding: 17, marginBottom: 11, backgroundColor: P.surface, borderWidth: 1, borderColor: P.border, borderRadius: 15 },
  memoryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  memoryFilm: { flex: 1, color: P.light, fontWeight: '700', fontSize: 15 },
  memoryDate: { color: P.muted, fontSize: 11 },
  memoryMood: { color: P.gold, fontSize: 11, marginTop: 9 },
  memoryText: { color: '#E2E7DF', fontSize: 14, lineHeight: 23, fontFamily: SERIF, marginTop: 10 },
  memoryLink: { color: P.gold, fontSize: 10, letterSpacing: 1.2, marginTop: 14, fontWeight: '700' },
  emptyCard: { backgroundColor: P.surface, borderColor: P.border, borderWidth: 1, padding: 19, borderRadius: 15, gap: 11 },
  emptyTitle: { color: P.light, fontFamily: SERIF, fontSize: 22 },
  emptyCopy: { color: P.muted, fontSize: 13, lineHeight: 20 },
  inlineLink: { fontSize: 10, color: P.gold, letterSpacing: 1.2, fontWeight: '800' },
  sectionBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 31 },
  shelf: { gap: 14, paddingBottom: 10 },
  shelfItem: { width: 94 },
  shelfTitle: { color: P.light, fontSize: 12, marginTop: 8, fontWeight: '600', lineHeight: 17 },
  footerQuote: { color: P.muted, fontFamily: SERIF, fontSize: 16, textAlign: 'center', fontStyle: 'italic', marginTop: 37 },
  mutedNote: { color: P.muted, fontSize: 13 },
  listScreen: { flex: 1 },
  pageHead: { paddingHorizontal: 19, paddingTop: 23, paddingBottom: 12 },
  pageTitle: { color: P.light, fontSize: 33, fontFamily: SERIF, marginTop: 9, marginBottom: 8 },
  pageCopy: { fontSize: 13, color: P.muted, lineHeight: 20, marginBottom: 18 },
  input: { borderWidth: 1, borderColor: P.border, backgroundColor: P.surface, color: P.light, borderRadius: 12, minHeight: 52, paddingHorizontal: 15, fontSize: 14, marginBottom: 12 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  chip: { backgroundColor: P.raised, borderColor: P.border, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 30 },
  chipText: { color: P.light, fontSize: 12 },
  manualButton: { paddingVertical: 12, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: '#A9895C', alignItems: 'center', marginBottom: 4 },
  manualText: { color: P.gold, fontSize: 13, fontWeight: '700' },
  error: { color: P.danger, fontSize: 12, marginTop: 10 },
  searchList: { paddingHorizontal: 19, paddingTop: 9, paddingBottom: 28, flexGrow: 1 },
  searchRow: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 12, borderBottomColor: P.border, borderBottomWidth: 1 },
  searchCopy: { flex: 1, gap: 5 },
  searchTitle: { color: P.light, fontSize: 16, fontWeight: '700' },
  rowMeta: { color: P.gold, fontSize: 11 },
  rowDescription: { color: P.muted, fontSize: 12, lineHeight: 18 },
  arrow: { color: P.gold, fontSize: 28 },
  cover: { borderWidth: 1, borderColor: '#9B987F', borderRadius: 7, padding: 9, justifyContent: 'space-between', alignItems: 'center' },
  coverSmall: { width: 85, height: 118 },
  coverLarge: { width: '100%', aspectRatio: 0.73 },
  coverLabel: { color: '#E0D6C5', fontSize: 9, textAlign: 'center', letterSpacing: 1.05 },
  coverTitle: { color: '#FFF8EF', fontSize: 21, fontFamily: SERIF, textAlign: 'center' },
  coverTitleSmall: { fontSize: 14 },
  coverYear: { color: '#F6E5CA', fontSize: 10, textAlign: 'center' },
  coverRule: { borderTopWidth: 1, borderColor: '#E6D7B855', width: '100%' },
  coverVariantSecond: { borderRadius: 3, borderWidth: 2, borderColor: '#CBB68C88' },
  coverRuleHeavy: { borderTopWidth: 2, borderColor: '#E6D7B888' },
  coverDiamond: { width: 17, height: 17, borderWidth: 1, borderColor: '#E6D7B899', transform: [{ rotate: '45deg' }], alignSelf: 'center' },
  coverDiamondSmall: { width: 10, height: 10 },
  coverTitleAlternate: { fontWeight: '700', letterSpacing: 0.7 },
  archiveList: { paddingHorizontal: 13, paddingTop: 8, paddingBottom: 26, flexGrow: 1 },
  sortOptions: { flexDirection: 'row', gap: 7, paddingBottom: 5, paddingRight: 19 },
  archiveToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  archiveCount: { color: P.muted, fontSize: 12 },
  viewOptions: { flexDirection: 'row', borderWidth: 1, borderColor: P.border, borderRadius: 10, overflow: 'hidden' },
  viewButton: { paddingVertical: 9, paddingHorizontal: 12, backgroundColor: P.surface },
  viewButtonSelected: { backgroundColor: P.gold },
  viewButtonText: { color: P.muted, fontSize: 12, fontWeight: '700' },
  viewButtonTextSelected: { color: P.bg },
  filterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 },
  filterToggle: { paddingVertical: 10, paddingHorizontal: 2 },
  filterToggleText: { color: P.gold, fontSize: 12, fontWeight: '700' },
  filterClear: { padding: 10 },
  filterClearText: { color: P.muted, fontSize: 12, textDecorationLine: 'underline' },
  filterPanel: { borderColor: P.border, borderWidth: 1, borderRadius: 13, backgroundColor: P.surface, paddingVertical: 12, marginBottom: 8, gap: 8 },
  filterHeading: { color: P.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, paddingHorizontal: 12, marginTop: 2 },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12 },
  filterScroller: { flexDirection: 'row', gap: 7, paddingHorizontal: 12, paddingBottom: 3 },
  filterNote: { color: P.muted, fontSize: 10, paddingHorizontal: 12, marginTop: 3 },
  sortChip: { borderWidth: 1, borderColor: P.border, backgroundColor: P.surface, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8 },
  sortChipSelected: { borderColor: P.gold, backgroundColor: P.raised },
  sortChipText: { color: P.muted, fontSize: 11 },
  sortChipTextSelected: { color: P.gold, fontWeight: '700' },
  gridRow: { gap: 11, paddingBottom: 16 },
  archiveItem: { flex: 1, maxWidth: '50%', paddingHorizontal: 6 },
  archiveTitle: { color: P.light, fontWeight: '700', fontSize: 13, lineHeight: 18, marginTop: 8 },
  archiveStatus: { color: '#B4BFB3', fontSize: 11, marginTop: 5 },
  archiveStatusWritten: { color: P.gold },
  archiveRow: { flexDirection: 'row', gap: 13, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: P.border, alignItems: 'center' },
  archiveRowInfo: { flex: 1, gap: 5 },
  archiveRowTitle: { color: P.light, fontFamily: SERIF, fontSize: 19 },
  archiveRowMeta: { color: P.muted, fontSize: 11 },
  archiveRowGenre: { color: '#D2D4C6', fontSize: 11 },
  archiveChevron: { color: P.gold, fontSize: 24, paddingRight: 6 },
  emptyList: { color: P.muted, lineHeight: 22, fontSize: 13, marginTop: 22, textAlign: 'center', paddingHorizontal: 20 },
  emptyArchive: { marginHorizontal: 19, marginTop: 40, gap: 12 },
  bottomNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#162019', borderTopWidth: 1, borderTopColor: P.border, paddingTop: 7, paddingBottom: 4 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  navItemActive: { borderTopWidth: 2, borderTopColor: P.gold },
  navSymbol: { color: P.muted, fontSize: 23, lineHeight: 28 },
  navSymbolActive: { color: P.gold },
  navLabel: { color: P.muted, fontSize: 10, marginTop: 2 },
  navLabelActive: { color: P.light, fontWeight: '700' },
  action: { minHeight: 46, backgroundColor: P.gold, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 12 },
  actionOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: P.border },
  actionText: { color: '#1A271E', fontWeight: '800', fontSize: 13 },
  actionTextOutline: { color: P.light },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000B' },
  modalSheet: { backgroundColor: P.bg, maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: P.border },
  modalBody: { paddingHorizontal: 23, paddingTop: 25, paddingBottom: 37 },
  detailInfo: { color: P.muted, fontSize: 13, marginTop: 9, lineHeight: 21 },
  detailDescription: { color: P.light, fontSize: 14, lineHeight: 23, marginTop: 18 },
  source: { color: P.muted, fontSize: 10, marginTop: 15 },
  modalActions: { gap: 11, marginTop: 21 },
});
