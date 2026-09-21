import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { calendarCreateSchema, type CalendarRecurrence } from '@michel/contracts';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';

export function MobileCalendarPanel({
  server,
  token,
  onBack,
}: {
  server: SavedServer;
  token: string;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const queryKey = ['michel', server.id, 'calendar'];
  const calendar = useQuery({
    queryKey,
    queryFn: () => mobileApi.calendar(server, token),
    refetchInterval: 30000,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<'APPOINTMENT' | 'VISIT'>('APPOINTMENT');
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [recurrence, setRecurrence] = useState<CalendarRecurrence>('NONE');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => {
      const base = {
        type,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        notes: notes || null,
        recurrence,
        recurrenceUntil: recurrenceUntil
          ? new Date(`${recurrenceUntil}T23:59:00`).toISOString()
          : null,
      };
      const input =
        type === 'VISIT'
          ? { ...base, type: 'VISIT' as const, visitorName: title }
          : { ...base, type: 'APPOINTMENT' as const, title, location: location || null };
      const parsed = calendarCreateSchema.parse(input);
      return mobileApi.createCalendar(server, token, parsed);
    },
    onSuccess: async () => {
      setFormOpen(false);
      setTitle('');
      setNotes('');
      setRecurrenceUntil('');
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['michel', server.id, 'schedule'] });
    },
    onError: () => setError('Vérifiez le titre et la date.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => mobileApi.deleteCalendar(server, token, id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['michel', server.id, 'schedule'] });
    },
  });
  const events = calendar.data?.items ?? [];
  const format = (value: string) =>
    new Date(value).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: calendar.data?.timezone,
    });
  return (
    <ScrollView
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl
          refreshing={calendar.isRefetching}
          onRefresh={() => void calendar.refetch()}
        />
      }
    >
      <View style={s.header}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color="#12385F" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>CARNET DE LIAISON</Text>
          <Text accessibilityRole="header" style={s.title}>
            Calendrier partagé
          </Text>
        </View>
        {calendar.data?.canWrite && (
          <Pressable style={s.add} onPress={() => setFormOpen(!formOpen)}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addText}>Ajouter</Text>
          </Pressable>
        )}
      </View>
      {formOpen && calendar.data?.canWrite && (
        <View style={s.form}>
          <View style={s.choices}>
            <Choice
              label="Rendez-vous"
              active={type === 'APPOINTMENT'}
              onPress={() => setType('APPOINTMENT')}
            />
            <Choice
              label="Visite familiale"
              active={type === 'VISIT'}
              onPress={() => setType('VISIT')}
            />
          </View>
          <Field
            label={type === 'VISIT' ? 'Visiteur' : 'Titre'}
            value={title}
            onChangeText={setTitle}
          />
          <Field
            label="Début (AAAA-MM-JJ HH:MM)"
            value={startsAt}
            onChangeText={setStartsAt}
            placeholder="2026-09-24 10:30"
          />
          <Field label="Fin (facultatif)" value={endsAt} onChangeText={setEndsAt} />
          <Field label="Lieu" value={location} onChangeText={setLocation} />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
          <View style={s.choices}>
            <Choice
              label="Aucune répétition"
              active={recurrence === 'NONE'}
              onPress={() => setRecurrence('NONE')}
            />
            <Choice
              label="Chaque jour"
              active={recurrence === 'DAILY'}
              onPress={() => setRecurrence('DAILY')}
            />
            <Choice
              label="Chaque semaine"
              active={recurrence === 'WEEKLY'}
              onPress={() => setRecurrence('WEEKLY')}
            />
            <Choice
              label="Chaque mois"
              active={recurrence === 'MONTHLY'}
              onPress={() => setRecurrence('MONTHLY')}
            />
          </View>
          {recurrence !== 'NONE' && (
            <Field
              label="Jusqu’au (AAAA-MM-JJ)"
              value={recurrenceUntil}
              onChangeText={setRecurrenceUntil}
              placeholder="2027-09-24"
            />
          )}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable style={s.save} onPress={() => create.mutate()} disabled={create.isPending}>
            <Text style={s.saveText}>{create.isPending ? '…' : 'Enregistrer'}</Text>
          </Pressable>
        </View>
      )}
      {calendar.isPending && <Text style={s.muted}>Chargement…</Text>}
      {!events.length && !calendar.isPending && (
        <View style={s.empty}>
          <Ionicons name="calendar-outline" size={42} color="#8ab1c8" />
          <Text style={s.emptyTitle}>Aucun rendez-vous prévu</Text>
          <Text style={s.muted}>Ajoutez une visite ou un rendez-vous pour la maison.</Text>
        </View>
      )}
      {events.map((event) => (
        <View style={s.card} key={event.id}>
          <View style={s.icon}>
            <Ionicons
              name={event.type === 'VISIT' ? 'people-outline' : 'calendar-outline'}
              size={22}
              color="#214b85"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{event.title}</Text>
            <Text style={s.muted}>
              {format(event.startsAt)}
              {event.detail ? ` · ${event.detail}` : ''}
            </Text>
            {event.notes ? <Text style={s.note}>{event.notes}</Text> : null}
          </View>
          {calendar.data?.canWrite && (
            <Pressable onPress={() => remove.mutate(event.id)}>
              <Ionicons name="trash-outline" size={20} color="#9a5550" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
function Field({
  label,
  multiline,
  ...props
}: {
  label: string;
  multiline?: boolean;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        style={[s.input, multiline && s.textarea]}
        placeholderTextColor="#8a98a7"
      />
    </View>
  );
}
function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.choice, active && s.choiceActive]}>
      <Text style={[s.choiceText, active && s.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  page: { padding: 18, gap: 12, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8 },
  eyebrow: { color: '#6c7c8b', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#0B2948', fontSize: 28, fontWeight: '700' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#214b85',
  },
  addText: { color: '#fff', fontWeight: '700' },
  form: { gap: 10, borderRadius: 16, padding: 15, backgroundColor: '#F3F8FB' },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1dee7',
    borderRadius: 9,
    padding: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  choiceActive: { backgroundColor: '#e6f1fa', borderColor: '#7ca8ca' },
  choiceText: { color: '#5d7188', fontSize: 12 },
  choiceTextActive: { color: '#214b85', fontWeight: '700' },
  label: { color: '#526b84', fontSize: 12, fontWeight: '700', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: '#d1dee7',
    borderRadius: 9,
    padding: 10,
    backgroundColor: '#fff',
    color: '#17325d',
  },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  save: { alignItems: 'center', borderRadius: 10, padding: 12, backgroundColor: '#214b85' },
  saveText: { color: '#fff', fontWeight: '700' },
  error: { color: '#9a5550' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#dce7e9',
    borderRadius: 15,
    padding: 14,
    backgroundColor: '#fff',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf6ff',
  },
  cardTitle: { color: '#17325d', fontSize: 17, fontWeight: '700' },
  muted: { color: '#697b90', fontSize: 13 },
  note: { color: '#526b84', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 70, gap: 8 },
  emptyTitle: { color: '#21416d', fontSize: 18, fontWeight: '700' },
});
