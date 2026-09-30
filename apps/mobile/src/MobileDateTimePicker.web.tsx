import { createElement, type ChangeEvent } from 'react';
import type { MobileDateTimePickerProps } from './MobileDateTimePicker';

const pad = (value: number) => String(value).padStart(2, '0');

function dateInputValue(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function timeInputValue(value: Date) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function MobileDateTimePicker({
  value,
  mode,
  onChange,
  minuteInterval = 1,
  minimumDate,
}: MobileDateTimePickerProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.currentTarget.value;
    const selected = new Date(value);

    if (mode === 'date') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inputValue);
      if (!match) return;
      const [, year, month, day] = match;
      selected.setFullYear(Number(year), Number(month) - 1, Number(day));
    } else {
      const match = /^(\d{2}):(\d{2})$/.exec(inputValue);
      if (!match) return;
      const [, hours, minutes] = match;
      selected.setHours(Number(hours), Number(minutes), 0, 0);
    }

    onChange(event, selected);
  };

  return createElement('input', {
    type: mode,
    value: mode === 'date' ? dateInputValue(value) : timeInputValue(value),
    min: mode === 'date' && minimumDate ? dateInputValue(minimumDate) : undefined,
    step: mode === 'time' ? minuteInterval * 60 : undefined,
    'aria-label': mode === 'date' ? 'Choisir la date' : 'Choisir l’heure',
    onChange: handleChange,
    style: {
      boxSizing: 'border-box',
      width: '100%',
      height: 48,
      padding: '0 12px',
      border: '1px solid #cbdbea',
      borderRadius: 12,
      color: '#17325d',
      backgroundColor: '#fff',
      fontFamily: 'inherit',
      fontSize: 16,
    },
  });
}
