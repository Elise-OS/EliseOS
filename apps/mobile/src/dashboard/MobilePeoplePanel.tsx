import { Ionicons } from '@expo/vector-icons';
import type { MembershipRole } from '@michel/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { mobileApi, type TrustedPerson } from '../api';
import type { SavedServer } from '../discovery/types';

const c = {
  navy: '#0B2948',
  blue: '#12385F',
  accent: '#376884',
  cream: '#F5F0E8',
  paper: '#FDFBF7',
  line: '#DED8CE',
  muted: '#687382',
  green: '#4F8569',
  paleGreen: '#E5EFE8',
  amber: '#D99A55',
  paleAmber: '#F7E9D7',
  red: '#B74747',
};

type PersonDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  relation: string;
  isEmergency: boolean;
  hasAccess: boolean;
  role: 'ADMINISTRATOR' | 'CAREGIVER' | 'VIEWER';
  username: string;
  temporaryPassword: string;
};

const blankDraft = (): PersonDraft => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  relation: '',
  isEmergency: false,
  hasAccess: false,
  role: 'CAREGIVER',
  username: '',
  temporaryPassword: '',
});

const roleLabel = (role: MembershipRole | null) =>
  role === 'OWNER'
    ? 'Propriétaire'
    : role === 'ADMINISTRATOR'
      ? 'Administrateur'
      : role === 'CAREGIVER'
        ? 'Aidant'
        : role === 'VIEWER'
          ? 'Lecture seule'
          : 'Contact';

export function MobilePeoplePanel({
  server,
  token,
  role,
}: {
  server: SavedServer;
  token: string;
  role: MembershipRole;
}) {
  const canManage = role === 'OWNER' || role === 'ADMINISTRATOR';
  const [people, setPeople] = useState<TrustedPerson[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACCESS' | 'EMERGENCY' | 'DISABLED'>('ALL');
  const [editor, setEditor] = useState<TrustedPerson | 'new' | null>(null);
  const [draft, setDraft] = useState<PersonDraft>(blankDraft());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<TrustedPerson | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const load = async () => {
    try {
      setPeople(await mobileApi.people(server, token));
      setNotice('');
    } catch {
      setNotice('Les proches ne sont pas accessibles pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [server.id, token]);

  const edit = (person?: TrustedPerson) => {
    setError('');
    setEditor(person ?? 'new');
    setDraft(
      person
        ? {
            firstName: person.firstName,
            lastName: person.lastName,
            phone: person.phone ?? '',
            email: person.email ?? '',
            relation: person.relation ?? '',
            isEmergency: person.isEmergency,
            hasAccess: person.hasAccount,
            role: person.role && person.role !== 'OWNER' ? person.role : 'CAREGIVER',
            username: person.username ?? '',
            temporaryPassword: '',
          }
        : blankDraft(),
    );
  };

  const save = async () => {
    if (!editor || saving) return;
    const existing = editor === 'new' ? null : editor;
    if (
      !draft.firstName.trim() ||
      !draft.lastName.trim() ||
      (!draft.phone.trim() && !draft.email.trim())
    ) {
      setError('Indiquez le nom et un moyen de contact.');
      return;
    }
    const needsNewAccess = draft.hasAccess && (!existing || !existing.hasAccount);
    if (needsNewAccess && (!draft.username.trim() || draft.temporaryPassword.length < 12)) {
      setError('Un identifiant et un mot de passe temporaire de 12 caractères sont requis.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (!existing) {
        await mobileApi.createPerson(server, token, {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          relation: draft.relation.trim(),
          isEmergency: draft.isEmergency,
          ...(draft.hasAccess
            ? {
                access: {
                  role: draft.role,
                  username: draft.username.trim(),
                  temporaryPassword: draft.temporaryPassword,
                },
              }
            : {}),
        });
      } else {
        await mobileApi.updatePerson(server, token, existing.id, {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone: draft.phone.trim(),
          email: draft.email.trim(),
          relation: draft.relation.trim(),
          isEmergency: draft.isEmergency,
        });
        if (!existing.hasAccount && draft.hasAccess) {
          await mobileApi.updatePersonAccess(server, token, existing.id, {
            action: 'create',
            role: draft.role,
            username: draft.username.trim(),
            temporaryPassword: draft.temporaryPassword,
          });
        } else if (existing.hasAccount && existing.role !== draft.role) {
          await mobileApi.updatePersonAccess(server, token, existing.id, {
            action: 'role',
            role: draft.role,
          });
        }
      }
      setEditor(null);
      setDraft(blankDraft());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer cette fiche.');
    } finally {
      setSaving(false);
    }
  };

  const access = (person: TrustedPerson, action: 'disable' | 'enable' | 'restore') => {
    const question =
      action === 'restore'
        ? 'Restaurer cette fiche ? Son accès restera suspendu jusqu’à sa réactivation.'
        : 'Confirmer cette modification d’accès ?';
    Alert.alert(question, undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        onPress: () => {
          void mobileApi
            .updatePersonAccess(server, token, person.id, { action })
            .then(load)
            .catch(() => setNotice('La modification d’accès n’a pas abouti.'));
        },
      },
    ]);
  };

  const resetPassword = async () => {
    if (!passwordTarget || temporaryPassword.length < 12) return;
    try {
      await mobileApi.updatePersonAccess(server, token, passwordTarget.id, {
        action: 'reset-password',
        temporaryPassword,
      });
      setPasswordTarget(null);
      setTemporaryPassword('');
      setNotice('Le mot de passe temporaire a été enregistré.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'La réinitialisation a échoué.');
    }
  };

  const archive = (person: TrustedPerson) =>
    Alert.alert('Archiver cette fiche ?', 'Son historique sera conservé.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Archiver',
        style: 'destructive',
        onPress: () => {
          void mobileApi
            .archivePerson(server, token, person.id)
            .then(load)
            .catch(() => setNotice('La fiche n’a pas pu être archivée.'));
        },
      },
    ]);

  const visible = useMemo(
    () =>
      people.filter((person) => {
        const haystack =
          `${person.firstName} ${person.lastName} ${person.relation ?? ''} ${person.email ?? ''}`.toLocaleLowerCase();
        if (!haystack.includes(query.trim().toLocaleLowerCase())) return false;
        if (filter === 'ACCESS')
          return person.hasAccount && !person.accessDisabled && !person.archived;
        if (filter === 'EMERGENCY') return person.isEmergency && !person.archived;
        if (filter === 'DISABLED') return person.accessDisabled || person.archived;
        return !person.archived;
      }),
    [filter, people, query],
  );
  const activePeople = people.filter(({ archived }) => !archived).length;
  const activeAccess = people.filter(
    ({ hasAccount, accessDisabled, archived }) => hasAccount && !accessDisabled && !archived,
  ).length;
  const emergencyContacts = people.filter(
    ({ isEmergency, archived }) => isEmergency && !archived,
  ).length;

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.hero}>
          <View style={s.heroCopy}>
            <Text style={s.eyebrow}>CERCLE DE CONFIANCE</Text>
            <Text style={s.title}>Les proches</Text>
            <Text style={s.subtitle}>Les bonnes personnes, avec le bon niveau d’accès.</Text>
          </View>
          {canManage ? (
            <Pressable accessibilityRole="button" style={s.addButton} onPress={() => edit()}>
              <Ionicons name="add" size={19} color="#fff" />
              <Text style={s.addText}>Ajouter un proche</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={s.summary}>
          <Summary icon="people-outline" value={activePeople} label="proches enregistrés" />
          <View style={s.summaryDivider} />
          <Summary icon="shield-checkmark-outline" value={activeAccess} label="accès à Élise" />
          <View style={s.summaryDivider} />
          <Summary
            icon="notifications-outline"
            value={emergencyContacts}
            label="contacts prioritaires"
          />
        </View>

        <View style={s.search}>
          <Ionicons name="search-outline" size={18} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher par nom, lien ou email"
            placeholderTextColor="#92999f"
            accessibilityLabel="Rechercher parmi les proches"
            style={s.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filters}
        >
          {(
            [
              ['ALL', 'Tous'],
              ['ACCESS', 'Avec accès'],
              ['EMERGENCY', 'Urgence'],
              ['DISABLED', 'Désactivés'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
              onPress={() => setFilter(key)}
              style={[s.filter, filter === key && s.filterActive]}
            >
              <Text style={[s.filterText, filter === key && s.filterTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {notice ? (
          <Text accessibilityRole="alert" style={s.notice}>
            {notice}
          </Text>
        ) : null}
        {loading ? <Text style={s.muted}>Chargement des proches…</Text> : null}
        {!loading && !visible.length ? (
          <View style={s.empty}>
            <Ionicons name="people-outline" size={28} color={c.accent} />
            <Text style={s.cardTitle}>Personne ne correspond à cette vue</Text>
            <Text style={s.muted}>Modifiez la recherche ou choisissez un autre filtre.</Text>
          </View>
        ) : null}

        {visible.map((person) => (
          <View
            key={person.id}
            style={[s.personCard, (person.accessDisabled || person.archived) && s.personCardMuted]}
          >
            <View style={s.personHead}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {`${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()}
                </Text>
              </View>
              <View style={s.personIdentity}>
                <Text style={s.cardTitle}>
                  {person.firstName} {person.lastName}
                </Text>
                <Text style={s.muted}>{person.relation || 'Lien non précisé'}</Text>
              </View>
              {person.isEmergency ? (
                <View style={s.priority}>
                  <Ionicons name="notifications" size={13} color={c.red} />
                  <Text style={s.priorityText}>{person.priority + 1}</Text>
                </View>
              ) : null}
            </View>
            <View style={s.badges}>
              <View style={s.roleBadge}>
                <Ionicons
                  name={person.hasAccount ? 'shield-checkmark-outline' : 'person-outline'}
                  size={13}
                  color={c.blue}
                />
                <Text style={s.roleText}>{roleLabel(person.role)}</Text>
              </View>
              {person.isEmergency ? (
                <Text style={s.emergencyBadge}>Contact prioritaire</Text>
              ) : null}
              {person.accessDisabled ? <Text style={s.disabledBadge}>Accès désactivé</Text> : null}
              {person.archived ? <Text style={s.disabledBadge}>Archivé</Text> : null}
            </View>
            {person.phone ? (
              <Pressable
                style={s.contactLine}
                onPress={() => void Linking.openURL(`tel:${person.phone}`)}
              >
                <Ionicons name="call-outline" size={15} color={c.accent} />
                <Text style={s.contactText}>{person.phone}</Text>
              </Pressable>
            ) : null}
            {person.email ? (
              <Pressable
                style={s.contactLine}
                onPress={() => void Linking.openURL(`mailto:${person.email}`)}
              >
                <Ionicons name="mail-outline" size={15} color={c.accent} />
                <Text style={s.contactText}>{person.email}</Text>
              </Pressable>
            ) : null}
            {person.username ? (
              <Text style={s.username}>
                <Ionicons name="person-circle-outline" size={14} color={c.muted} /> @
                {person.username}
              </Text>
            ) : null}
            <View style={s.footer}>
              <Text style={[s.accessState, person.accessDisabled && s.accessOff]}>
                {person.hasAccount
                  ? person.accessDisabled
                    ? 'Accès suspendu'
                    : 'Accès actif'
                  : 'Contact uniquement'}
              </Text>
              {person.isCurrentUser ? <Text style={s.muted}>Votre compte</Text> : null}
            </View>
            {canManage && !person.isCurrentUser ? (
              <View style={s.actions}>
                <Pressable style={s.outlineButton} onPress={() => edit(person)}>
                  <Text style={s.outlineText}>Voir la fiche</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.blue} />
                </Pressable>
                {person.archived ? (
                  <Pressable style={s.actionButton} onPress={() => void access(person, 'restore')}>
                    <Text style={s.actionText}>Restaurer</Text>
                  </Pressable>
                ) : person.hasAccount ? (
                  <Pressable
                    style={s.actionButton}
                    onPress={() =>
                      void access(person, person.accessDisabled ? 'enable' : 'disable')
                    }
                  >
                    <Text style={s.actionText}>
                      {person.accessDisabled ? 'Réactiver' : 'Suspendre'}
                    </Text>
                  </Pressable>
                ) : null}
                {person.hasAccount && !person.accessDisabled && !person.archived ? (
                  <Pressable
                    style={s.actionButton}
                    onPress={() => {
                      setPasswordTarget(person);
                      setTemporaryPassword('');
                    }}
                  >
                    <Text style={s.actionText}>Réinitialiser le mot de passe</Text>
                  </Pressable>
                ) : null}
                {!person.archived ? (
                  <Pressable style={s.archiveButton} onPress={() => archive(person)}>
                    <Text style={s.archiveText}>Archiver la fiche</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Modal
        visible={Boolean(editor)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditor(null)}
      >
        <View style={s.modalShell}>
          <View style={s.modalHeader}>
            <View>
              <Text style={s.eyebrow}>
                {editor === 'new' ? 'NOUVEAU PROCHE' : 'MODIFIER LA FICHE'}
              </Text>
              <Text style={s.modalTitle}>
                {editor === 'new'
                  ? 'Ajouter au cercle'
                  : editor
                    ? `${editor.firstName} ${editor.lastName}`
                    : ''}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Fermer"
              style={s.closeButton}
              onPress={() => setEditor(null)}
            >
              <Ionicons name="close" size={22} color={c.navy} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
            <Field
              label="Prénom"
              value={draft.firstName}
              onChange={(value) => setDraft({ ...draft, firstName: value })}
            />
            <Field
              label="Nom"
              value={draft.lastName}
              onChange={(value) => setDraft({ ...draft, lastName: value })}
            />
            <Field
              label="Téléphone"
              keyboardType="phone-pad"
              value={draft.phone}
              onChange={(value) => setDraft({ ...draft, phone: value })}
            />
            <Field
              label="Email"
              keyboardType="email-address"
              value={draft.email}
              onChange={(value) => setDraft({ ...draft, email: value })}
            />
            <Field
              label="Lien avec le résident"
              value={draft.relation}
              onChange={(value) => setDraft({ ...draft, relation: value })}
            />
            <Toggle
              label="Contact d’urgence"
              detail="Visible dans l’ordre d’appel prioritaire."
              value={draft.isEmergency}
              onChange={(value) => setDraft({ ...draft, isEmergency: value })}
            />
            {editor === 'new' || (editor && !editor.hasAccount) ? (
              <Toggle
                label="Donner accès à Élise"
                detail="Le mot de passe devra être changé à la première connexion."
                value={draft.hasAccess}
                onChange={(value) => setDraft({ ...draft, hasAccess: value })}
              />
            ) : null}
            {(draft.hasAccess || (editor !== 'new' && editor?.hasAccount)) &&
            editor !== null &&
            (editor === 'new' || editor.role !== 'OWNER') ? (
              <>
                <Text style={s.fieldLabel}>Rôle dans Élise</Text>
                <View style={s.roleChoices}>
                  {[
                    ...(role === 'OWNER' ? [['ADMINISTRATOR', 'Administrateur'] as const] : []),
                    ['CAREGIVER', 'Aidant'] as const,
                    ['VIEWER', 'Lecture seule'] as const,
                  ].map(([value, label]) => (
                    <Pressable
                      key={value}
                      onPress={() => setDraft({ ...draft, role: value })}
                      style={[s.filter, draft.role === value && s.filterActive]}
                    >
                      <Text style={[s.filterText, draft.role === value && s.filterTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {editor === 'new' || !editor.hasAccount ? (
                  <>
                    <Field
                      label="Identifiant"
                      autoCapitalize="none"
                      value={draft.username}
                      onChange={(value) => setDraft({ ...draft, username: value })}
                    />
                    <Field
                      label="Mot de passe temporaire (12 caractères minimum)"
                      secure
                      value={draft.temporaryPassword}
                      onChange={(value) => setDraft({ ...draft, temporaryPassword: value })}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            ) : null}
            <View style={s.formActions}>
              <Pressable style={s.outlineButton} onPress={() => setEditor(null)}>
                <Text style={s.outlineText}>Annuler</Text>
              </Pressable>
              <Pressable
                disabled={saving}
                style={[s.saveButton, saving && s.disabled]}
                onPress={() => void save()}
              >
                <Text style={s.saveText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={Boolean(passwordTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setPasswordTarget(null)}
      >
        <View style={s.passwordBackdrop}>
          <View style={s.passwordDialog}>
            <Text style={s.modalTitle}>Nouveau mot de passe temporaire</Text>
            <Text style={s.muted}>
              12 caractères minimum. La personne devra le changer à la prochaine connexion.
            </Text>
            <TextInput
              style={s.input}
              value={temporaryPassword}
              onChangeText={setTemporaryPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Mot de passe temporaire"
            />
            <View style={s.formActions}>
              <Pressable style={s.outlineButton} onPress={() => setPasswordTarget(null)}>
                <Text style={s.outlineText}>Annuler</Text>
              </Pressable>
              <Pressable
                disabled={temporaryPassword.length < 12}
                style={[s.saveButton, temporaryPassword.length < 12 && s.disabled]}
                onPress={() => void resetPassword()}
              >
                <Text style={s.saveText}>Enregistrer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Summary({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: number;
  label: string;
}) {
  return (
    <View style={s.summaryItem}>
      <Ionicons name={icon} size={18} color={c.accent} />
      <Text style={s.summaryValue}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType = 'default',
  secure = false,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize ?? 'sentences'}
      />
    </View>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={s.toggleRow}
      onPress={() => onChange(!value)}
    >
      <View style={s.toggleCopy}>
        <Text style={s.cardTitle}>{label}</Text>
        <Text style={s.muted}>{detail}</Text>
      </View>
      <View style={[s.toggle, value && s.toggleOn]}>
        <View style={[s.toggleKnob, value && s.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 36, gap: 12, backgroundColor: c.cream },
  hero: { borderRadius: 20, padding: 19, backgroundColor: '#EDF2F1', gap: 14 },
  heroCopy: { gap: 4 },
  eyebrow: { color: c.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: c.navy, fontFamily: 'Georgia', fontSize: 27 },
  subtitle: { color: c.muted, fontSize: 11, lineHeight: 16 },
  addButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.blue,
  },
  addText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  summary: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.paper,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryValue: { color: c.navy, fontSize: 18, fontWeight: '900' },
  summaryLabel: { color: c.muted, fontSize: 8, textAlign: 'center' },
  summaryDivider: { height: 37, width: StyleSheet.hairlineWidth, backgroundColor: c.line },
  search: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.paper,
  },
  searchInput: { flex: 1, color: c.navy, fontSize: 11, paddingVertical: 8 },
  filters: { gap: 7, paddingBottom: 2 },
  filter: {
    minHeight: 35,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  filterActive: { borderColor: c.blue, backgroundColor: c.blue },
  filterText: { color: c.muted, fontSize: 9, fontWeight: '800' },
  filterTextActive: { color: '#fff' },
  notice: { padding: 11, borderRadius: 11, color: c.red, backgroundColor: '#F8E7E5', fontSize: 10 },
  muted: { color: c.muted, fontSize: 10, lineHeight: 15 },
  empty: {
    minHeight: 140,
    padding: 18,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: c.paper,
  },
  personCard: {
    padding: 15,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: c.line,
    gap: 10,
    backgroundColor: c.paper,
  },
  personCardMuted: { opacity: 0.7 },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  personIdentity: { flex: 1, gap: 3 },
  cardTitle: { color: c.navy, fontSize: 12, fontWeight: '900' },
  priority: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  priorityText: { color: c.red, fontSize: 10, fontWeight: '900' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F0F3',
  },
  roleText: { color: c.blue, fontSize: 8, fontWeight: '800' },
  emergencyBadge: {
    color: '#8D4827',
    backgroundColor: c.paleAmber,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    fontSize: 8,
    fontWeight: '800',
  },
  disabledBadge: {
    color: c.muted,
    backgroundColor: '#ECE9E3',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    fontSize: 8,
    fontWeight: '800',
  },
  contactLine: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24 },
  contactText: { color: c.blue, fontSize: 10 },
  username: { color: c.muted, fontSize: 9 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    paddingTop: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  accessState: { color: c.green, fontSize: 9, fontWeight: '900' },
  accessOff: { color: c.red },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
    paddingTop: 9,
    gap: 7,
  },
  outlineButton: {
    minHeight: 40,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.paper,
  },
  outlineText: { color: c.blue, fontSize: 10, fontWeight: '900' },
  actionButton: { paddingVertical: 8, alignItems: 'flex-start' },
  actionText: { color: c.blue, fontSize: 10, fontWeight: '800' },
  archiveButton: { paddingVertical: 8, alignItems: 'flex-start' },
  archiveText: { color: c.red, fontSize: 10, fontWeight: '800' },
  modalShell: { flex: 1, backgroundColor: c.cream },
  modalHeader: {
    minHeight: 77,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { marginTop: 4, color: c.navy, fontFamily: 'Georgia', fontSize: 23 },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.paper,
  },
  form: { padding: 18, paddingBottom: 36, gap: 12 },
  field: { gap: 6 },
  fieldLabel: { color: c.navy, fontSize: 10, fontWeight: '800' },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.line,
    color: c.navy,
    backgroundColor: c.paper,
    fontSize: 11,
  },
  toggleRow: {
    minHeight: 63,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: c.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.paper,
  },
  toggleCopy: { flex: 1, gap: 4 },
  toggle: {
    width: 40,
    height: 24,
    padding: 3,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: '#B9C0C4',
  },
  toggleOn: { backgroundColor: c.green },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleKnobOn: { alignSelf: 'flex-end' },
  roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  error: { color: c.red, fontSize: 10 },
  formActions: { marginTop: 8, flexDirection: 'row', gap: 9 },
  saveButton: {
    minHeight: 42,
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.blue,
  },
  saveText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  passwordBackdrop: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 41, 72, 0.35)',
  },
  passwordDialog: { padding: 18, borderRadius: 18, gap: 12, backgroundColor: c.paper },
});
