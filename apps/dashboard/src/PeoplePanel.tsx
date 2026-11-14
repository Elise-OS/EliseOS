import { Button, Card } from '@elise/ui';
import {
  Archive,
  Bell,
  ChevronRight,
  Eye,
  HeartHandshake,
  KeyRound,
  Mail,
  Phone,
  Plus,
  Power,
  Search,
  ShieldCheck,
  UsersRound,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { type Locale, t as i18nT } from './i18n';
import { DataLoadingScreen } from './DataLoadingScreen';
import type { Person, AccessRole, CurrentAccess } from './app-types';

export const blankPerson = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  relation: '',
  isEmergency: false,
  hasAccess: false,
  role: 'CAREGIVER' as AccessRole,
  username: '',
  temporaryPassword: '',
};

export const personRoleLabel = (role: Person['role']) => {
  const labels = {
    OWNER: () => i18nT('app.personRoleLabel.labels.OWNER'),
    ADMINISTRATOR: () => i18nT('app.personRoleLabel.labels.ADMINISTRATOR'),
    CAREGIVER: () => i18nT('app.personRoleLabel.labels.CAREGIVER'),
    VIEWER: () => i18nT('app.personRoleLabel.labels.VIEWER'),
  } as const;
  return role ? labels[role]() : i18nT('app.noAccess');
};

export const personRoleIcon = (role: Person['role']) => {
  const Icon =
    role === 'CAREGIVER'
      ? HeartHandshake
      : role === 'OWNER' || role === 'ADMINISTRATOR'
        ? ShieldCheck
        : role === 'VIEWER'
          ? Eye
          : UserRound;
  return <Icon aria-hidden="true" />;
};

export function PeoplePanel({
  locale,
  currentRole,
}: {
  locale: Locale;
  currentRole: CurrentAccess['role'];
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACCESS' | 'EMERGENCY' | 'DISABLED'>('ALL');
  const [editor, setEditor] = useState<Person | 'new' | null>(null);
  const [draft, setDraft] = useState(blankPerson);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canManage = currentRole === 'OWNER' || currentRole === 'ADMINISTRATOR';
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/household/people?archived=true');
      if (response.ok) setPeople((await response.json()) as Person[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const edit = (person?: Person) => {
    setEditor(person ?? 'new');
    setError('');
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
        : blankPerson,
    );
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const existing = editor === 'new' ? null : editor;
    if (!draft.firstName || !draft.lastName || (!draft.phone && !draft.email)) {
      setError(i18nT('app.enterANameAndContact'));
      return;
    }
    if (
      (!existing || !existing.hasAccount) &&
      draft.hasAccess &&
      (!draft.username || draft.temporaryPassword.length < 12)
    ) {
      setError(i18nT('app.aUsernameAnd12Character'));
      return;
    }
    setSaving(true);
    setError('');
    const response = await fetch(
      existing ? `/api/v1/household/people/${existing.id}` : '/api/v1/household/people',
      {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: draft.firstName,
          lastName: draft.lastName,
          phone: draft.phone,
          email: draft.email,
          relation: draft.relation,
          isEmergency: draft.isEmergency,
          ...(!existing && draft.hasAccess
            ? {
                access: {
                  role: draft.role,
                  username: draft.username,
                  temporaryPassword: draft.temporaryPassword,
                },
              }
            : {}),
        }),
      },
    );
    let roleOk = true;
    if (
      response.ok &&
      existing &&
      ((!existing.hasAccount && draft.hasAccess) ||
        (existing.hasAccount && existing.role !== draft.role))
    ) {
      roleOk = (
        await fetch(`/api/v1/household/people/${existing.id}/access`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            existing.hasAccount
              ? { action: 'role', role: draft.role }
              : {
                  action: 'create',
                  role: draft.role,
                  username: draft.username,
                  temporaryPassword: draft.temporaryPassword,
                },
          ),
        })
      ).ok;
    }
    setSaving(false);
    if (!response.ok || !roleOk) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? i18nT('app.unableToSaveThisProfile'));
      return;
    }
    setEditor(null);
    await load();
  };
  const access = async (
    person: Person,
    action: 'disable' | 'enable' | 'reset-password' | 'restore',
  ) => {
    let body: Record<string, string> = { action };
    if (action === 'reset-password') {
      const password = window.prompt(i18nT('app.temporaryPassword12CharactersMinimum'));
      if (!password || password.length < 12) return;
      body = { action, temporaryPassword: password };
    } else if (
      !window.confirm(
        action === 'restore'
          ? i18nT('app.restoreThisProfileAccessWill')
          : i18nT('app.confirmThisAccessChange'),
      )
    )
      return;
    const response = await fetch(`/api/v1/household/people/${person.id}/access`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) await load();
  };
  const archive = async (person: Person) => {
    if (!window.confirm(i18nT('app.archiveThisProfileItsHistory'))) return;
    if ((await fetch(`/api/v1/household/people/${person.id}`, { method: 'DELETE' })).ok)
      await load();
  };
  const visible = people.filter((person) => {
    if (
      !`${person.firstName} ${person.lastName} ${person.relation ?? ''} ${person.email ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      return false;
    if (filter === 'ACCESS') return person.hasAccount && !person.accessDisabled && !person.archived;
    if (filter === 'EMERGENCY') return person.isEmergency && !person.archived;
    if (filter === 'DISABLED') return person.accessDisabled || person.archived;
    return !person.archived;
  });
  const filters = {
    ALL: i18nT('app.all'),
    ACCESS: i18nT('app.withAccess'),
    EMERGENCY: i18nT('app.emergency'),
    DISABLED: i18nT('app.disabled'),
  };
  const activePeople = people.filter((person) => !person.archived).length;
  const activeAccess = people.filter(
    (person) => person.hasAccount && !person.accessDisabled && !person.archived,
  ).length;
  const emergencyContacts = people.filter(
    (person) => person.isEmergency && !person.archived,
  ).length;

  if (loading)
    return <DataLoadingScreen locale={locale} message={i18nT('app.preparingYourCareCircle')} />;

  return (
    <section className="section-view people-page">
      <header className="page-hero people-hero">
        <div className="page-hero__copy people-title-row">
          <div>
            <span className="page-hero__eyebrow">{i18nT('app.careCircle')}</span>
            <h2 className="page-hero__title">{i18nT('app.people')}</h2>
            <p className="page-hero__text">{i18nT('app.theRightPeopleWithThe')}</p>
          </div>
        </div>
        {canManage && (
          <Button className="people-add-button" onClick={() => edit()}>
            <Plus />
            {i18nT('app.addPerson')}
          </Button>
        )}
      </header>
      <div className="people-overview" aria-label={i18nT('app.summary')}>
        <div>
          <span className="people-overview-icon people-overview-icon--family">
            <UserRound />
          </span>
          <p>
            <strong>{activePeople}</strong>
            <span>{i18nT('app.savedPeople')}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--access">
            <ShieldCheck />
          </span>
          <p>
            <strong>{activeAccess}</strong>
            <span>{i18nT('app.eliseAccess')}</span>
          </p>
        </div>
        <i />
        <div>
          <span className="people-overview-icon people-overview-icon--urgent">
            <Bell />
          </span>
          <p>
            <strong>{emergencyContacts}</strong>
            <span>{i18nT('app.priorityContacts')}</span>
          </p>
        </div>
      </div>
      <div className="people-toolbar">
        <label className="people-search">
          <Search />
          <input
            aria-label={i18nT('app.search')}
            type="search"
            placeholder={i18nT('app.searchByNameRelationshipOr')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div role="group" aria-label={i18nT('app.filterList')}>
          {(Object.keys(filters) as Array<keyof typeof filters>).map((value) => (
            <button
              type="button"
              className={filter === value ? 'is-active' : ''}
              key={value}
              onClick={() => setFilter(value)}
            >
              {filters[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="people-card-grid">
        {!loading &&
          visible.map((person) => (
            <Card
              className={`people-card role-card-${person.role ?? 'NONE'}${person.accessDisabled || person.archived ? ' is-disabled' : ''}`}
              key={person.id}
            >
              <div className="people-card-top">
                <span className="people-avatar">{personRoleIcon(person.role)}</span>
                <div>
                  <h3>
                    {person.firstName} {person.lastName}
                  </h3>
                  <p>{person.relation || i18nT('app.relationshipNotSpecified')}</p>
                </div>
                {person.isEmergency && (
                  <span className="people-priority" title={i18nT('app.callPriority')}>
                    <Bell />
                    {person.priority + 1}
                  </span>
                )}
              </div>
              <div className="people-badges">
                <span className={`people-role role-${person.role ?? 'NONE'}`}>
                  {personRoleIcon(person.role)}
                  {personRoleLabel(person.role)}
                </span>
                {person.isEmergency && (
                  <span className="people-emergency">
                    <Bell />
                    {i18nT('app.priorityContact')}
                  </span>
                )}
                {person.accessDisabled && <span>{i18nT('app.accessDisabled')}</span>}
                {person.archived && <span>{i18nT('app.archived')}</span>}
              </div>
              <div className="people-contact-lines">
                {person.phone && (
                  <a href={`tel:${person.phone}`}>
                    <Phone /> <span>{person.phone}</span>
                  </a>
                )}
                {person.email && (
                  <a href={`mailto:${person.email}`}>
                    <Mail /> <span>{person.email}</span>
                  </a>
                )}
                {person.username && (
                  <small>
                    <UserRound /> <span>@{person.username}</span>
                  </small>
                )}
              </div>
              <div className="people-card-footer">
                <span className={`people-access-state${person.accessDisabled ? ' is-off' : ''}`}>
                  <i />
                  {person.hasAccount
                    ? person.accessDisabled
                      ? i18nT('app.accessSuspended')
                      : i18nT('app.activeAccess')
                    : i18nT('app.contactOnly')}
                </span>
                {canManage && !person.isCurrentUser && (
                  <div className="people-actions">
                    <button className="people-edit" onClick={() => edit(person)}>
                      {i18nT('app.viewProfile')}
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <details className="people-action-menu">
                      <summary aria-label={i18nT('app.moreActions')}>•••</summary>
                      <div>
                        {person.archived ? (
                          <button onClick={() => void access(person, 'restore')}>
                            <Archive />
                            {i18nT('app.restoreProfile')}
                          </button>
                        ) : person.hasAccount ? (
                          <button
                            onClick={() =>
                              void access(person, person.accessDisabled ? 'enable' : 'disable')
                            }
                          >
                            <Power />
                            {person.accessDisabled
                              ? i18nT('app.enableAccess')
                              : i18nT('app.suspendAccess')}
                          </button>
                        ) : null}
                        {!person.archived && person.hasAccount && !person.accessDisabled && (
                          <button onClick={() => void access(person, 'reset-password')}>
                            <KeyRound />
                            {i18nT('app.resetPassword')}
                          </button>
                        )}
                        {!person.archived && (
                          <button className="is-danger" onClick={() => void archive(person)}>
                            <Archive />
                            {i18nT('app.archiveProfile')}
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                )}
                {person.isCurrentUser && <small>{i18nT('app.yourAccount')}</small>}
              </div>
            </Card>
          ))}
        {!loading && visible.length === 0 && (
          <Card className="people-empty">
            <span>
              <UsersRound />
            </span>
            <h3>{i18nT('app.noOneMatchesThisView')}</h3>
            <p>{i18nT('app.changeYourSearchOrChoose')}</p>
          </Card>
        )}
      </div>
      {editor && (
        <div
          className="people-editor-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}
        >
          <div className="people-editor" role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow">
                  {editor === 'new' ? i18nT('app.newPerson') : i18nT('app.editProfile')}
                </span>
                <h2>
                  {editor === 'new'
                    ? i18nT('app.addToCircle')
                    : `${editor.firstName} ${editor.lastName}`}
                </h2>
              </div>
              <button aria-label={i18nT('app.close')} onClick={() => setEditor(null)}>
                <X />
              </button>
            </header>
            <form onSubmit={(event) => void save(event)}>
              <div className="people-form-grid">
                <label>
                  {i18nT('app.firstName')}
                  <input
                    autoFocus
                    value={draft.firstName}
                    onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                  />
                </label>
                <label>
                  {i18nT('app.lastName')}
                  <input
                    value={draft.lastName}
                    onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                  />
                </label>
                <label>
                  {i18nT('app.phone')}
                  <input
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </label>
                <label className="wide">
                  {i18nT('app.relationship')}
                  <input
                    value={draft.relation}
                    onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
                  />
                </label>
              </div>
              <label className="people-check">
                <input
                  type="checkbox"
                  checked={draft.isEmergency}
                  onChange={(e) => setDraft({ ...draft, isEmergency: e.target.checked })}
                />
                <span>
                  <strong>{i18nT('app.emergencyContact')}</strong>
                  <small>{i18nT('app.shownInThePriorityCall')}</small>
                </span>
              </label>
              {(editor === 'new' || !editor.hasAccount) && (
                <label className="people-check">
                  <input
                    type="checkbox"
                    checked={draft.hasAccess}
                    onChange={(e) => setDraft({ ...draft, hasAccess: e.target.checked })}
                  />
                  <span>
                    <strong>{i18nT('app.grantEliseAccess')}</strong>
                    <small>{i18nT('app.passwordMustBeChangedAt')}</small>
                  </span>
                </label>
              )}
              {(draft.hasAccess || (editor !== 'new' && editor.hasAccount)) &&
                (editor === 'new' || editor.role !== 'OWNER') && (
                  <div className="people-access-fields">
                    <label>
                      {i18nT('app.role')}
                      <select
                        value={draft.role}
                        onChange={(e) => setDraft({ ...draft, role: e.target.value as AccessRole })}
                      >
                        {currentRole === 'OWNER' && (
                          <option value="ADMINISTRATOR">{i18nT('app.administrator')}</option>
                        )}
                        <option value="CAREGIVER">{i18nT('app.caregiver')}</option>
                        <option value="VIEWER">{i18nT('app.readOnly')}</option>
                      </select>
                    </label>
                    {(editor === 'new' || !editor.hasAccount) && (
                      <>
                        <label>
                          {i18nT('app.username')}
                          <input
                            value={draft.username}
                            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                          />
                        </label>
                        <label className="wide">
                          {i18nT('app.temporaryPassword')}
                          <input
                            type="password"
                            minLength={12}
                            value={draft.temporaryPassword}
                            onChange={(e) =>
                              setDraft({ ...draft, temporaryPassword: e.target.value })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              {error && <p className="form-error">{error}</p>}
              <footer>
                <Button type="button" className="button-secondary" onClick={() => setEditor(null)}>
                  {i18nT('app.cancel')}
                </Button>
                <Button disabled={saving}>
                  {saving ? i18nT('app.saving') : i18nT('app.save')}
                </Button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
