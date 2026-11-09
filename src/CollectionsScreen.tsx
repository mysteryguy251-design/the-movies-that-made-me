import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  createCollection, deleteCollection, listCollectionFilmIds, listCollections,
  renameCollection, setCollectionFilm,
} from './database';
import type { FilmCollection } from './database';
import type { Film } from './types';

const C = {
  bg: '#101613', surface: '#1D2722', raised: '#25322B', border: '#34453B',
  text: '#F7F1E7', muted: '#B2BDB4', gold: '#DFC18A', danger: '#EDACA2',
};
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const PALETTES = ['#344A3C', '#4C3F3F', '#3B4556', '#584D38', '#3B514C', '#4D3E50'];
function shade(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTES[n % PALETTES.length];
}

type Props = {
  active: boolean;
  films: Film[];
  onOpenFilm: (film: Film) => void;
  revision: number;
};

export function CollectionsScreen({ active, films, onOpenFilm, revision }: Props) {
  const [collections, setCollections] = useState<FilmCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filmIds, setFilmIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [filmFilter, setFilmFilter] = useState('');

  const load = useCallback(async (currentId: string | null) => {
    const list = await listCollections();
    setCollections(list);
    if (currentId) {
      if (list.some((c) => c.id === currentId)) {
        setFilmIds(await listCollectionFilmIds(currentId));
      } else {
        setSelectedId(null);
        setFilmIds([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    load(selectedId).catch((e) => Alert.alert('Could not load collections', String(e)))
      .finally(() => setLoading(false));
  }, [active, revision, selectedId, load]);

  const selected = collections.find((c) => c.id === selectedId);
  const selectedFilms = useMemo(() => {
    const ids = new Set(filmIds);
    return films.filter((f) => ids.has(f.id));
  }, [films, filmIds]);
  const choices = useMemo(() => films.filter((f) =>
    `${f.title} ${f.year ?? ''}`.toLowerCase().includes(filmFilter.trim().toLowerCase())), [filmFilter, films]);

  const openCreate = () => { setEditTarget(null); setName(''); setEditOpen(true); };
  const openRename = () => { if (!selected) return; setEditTarget(selected.id); setName(selected.name); setEditOpen(true); };

  const commitName = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = editTarget ? editTarget : await createCollection(name);
      if (editTarget) await renameCollection(editTarget, name);
      setEditOpen(false);
      setSelectedId(id);
      await load(id);
    } catch (e) { Alert.alert('Could not save collection', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const askDelete = () => {
    if (!selected || busy) return;
    const collection = selected;
    Alert.alert('Delete this collection?',
      `“${collection.name}” will be deleted, but all films and journal reflections will remain in your archive.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete collection', style: 'destructive', onPress: () => {
        setBusy(true);
        deleteCollection(collection.id)
          .then(() => { setSelectedId(null); setFilmIds([]); return load(null); })
          .catch((e) => Alert.alert('Could not delete collection', String(e)))
          .finally(() => setBusy(false));
      } },
    ]);
  };

  const toggleFilm = async (filmId: string) => {
    if (!selectedId || busy) return;
    const included = !filmIds.includes(filmId);
    setBusy(true);
    try {
      await setCollectionFilm(selectedId, filmId, included);
      setFilmIds(await listCollectionFilmIds(selectedId));
      setCollections(await listCollections());
    } catch (e) { Alert.alert('Could not update shelf', String(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      {loading && <ActivityIndicator color={C.gold} style={styles.loading}/>}
      {!selected ? (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>CURATED BY YOU</Text>
          <Text style={styles.title}>Your collections.</Text>
          <Text style={styles.subtitle}>A home for films connected by a memory, a mood, or a moment in your life.</Text>
          <Pressable accessibilityRole="button" onPress={openCreate} style={styles.primary}>
            <Text style={styles.primaryText}>＋ Create a collection</Text>
          </Pressable>
          {collections.length === 0 && !loading && (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>A shelf waiting for its story.</Text>
              <Text style={styles.description}>Start with “Films That Changed Me”, “Comfort Movies”, or a collection that's completely your own.</Text>
            </View>
          )}
          {collections.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" onPress={() => setSelectedId(c.id)}
              style={({ pressed }) => [styles.collectionCard, pressed && { opacity: 0.77 }]}>
              <View style={styles.collectionArtwork}>
                <Text style={styles.collectionMark}>✦</Text>
                <Text style={styles.collectionArtworkText} numberOfLines={3}>{c.name}</Text>
              </View>
              <View style={styles.collectionInfo}>
                <Text style={styles.collectionName} numberOfLines={2}>{c.name}</Text>
                <Text style={styles.collectionCount}>{c.filmCount} {c.filmCount === 1 ? 'film' : 'films'}</Text>
                <Text style={styles.collectionLink}>OPEN SHELF  →</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.detailPage}>
          <View style={styles.detailHeader}>
            <Pressable accessibilityRole="button" onPress={() => setSelectedId(null)} style={styles.back}>
              <Text style={styles.backText}>← All collections</Text>
            </Pressable>
            <Text style={styles.eyebrow}>YOUR PERSONAL SHELF</Text>
            <Text style={styles.title}>{selected.name}</Text>
            <Text style={styles.subtitle}>{selectedFilms.length} {selectedFilms.length === 1 ? 'film' : 'films'} in this collection</Text>
            <Pressable accessibilityRole="button" onPress={() => { setFilmFilter(''); setAssignOpen(true); }} style={styles.primary}>
              <Text style={styles.primaryText}>＋ Add or remove films</Text>
            </Pressable>
            <View style={styles.tools}>
              <Pressable accessibilityRole="button" onPress={openRename} style={styles.tool}><Text style={styles.toolText}>Rename shelf</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={askDelete} style={styles.tool}><Text style={[styles.toolText, { color: C.danger }]}>Delete shelf</Text></Pressable>
            </View>
          </View>
          <FlatList key={`collection-${selectedId}`} data={selectedFilms} keyExtractor={(f) => f.id}
            contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" style={styles.filmRow} onPress={() => onOpenFilm(item)}>
                <View style={[styles.poster, { backgroundColor: shade(item.id) }]}>
                  <Text numberOfLines={3} style={styles.posterTitle}>{item.title}</Text>
                  <Text style={styles.posterYear}>{item.year ?? '—'}</Text>
                </View>
                <View style={styles.filmInfo}>
                  <Text style={styles.filmTitle}>{item.title}</Text>
                  <Text style={styles.filmMeta}>{item.year ?? 'Year unknown'}{item.director ? ` · ${item.director}` : ''}</Text>
                  <Text style={styles.collectionLink}>OPEN JOURNAL  ↗</Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<View style={styles.empty}>
              <Text style={styles.emptyTitle}>This shelf is still empty.</Text>
              <Text style={styles.description}>Choose films from your archive to begin collecting.</Text>
            </View>}/>
        </View>
      )}

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditOpen(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.eyebrow}>A COLLECTION OF YOUR OWN</Text>
            <Text style={styles.sheetTitle}>{editTarget ? 'Rename your shelf' : 'Give your shelf a name'}</Text>
            <TextInput style={styles.input} placeholder="e.g. Films That Changed Me" placeholderTextColor={C.muted}
              value={name} onChangeText={setName} maxLength={70} autoFocus returnKeyType="done" onSubmitEditing={commitName}/>
            <Pressable accessibilityRole="button" disabled={busy || !name.trim()} onPress={commitName}
              style={[styles.primary, (busy || !name.trim()) && { opacity: 0.5 }]}>
              <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save collection'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={() => { if (!busy) setAssignOpen(false); }}>
        <View style={styles.overlay}>
          <View style={styles.pickerSheet}>
            <Text style={styles.eyebrow}>EDIT YOUR SHELF</Text>
            <Text style={styles.sheetTitle}>Choose your films</Text>
            <Text style={styles.description}>Tap a film to add or remove it. Changes save immediately on this device.</Text>
            <TextInput value={filmFilter} onChangeText={setFilmFilter} style={styles.input}
              placeholder="Find a saved film..." placeholderTextColor={C.muted}/>
            <FlatList data={choices} keyExtractor={(f) => f.id} keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const checked = filmIds.includes(item.id);
                return (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy }}
                    disabled={busy} onPress={() => toggleFilm(item.id)} style={styles.choice}>
                    <Text style={styles.choiceText}>{item.title} {item.year ? `(${item.year})` : ''}</Text>
                    <View style={[styles.checkbox, checked && styles.checked]}><Text style={styles.checkText}>{checked ? '✓' : ''}</Text></View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.description}>{films.length ? 'No matching saved films.' : 'Save your first film in Discover before adding it to a collection.'}</Text>}/>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => setAssignOpen(false)}>
              <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Done'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loading: { position: 'absolute', top: 5, right: 22, zIndex: 2 },
  page: { padding: 19, paddingBottom: 40 },
  eyebrow: { color: C.gold, fontWeight: '700', fontSize: 10, letterSpacing: 1.65, marginBottom: 10 },
  title: { fontFamily: SERIF, color: C.text, fontSize: 31, marginBottom: 9 },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 21, marginBottom: 18 },
  primary: { borderRadius: 12, backgroundColor: C.gold, paddingHorizontal: 16, paddingVertical: 15, alignItems: 'center', marginBottom: 18 },
  primaryText: { fontSize: 13, fontWeight: '800', color: '#1C261F' },
  collectionCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 15,
    padding: 12, marginBottom: 12, flexDirection: 'row', gap: 14, alignItems: 'center' },
  collectionArtwork: { width: 110, height: 124, padding: 9, backgroundColor: '#354838', borderRadius: 9,
    justifyContent: 'space-between', borderWidth: 1, borderColor: '#8F8A66' },
  collectionMark: { color: C.gold, fontSize: 16 },
  collectionArtworkText: { fontFamily: SERIF, color: C.text, fontSize: 17, lineHeight: 21 },
  collectionInfo: { flex: 1, gap: 9 },
  collectionName: { color: C.text, fontSize: 18, fontFamily: SERIF },
  collectionCount: { color: C.muted, fontSize: 12 },
  collectionLink: { color: C.gold, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  empty: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 23, gap: 9, marginTop: 14 },
  emptyTitle: { color: C.text, fontFamily: SERIF, fontSize: 22 },
  description: { color: C.muted, fontSize: 13, lineHeight: 20 },
  detailPage: { flex: 1 },
  detailHeader: { paddingHorizontal: 19, paddingTop: 13 },
  back: { marginBottom: 20 }, backText: { color: C.gold, fontSize: 13 },
  tools: { flexDirection: 'row', gap: 14, marginTop: -5, marginBottom: 9 },
  tool: { paddingVertical: 7, paddingRight: 18 }, toolText: { color: C.text, fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: 19, paddingBottom: 35, flexGrow: 1 },
  filmRow: { flexDirection: 'row', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  poster: { width: 81, height: 110, borderRadius: 6, borderWidth: 1, borderColor: '#907F68', padding: 8,
    justifyContent: 'space-between' },
  posterTitle: { color: C.text, fontFamily: SERIF, fontSize: 13 },
  posterYear: { color: C.gold, fontSize: 10 },
  filmInfo: { flex: 1, gap: 10, justifyContent: 'center' },
  filmTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  filmMeta: { color: C.muted, fontSize: 12, lineHeight: 19 },
  overlay: { flex: 1, backgroundColor: '#000C', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.surface, padding: 22, borderColor: C.border, borderWidth: 1, borderRadius: 18 },
  sheetTitle: { color: C.text, fontFamily: SERIF, fontSize: 25, marginBottom: 16 },
  input: { backgroundColor: C.bg, color: C.text, borderRadius: 11, borderWidth: 1, borderColor: C.border,
    minHeight: 50, paddingHorizontal: 13, marginBottom: 16 },
  cancel: { alignItems: 'center', paddingVertical: 6 }, cancelText: { color: C.muted },
  pickerSheet: { maxHeight: '85%', backgroundColor: C.surface, borderTopLeftRadius: 21, borderTopRightRadius: 21,
    padding: 20, paddingTop: 25, flex: 1, marginTop: '18%' },
  choice: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: C.border },
  choiceText: { color: C.text, fontSize: 14, flex: 1 },
  checkbox: { borderWidth: 1, borderColor: C.gold, width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: C.gold }, checkText: { color: C.bg, fontWeight: '900' },
});
