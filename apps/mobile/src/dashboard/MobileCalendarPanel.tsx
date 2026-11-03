import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Platform,
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
import { dateLocale, tr } from '../locale';
import { MobileDateTimePicker } from '../MobileDateTimePicker';

type PickerTarget = 'start' | 'end';
type PickerMode = 'date' | 'time';
type ActivePicker = { target: PickerTarget; mode: PickerMode } | null;

function nextHalfHour() {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil((start.getMinutes() + 1) / 30) * 30);
  return start;
}

function recurrenceEnd(start: Date, recurrence: CalendarRecurrence, count: number) {
  if (Number.isNaN(start.getTime()) || !Number.isInteger(count) || count < 1 || count > 400)
    return null;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let index = 1; index < count; index += 1) {
    if (recurrence === 'DAILY') end.setDate(end.getDate() + 1);
    if (recurrence === 'WEEKLY') end.setDate(end.getDate() + 7);
    if (recurrence === 'MONTHLY') {
      const originalDay = end.getDate();
      end.setDate(1);
      end.setMonth(end.getMonth() + 1);
      const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
      end.setDate(Math.min(originalDay, lastDay));
    }
  }
  end.setHours(23, 59, 0, 0);
  return end;
}

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
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(() => nextHalfHour());
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [pickerDraft, setPickerDraft] = useState(() => nextHalfHour());
  const [recurrence, setRecurrence] = useState<CalendarRecurrence>('NONE');
  const [recurrenceCount, setRecurrenceCount] = useState('7');
  const [error, setError] = useState('');
  const pickerValue = (target: PickerTarget) =>
    target === 'start' ? startsAt : (endsAt ?? new Date(startsAt.getTime() + 60 * 60 * 1000));
  const applyPickerValue = (target: PickerTarget, mode: PickerMode, selected: Date) => {
    const next = new Date(pickerValue(target));
    if (mode === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    if (target === 'start') {
      setStartsAt(next);
      if (endsAt && endsAt <= next) setEndsAt(new Date(next.getTime() + 60 * 60 * 1000));
      setError('');
    } else {
      setEndsAt(next);
      setError(
        next <= startsAt
          ? tr('La fin doit être après le début.', 'The end must be after the start.')
          : '',
      );
    }
  };
  const openPicker = (target: PickerTarget, mode: PickerMode) => {
    const value = pickerValue(target);
    const onChange = (_event: unknown, selected?: Date) => {
      if (selected) applyPickerValue(target, mode, selected);
    };
    if (Platform.OS === 'android') {
      if (mode === 'date') {
        DateTimePickerAndroid.open({
          value,
          mode,
          display: 'calendar',
          ...(target === 'end' ? { minimumDate: startsAt } : {}),
          onChange,
        });
      } else {
        DateTimePickerAndroid.open({ value, mode, display: 'clock', is24Hour: true, onChange });
      }
      return;
    }
    setPickerDraft(value);
    setActivePicker({ target, mode });
  };
  const toggleForm = () => {
    if (formOpen) {
      setFormOpen(false);
      return;
    }
    setTitle('');
    setStartsAt(nextHalfHour());
    setEndsAt(null);
    setError('');
    setFormOpen(true);
  };
  const create = useMutation({
    mutationFn: () => {
      const until =
        recurrence === 'NONE' ? null : recurrenceEnd(startsAt, recurrence, Number(recurrenceCount));
      if (
        Number.isNaN(startsAt.getTime()) ||
        (endsAt && endsAt <= startsAt) ||
        (recurrence !== 'NONE' && !until)
      )
        throw new Error('Invalid calendar input');
      const input = {
        type: 'APPOINTMENT' as const,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        notes: null,
        recurrence,
        recurrenceUntil: until?.toISOString() ?? null,
        title: title.trim(),
        location: null,
      };
      const parsed = calendarCreateSchema.parse(input);
      return mobileApi.createCalendar(server, token, parsed);
    },
    onSuccess: async () => {
      setFormOpen(false);
      setTitle('');
      setStartsAt(nextHalfHour());
      setEndsAt(null);
      setRecurrenceCount('7');
      setError('');
      await client.invalidateQueries({ queryKey });
      await client.invalidateQueries({ queryKey: ['michel', server.id, 'schedule'] });
    },
    onError: () =>
      setError(
        tr('Vérifiez le rendez-vous et ses horaires.', 'Check the appointment and its times.'),
      ),
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
    new Date(value).toLocaleString(dateLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: calendar.data?.timezone,
    });
  const formatPickerDate = (value: Date) =>
    value.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const formatPickerTime = (value: Date) =>
    value.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const confirmPicker = () => {
    if (activePicker) applyPickerValue(activePicker.target, activePicker.mode, pickerDraft);
    setActivePicker(null);
  };
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
          <Text style={s.eyebrow}>{tr('CARNET DE LIAISON', 'NOTEBOOK')}</Text>
          <Text accessibilityRole="header" style={s.title}>
            {tr('Calendrier partagé', 'Shared calendar')}
          </Text>
        </View>
        {calendar.data?.canWrite && (
          <Pressable style={s.add} onPress={toggleForm}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addText}>{tr('Ajouter', 'Add')}</Text>
          </Pressable>
        )}
      </View>
      {formOpen && calendar.data?.canWrite && (
        <View style={s.form}>
          <Field label={tr('Rendez-vous', 'Appointment')} value={title} onChangeText={setTitle} />
          <View style={s.dateTimeGroup}>
            <Text style={s.label}>{tr('Début', 'Start')}</Text>
            <View style={s.dateTimeRow}>
              <PickerButton
                label="Date"
                value={formatPickerDate(startsAt)}
                icon="calendar-outline"
                onPress={() => openPicker('start', 'date')}
              />
              <PickerButton
                label={tr('Heure', 'Time')}
                value={formatPickerTime(startsAt)}
                icon="time-outline"
                onPress={() => openPicker('start', 'time')}
              />
            </View>
          </View>
          <View style={s.dateTimeGroup}>
            <View style={s.endHeading}>
              <Text style={s.label}>{tr('Fin (facultatif)', 'End (optional)')}</Text>
              {endsAt && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('Supprimer l’heure de fin', 'Remove the end time')}
                  onPress={() => setEndsAt(null)}
                  style={s.clearEnd}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#516981" />
                  <Text style={s.clearEndText}>{tr('Retirer', 'Remove')}</Text>
                </Pressable>
              )}
            </View>
            {endsAt ? (
              <View style={s.dateTimeRow}>
                <PickerButton
                  label="Date"
                  value={formatPickerDate(endsAt)}
                  icon="calendar-outline"
                  onPress={() => openPicker('end', 'date')}
                />
                <PickerButton
                  label={tr('Heure', 'Time')}
                  value={formatPickerTime(endsAt)}
                  icon="time-outline"
                  onPress={() => openPicker('end', 'time')}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setEndsAt(new Date(startsAt.getTime() + 60 * 60 * 1000))}
                style={s.addEnd}
              >
                <Ionicons name="add-circle-outline" size={19} color="#315A82" />
                <Text style={s.addEndText}>
                  {tr('Ajouter une heure de fin', 'Add an end time')}
                </Text>
              </Pressable>
            )}
          </View>
          <View style={s.choices}>
            <Choice
              label={tr('Aucune répétition', 'No repeat')}
              active={recurrence === 'NONE'}
              onPress={() => setRecurrence('NONE')}
            />
            <Choice
              label={tr('Chaque jour', 'Every day')}
              active={recurrence === 'DAILY'}
              onPress={() => setRecurrence('DAILY')}
            />
            <Choice
              label={tr('Chaque semaine', 'Every week')}
              active={recurrence === 'WEEKLY'}
              onPress={() => setRecurrence('WEEKLY')}
            />
            <Choice
              label={tr('Chaque mois', 'Every month')}
              active={recurrence === 'MONTHLY'}
              onPress={() => setRecurrence('MONTHLY')}
            />
          </View>
          {recurrence !== 'NONE' && (
            <Field
              label={
                recurrence === 'DAILY'
                  ? tr('Pendant (jours)', 'For (days)')
                  : tr('Nombre de répétitions', 'Number of repeats')
              }
              value={recurrenceCount}
              onChangeText={setRecurrenceCount}
              placeholder="7"
            />
          )}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable
            style={[s.save, create.isPending && s.disabled]}
            onPress={() => create.mutate()}
            disabled={create.isPending}
          >
            <Text style={s.saveText}>{create.isPending ? '…' : tr('Enregistrer', 'Save')}</Text>
          </Pressable>
        </View>
      )}
      <Modal
        transparent
        animationType="slide"
        visible={Boolean(activePicker)}
        onRequestClose={() => setActivePicker(null)}
      >
        <View style={s.pickerOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('Fermer le sélecteur', 'Close the picker')}
            onPress={() => setActivePicker(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Pressable onPress={() => setActivePicker(null)} style={s.pickerHeaderButton}>
                <Text style={s.pickerCancel}>{tr('Annuler', 'Cancel')}</Text>
              </Pressable>
              <Text style={s.pickerTitle}>
                {activePicker?.mode === 'date'
                  ? tr('Choisir la date', 'Choose the date')
                  : tr('Choisir l’heure', 'Choose the time')}
              </Text>
              <Pressable onPress={confirmPicker} style={s.pickerHeaderButton}>
                <Text style={s.pickerConfirm}>{tr('Valider', 'Confirm')}</Text>
              </Pressable>
            </View>
            {activePicker && (
              <MobileDateTimePicker
                value={pickerDraft}
                mode={activePicker.mode}
                is24Hour
                locale="fr-FR"
                themeVariant="light"
                minuteInterval={5}
                minimumDate={
                  activePicker.target === 'end' && activePicker.mode === 'date'
                    ? startsAt
                    : undefined
                }
                onChange={(_event, selected) => {
                  if (selected) setPickerDraft(selected);
                }}
                style={s.picker}
              />
            )}
          </View>
        </View>
      </Modal>
      {calendar.isPending && <Text style={s.muted}>{tr('Chargement…', 'Loading…')}</Text>}
      {!events.length && !calendar.isPending && (
        <View style={s.empty}>
          <Ionicons name="calendar-outline" size={42} color="#8ab1c8" />
          <Text style={s.emptyTitle}>
            {tr('Aucun rendez-vous prévu', 'No appointments planned')}
          </Text>
          <Text style={s.muted}>
            {tr('Ajoutez un rendez-vous pour la maison.', 'Add an appointment for the home.')}
          </Text>
        </View>
      )}
      {events.map((event) => (
        <View style={s.card} key={event.id}>
          <View style={s.icon}>
            <Ionicons name="calendar-outline" size={22} color="#214b85" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{event.title}</Text>
            <Text style={s.muted}>{format(event.startsAt)}</Text>
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
function PickerButton({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} : ${value}`}
      onPress={onPress}
      style={s.dateTimeButton}
    >
      <View style={s.dateTimeButtonCopy}>
        <Text style={s.dateTimeButtonLabel}>{label}</Text>
        <Text style={s.dateTimeButtonValue} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
      <Ionicons name={icon} size={19} color="#315A82" />
    </Pressable>
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
  eyebrow: { color: '#55687B', fontSize: 14, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: '#0B2948', fontSize: 30, fontWeight: '700' },
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
  form: { gap: 12, borderRadius: 16, padding: 15, backgroundColor: '#F3F8FB' },
  dateTimeGroup: { gap: 6 },
  dateTimeRow: { flexDirection: 'row', gap: 8 },
  dateTimeButton: {
    minWidth: 0,
    minHeight: 66,
    flex: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 7,
    borderWidth: 1,
    borderColor: '#d1dee7',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  dateTimeButtonCopy: { minWidth: 0, flex: 1, gap: 3 },
  dateTimeButtonLabel: {
    color: '#55687B',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dateTimeButtonValue: { color: '#17325d', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  endHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  clearEnd: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  clearEndText: { color: '#516981', fontSize: 15, fontWeight: '600' },
  addEnd: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#b9cbd9',
    borderRadius: 12,
    backgroundColor: '#f9fcfe',
  },
  addEndText: { color: '#315A82', fontSize: 16, fontWeight: '600' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minWidth: 112,
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1,
    borderColor: '#d1dee7',
    borderRadius: 9,
    padding: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  choiceActive: { backgroundColor: '#e6f1fa', borderColor: '#7ca8ca' },
  choiceText: { color: '#536880', fontSize: 15 },
  choiceTextActive: { color: '#214b85', fontWeight: '700' },
  label: { color: '#526b84', fontSize: 15, fontWeight: '700', marginBottom: 5 },
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
  disabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '700' },
  error: { color: '#9a5550' },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 28, 45, 0.42)' },
  pickerSheet: {
    paddingTop: 14,
    paddingHorizontal: 18,
    paddingBottom: 30,
    gap: 8,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#fff',
  },
  pickerHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickerHeaderButton: {
    minWidth: 64,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCancel: { color: '#526b84', fontSize: 17, fontWeight: '600' },
  pickerTitle: {
    minWidth: 0,
    flex: 1,
    color: '#17325d',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  pickerConfirm: { color: '#214b85', fontSize: 17, fontWeight: '700' },
  picker: { width: '100%' },
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
  cardTitle: { color: '#17325d', fontSize: 19, fontWeight: '700' },
  muted: { color: '#52677F', fontSize: 16 },
  note: { color: '#526b84', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 70, gap: 8 },
  emptyTitle: { color: '#21416d', fontSize: 20, fontWeight: '700' },
});
