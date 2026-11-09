import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { exportBackup, importBackup, pickBackup } from './backup';

const color = {
  bg: '#101319', surface: '#1A1F29', border: '#323946',
  text: '#F5F0E7', muted: '#B0B7C0', gold: '#D9BA7F',
};

type Props = { visible: boolean; onClose: () => void; onImported: () => Promise<void> };

export function BackupModal({ visible, onClose, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<unknown | null>(null);

  const close = () => {
    if (busy) return;
    setPending(null);
    setMessage('');
    onClose();
  };
  const exportNow = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const counts = await exportBackup();
      setMessage(`The share panel opened for ${counts.films} films, ${counts.entries} reflections and ${counts.collections} collections. Verify that you saved the JSON file to a safe place outside Expo Go.`);
    } catch (error) {
      Alert.alert('Export failed', String(error));
    } finally {
      setBusy(false);
    }
  };
  const selectImport = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const parsed = await pickBackup();
      setPending(parsed);
      if (parsed !== null) setMessage('File selected. Import merges saved records without deleting or replacing anything already in the app.');
    } catch (error) {
      setPending(null);
      Alert.alert('Could not read file', String(error));
    } finally {
      setBusy(false);
    }
  };
  const confirmImport = async () => {
    if (busy || pending === null) return;
    setBusy(true);
    try {
      const result = await importBackup(pending);
      await onImported();
      setMessage(`Import finished: ${result.filmsAdded} films and ${result.entriesAdded} journal entries, ${result.collectionsAdded} collections and ${result.membershipsAdded} shelf memberships added. Existing records were left unchanged.`);
      setPending(null);
    } catch (error) {
      Alert.alert('Import failed', String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.eyebrow}>MY FILM ARCHIVE</Text>
            <Text style={styles.title}>Backup & restore</Text>
            <Text style={styles.description}>
              Keep a copy of your films, reflections and curated collections outside this app. A backup file can be re-imported if you switch phones or need to recover your archive.
            </Text>
            <View style={styles.notice}>
              <Text style={styles.warning}>Prototype privacy warning</Text>
              <Text style={styles.muted}>
                Backup files contain your private writing in readable JSON, without encryption. Save them somewhere you trust. Do not share them publicly.
              </Text>
            </View>
            <Pressable disabled={busy} style={styles.primary} onPress={exportNow}>
              <Text style={styles.primaryText}>Export my archive</Text>
            </Pressable>
            <Text style={styles.muted}>Use the Android sharing screen to save your file to a folder or cloud drive. The app cannot verify that it was actually saved.</Text>
            <View style={styles.divider}/>
            <Pressable disabled={busy} style={styles.secondary} onPress={selectImport}>
              <Text style={styles.secondaryText}>Choose a backup file</Text>
            </Pressable>
            {pending !== null ? (
              <View style={styles.confirm}>
                <Text style={styles.description}>Ready to merge this backup into the current archive?</Text>
                <Pressable disabled={busy} style={styles.primary} onPress={confirmImport}>
                  <Text style={styles.primaryText}>Confirm import</Text>
                </Pressable>
                <Pressable disabled={busy} style={styles.secondary} onPress={() => setPending(null)}>
                  <Text style={styles.secondaryText}>Cancel import</Text>
                </Pressable>
              </View>
            ) : null}
            {busy ? <ActivityIndicator color={color.gold} style={{ marginTop: 16 }}/> : null}
            {!!message && <Text style={styles.message}>{message}</Text>}
            <Pressable disabled={busy} style={styles.close} onPress={close}>
              <Text style={styles.secondaryText}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000B' },
  sheet: { backgroundColor: color.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%' },
  body: { padding: 24, paddingBottom: 45, gap: 12 },
  eyebrow: { color: color.gold, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  title: { color: color.text, fontSize: 27, fontWeight: '700' },
  description: { color: color.text, fontSize: 15, lineHeight: 23 },
  muted: { color: color.muted, fontSize: 13, lineHeight: 20 },
  notice: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, padding: 14, borderRadius: 12, gap: 6 },
  warning: { color: color.gold, fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: color.border, marginVertical: 8 },
  primary: { padding: 14, borderRadius: 12, backgroundColor: color.gold, alignItems: 'center' },
  primaryText: { color: '#121820', fontWeight: '700', fontSize: 15 },
  secondary: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: color.border, alignItems: 'center' },
  secondaryText: { color: color.text, fontWeight: '700', fontSize: 14 },
  message: { color: color.gold, fontSize: 13, lineHeight: 20 },
  confirm: { gap: 10, paddingVertical: 4 },
  close: { padding: 14, alignItems: 'center', marginTop: 8 },
});
