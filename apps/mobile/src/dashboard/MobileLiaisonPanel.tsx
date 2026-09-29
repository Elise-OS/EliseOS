import { useState } from 'react';
import { Annoyed, Frown, Laugh, Meh, Smile } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Modal,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  liaisonCreateSchema,
  liaisonMoodLabel,
  type LiaisonCreate,
  type ScheduleItem,
} from '@michel/contracts';
import { mobileApi, type AlertItem } from '../api';
import type { SavedServer } from '../discovery/types';

const MOODS = [
  {
    id: 'HAPPY',
    icon: Laugh,
    fr: 'Heureux',
    color: '#22795E',
    background: '#EAF6EF',
  },
  {
    id: 'GOOD',
    icon: Smile,
    fr: 'Bien',
    color: '#477E9B',
    background: '#EAF3F8',
  },
  {
    id: 'NEUTRAL',
    icon: Meh,
    fr: 'Neutre',
    color: '#66788A',
    background: '#EFF2F5',
  },
  {
    id: 'LOW',
    icon: Annoyed,
    fr: 'Pas très bien',
    color: '#B27831',
    background: '#FBF1E4',
  },
  {
    id: 'SAD',
    icon: Frown,
    fr: 'Triste',
    color: '#5875A4',
    background: '#EDF1FA',
  },
] as const;

export function MobileLiaisonPanel({
  server,
  token,
  offline,
  schedule,
  alerts,
  residentName,
  onJournal,
  onCalendar,
}: {
  server: SavedServer;
  token: string;
  offline: boolean;
  schedule: ScheduleItem[];
  alerts: AlertItem[];
  residentName: string;
  onJournal: () => void;
  onCalendar: () => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width <= 520;
  const veryCompact = width <= 350;
  const client = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['michel', server.id, 'liaison', 'ALL'],
    queryFn: ({ pageParam }) => mobileApi.liaison(server, token, 'ALL', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30000,
  });
  const data = query.data?.pages[0];
  const moodResidentName = (data?.residentName ?? residentName).trim().split(/\s+/)[0] ?? '';
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () => client.invalidateQueries({ queryKey: ['michel', server.id, 'liaison'] });
  const create = useMutation({
    mutationFn: (input: LiaisonCreate) => mobileApi.createLiaison(server, token, input),
    onSuccess: async () => {
      setBody('');
      setNoteOpen(false);
      setError('');
      setNotice('Votre contribution a été partagée.');
      await refresh();
    },
    onError: () =>
      setError(
        'Non enregistré. Vérifiez la connexion et vos droits, puis réessayez. Votre texte est conservé.',
      ),
    retry: false,
  });
  const createMood = useMutation({
    mutationFn: (input: LiaisonCreate) => mobileApi.createLiaison(server, token, input),
    onSuccess: async () => {
      setMoodOpen(false);
      setError('');
      setNotice('Humeur ajoutée au carnet.');
      await refresh();
    },
    onError: () => {
      setMoodOpen(false);
      setError('Humeur non enregistrée. Vérifiez la connexion et vos droits, puis réessayez.');
    },
    retry: false,
  });
  const complete = useMutation({
    mutationFn: (input: { id: string; completed: boolean }) =>
      mobileApi.completeLiaison(server, token, input.id, input.completed),
    onSuccess: async () => {
      setError('');
      setNotice('Le cahier a été mis à jour.');
      await refresh();
    },
    onError: () =>
      setError(
        'Modification non enregistrée. Vérifiez la connexion et vos droits, puis réessayez.',
      ),
    retry: false,
  });
  const busy = create.isPending || createMood.isPending || complete.isPending;
  const blocked = busy || offline;
  const submit = () => {
    const parsed = liaisonCreateSchema.safeParse({ kind: 'NOTE', body });
    if (!parsed.success) {
      setError('Ajoutez un texte.');
      return;
    }
    setNotice('');
    create.mutate(parsed.data);
  };
  const addMood = (mood: (typeof MOODS)[number]) => {
    const parsed = liaisonCreateSchema.safeParse({
      kind: 'NOTE',
      body: `mood:${mood.id}`,
      tags: ['MOOD'],
    });
    if (!parsed.success) return;
    setError('');
    createMood.mutate(parsed.data);
  };
  const date = (value: string) =>
    new Date(value).toLocaleString('fr-FR', {
      timeZone: data?.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const upcoming = schedule.find((item) => new Date(item.startsAt) >= new Date());
  const attention = alerts.find(
    (item) =>
      ['OPEN', 'ACKNOWLEDGED'].includes(item.status) &&
      ['ATTENTION', 'URGENT'].includes(item.severity),
  );
  const openTasks =
    data?.openTasks ?? items.filter((item) => item.kind === 'TASK' && !item.completedAt);
  const reminderCount = Number(Boolean(upcoming)) + Number(Boolean(attention)) + openTasks.length;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void refresh()} />
      }
    >
      <View style={s.hero}>
        <View style={s.heroHeadingRow}>
          <View style={s.heroHeadingCopy}>
            <Text style={s.heroEyebrow}>PARTAGE ENTRE AIDANTS</Text>
            <Text accessibilityRole="header" style={s.title}>
              Carnet de liaison
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ouvrir le calendrier"
            onPress={onCalendar}
            style={s.calendarButton}
          >
            <Ionicons name="calendar-outline" size={20} color="#214b85" />
          </Pressable>
        </View>
        <Text style={s.heroResident}>{residentName}</Text>
        <Text style={s.heroCopy}>Les dernières informations partagées entre aidants.</Text>
        <View style={s.heroFooter}>
          {data?.canWrite && (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMoodOpen(true)}
                style={s.secondaryAction}
              >
                <Ionicons name="happy-outline" size={19} color="#214b85" />
                <Text style={s.secondaryActionText}>Ajouter une humeur</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setNoteOpen(true)}
                style={s.primaryAction}
              >
                <Ionicons name="create-outline" size={19} color="#fff" />
                <Text style={s.primaryActionText}>Ajouter une note</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {offline && (
        <Text accessibilityRole="alert" style={s.warning}>
          Hors connexion. Les informations affichées peuvent être anciennes. Reconnectez-vous pour
          contribuer.
        </Text>
      )}
      {(error || query.isError) && (
        <View style={s.warning}>
          <Text accessibilityRole="alert">
            {error || 'Le cahier est inaccessible. Tirez vers le bas pour réessayer.'}
          </Text>
          <Action label="Réessayer" onPress={() => void query.refetch()} />
        </View>
      )}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={s.muted}>
          {notice}
        </Text>
      ) : null}
      {query.isPending && <Text>Chargement du cahier…</Text>}
      {data && !data.canWrite && (
        <Text style={s.muted}>
          Vous pouvez consulter le cahier. Les aidants peuvent y contribuer.
        </Text>
      )}
      {data && (
        <View style={[s.reminderSection, compact && s.reminderSectionCompact]}>
          <View style={[s.sectionHeading, compact && s.sectionHeadingCompact]}>
            <View style={[s.headingTitle, compact && s.headingTitleCompact]}>
              <View style={s.amberDot} />
              <Text
                accessibilityRole="header"
                style={[s.sectionTitle, compact && s.sectionTitleCompact]}
              >
                À retenir
              </Text>
            </View>
            <Text style={[s.muted, compact && s.compactText]}>{reminderCount} éléments</Text>
          </View>
          {upcoming && (
            <ReminderCard
              icon="calendar-outline"
              tone="blue"
              title="Prochain rendez-vous"
              body={upcoming.title}
              detail={date(upcoming.startsAt)}
            />
          )}
          {attention && (
            <ReminderCard
              icon="warning-outline"
              tone="amber"
              title="Point d’attention"
              body={attention.title}
              detail={attention.explanation}
            />
          )}
          {openTasks.slice(0, 2).map((task) => (
            <ReminderCard
              key={task.id}
              icon="checkbox-outline"
              tone="green"
              title={task.assignee?.displayName ?? 'À répartir'}
              body={task.body}
              detail={task.dueOn ? `Pour le ${task.dueOn}` : 'Sans échéance'}
            />
          ))}
          {!reminderCount && (
            <View style={[s.reminderCard, compact && s.reminderCardCompact, s.reminderGreen]}>
              <View style={[s.reminderIcon, compact && s.reminderIconCompact, s.reminderIconGreen]}>
                <Ionicons name="checkmark" size={23} color="#24694C" />
              </View>
              <View style={[s.reminderCopy, compact && s.reminderCopyCompact]}>
                <Text style={s.reminderTitle}>Rien à signaler</Text>
                <Text style={[s.muted, compact && s.compactText]}>
                  Aucune tâche ou visite prochaine.
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
      <Modal
        transparent
        animationType="fade"
        visible={noteOpen}
        onRequestClose={() => setNoteOpen(false)}
      >
        <KeyboardAvoidingView
          style={[s.modalOverlay, compact && s.modalOverlayCompact]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            onPress={() => setNoteOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={[s.noteDialog, compact && s.noteDialogCompact]}>
            <View style={s.moodDialogHeading}>
              <View style={s.moodDialogCopy}>
                <Text style={s.moodEyebrow}>CARNET DE LIAISON</Text>
                <Text accessibilityRole="header" style={s.moodDialogTitle}>
                  Ajouter une note
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                onPress={() => setNoteOpen(false)}
                style={s.moodClose}
              >
                <Ionicons name="close" size={22} color="#385577" />
              </Pressable>
            </View>
            <Text style={s.label}>Votre message</Text>
            <TextInput
              accessibilityLabel="Votre message"
              autoFocus
              multiline
              maxLength={3000}
              value={body}
              editable={!busy}
              onChangeText={setBody}
              placeholder="Je suis passé ce matin, le frigo est rempli…"
              style={[s.input, s.textarea]}
              textAlignVertical="top"
            />
            {error ? (
              <Text accessibilityRole="alert" style={s.modalError}>
                {error}
              </Text>
            ) : null}
            <Action
              label={busy ? 'Enregistrement…' : 'Partager'}
              disabled={blocked || !body.trim()}
              onPress={submit}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={moodOpen}
        onRequestClose={() => setMoodOpen(false)}
      >
        <View style={[s.modalOverlay, compact && s.modalOverlayCompact]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            onPress={() => setMoodOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={[s.moodDialog, compact && s.moodDialogCompact]}>
            <View style={s.moodDialogHeading}>
              <View style={s.moodDialogCopy}>
                <Text style={s.moodEyebrow}>CARNET DE LIAISON</Text>
                <Text
                  accessibilityRole="header"
                  style={[s.moodDialogTitle, compact && s.moodDialogTitleCompact]}
                >
                  Ajouter une humeur
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                onPress={() => setMoodOpen(false)}
                style={s.moodClose}
              >
                <Ionicons name="close" size={22} color="#385577" />
              </Pressable>
            </View>
            <Text style={s.moodDialogPrompt}>
              Comment se sent {moodResidentName || 'le résident'} ?
            </Text>
            {offline && (
              <Text accessibilityRole="alert" style={s.offlineMoodHint}>
                Reconnectez-vous pour enregistrer une humeur.
              </Text>
            )}
            <View style={[s.moodOptions, compact && s.moodOptionsCompact]}>
              {MOODS.map((mood) => {
                const MoodIcon = mood.icon;
                return (
                  <Pressable
                    key={mood.id}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: blocked }}
                    disabled={blocked}
                    onPress={() => addMood(mood)}
                    style={[
                      s.moodOption,
                      compact && s.moodOptionCompact,
                      createMood.isPending && s.disabled,
                    ]}
                  >
                    <View style={[s.moodPictogram, { backgroundColor: mood.background }]}>
                      <MoodIcon size={23} color={mood.color} strokeWidth={1.8} />
                    </View>
                    <Text style={s.moodLabel}>{mood.fr}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
      <View style={[s.sectionHeading, compact && s.sectionHeadingCompact]}>
        <View style={[s.headingTitle, compact && s.headingTitleCompact]}>
          <View style={s.greenDot} />
          <Text
            accessibilityRole="header"
            style={[s.sectionTitle, compact && s.sectionTitleCompact]}
          >
            Aujourd’hui
          </Text>
        </View>
        <Text style={[s.muted, compact && s.compactText]}>{items.length} notes</Text>
      </View>
      {data && (
        <>
          {items.map((item) => (
            <View key={item.id} style={[s.card, compact && s.cardCompact]}>
              <View style={s.noteHeader}>
                <View style={s.noteAvatar}>
                  <Text style={s.noteAvatarText}>
                    {(item.author?.displayName ?? 'Ancien proche')
                      .split(/\s+/)
                      .map((part) => part[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={s.noteHeadingCopy}>
                  <Text style={s.label}>{item.author?.displayName ?? 'Un ancien proche'}</Text>
                  <Text style={s.muted}>{date(item.createdAt)}</Text>
                </View>
              </View>
              <Text style={s.body}>
                {item.tags.includes('MOOD') && liaisonMoodLabel(item.body)
                  ? `${moodResidentName ? `Humeur de ${moodResidentName}` : 'Humeur du résident'} : ${liaisonMoodLabel(item.body)}`
                  : item.body}
              </Text>
              <View style={s.row}>
                {item.tags.map((tag) => (
                  <Text key={tag} style={s.noteTag}>
                    {tag === 'MEAL'
                      ? 'Repas'
                      : tag === 'TREATMENT'
                        ? 'Traitement'
                        : tag === 'MOOD'
                          ? 'Humeur'
                          : 'Repos'}
                  </Text>
                ))}
                {item.kind === 'TASK' && (
                  <Text style={s.noteTag}>{item.completedAt ? 'Terminée' : 'À faire'}</Text>
                )}
              </View>
              {item.kind === 'TASK' && (
                <>
                  <Text style={s.label}>
                    Responsable : {item.assignee?.displayName ?? 'À répartir'}
                  </Text>
                  {item.dueOn && (
                    <Text
                      style={!item.completedAt && item.dueOn < data.today ? s.overdue : s.muted}
                    >
                      Pour le{' '}
                      {new Date(`${item.dueOn}T12:00:00Z`).toLocaleDateString('fr-FR', {
                        timeZone: 'UTC',
                      })}
                      {!item.completedAt && item.dueOn < data.today ? ' · En retard' : ''}
                    </Text>
                  )}
                  {item.completedAt && (
                    <Text style={s.muted}>
                      Fait par {item.completedBy?.displayName ?? '—'} · {date(item.completedAt)}
                    </Text>
                  )}
                  {data.canWrite && (
                    <Action
                      label={item.completedAt ? 'Remettre à faire' : 'C’est fait'}
                      disabled={blocked}
                      onPress={() => complete.mutate({ id: item.id, completed: !item.completedAt })}
                    />
                  )}
                </>
              )}
            </View>
          ))}
          {!items.length && (
            <View style={[s.card, compact && s.cardCompact]}>
              <Text style={s.subtitle}>Les nouvelles commencent ici</Text>
              <Text style={s.muted}>
                Un passage, une attention, une chose à prévoir : partagez ce qui aide les proches.
              </Text>
            </View>
          )}
          {query.hasNextPage && (
            <Action
              label="Voir les précédentes"
              disabled={query.isFetching}
              onPress={() => void query.fetchNextPage()}
            />
          )}
        </>
      )}
      <Action label="Ouvrir le journal et l’agenda du foyer" onPress={onJournal} />
    </ScrollView>
  );
}

function ReminderCard({
  icon,
  tone,
  title,
  body,
  detail,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: 'blue' | 'green' | 'amber';
  title: string;
  body: string;
  detail: string;
}) {
  const compact = useWindowDimensions().width <= 520;
  const iconColor = tone === 'green' ? '#24694C' : tone === 'amber' ? '#B95B18' : '#1F5DA1';
  return (
    <View
      style={[
        s.reminderCard,
        compact && s.reminderCardCompact,
        tone === 'green' ? s.reminderGreen : tone === 'amber' ? s.reminderAmber : s.reminderBlue,
      ]}
    >
      <View
        style={[
          s.reminderIcon,
          compact && s.reminderIconCompact,
          tone === 'green'
            ? s.reminderIconGreen
            : tone === 'amber'
              ? s.reminderIconAmber
              : s.reminderIconBlue,
        ]}
      >
        <Ionicons name={icon} size={compact ? 22 : 25} color={iconColor} />
      </View>
      <View style={[s.reminderCopy, compact && s.reminderCopyCompact]}>
        <Text style={[s.reminderTitle, compact && s.reminderTitleCompact]}>{title}</Text>
        <Text style={[s.reminderBody, compact && s.reminderBodyCompact]}>{body}</Text>
        <Text style={[s.muted, compact && s.compactText]}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={compact ? 18 : 20} color="#315A82" />
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.action, disabled && s.disabled]}
    >
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 12 },
  hero: { gap: 5 },
  heroHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroHeadingCopy: { minWidth: 0, flex: 1 },
  heroEyebrow: { color: '#376884', fontSize: 9, letterSpacing: 1.25, fontWeight: '900' },
  title: {
    marginTop: 4,
    color: '#0B2948',
    fontFamily: 'Georgia',
    fontSize: 20,
    flexShrink: 1,
  },
  heroResident: { fontSize: 13, fontWeight: '700', color: '#687382', marginTop: 2, flexShrink: 1 },
  heroCopy: { fontSize: 13, lineHeight: 19, color: '#687382', flexShrink: 1 },
  calendarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D8E5EA',
    borderRadius: 14,
    backgroundColor: '#FDFBF7',
  },
  heroFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: 8,
  },
  primaryAction: {
    minWidth: 0,
    maxWidth: 190,
    minHeight: 47,
    flex: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#173968',
  },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  secondaryAction: {
    minWidth: 0,
    maxWidth: 190,
    minHeight: 47,
    flex: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbdbea',
    backgroundColor: '#fff',
  },
  secondaryActionText: { color: '#214b85', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  subtitle: { fontSize: 20, fontWeight: '600', color: '#0B2948', flexShrink: 1 },
  muted: { color: '#687382', fontSize: 13, lineHeight: 21, flexShrink: 1 },
  compactText: { fontSize: 12, lineHeight: 18 },
  reminderSection: {
    padding: 17,
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE3D7',
    backgroundColor: '#FFFCF7',
  },
  reminderSectionCompact: { padding: 14, gap: 10 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionHeadingCompact: { flexWrap: 'wrap', gap: 8 },
  headingTitle: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  headingTitleCompact: { flex: 1 },
  sectionTitle: { color: '#17345F', fontSize: 23, fontWeight: '700', flexShrink: 1 },
  sectionTitleCompact: { fontSize: 20 },
  amberDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#F6A22B' },
  greenDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#3BA46C' },
  reminderCard: {
    minHeight: 96,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 15,
    borderWidth: 1,
  },
  reminderCardCompact: { minHeight: 84, padding: 12, gap: 8 },
  reminderBlue: { borderColor: '#CFE1EF', backgroundColor: '#EDF6FF' },
  reminderGreen: { borderColor: '#CCE4D4', backgroundColor: '#EEF9F2' },
  reminderAmber: { borderColor: '#F2CF9E', backgroundColor: '#FFF6E9' },
  reminderIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    flexShrink: 0,
  },
  reminderIconCompact: { width: 38, height: 38, borderRadius: 19 },
  reminderIconBlue: { backgroundColor: '#DCEBFC' },
  reminderIconGreen: { backgroundColor: '#DCEFE2' },
  reminderIconAmber: { backgroundColor: '#FFE5C1' },
  reminderCopy: { minWidth: 0, flex: 1, gap: 2 },
  reminderCopyCompact: { gap: 1 },
  reminderTitle: { color: '#17375F', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  reminderTitleCompact: { fontSize: 13 },
  reminderBody: { color: '#23456F', fontSize: 16, lineHeight: 21, flexShrink: 1 },
  reminderBodyCompact: { fontSize: 15, lineHeight: 20 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#D9E5EB',
  },
  cardCompact: { padding: 14, gap: 12 },
  noteDialog: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#D8E5EA',
  },
  noteDialogCompact: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  body: { color: '#0B2948', fontSize: 17, lineHeight: 27, flexShrink: 1 },
  label: { color: '#12385F', fontWeight: '600', fontSize: 14, flexShrink: 1 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteAvatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#E8F2FD',
  },
  noteAvatarText: { color: '#173B6E', fontSize: 14, fontWeight: '700' },
  noteHeadingCopy: { minWidth: 0, flex: 1, gap: 2 },
  noteTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
    borderRadius: 99,
    color: '#315A82',
    backgroundColor: '#E8F2FD',
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#FAFCFD',
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
    fontSize: 16,
    color: '#0B2948',
    borderColor: '#DED8CE',
    borderWidth: 1,
  },
  textarea: { minHeight: 130 },
  modalError: { color: '#9A5550', fontSize: 13, lineHeight: 18 },
  modalOverlay: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 28, 45, 0.48)',
  },
  modalOverlayCompact: { padding: 12 },
  moodDialog: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#fff',
    gap: 16,
  },
  moodDialogCompact: { padding: 16, gap: 14 },
  moodDialogHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  moodDialogCopy: { flex: 1, gap: 5 },
  moodEyebrow: { color: '#66809A', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  moodDialogTitle: { color: '#17345F', fontSize: 23, fontWeight: '700', flexShrink: 1 },
  moodDialogTitleCompact: { fontSize: 20 },
  moodClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E0E7ED',
    borderRadius: 12,
  },
  moodDialogPrompt: { color: '#52688D', fontSize: 15 },
  offlineMoodHint: {
    padding: 10,
    borderRadius: 10,
    color: '#80521E',
    backgroundColor: '#FFF6E9',
    fontSize: 13,
    lineHeight: 18,
  },
  moodOptions: { flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'center', gap: 4 },
  moodOptionsCompact: { gap: 2 },
  moodOption: {
    minWidth: 0,
    minHeight: 92,
    flex: 1,
    paddingHorizontal: 2,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E0E9EE',
    borderRadius: 14,
    backgroundColor: '#F8FBFC',
  },
  moodOptionCompact: { minHeight: 84, paddingHorizontal: 0, paddingVertical: 5, gap: 4 },
  moodPictogram: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodLabel: { color: '#31527D', fontSize: 11, textAlign: 'center', flexShrink: 1 },
  action: {
    backgroundColor: '#E8F0F3',
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: '#12385F', fontWeight: '600', fontSize: 14, flexShrink: 1 },
  disabled: { opacity: 0.5 },
  warning: { backgroundColor: '#F7E9D7', padding: 14, borderRadius: 12, color: '#714414' },
  overdue: { color: '#925817', fontSize: 14 },
});
