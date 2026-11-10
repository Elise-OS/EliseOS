import DateTimePicker from '@react-native-community/datetimepicker';
import type { StyleProp, ViewStyle } from 'react-native';

export type MobileDateTimePickerProps = {
  value: Date;
  mode: 'date' | 'time';
  onChange: (event: unknown, selected?: Date) => void;
  is24Hour?: boolean;
  locale?: string;
  themeVariant?: 'light' | 'dark';
  minuteInterval?: 1 | 2 | 3 | 4 | 5 | 6 | 10 | 12 | 15 | 20 | 30;
  minimumDate?: Date;
  style?: StyleProp<ViewStyle>;
};

export function MobileDateTimePicker({
  value,
  mode,
  onChange,
  is24Hour,
  locale,
  themeVariant,
  minuteInterval,
  minimumDate,
  style,
}: MobileDateTimePickerProps) {
  return (
    <DateTimePicker
      value={value}
      mode={mode}
      display="spinner"
      is24Hour={is24Hour}
      locale={locale}
      themeVariant={themeVariant}
      minuteInterval={minuteInterval}
      minimumDate={minimumDate}
      onChange={(event, selected) => onChange(event, selected)}
      style={style}
    />
  );
}
