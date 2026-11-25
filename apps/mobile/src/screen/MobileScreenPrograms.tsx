import { screenLocalTime } from '@elise/contracts';
import type { ScreenMedia, ScreenProgram, ScreenSnapshot, TvChannel } from '@elise/contracts';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { t } from '../i18n';
import { dateLocale } from '../locale';
import { MobileDateTimePicker } from '../MobileDateTimePicker';

const c = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  paleBlue: '#E8F0F3',
  teal: '#347D8B',
};

/** Monday first; 0 is Sunday as in Date.getDay(). */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const weekdayName = (day: number, width: 'short' | 'long') =>
  // 4 January 2026 is a Sunday.
  new Intl.DateTimeFormat(dateLocale(), { weekday: width, timeZone: 'UTC' })
    .format(Date.UTC(2026, 0, 4 + day))
    .replace('.', '');

function daysLabel(days: readonly number[]) {
  const set = new Set(days);
  if (set.size === 7) return t('mobileScreenPrograms.everyDay');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day)))
    return t('mobileScreenPrograms.weekdays');
  const ordered = WEEK.filter((day) => set.has(day));
  return ordered.map((day) => weekdayName(day, ordered.length > 2 ? 'short' : 'long')).join(', ');
}

function whenLabel(program: ScreenProgram) {
  const hours = `${program.start} – ${program.end}`;
  if (program.repeat === 'weekly') return `${daysLabel(program.days ?? [])} · ${hours}`;
  const date = new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${program.date}T12:00:00Z`));
  return `${date} · ${hours}`;
}

const pad = (value: number) => String(value).padStart(2, '0');
const clockOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const dateOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const asDate = (date: string, clock = '12:00') => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = clock.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
};

type Field = 'start' | 'end' | 'date';
type Choice = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap };

export function MobileScreenPrograms({
  server,
  token,
  snapshot,
  busy,
  liveChannels,
  mediaIdForUrl,
  run,
}: {
  server: SavedServer;
  token: string;
  snapshot: ScreenSnapshot;
  busy: boolean;
  liveChannels: TvChannel[];
  mediaIdForUrl: (kind: ScreenMedia['kind'], url: string) => string;
  run: (action: () => Promise<void>, refresh?: boolean) => Promise<void>;
}) {
  const { state } = snapshot;
  const today = screenLocalTime(new Date(), snapshot.timezone).date;
  const radios = state.media.filter((media) => media.kind === 'stream');
  const videos = state.media.filter((media) => media.kind === 'youtube');
  const choices: Choice[] = [
    ...radios.map((media) => ({
      key: `media:${media.id}`,
      label: media.title,
      icon: 'radio-outline' as const,
    })),
    ...liveChannels.map((channel) => ({
      key: `channel:${channel.id}`,
      label: channel.name,
      icon: 'tv-outline' as const,
    })),
    ...videos.map((media) => ({
      key: `media:${media.id}`,
      label: media.title,
      icon: 'logo-youtube' as const,
    })),
  ];
  const [choice, setChoice] = useState('');
  const [repeat, setRepeat] = useState<'weekly' | 'once'>('weekly');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [picker, setPicker] = useState<{ field: Field; value: Date } | null>(null);
  const selected = choice || choices[0]?.key || '';
  const valid = !!selected && start !== end && (repeat === 'once' ? !!date : days.length > 0);
  const sortKey = (program: ScreenProgram) =>
    `${program.repeat === 'once' ? program.date : '0000'} ${program.start}`;
  const programs = [...(state.programs ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const apply = (field: Field, value: Date) => {
    if (field === 'date') setDate(dateOf(value));
    else if (field === 'start') setStart(clockOf(value));
    else setEnd(clockOf(value));
  };
  const openPicker = (field: Field) => {
    const value = field === 'date' ? asDate(date) : asDate(today, field === 'start' ? start : end);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: field === 'date' ? 'date' : 'time',
        display: field === 'date' ? 'calendar' : 'clock',
        is24Hour: true,
        ...(field === 'date' ? { minimumDate: asDate(today) } : {}),
        onChange: (_event, picked) => {
          if (picked) apply(field, picked);
        },
      });
      return;
    }
    setPicker({ field, value });
  };

  const submit = () =>
    run(async () => {
      let mediaId = selected.slice('media:'.length);
      if (selected.startsWith('channel:')) {
        const channel = liveChannels.find(({ id }) => `channel:${id}` === selected);
        if (!channel) return;
        mediaId = mediaIdForUrl('tv', channel.url);
        if (!state.media.some((media) => media.id === mediaId))
          await mobileApi.createScreenMedia(server, token, {
            id: mediaId,
            title: channel.name,
            kind: 'tv',
            url: channel.url,
          });
      }
      await mobileApi.addScreenProgram(server, token, {
        ...(repeat === 'weekly'
          ? { repeat: 'weekly' as const, days }
          : { repeat: 'once' as const, date }),
        start,
        end,
        mediaId,
      });
      setChoice('');
    }, true);

  return (
    <View style={s.card}>
      <View style={s.heading}>
        <View style={s.headingIcon}>
          <Ionicons name="alarm-outline" size={19} color={c.blue} />
        </View>
        <View style={s.flex}>
          <Text style={s.title}>{t('mobileScreenPrograms.title')}</Text>
          <Text style={s.detail}>
            {t('mobileScreenPrograms.intro', { resident: snapshot.resident })}
          </Text>
        </View>
      </View>

      <Text style={s.fieldLabel}>{t('mobileScreenPrograms.what')}</Text>
      {choices.length === 0 ? (
        <Text style={s.emptyText}>{t('mobileScreenPrograms.nothingToProgram')}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {choices.map((item) => {
            const active = item.key === selected;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setChoice(item.key)}
              >
                <Ionicons name={item.icon} size={15} color={active ? '#fff' : c.accent} />
                <Text numberOfLines={1} style={[s.chipText, active && s.chipTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Text style={s.fieldLabel}>{t('mobileScreenPrograms.when')}</Text>
      <View style={s.toggle} accessibilityRole="radiogroup">
        {(
          [
            ['weekly', t('mobileScreenPrograms.everyWeek'), 'repeat-outline'],
            ['once', t('mobileScreenPrograms.once'), 'calendar-outline'],
          ] as const
        ).map(([value, label, icon]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: repeat === value }}
            style={[s.toggleButton, repeat === value && s.toggleButtonActive]}
            onPress={() => setRepeat(value)}
          >
            <Ionicons name={icon} size={15} color={repeat === value ? '#fff' : c.muted} />
            <Text style={[s.toggleText, repeat === value && s.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {repeat === 'weekly' ? (
        <View style={s.days}>
          {WEEK.map((day) => {
            const active = days.includes(day);
            return (
              <Pressable
                key={day}
                accessibilityRole="checkbox"
                accessibilityLabel={weekdayName(day, 'long')}
                accessibilityState={{ checked: active }}
                style={[s.day, active && s.dayActive]}
                onPress={() =>
                  setDays((current) =>
                    active ? current.filter((item) => item !== day) : [...current, day],
                  )
                }
              >
                <Text style={[s.dayText, active && s.chipTextActive]}>
                  {weekdayName(day, 'short').slice(0, 3)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Pressable style={s.timeButton} onPress={() => openPicker('date')}>
          <Ionicons name="calendar-outline" size={17} color={c.blue} />
          <Text style={s.timeValue}>
            {new Intl.DateTimeFormat(dateLocale(), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(asDate(date))}
          </Text>
        </Pressable>
      )}
      <View style={s.hours}>
        {(['start', 'end'] as const).map((field) => (
          <Pressable
            key={field}
            accessibilityLabel={t(`mobileScreenPrograms.${field}`)}
            style={[s.timeButton, s.flex]}
            onPress={() => openPicker(field)}
          >
            <Text style={s.timeLabel}>{t(`mobileScreenPrograms.${field}`)}</Text>
            <Text style={s.timeValue}>{field === 'start' ? start : end}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.footnote}>{t('mobileScreenPrograms.howItWorks')}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy || !valid}
        style={[s.primaryButton, (busy || !valid) && s.disabledButton]}
        onPress={() => void submit()}
      >
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={s.primaryButtonText}>{t('mobileScreenPrograms.add')}</Text>
      </Pressable>

      {programs.length === 0 ? (
        <Text style={s.emptyText}>{t('mobileScreenPrograms.empty')}</Text>
      ) : (
        <View style={s.list}>
          {programs.map((program) => {
            const media = state.media.find((item) => item.id === program.mediaId);
            const playing = state.programRun?.programId === program.id;
            const title = media?.title ?? program.title;
            return (
              <View key={program.id} style={[s.programRow, playing && s.programRowPlaying]}>
                <View style={s.programIcon}>
                  <Ionicons
                    name={
                      media?.kind === 'tv'
                        ? 'tv-outline'
                        : media?.kind === 'youtube'
                          ? 'logo-youtube'
                          : 'radio-outline'
                    }
                    size={19}
                    color={c.teal}
                  />
                </View>
                <View style={s.flex}>
                  <Text numberOfLines={1} style={s.programTitle}>
                    {title}
                    {playing ? `  · ${t('mobileScreenPrograms.playingNow')}` : ''}
                  </Text>
                  <Text style={s.programWhen}>{whenLabel(program)}</Text>
                </View>
                <Pressable
                  accessibilityLabel={t('mobileScreenPrograms.remove', { title })}
                  disabled={busy}
                  style={s.iconAction}
                  onPress={() =>
                    void run(
                      () =>
                        mobileApi
                          .removeScreenProgram(server, token, program.id)
                          .then(() => undefined),
                      true,
                    )
                  }
                >
                  <Ionicons name="trash-outline" size={17} color="#B74747" />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(picker)}
        onRequestClose={() => setPicker(null)}
      >
        <View style={s.pickerOverlay}>
          <Pressable style={s.pickerBackdrop} onPress={() => setPicker(null)} />
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Pressable onPress={() => setPicker(null)} style={s.pickerHeaderButton}>
                <Text style={s.pickerCancel}>{t('mobileScreenTabs.cancel')}</Text>
              </Pressable>
              <Text style={s.pickerTitle}>
                {picker?.field === 'date'
                  ? t('mobileScreenTabs.chooseTheDate')
                  : t('mobileScreenTabs.chooseTheTime')}
              </Text>
              <Pressable
                onPress={() => {
                  if (picker) apply(picker.field, picker.value);
                  setPicker(null);
                }}
                style={s.pickerHeaderButton}
              >
                <Text style={s.pickerConfirm}>{t('mobileScreenTabs.confirm')}</Text>
              </Pressable>
            </View>
            {picker ? (
              <MobileDateTimePicker
                value={picker.value}
                mode={picker.field === 'date' ? 'date' : 'time'}
                is24Hour
                locale={dateLocale()}
                themeVariant="light"
                minuteInterval={5}
                {...(picker.field === 'date' ? { minimumDate: asDate(today) } : {})}
                onChange={(_event, picked) => {
                  if (picked) setPicker((current) => current && { ...current, value: picked });
                }}
                style={s.picker}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    padding: 13,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    gap: 11,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paleBlue,
  },
  title: { color: c.navy, fontFamily: 'Georgia', fontSize: 20 },
  detail: { color: c.muted, fontSize: 13, lineHeight: 20 },
  fieldLabel: { marginTop: 2, color: c.navy, fontSize: 13, fontWeight: '900' },
  emptyText: { paddingVertical: 9, color: c.muted, textAlign: 'center', fontSize: 13 },
  row: { gap: 7, paddingVertical: 2 },
  chip: {
    maxWidth: 210,
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: c.blue, backgroundColor: c.blue },
  chipText: { color: c.navy, fontSize: 13, fontWeight: '800' },
  chipTextActive: { color: '#fff' },
  toggle: {
    padding: 4,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#fff',
  },
  toggleButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  toggleButtonActive: { backgroundColor: c.blue },
  toggleText: { color: c.muted, fontSize: 13, fontWeight: '800' },
  days: { flexDirection: 'row', gap: 5 },
  day: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  dayActive: { borderColor: c.teal, backgroundColor: c.teal },
  dayText: { color: c.navy, fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  hours: { flexDirection: 'row', gap: 8 },
  timeButton: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
  },
  timeLabel: { color: c.muted, fontSize: 12, fontWeight: '800' },
  timeValue: { color: c.navy, fontSize: 15, fontWeight: '900', textTransform: 'capitalize' },
  footnote: { color: c.muted, fontSize: 12, lineHeight: 18 },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.blue,
  },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  list: { gap: 8 },
  programRow: {
    minHeight: 58,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#F6F4EF',
  },
  programRowPlaying: { borderColor: '#9BC1CC', backgroundColor: '#EEF6F7' },
  programIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  programTitle: { color: c.navy, fontSize: 14, fontWeight: '900' },
  programWhen: { marginTop: 3, color: c.muted, fontSize: 12 },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F0EC',
  },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end' },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 22, 36, 0.38)' },
  pickerSheet: {
    paddingBottom: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: c.paper,
  },
  pickerHeader: {
    minHeight: 54,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerHeaderButton: { minWidth: 62, paddingVertical: 9 },
  pickerCancel: { color: c.muted, fontSize: 15 },
  pickerTitle: { color: c.navy, fontSize: 16, fontWeight: '800' },
  pickerConfirm: { color: c.blue, textAlign: 'right', fontSize: 15, fontWeight: '900' },
  picker: { height: 210 },
});
