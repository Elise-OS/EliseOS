export function isDosePastConfirmationWindow(
  scheduledFor: Date,
  graceMinutes: number,
  now: Date,
): boolean {
  return now.getTime() >= scheduledFor.getTime() + graceMinutes * 60_000;
}

export function missedDoseCopy(name: string, dosage: string, localTime: string) {
  return {
    title: `Prise de ${localTime} non confirmée`,
    explanation: `La prise de ${name} (${dosage}) prévue à ${localTime} n’a pas encore été confirmée. Un oubli est possible ; une vérification peut être utile.`,
  };
}
