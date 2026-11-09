import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteJournalEntry, deleteLocalJournalDraft, getLocalJournalDraft,
  listJournalEntries, saveJournalEntry, upsertLocalJournalDraft,
} from './database';
import type { Film, JournalDraft, JournalEntry } from './types';

const C = {
  background: '#101613',
  surface: '#1B2620',
  elevated: '#26382B',
  border: '#374A3D',
  ivory: '#F7F1E7',
  muted: '#B4BEB5',
  gold: '#DFC18A',
  goldFaint: '#B39A71',
  danger: '#E9A69B',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const MOODS = [
  'Moved', 'Comforted', 'Joyful', 'Thoughtful', 'Nostalgic',
  'Unsettled', 'Heartbroken', 'Inspired', 'Amused', 'Indifferent',
];
const COVER_COLORS = ['#344A3C', '#4C3F3F', '#3B4556', '#584D38', '#3B514C', '#4D3E50'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

function todayLocal(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function blankDraft(): JournalDraft {
  return { watchedOn: todayLocal(), rating: null, moods: [], note: '', memorableMoment: '', personalConnection: '' };
}

function draftFromEntry(entry: JournalEntry): JournalDraft {
  return {
    watchedOn: entry.watchedOn, rating: entry.rating, moods: [...entry.moods],
    note: entry.note, memorableMoment: entry.memorableMoment,
    personalConnection: entry.personalConnection,
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1888 && year <= 2100 && date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function displayDate(iso: string): string {
  // Calendar dates are kept as literal components to avoid timezone shifts.
  const [year, month, day] = iso.split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return year && month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? `${months[month - 1]} ${day}, ${year}` : iso;
}

function preferredText(entry: JournalEntry): string {
  return entry.note.trim() || entry.memorableMoment.trim() || entry.personalConnection.trim() ||
    (entry.moods.length ? `You felt ${entry.moods.join(', ').toLowerCase()}.` : 'A viewing worth remembering.');
}

function Button({ title, onPress, secondary = false, disabled = false }: {
  title: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled, pressed && { opacity: 0.75 }]}>
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

type Props = {
  film: Film | null;
  onClose: () => void;
  onRemoveFilm: (film: Film) => void;
};

export function JournalModal({ film, onClose, onRemoveFilm }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deep, setDeep] = useState(false);
  const [showMoreMoods, setShowMoreMoods] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [existing, setExisting] = useState<JournalEntry | null>(null);
  const [draft, setDraft] = useState<JournalDraft>(blankDraft);
  const [initialDraft, setInitialDraft] = useState<JournalDraft>(blankDraft);
  const [restoring, setRestoring] = useState(false);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Mutable snapshots let us flush the latest keystroke even before a React re-render.
  const draftRef = useRef<JournalDraft>(draft);
  const initialRef = useRef<JournalDraft>(initialDraft);
  const deepRef = useRef(false);
  const startingDeepRef = useRef(false);
  const editingRef = useRef(false);
  const activeKeyRef = useRef<string | null>(null);
  const activeFilmIdRef = useRef<string | null>(null);
  const targetEntryIdRef = useRef<string | null>(null);
  const sessionRef = useRef(0);
  const changeVersionRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const transitionRef = useRef(false);

  const reload = useCallback(async (filmId: string) => {
    setEntries(await listJournalEntries(filmId));
  }, []);

  const cancelDebounce = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  };

  // Writes and deletions share one queue. A delayed write cannot recreate a draft
  // after the user has saved or explicitly discarded it.
  const queuePersistDraft = (force = false): Promise<void> => {
    const key = activeKeyRef.current;
    const filmId = activeFilmIdRef.current;
    if (!editingRef.current || (!force && transitionRef.current) || !key || !filmId) return Promise.resolve();
    const snapshot = { ...draftRef.current, moods: [...draftRef.current.moods] };
    const deepMode = deepRef.current;
    const targetEntryId = targetEntryIdRef.current;
    if (!targetEntryId) return Promise.resolve();
    const session = sessionRef.current;
    const version = changeVersionRef.current;
    setDraftStatus('saving');
    const task = writeChainRef.current.catch(() => undefined).then(async () => {
      await upsertLocalJournalDraft(key, filmId, targetEntryId, snapshot, deepMode);
      if (session === sessionRef.current && key === activeKeyRef.current &&
          version === changeVersionRef.current) setDraftStatus('saved');
    });
    writeChainRef.current = task;
    void task.catch(() => {
      if (session === sessionRef.current && key === activeKeyRef.current) setDraftStatus('error');
    });
    return task;
  };

  const queueDeleteDraft = (key: string, filmId: string): Promise<void> => {
    const task = writeChainRef.current.catch(() => undefined).then(() => deleteLocalJournalDraft(key, filmId));
    writeChainRef.current = task;
    return task;
  };

  const scheduleDraftSave = () => {
    if (!editingRef.current || transitionRef.current) return;
    changeVersionRef.current += 1;
    setDraftStatus('saving');
    cancelDebounce();
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void queuePersistDraft().catch(() => undefined);
    }, 650);
  };

  useEffect(() => {
    if (!film) {
      setEntries([]);
      setEditing(false);
      editingRef.current = false;
      activeKeyRef.current = null;
      activeFilmIdRef.current = null;
      targetEntryIdRef.current = null;
      cancelDebounce();
      return;
    }
    let alive = true;
    setLoading(true);
    setEditing(false);
    editingRef.current = false;
    transitionRef.current = false;
    cancelDebounce();
    sessionRef.current += 1;
    activeKeyRef.current = null;
    activeFilmIdRef.current = null;
    targetEntryIdRef.current = null;
    listJournalEntries(film.id)
      .then((items) => { if (alive) setEntries(items); })
      .catch((error) => { if (alive) Alert.alert('Could not open journal', String(error)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [film?.id]);

  // Best-effort flush as Android/iOS backgrounds the app. Debounced writes do
  // most of the work; an OS force-kill cannot guarantee a final pending write.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && editingRef.current) {
        cancelDebounce();
        void queuePersistDraft().catch(() => undefined);
      }
    });
    return () => { sub.remove(); cancelDebounce(); };
  }, []);

  function update<K extends keyof JournalDraft>(key: K, value: JournalDraft[K]) {
    if (transitionRef.current) return;
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    scheduleDraftSave();
  }

  const openEditor = (entry: JournalEntry | null, next: JournalDraft, deepMode: boolean, restored: boolean, targetId?: string) => {
    if (!film) return;
    const baseline = entry ? draftFromEntry(entry) : blankDraft();
    sessionRef.current += 1;
    changeVersionRef.current = 0;
    draftRef.current = next;
    initialRef.current = baseline;
    deepRef.current = deepMode;
    startingDeepRef.current = Boolean(entry?.memorableMoment || entry?.personalConnection);
    activeKeyRef.current = entry ? `edit:${entry.id}` : `new:${film.id}`;
    activeFilmIdRef.current = film.id;
    // Reuse the same ID across saves/recovery: retrying cannot duplicate a new entry.
    targetEntryIdRef.current = entry?.id ?? targetId ?? `journal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    editingRef.current = true;
    transitionRef.current = false;
    setExisting(entry);
    setDraft(next);
    setInitialDraft(baseline);
    setDeep(deepMode);
    setDraftStatus(restored ? 'saved' : 'idle');
    setShowMoreMoods(next.moods.some((m) => !MOODS.slice(0, 5).includes(m)));
    setEditing(true);
  };

  const beginEdit = async (entry: JournalEntry | null) => {
    if (!film || busy || restoring) return;
    const filmId = film.id;
    const key = entry ? `edit:${entry.id}` : `new:${filmId}`;
    const baseline = entry ? draftFromEntry(entry) : blankDraft();
    const defaultDeep = Boolean(entry?.memorableMoment || entry?.personalConnection);
    setRestoring(true);
    try {
      const stored = await getLocalJournalDraft(key, filmId);
      if (stored) {
        Alert.alert('Unfinished reflection found',
          'You have writing saved on this device. Would you like to continue where you left off?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Start fresh', style: 'destructive', onPress: () => {
              void queueDeleteDraft(key, filmId).then(() => openEditor(entry, baseline, defaultDeep, false))
                .catch((error) => Alert.alert('Could not clear draft', String(error)));
            } },
            { text: 'Resume draft', onPress: () => openEditor(entry, stored.draft, stored.deep, true, stored.targetEntryId) },
          ]);
      } else {
        openEditor(entry, baseline, defaultDeep, false);
      }
    } catch (error) {
      Alert.alert('Could not load saved draft', `${String(error)}\nYour existing reflections are unchanged.`);
    } finally {
      setRestoring(false);
    }
  };

  const leaveEditor = (leave: () => void) => {
    editingRef.current = false;
    transitionRef.current = false;
    cancelDebounce();
    activeKeyRef.current = null;
    activeFilmIdRef.current = null;
    targetEntryIdRef.current = null;
    sessionRef.current += 1;
    leave();
  };

  const confirmLeave = (leave: () => void) => {
    if (busy || restoring || transitionRef.current) return;
    if (!editingRef.current) { leave(); return; }
    const key = activeKeyRef.current;
    const filmId = activeFilmIdRef.current;
    if (!key || !filmId) return;
    const hasChanges = JSON.stringify(draftRef.current) !== JSON.stringify(initialRef.current) ||
      deepRef.current !== startingDeepRef.current;
    if (!hasChanges) {
      // No edits to keep: still wait for previous writes before removing a stale draft.
      transitionRef.current = true;
      cancelDebounce();
      void queueDeleteDraft(key, filmId).then(() => leaveEditor(leave))
        .catch((error) => { transitionRef.current = false; Alert.alert('Could not clear draft', String(error)); });
      return;
    }
    Alert.alert('Leave this reflection?', 'Your unfinished writing can be recovered next time.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Discard draft', style: 'destructive', onPress: () => {
        transitionRef.current = true;
        cancelDebounce();
        void queueDeleteDraft(key, filmId).then(() => leaveEditor(leave))
          .catch((error) => { transitionRef.current = false; Alert.alert('Could not discard draft', String(error)); });
      } },
      { text: 'Save draft & leave', onPress: () => {
        transitionRef.current = true;
        cancelDebounce();
        void queuePersistDraft(true).then(() => leaveEditor(leave))
          .catch((error) => { transitionRef.current = false; Alert.alert('Draft not saved', `Please retry: ${String(error)}`); });
      } },
    ]);
  };

  const goBack = () => confirmLeave(() => editing ? setEditing(false) : onClose());
  const close = () => editing ? goBack() : onClose();

  const toggleMood = (mood: string) => {
    if (transitionRef.current) return;
    const prev = draftRef.current;
    const next = {
      ...prev,
      moods: prev.moods.includes(mood) ? prev.moods.filter((m) => m !== mood) : [...prev.moods, mood],
    };
    draftRef.current = next;
    setDraft(next);
    scheduleDraftSave();
  };

  const switchMode = (nextDeep: boolean) => {
    if (transitionRef.current || deepRef.current === nextDeep) return;
    deepRef.current = nextDeep;
    setDeep(nextDeep);
    scheduleDraftSave();
    Keyboard.dismiss();
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  };

  const save = async () => {
    if (!film || busy) return;
    const watchedOn = draftRef.current.watchedOn.trim();
    if (!validDate(watchedOn)) {
      Alert.alert('Check your viewing date', 'Enter a real date in YYYY-MM-DD format.');
      return;
    }
    if (draftRef.current.rating === null && !draftRef.current.moods.length &&
        !draftRef.current.note.trim() && !draftRef.current.memorableMoment.trim() && !draftRef.current.personalConnection.trim()) {
      Alert.alert('Add one memory', 'Choose a feeling, add a rating, or write a thought to save this entry.');
      return;
    }
    const key = activeKeyRef.current;
    const filmId = film.id;
    const snapshot = { ...draftRef.current, moods: [...draftRef.current.moods] };
    setBusy(true);
    transitionRef.current = true;
    cancelDebounce();
    try {
      // Always persist the last keystroke before committing the final entry.
      await queuePersistDraft(true);
      const now = new Date().toISOString();
      await saveJournalEntry({
        id: targetEntryIdRef.current ?? existing?.id ?? `journal-${Date.now()}`,
        filmId,
        watchedOn,
        rating: snapshot.rating,
        moods: snapshot.moods,
        note: snapshot.note.trim(),
        memorableMoment: snapshot.memorableMoment.trim(),
        personalConnection: snapshot.personalConnection.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      // On success remove only this editor's draft, after all pending writes.
      if (key) await queueDeleteDraft(key, filmId);
      await reload(filmId);
      leaveEditor(() => setEditing(false));
    } catch (error) {
      transitionRef.current = false;
      Alert.alert('Could not save reflection', `Your entry was not confirmed saved. ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (entry: JournalEntry) => {
    if (!film) return;
    Alert.alert('Delete this reflection?', 'This viewing and its notes will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteJournalEntry(entry.id, film.id);
          await reload(film.id);
        } catch (error) { Alert.alert('Could not delete reflection', String(error)); }
      } },
    ]);
  };

  const ordered = [...entries].sort((a, b) => a.watchedOn.localeCompare(b.watchedOn) || a.createdAt.localeCompare(b.createdAt));
  const earliest = ordered[0];
  const latest = ordered[ordered.length - 1];

  return (
    <Modal visible={!!film} animationType="slide" onRequestClose={close}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.background}/>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.navBar}>
            <Pressable accessibilityRole="button" onPress={goBack} style={styles.navPress}>
              <Text style={styles.backText}>← {editing ? 'FILM DETAILS' : 'CLOSE FILM'}</Text>
            </Pressable>
            <Text style={styles.navRight}>{editing ? 'YOUR REFLECTION' : 'YOUR FILM STORY'}</Text>
          </View>
          <ScrollView ref={scrollRef} key={`${film?.id ?? 'none'}-${editing ? 'edit' : 'detail'}`}
            style={styles.fill} contentContainerStyle={styles.page}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {!editing ? (
              <>
                <View style={[styles.filmHero, { backgroundColor: colorFor(film?.id ?? '') }]}>
                  <View style={styles.heroInnerRule} />
                  <Kicker>A FILM IN YOUR COLLECTION</Kicker>
                  <Text style={styles.filmTitle}>{film?.title}</Text>
                  <Text style={styles.filmYear}>{film?.year ?? 'YEAR UNKNOWN'}</Text>
                  <View style={styles.heroInnerRule} />
                </View>
                <Kicker>THE FILM</Kicker>
                <Text style={styles.detailName}>{film?.title}</Text>
                <Text style={styles.detailMeta}>
                  {[film?.year?.toString(), film?.director, film?.runtimeMinutes ? `${film.runtimeMinutes} min` : ''].filter(Boolean).join('  ·  ') || 'Personal film record'}
                </Text>
                {!!film?.genres.length && <Text style={styles.genres}>{film.genres.join('  /  ')}</Text>}
                {!!film?.description && <Text style={styles.description}>{film.description}</Text>}
                <View style={styles.filmRule}/>
                <View style={styles.sectionHeader}>
                  <View>
                    <Kicker>YOUR PERSONAL CINEMA</Kicker>
                    <Text style={styles.sectionTitle}>Your history with this film</Text>
                  </View>
                </View>
                <Text style={styles.subtle}>{entries.length} {entries.length === 1 ? 'reflection' : 'reflections'} saved. Every viewing can tell a different story.</Text>
                <View style={styles.actionSpace}>
                  <Button title={restoring ? 'Checking saved draft...' : '+ Remember this viewing'} onPress={() => { void beginEdit(null); }} disabled={restoring}/>
                </View>
                {loading ? <ActivityIndicator style={styles.loading} color={C.gold}/> :
                  entries.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>The first page is yours.</Text>
                      <Text style={styles.subtle}>What stood out, what surprised you, or how did you feel when the credits rolled?</Text>
                    </View>
                  ) : <>
                    <View style={styles.timeline}>
                      {entries.map((entry, index) => (
                        <View key={entry.id} style={styles.timelineRow}>
                          <View style={styles.timelineGutter}>
                            <View style={styles.timelineDot}/>
                            {index < entries.length - 1 && <View style={styles.timelineLine}/>}
                          </View>
                          <View style={styles.entryCard}>
                            <View style={styles.entryTop}>
                              <Text style={styles.entryDate}>{displayDate(entry.watchedOn)}</Text>
                              <Text style={styles.entryTag}>{index === 0 ? 'LATEST' : 'VIEWING'}</Text>
                            </View>
                            {!!entry.moods.length && <Text style={styles.moodText}>{entry.moods.join('  ·  ')}</Text>}
                            {entry.rating !== null && <Text style={styles.ratingSmall}>{'★'.repeat(entry.rating)}{'☆'.repeat(5-entry.rating)}</Text>}
                            {!!entry.note && <Text style={styles.entryThought}>{entry.note}</Text>}
                            {!!entry.memorableMoment && <Text style={styles.extra}><Text style={styles.extraLabel}>A moment  </Text>{entry.memorableMoment}</Text>}
                            {!!entry.personalConnection && <Text style={styles.extra}><Text style={styles.extraLabel}>A thought  </Text>{entry.personalConnection}</Text>}
                            <View style={styles.entryActions}>
                              <Pressable accessibilityRole="button" onPress={() => { void beginEdit(entry); }} style={styles.entryActionTap}>
                                <Text style={styles.editText}>EDIT ENTRY  ↗</Text>
                              </Pressable>
                              <Pressable accessibilityRole="button" onPress={() => confirmDelete(entry)} style={styles.entryActionTap}>
                                <Text style={styles.deleteText}>DELETE</Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                    {ordered.length > 1 && earliest && latest && (
                      <View style={styles.compare}>
                        <Kicker>THEN & NOW</Kicker>
                        <Text style={styles.compareTitle}>A different viewing. A different you.</Text>
                        <Text style={styles.subtle}>Your first and most recent thoughts, preserved in their original words.</Text>
                        <View style={styles.compareCell}>
                          <Text style={styles.compareLabel}>THEN  ·  {displayDate(earliest.watchedOn)}</Text>
                          <Text style={styles.compareQuote}>{preferredText(earliest)}</Text>
                        </View>
                        <View style={styles.compareCell}>
                          <Text style={styles.compareLabel}>NOW  ·  {displayDate(latest.watchedOn)}</Text>
                          <Text style={styles.compareQuote}>{preferredText(latest)}</Text>
                        </View>
                      </View>
                    )}
                  </>}
                <Pressable accessibilityRole="button" onPress={() => film && onRemoveFilm(film)} style={styles.removeFilm}>
                  <Text style={styles.deleteText}>Remove film and all its reflections</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Kicker>AFTER THE CREDITS</Kicker>
                <Text style={styles.editorHeading}>
                  {deep ? 'A little more beneath the surface.' : 'What stayed with you?'}
                </Text>
                <Text style={styles.editorIntro}>{film?.title} · {film?.year ?? 'Film journal'}</Text>
                <View style={styles.editorSwitch} accessibilityRole="tablist">
                  <Pressable accessibilityRole="tab" accessibilityState={{ selected: !deep }}
                    accessibilityLabel="Quick Note mode"
                    onPress={() => switchMode(false)} style={[styles.segment, !deep && styles.segmentActive]}>
                    <Text style={[styles.segmentText, !deep && styles.segmentTextActive]}>QUICK NOTE</Text>
                  </Pressable>
                  <Pressable accessibilityRole="tab" accessibilityState={{ selected: deep }}
                    accessibilityLabel="Deep Reflection mode"
                    onPress={() => switchMode(true)} style={[styles.segment, deep && styles.segmentActive]}>
                    <Text style={[styles.segmentText, deep && styles.segmentTextActive]}>DEEP REFLECTION</Text>
                  </Pressable>
                </View>

                {deep ? (
                  <View style={styles.deepIntro}>
                    <Text style={styles.deepEyebrow}>DEEP REFLECTION  ·  THREE CHAPTERS</Text>
                    <Text style={styles.deepIntroTitle}>Take your time with this one.</Text>
                    <Text style={styles.deepIntroBody}>
                      Your first impression, a moment worth remembering, and what it meant to you.
                      Write as much or as little as you like. Every prompt is optional.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.quickIntro}>
                    <Text style={styles.quickIntroText}>
                      QUICK NOTE  ·  One thought is enough. You can always return to it later.
                    </Text>
                  </View>
                )}

                <View style={[styles.paper, deep && styles.deepPaper]}>
                  {deep && <Text style={styles.chapterLabel}>01  /  FIRST IMPRESSIONS</Text>}
                  <Text style={styles.paperPrompt}>
                    {deep ? 'How did the film leave you?' : 'Your thoughts, in your words.'}
                  </Text>
                  <Text style={styles.paperHint}>
                    {deep ? 'Start anywhere: the feeling, the story, or one detail.' : 'A feeling, a thought, a detail you don’t want to forget.'}
                  </Text>
                  <TextInput style={[styles.paperInput, deep && styles.paperInputDeep]}
                    accessibilityLabel="Your reflection" multiline textAlignVertical="top"
                    value={draft.note} onChangeText={(value) => update('note', value)}
                    placeholder={deep ? 'The first thing I thought about afterward was…' : 'When the credits rolled, I kept thinking about…'}
                    placeholderTextColor="#89998D" />
                  <View style={styles.paperRule}/>
                </View>

                {deep && (
                  <View style={styles.deepQuestions}>
                    <View style={styles.chapterHead}>
                      <Text style={styles.chapterLabel}>02  /  THE MOMENT</Text>
                      <Text style={styles.chapterTitle}>A scene that stayed.</Text>
                      <Text style={styles.chapterHint}>A character, a line, a shot, a piece of music…</Text>
                    </View>
                    <TextInput style={[styles.input, styles.deepInput]} accessibilityLabel="Memorable scene or moment"
                      multiline textAlignVertical="top" value={draft.memorableMoment}
                      onChangeText={(value) => update('memorableMoment', value)}
                      placeholder="I keep returning to the moment when…" placeholderTextColor="#89998D" />
                    <View style={styles.chapterHead}>
                      <Text style={styles.chapterLabel}>03  /  THE MEANING</Text>
                      <Text style={styles.chapterTitle}>What did it mean to you?</Text>
                      <Text style={styles.chapterHint}>Did it remind you of your life, or change how you see something?</Text>
                    </View>
                    <TextInput style={[styles.input, styles.deepInput]} accessibilityLabel="Personal connection"
                      multiline textAlignVertical="top" value={draft.personalConnection}
                      onChangeText={(value) => update('personalConnection', value)}
                      placeholder="Years from now, I want to remember…" placeholderTextColor="#89998D" />
                  </View>
                )}

                <View style={styles.detailsSection}>
                  <Text style={styles.detailsHeading}>The little details</Text>
                  <Text style={styles.detailsHint}>Optional context for your future self.</Text>
                  <Text style={styles.fieldLabel}>HOW DID IT LEAVE YOU FEELING?</Text>
                  <View style={styles.moods}>
                    {(showMoreMoods ? MOODS : MOODS.slice(0, 5)).map((mood) => {
                      const selected = draft.moods.includes(mood);
                      return <Pressable key={mood} accessibilityRole="button"
                        accessibilityState={{ selected }} onPress={() => toggleMood(mood)}
                        style={[styles.moodPill, selected && styles.moodPillSelected]}>
                        <Text style={[styles.moodPillText, selected && styles.moodPillTextSelected]}>{mood}</Text>
                      </Pressable>;
                    })}
                    <Pressable accessibilityRole="button" onPress={() => setShowMoreMoods(!showMoreMoods)}
                      style={styles.moreMoodsButton}>
                      <Text style={styles.moreMoodsText}>{showMoreMoods ? 'Fewer feelings −' : '+ More feelings'}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.ratingRow}>
                    <Text style={styles.fieldLabel}>YOUR RATING (OPTIONAL)</Text>
                    <View style={styles.stars}>
                      {[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="button"
                        accessibilityLabel={`Rate ${value} out of 5; tap again to clear`}
                        onPress={() => update('rating', draft.rating === value ? null : value)}
                        style={styles.starTap}><Text style={[styles.starText, value <= (draft.rating ?? 0) && styles.starActive]}>
                          {value <= (draft.rating ?? 0) ? '★' : '☆'}
                        </Text></Pressable>)}
                    </View>
                  </View>
                  <Text style={styles.fieldLabel}>WHEN DID YOU WATCH IT?</Text>
                  <TextInput style={styles.input} accessibilityLabel="Viewing date"
                    value={draft.watchedOn} onChangeText={(value) => update('watchedOn', value)}
                    keyboardType="numbers-and-punctuation" autoCorrect={false}
                    placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} maxLength={10}/>
                </View>
                <View style={styles.saveArea}>
                  <View style={styles.autosaveRow} accessibilityLiveRegion="polite">
                    <Text style={[styles.autosaveText, draftStatus === 'error' && styles.autosaveError]}>
                      {draftStatus === 'saving' ? 'Saving draft on this device…' :
                       draftStatus === 'saved' ? '✓ Draft saved on this device' :
                       draftStatus === 'error' ? 'Draft save failed — retry before leaving' :
                       'Drafts save automatically while you write'}
                    </Text>
                    {draftStatus === 'error' && (
                      <Pressable accessibilityRole="button" onPress={() => { void queuePersistDraft().catch(() => undefined); }}>
                        <Text style={styles.retryText}>RETRY</Text>
                      </Pressable>
                    )}
                  </View>
                  <Button title={busy ? 'Saving your reflection...' : existing ? 'Save changes' : 'Save to my journal'} onPress={save} disabled={busy}/>
                  <Button title="Back to film" secondary onPress={goBack} disabled={busy}/>
                  <Text style={styles.privacyNote}>PRIVATE BY DEFAULT  ·  SAVED ON THIS DEVICE</Text>
                  <Text style={styles.saveNote}>Drafts stay on this device until you publish or discard them. Archive exports currently exclude unfinished drafts.</Text>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  fill: { flex: 1 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20,
    paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  navPress: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: C.gold, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  navRight: { color: C.muted, fontSize: 9, letterSpacing: 1.4, flexShrink: 1, textAlign: 'right' },
  page: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 54 },
  kicker: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  filmHero: { height: 242, borderRadius: 19, borderWidth: 1, borderColor: '#A49774',
    alignItems: 'center', justifyContent: 'space-between', padding: 22, marginBottom: 27 },
  heroInnerRule: { width: '100%', height: 1, backgroundColor: '#C9BEAA88' },
  filmTitle: { fontFamily: SERIF, fontSize: 36, lineHeight: 43, textAlign: 'center', color: C.ivory, maxWidth: '90%' },
  filmYear: { fontSize: 12, color: C.ivory, letterSpacing: 2 },
  detailName: { fontFamily: SERIF, color: C.ivory, fontSize: 31, marginTop: 8, lineHeight: 39 },
  detailMeta: { color: C.muted, fontSize: 13, marginTop: 8, lineHeight: 21 },
  genres: { color: C.gold, fontSize: 11, marginTop: 12, lineHeight: 20 },
  description: { color: '#CED7CC', fontSize: 14, lineHeight: 23, marginTop: 14 },
  filmRule: { borderTopWidth: 1, borderColor: C.border, marginTop: 28, marginBottom: 28 },
  sectionHeader: { marginBottom: 8 },
  sectionTitle: { fontFamily: SERIF, color: C.ivory, fontSize: 25, lineHeight: 31, marginTop: 9 },
  subtle: { color: C.muted, fontSize: 13, lineHeight: 21 },
  actionSpace: { marginTop: 22, marginBottom: 22 },
  button: { borderRadius: 12, minHeight: 52, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 15, paddingVertical: 13, backgroundColor: C.gold },
  buttonSecondary: { backgroundColor: 'transparent', borderColor: C.border, borderWidth: 1 },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#172119', fontWeight: '800', fontSize: 14 },
  buttonTextSecondary: { color: C.ivory },
  loading: { marginTop: 22 },
  emptyBox: { backgroundColor: C.surface, borderRadius: 16, borderColor: C.border,
    borderWidth: 1, padding: 19, gap: 10, marginBottom: 15 },
  emptyTitle: { fontFamily: SERIF, color: C.ivory, fontSize: 24 },
  timeline: { marginTop: 4 },
  timelineRow: { flexDirection: 'row', gap: 13 },
  timelineGutter: { width: 13, alignItems: 'center' },
  timelineDot: { height: 11, width: 11, borderRadius: 6, backgroundColor: C.gold, marginTop: 21 },
  timelineLine: { width: 1, flex: 1, backgroundColor: C.border, marginVertical: 6 },
  entryCard: { flex: 1, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1,
    borderColor: C.border, padding: 18, gap: 11, marginBottom: 16 },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  entryDate: { flex: 1, color: C.ivory, fontSize: 15, fontWeight: '800' },
  entryTag: { color: C.goldFaint, fontSize: 9, letterSpacing: 1 },
  moodText: { color: C.gold, fontSize: 12, lineHeight: 18 },
  ratingSmall: { color: C.gold, fontSize: 18 },
  entryThought: { color: C.ivory, fontFamily: SERIF, fontSize: 17, lineHeight: 26 },
  extra: { color: C.muted, fontSize: 13, lineHeight: 22 },
  extraLabel: { color: C.gold, fontWeight: '700' },
  entryActions: { flexDirection: 'row', alignItems: 'center', gap: 18,
    marginTop: 4, borderTopWidth: 1, borderColor: C.border, paddingTop: 11 },
  entryActionTap: { paddingVertical: 5 },
  editText: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  deleteText: { color: C.danger, fontSize: 11, fontWeight: '700' },
  compare: { borderRadius: 19, borderWidth: 1, borderColor: '#6C6651', backgroundColor: '#253128',
    padding: 19, marginTop: 15, gap: 12 },
  compareTitle: { fontFamily: SERIF, color: C.ivory, fontSize: 25, lineHeight: 33 },
  compareCell: { paddingTop: 13, borderTopWidth: 1, borderTopColor: C.border, gap: 7 },
  compareLabel: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  compareQuote: { color: C.ivory, fontFamily: SERIF, fontSize: 16, lineHeight: 25 },
  removeFilm: { alignSelf: 'center', paddingVertical: 18, marginTop: 28 },
  editorHeading: { fontFamily: SERIF, color: C.ivory, fontSize: 31, lineHeight: 38, marginTop: 12 },
  editorIntro: { color: C.gold, marginTop: 7, fontSize: 13 },
  editorHelper: { color: C.muted, fontSize: 14, lineHeight: 22, marginTop: 14 },
  quickIntro: { borderLeftWidth: 2, borderColor: C.goldFaint, marginTop: 4, paddingVertical: 9, paddingLeft: 12 },
  quickIntroText: { color: C.muted, fontSize: 12, lineHeight: 18 },
  deepIntro: { backgroundColor: '#28352A', borderColor: '#8A7555', borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 4, gap: 8 },
  deepEyebrow: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  deepIntroTitle: { color: C.ivory, fontFamily: SERIF, fontSize: 23, lineHeight: 30 },
  deepIntroBody: { color: C.muted, fontSize: 12, lineHeight: 20 },
  chapterLabel: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  deepPaper: { borderColor: '#8A7555', marginTop: 16 },
  paperInputDeep: { minHeight: 120 },
  deepQuestions: { marginTop: 24 },
  chapterHead: { marginTop: 13, marginBottom: 12 },
  chapterTitle: { color: C.ivory, fontFamily: SERIF, fontSize: 24, lineHeight: 32 },
  chapterHint: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 4 },
  deepInput: { minHeight: 100, fontFamily: SERIF, fontSize: 16, lineHeight: 24, paddingTop: 14 },
  detailsSection: { marginTop: 28, paddingTop: 22, borderTopWidth: 1, borderTopColor: C.border },
  detailsHeading: { color: C.ivory, fontSize: 21, fontFamily: SERIF, lineHeight: 28 },
  detailsHint: { color: C.muted, fontSize: 12, marginTop: 5, marginBottom: 4 },
  moreMoodsButton: { paddingHorizontal: 13, paddingVertical: 11, justifyContent: 'center' },
  moreMoodsText: { color: C.gold, fontSize: 12, fontWeight: '700' },
  editorSwitch: { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 12,
    overflow: 'hidden', marginTop: 22, marginBottom: 12, padding: 3, backgroundColor: C.surface },
  segment: { flex: 1, borderRadius: 9, alignItems: 'center', paddingVertical: 13 },
  segmentActive: { backgroundColor: C.gold },
  segmentText: { color: C.muted, fontSize: 10, letterSpacing: 0.6, fontWeight: '800' },
  segmentTextActive: { color: '#19261D' },
  fieldLabel: { color: C.ivory, fontSize: 11, fontWeight: '800', letterSpacing: 0.75,
    marginTop: 24, marginBottom: 11 },
  fieldHint: { color: C.muted, fontSize: 11, marginTop: -4 },
  input: { minHeight: 52, paddingVertical: 12, paddingHorizontal: 15, fontSize: 15,
    color: C.ivory, backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 11 },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  moodPill: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 24, paddingHorizontal: 14, paddingVertical: 11 },
  moodPillSelected: { backgroundColor: C.gold, borderColor: C.gold },
  moodPillText: { color: C.muted, fontSize: 12 },
  moodPillTextSelected: { color: '#1A281F', fontWeight: '800' },
  ratingRow: { marginTop: 8 },
  stars: { flexDirection: 'row', gap: 5, marginTop: 3 },
  starTap: { padding: 4 },
  starText: { color: C.muted, fontSize: 34 },
  starActive: { color: C.gold },
  paper: { backgroundColor: '#202D24', borderWidth: 1, borderColor: '#59664F',
    borderRadius: 18, padding: 18, marginTop: 14 },
  paperPrompt: { fontFamily: SERIF, color: C.ivory, fontSize: 24, lineHeight: 32 },
  paperHint: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 7 },
  paperInput: { minHeight: 115, color: C.ivory, fontFamily: SERIF, fontSize: 18,
    lineHeight: 29, marginTop: 18, padding: 0 },
  paperRule: { borderTopWidth: 1, borderTopColor: '#58664F', marginTop: 12 },
  deepSection: { marginTop: 28 },
  multiline: { minHeight: 100 },
  saveArea: { marginTop: 30, gap: 12 },
  privacyNote: { textAlign: 'center', color: C.goldFaint, fontSize: 10, letterSpacing: 1.15, marginTop: 8 },
  saveNote: { color: C.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  autosaveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 5 },
  autosaveText: { color: C.goldFaint, fontSize: 12, textAlign: 'center' },
  autosaveError: { color: C.danger },
  retryText: { color: C.gold, fontWeight: '800', fontSize: 12 },
});
