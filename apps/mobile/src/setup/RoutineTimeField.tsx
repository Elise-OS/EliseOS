import { Ionicons } from '@expo/vector-icons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileDateTimePicker } from '../MobileDateTimePicker';
import { clockToDate, dateToClock, shiftClock } from './clock';
import type { Locale } from './MobileSetup';
import { colors } from '../theme';
import { dateLocale, t } from '../i18n';

const STEP_MINUTES = 15;

/**
 * A time of day chosen with the native picker or quarter-hour steps: the value can only
 * ever be a valid "HH:MM", which the installation contract requires.
 */
export function RoutineTimeField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  locale: Locale;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<Date | null>(null);

  const open = () => {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: clockToDate(value),
        mode: 'time',
        display: 'clock',
        is24Hour: true,
        onChange: (_event, selected) => {
          if (selected) onChange(dateToClock(selected));
        },
      });
      return;
    }
    setDraft(clockToDate(value));
  };

  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.controls}>
        <Pressable
          style={styles.step}
          disabled={disabled}
          onPress={() => onChange(shiftClock(value, -STEP_MINUTES))}
          accessibilityRole="button"
          accessibilityLabel={t('routineTimeField.n15MinutesEarlier', { label })}
          hitSlop={6}
        >
          <Ionicons name="remove" size={18} color={colors.navy} />
        </Pressable>
        <Pressable
          style={styles.time}
          disabled={disabled}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('routineTimeField.change', { label, value })}
        >
          <Ionicons name="time-outline" size={16} color={colors.green} />
          <Text style={styles.timeText}>{value}</Text>
        </Pressable>
        <Pressable
          style={styles.step}
          disabled={disabled}
          onPress={() => onChange(shiftClock(value, STEP_MINUTES))}
          accessibilityRole="button"
          accessibilityLabel={t('routineTimeField.n15MinutesLater', { label })}
          hitSlop={6}
        >
          <Ionicons name="add" size={18} color={colors.navy} />
        </Pressable>
      </View>

      <Modal
        visible={Boolean(draft)}
        transparent
        animationType="slide"
        onRequestClose={() => setDraft(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Pressable onPress={() => setDraft(null)} hitSlop={8}>
                <Text style={styles.sheetCancel}>{t('routineTimeField.cancel')}</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable
                onPress={() => {
                  if (draft) onChange(dateToClock(draft));
                  setDraft(null);
                }}
                hitSlop={8}
              >
                <Text style={styles.sheetConfirm}>{t('routineTimeField.done')}</Text>
              </Pressable>
            </View>
            {draft && (
              <MobileDateTimePicker
                value={draft}
                mode="time"
                is24Hour
                locale={dateLocale()}
                themeVariant="light"
                minuteInterval={5}
                onChange={(_event, selected) => {
                  if (selected) setDraft(selected);
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  disabled: { opacity: 0.45 },
  label: { flex: 1, color: colors.muted, fontSize: 15, fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: {
    width: 38,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: {
    minWidth: 96,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: '#FBFCFA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  timeText: {
    color: colors.navy,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 41, 72, 0.35)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  sheetTitle: { color: colors.navy, fontSize: 17, fontWeight: '700' },
  sheetCancel: { color: colors.muted, fontSize: 17 },
  sheetConfirm: { color: colors.green, fontSize: 17, fontWeight: '700' },
});
