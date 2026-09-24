import { useState } from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Modal,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  liaisonCreateSchema,
  liaisonMoodLabel,
  type LiaisonCreate,
  type LiaisonFilter,
  type ScheduleItem,
} from '@michel/contracts';
import { mobileApi, type AlertItem } from '../api';
import type { SavedServer } from '../discovery/types';

const MOODS = [
  {
    id: 'HAPPY',
    icon: 'emoticon-excited-outline',
    fr: 'Heureux',
    color: '#22795E',
    background: '#EAF6EF',
  },
  {
    id: 'GOOD',
    icon: 'emoticon-happy-outline',
    fr: 'Bien',
    color: '#477E9B',
    background: '#EAF3F8',
  },
  {
    id: 'NEUTRAL',
    icon: 'emoticon-neutral-outline',
    fr: 'Neutre',
    color: '#66788A',
    background: '#EFF2F5',
  },
  {
    id: 'LOW',
    icon: 'emoticon-frown-outline',
    fr: 'Pas très bien',
    color: '#B27831',
    background: '#FBF1E4',
  },
  {
    id: 'SAD',
    icon: 'emoticon-cry-outline',
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
  const client = useQueryClient();
  const [filter, setFilter] = useState<LiaisonFilter>('ALL');
  const [visits, setVisits] = useState(false);
  const [composing, setComposing] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['michel', server.id, 'liaison', filter],
    queryFn: ({ pageParam }) => mobileApi.liaison(server, token, filter, pageParam),
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
      setComposing(false);
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
    mutationFn: (input: { id: string; completed: boolean; visit?: boolean }) =>
      mobileApi.completeLiaison(server, token, input.id, input.completed, input.visit),
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
    setVisits(false);
    setFilter('ALL');
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
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: data?.timezone,
  }).format(new Date());
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.page}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void refresh()} />
      }
    >
      <View style={s.hero}>
        <Text accessibilityRole="header" style={s.title}>
          Carnet de liaison
        </Text>
        <Text style={s.heroResident}>{residentName}</Text>
        <Text style={s.heroCopy}>Les dernières informations partagées entre aidants.</Text>
        <View style={s.heroFooter}>
          <Text style={s.heroDate}>{today}</Text>
          <Pressable accessibilityRole="button" onPress={onCalendar} style={s.secondaryAction}>
            <Ionicons name="calendar-outline" size={18} color="#214b85" />
            <Text style={s.secondaryActionText}>Calendrier</Text>
          </Pressable>
          {data?.canWrite && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setComposing(!composing)}
              style={s.primaryAction}
            >
              <Ionicons name="create-outline" size={19} color="#fff" />
              <Text style={s.primaryActionText}>{composing ? 'Fermer' : 'Ajouter une note'}</Text>
            </Pressable>
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
        <View style={s.reminderSection}>
          <View style={s.sectionHeading}>
            <View style={s.headingTitle}>
              <View style={s.amberDot} />
              <Text accessibilityRole="header" style={s.sectionTitle}>
                À retenir
              </Text>
            </View>
            <Text style={s.muted}>{reminderCount} éléments</Text>
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
            <View style={[s.reminderCard, s.reminderGreen]}>
              <View style={[s.reminderIcon, s.reminderIconGreen]}>
                <Ionicons name="checkmark" size={23} color="#24694C" />
              </View>
              <View style={s.reminderCopy}>
                <Text style={s.reminderTitle}>Rien à signaler</Text>
                <Text style={s.muted}>Aucune tâche ou visite prochaine.</Text>
              </View>
            </View>
          )}
        </View>
      )}
      {composing && data?.canWrite && (
        <View style={s.composerCard}>
          <Text accessibilityRole="header" style={s.subtitle}>
            Une nouvelle à partager ?
          </Text>
          <Text style={s.label}>Votre message</Text>
          <TextInput
            accessibilityLabel="Votre message"
            multiline
            maxLength={3000}
            value={body}
            editable={!busy}
            onChangeText={setBody}
            placeholder="Je suis passé ce matin, le frigo est rempli…"
            style={[s.input, s.textarea]}
            textAlignVertical="top"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={() => setMoodOpen(true)}
            style={[s.moodTrigger, blocked && s.disabled]}
          >
            <Ionicons name="happy-outline" size={19} color="#315A82" />
            <Text style={s.moodTriggerText}>Ajouter une humeur</Text>
          </Pressable>
          <Action
            label={busy ? 'Enregistrement…' : 'Partager'}
            disabled={blocked || !body.trim()}
            onPress={submit}
          />
        </View>
      )}
      <Modal
        transparent
        animationType="fade"
        visible={moodOpen}
        onRequestClose={() => setMoodOpen(false)}
      >
        <View style={s.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            onPress={() => setMoodOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={s.moodDialog}>
            <View style={s.moodDialogHeading}>
              <View style={s.moodDialogCopy}>
                <Text style={s.moodEyebrow}>CARNET DE LIAISON</Text>
                <Text accessibilityRole="header" style={s.moodDialogTitle}>
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
            <Text style={s.moodDialogPrompt}>Comment se sent Michel ?</Text>
            <View style={s.moodOptions}>
              {MOODS.map((mood) => (
                <Pressable
                  key={mood.id}
                  accessibilityRole="button"
                  disabled={createMood.isPending}
                  onPress={() => addMood(mood)}
                  style={[s.moodOption, createMood.isPending && s.disabled]}
                >
                  <View style={[s.moodPictogram, { backgroundColor: mood.background }]}>
                    <MaterialCommunityIcons name={mood.icon} size={26} color={mood.color} />
                  </View>
                  <Text style={s.moodLabel}>{mood.fr}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <View style={s.sectionHeading}>
        <View style={s.headingTitle}>
          <View style={s.greenDot} />
          <Text accessibilityRole="header" style={s.sectionTitle}>
            {visits
              ? 'Visites'
              : filter === 'OPEN'
                ? 'À faire'
                : filter === 'DONE'
                  ? 'Terminées'
                  : 'Aujourd’hui'}
          </Text>
        </View>
        <Text style={s.muted}>{visits ? (data?.visits.length ?? 0) : items.length} notes</Text>
      </View>
      <View style={s.row}>
        {(['ALL', 'OPEN', 'DONE'] as const).map((value, index) => (
          <Choice
            key={value}
            label={['Le fil', 'À faire', 'Terminées'][index]}
            selected={!visits && filter === value}
            onPress={() => {
              setVisits(false);
              setFilter(value);
            }}
          />
        ))}
        <Choice label="Visites" selected={visits} onPress={() => setVisits(true)} />
      </View>
      {data && !visits && (
        <>
          {items.map((item) => (
            <View key={item.id} style={s.card}>
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
            <View style={s.card}>
              <Text style={s.subtitle}>
                {filter === 'ALL' ? 'Les nouvelles commencent ici' : 'Aucune tâche dans cette vue'}
              </Text>
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
      {data && visits && (
        <>
          <Text style={s.muted}>
            Visites des 30 derniers jours et des 90 prochains jours. Horaires du domicile.
          </Text>
          {data.visits.map((visit) => (
            <View key={visit.id} style={s.card}>
              <Text style={s.subtitle}>{visit.visitorName}</Text>
              <Text style={s.tag}>{visit.completedAt ? 'Réalisée' : 'Prévue'}</Text>
              <Text>{date(visit.startsAt)}</Text>
              {visit.notes && <Text style={s.body}>{visit.notes}</Text>}
              {visit.completedAt && (
                <Text style={s.muted}>
                  Confirmée par {visit.completedBy?.displayName ?? '—'} · {date(visit.completedAt)}
                </Text>
              )}
              {data.canWrite && (visit.completedAt || new Date(visit.startsAt) <= new Date()) && (
                <Action
                  label={visit.completedAt ? 'Annuler la confirmation' : 'La visite a eu lieu'}
                  disabled={blocked}
                  onPress={() =>
                    complete.mutate({ id: visit.id, completed: !visit.completedAt, visit: true })
                  }
                />
              )}
            </View>
          ))}
          {!data.visits.length && <Text style={s.muted}>Aucune visite sur cette période.</Text>}
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
  const iconColor = tone === 'green' ? '#24694C' : tone === 'amber' ? '#B95B18' : '#1F5DA1';
  return (
    <View
      style={[
        s.reminderCard,
        tone === 'green' ? s.reminderGreen : tone === 'amber' ? s.reminderAmber : s.reminderBlue,
      ]}
    >
      <View
        style={[
          s.reminderIcon,
          tone === 'green'
            ? s.reminderIconGreen
            : tone === 'amber'
              ? s.reminderIconAmber
              : s.reminderIconBlue,
        ]}
      >
        <Ionicons name={icon} size={25} color={iconColor} />
      </View>
      <View style={s.reminderCopy}>
        <Text style={s.reminderTitle}>{title}</Text>
        <Text style={s.reminderBody}>{body}</Text>
        <Text style={s.muted}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#315A82" />
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
function Choice({
  label,
  onPress,
  selected,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, selected && s.selected]}
    >
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, gap: 18, backgroundColor: '#F7F5F0' },
  hero: {
    padding: 22,
    gap: 5,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#DCE9EF',
    backgroundColor: '#F1F9FD',
  },
  title: { fontSize: 34, fontWeight: '700', color: '#153665', letterSpacing: -1 },
  heroResident: { fontSize: 21, fontWeight: '600', color: '#52688D', marginTop: 4 },
  heroCopy: { fontSize: 15, lineHeight: 21, color: '#52688D' },
  heroFooter: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroDate: { flex: 1, color: '#52688D', fontSize: 13, textTransform: 'capitalize' },
  primaryAction: {
    minHeight: 47,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#173968',
  },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  secondaryAction: {
    minHeight: 47,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbdbea',
    backgroundColor: '#fff',
  },
  secondaryActionText: { color: '#214b85', fontSize: 13, fontWeight: '700' },
  subtitle: { fontSize: 20, fontWeight: '600', color: '#0B2948' },
  muted: { color: '#687382', fontSize: 13, lineHeight: 21 },
  reminderSection: {
    padding: 17,
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE3D7',
    backgroundColor: '#FFFCF7',
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headingTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { color: '#17345F', fontSize: 23, fontWeight: '700' },
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
  reminderBlue: { borderColor: '#CFE1EF', backgroundColor: '#EDF6FF' },
  reminderGreen: { borderColor: '#CCE4D4', backgroundColor: '#EEF9F2' },
  reminderAmber: { borderColor: '#F2CF9E', backgroundColor: '#FFF6E9' },
  reminderIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  reminderIconBlue: { backgroundColor: '#DCEBFC' },
  reminderIconGreen: { backgroundColor: '#DCEFE2' },
  reminderIconAmber: { backgroundColor: '#FFE5C1' },
  reminderCopy: { flex: 1, gap: 2 },
  reminderTitle: { color: '#17375F', fontSize: 14, fontWeight: '700' },
  reminderBody: { color: '#23456F', fontSize: 16, lineHeight: 21 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#D9E5EB',
  },
  composerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#D8E5EA',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  body: { color: '#0B2948', fontSize: 17, lineHeight: 27 },
  label: { color: '#12385F', fontWeight: '600', fontSize: 14 },
  tag: { color: '#376884', fontWeight: '600', fontSize: 13 },
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
  noteHeadingCopy: { flex: 1, gap: 2 },
  noteTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
    borderRadius: 99,
    color: '#315A82',
    backgroundColor: '#E8F2FD',
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
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
  moodTrigger: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D8E5EA',
    borderRadius: 11,
    backgroundColor: '#F6FAFB',
  },
  moodTriggerText: { color: '#31527D', fontSize: 13, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 28, 45, 0.48)',
  },
  moodDialog: {
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#fff',
    gap: 16,
  },
  moodDialogHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  moodDialogCopy: { flex: 1, gap: 5 },
  moodEyebrow: { color: '#66809A', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  moodDialogTitle: { color: '#17345F', fontSize: 23, fontWeight: '700' },
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
  moodOptions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  moodOption: {
    minWidth: 82,
    minHeight: 92,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E0E9EE',
    borderRadius: 14,
    backgroundColor: '#F8FBFC',
  },
  moodPictogram: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodLabel: { color: '#31527D', fontSize: 12, textAlign: 'center' },
  action: {
    backgroundColor: '#E8F0F3',
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: '#12385F', fontWeight: '600', fontSize: 14 },
  choice: {
    borderWidth: 1,
    borderColor: '#DED8CE',
    borderRadius: 12,
    padding: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#E8F0F3', borderColor: '#376884' },
  disabled: { opacity: 0.5 },
  warning: { backgroundColor: '#F7E9D7', padding: 14, borderRadius: 12, color: '#714414' },
  overdue: { color: '#925817', fontSize: 14 },
});
