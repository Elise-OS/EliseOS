import type { EquipmentCoverage, EquipmentTarget } from '@michel/contracts';
import type { CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  MapPin,
  PackageCheck,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

const capabilityLabels: Record<string, [string, string]> = {
  motion: ['Détecteur de mouvement', 'Motion sensor'],
  occupancy: ['Capteur de présence', 'Occupancy sensor'],
  person_presence: ['Capteur de présence fine', 'Fine presence sensor'],
  contact: ['Capteur d’ouverture', 'Opening sensor'],
  temperature: ['Capteur de température', 'Temperature sensor'],
  humidity: ['Capteur d’humidité', 'Humidity sensor'],
  water_leak: ['Détecteur de fuite', 'Water leak sensor'],
  power: ['Prise avec mesure d’énergie', 'Energy-monitoring plug'],
};

const itemLabels: Record<string, [string, string]> = {
  MAIN_ENTRANCE: ['Entrée principale', 'Main entrance'],
  STAIR: ['Escalier', 'Staircase'],
  SINK: ['Évier', 'Sink'],
  WASHBASIN: ['Lavabo', 'Washbasin'],
  WASHING_MACHINE: ['Lave-linge', 'Washing machine'],
  DISHWASHER: ['Lave-vaisselle', 'Dishwasher'],
  SHOWER: ['Douche', 'Shower'],
  BATHTUB: ['Baignoire', 'Bathtub'],
  TOILET: ['Toilettes', 'Toilet'],
  FRIDGE: ['Réfrigérateur', 'Fridge'],
  OVEN: ['Four', 'Oven'],
  COFFEE_MACHINE: ['Cafetière', 'Coffee machine'],
  KETTLE: ['Bouilloire', 'Kettle'],
  MICROWAVE: ['Micro-ondes', 'Microwave'],
  MEDICAL_DEVICE: ['Appareil médical', 'Medical device'],
};

const warnings: Record<EquipmentCoverage['summary']['warnings'][number], [string, string]> = {
  EMPTY_PLAN: [
    'Ajoutez au moins une pièce pour qu’Élise puisse analyser le logement.',
    'Add at least one room so Elise can analyse the home.',
  ],
  MISSING_MAIN_ENTRANCE: [
    'L’entrée principale n’est pas dessinée : le capteur d’ouverture correspondant ne peut pas encore être compté.',
    'The main entrance is not drawn, so its opening sensor cannot be counted yet.',
  ],
  MISSING_PASSAGES: [
    'Les passages entre les pièces ne sont pas dessinés. Leur ajout affinera les emplacements conseillés.',
    'Passages between rooms are not drawn. Adding them will refine the suggested locations.',
  ],
  MISSING_STAIRS: [
    'Tous les niveaux ne sont pas encore reliés par un escalier dans le plan.',
    'Not all floors are connected by a staircase in the plan yet.',
  ],
  MISSING_WATER_POINTS: [
    'Aucun point d’eau n’est placé. Ajoutez l’évier, le lavabo ou le lave-linge pour obtenir les besoins de détection de fuite.',
    'No water point is placed. Add the sink, washbasin or washing machine to calculate leak detection needs.',
  ],
};

const localizedTarget = (target: EquipmentTarget, fr: boolean) =>
  target.type === 'ROOM' ? target.label : (itemLabels[target.kind]?.[fr ? 0 : 1] ?? target.label);

const capabilitySummary = (capabilities: string[], fr: boolean) =>
  capabilities
    .map((capability) => capabilityLabels[capability]?.[fr ? 0 : 1] ?? capability)
    .join(' · ');

export function SensorCoverageRecommendations({
  locale,
  coverage,
  loading,
  error,
  onRetry,
  onBack,
  onContinue,
  onClose,
}: {
  locale: 'fr' | 'en';
  coverage: EquipmentCoverage | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onBack?: () => void;
  onContinue?: () => void;
  onClose?: () => void;
}) {
  const fr = locale === 'fr';
  const summary = coverage?.summary;
  const coverageRate = summary?.totals.required
    ? Math.round((summary.totals.covered / summary.totals.required) * 100)
    : 0;
  return (
    <section className="coverage-recommendations-page">
      <header className="coverage-recommendations-topbar">
        <div>
          <span>
            <ShieldCheck />
          </span>
          <div>
            <strong>Élise</strong>
            <small>{fr ? 'Analyse du logement' : 'Home analysis'}</small>
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'}>
            <X />
          </button>
        )}
      </header>

      {loading ? (
        <div className="coverage-recommendations-state" role="status">
          <Sparkles />
          <h2>{fr ? 'Élise analyse votre plan…' : 'Elise is analysing your plan…'}</h2>
          <p>
            {fr
              ? 'Pièces, passages et équipements sont pris en compte.'
              : 'Rooms, passages and equipment are being taken into account.'}
          </p>
        </div>
      ) : error || !summary ? (
        <div className="coverage-recommendations-state is-error" role="alert">
          <AlertTriangle />
          <h2>{fr ? 'L’analyse n’est pas disponible' : 'The analysis is unavailable'}</h2>
          <p>{error || (fr ? 'Réessayez dans quelques instants.' : 'Please try again shortly.')}</p>
          <button type="button" onClick={onRetry}>
            <RefreshCw />
            {fr ? 'Réessayer' : 'Try again'}
          </button>
        </div>
      ) : (
        <div className="coverage-recommendations-content">
          <header className="coverage-recommendations-hero">
            <div className="coverage-hero-copy">
              <span className="eyebrow">
                <Sparkles />
                {fr ? 'Votre couverture recommandée' : 'Your recommended coverage'}
              </span>
              <h1>
                {summary.totals.required
                  ? fr
                    ? `${summary.totals.required} capteur${summary.totals.required > 1 ? 's' : ''} pour couvrir le logement`
                    : `${summary.totals.required} sensor${summary.totals.required > 1 ? 's' : ''} to cover the home`
                  : fr
                    ? 'Le plan doit être complété'
                    : 'The plan needs more detail'}
              </h1>
              <p>
                {fr
                  ? `Une sélection sur mesure à partir des pièces, passages et équipements dessinés dans votre plan.`
                  : 'A tailored selection based on the rooms, passages and equipment drawn in your plan.'}
              </p>
            </div>
            <div className="coverage-score" aria-label={`${coverageRate}%`}>
              <div
                className="coverage-score-ring"
                style={{ '--coverage-rate': `${coverageRate * 3.6}deg` } as CSSProperties}
              >
                <span>
                  <strong>{coverageRate}%</strong>
                  <small>{fr ? 'déjà couvert' : 'covered'}</small>
                </span>
              </div>
              <p>
                {summary.totals.toAdd
                  ? fr
                    ? `Plus que ${summary.totals.toAdd} appareil${summary.totals.toAdd > 1 ? 's' : ''} à prévoir`
                    : `${summary.totals.toAdd} device${summary.totals.toAdd > 1 ? 's' : ''} left to add`
                  : fr
                    ? 'Votre couverture est complète'
                    : 'Your coverage is complete'}
              </p>
            </div>
          </header>

          <div className="coverage-totals">
            <span>
              <i>
                <Radio />
              </i>
              <strong>{summary.totals.required}</strong>
              <small>{fr ? 'capteurs recommandés' : 'recommended sensors'}</small>
            </span>
            <span>
              <i>
                <CircleCheck />
              </i>
              <strong>{summary.totals.covered}</strong>
              <small>{fr ? 'déjà présents' : 'already present'}</small>
            </span>
            <span className="is-highlighted">
              <i>
                <PackageCheck />
              </i>
              <strong>{summary.totals.toAdd}</strong>
              <small>{fr ? 'à prévoir' : 'to add'}</small>
            </span>
          </div>

          {!!summary.warnings.length && (
            <aside className="coverage-plan-warnings">
              <header>
                <AlertTriangle />
                <strong>{fr ? 'Analyse à affiner' : 'Analysis to refine'}</strong>
              </header>
              <ul>
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warnings[warning][fr ? 0 : 1]}</li>
                ))}
              </ul>
            </aside>
          )}

          <CoverageList
            locale={locale}
            title={fr ? 'Le kit conseillé' : 'Recommended kit'}
            items={summary.main}
            empty={
              fr
                ? 'La couverture principale est complète avec les appareils déjà installés.'
                : 'Core coverage is complete with the devices already installed.'
            }
          />
          {!!summary.optional.length && (
            <CoverageList
              locale={locale}
              title={fr ? 'Pour aller plus loin' : 'Going further'}
              subtitle={
                fr
                  ? 'Confort et compréhension supplémentaires, hors du total principal.'
                  : 'Additional comfort and insight, outside the main total.'
              }
              items={summary.optional}
              optional
            />
          )}

          <aside className="coverage-safety-note">
            <ShieldCheck />
            <p>
              {fr
                ? 'Cette recommandation aide Élise à mieux comprendre le logement. Elle ne constitue ni une garantie de sécurité, ni un dispositif médical ou un service d’urgence.'
                : 'This recommendation helps Elise understand the home. It is not a safety guarantee, medical device or emergency service.'}
            </p>
          </aside>
        </div>
      )}

      {!loading && !error && summary && (onBack || onContinue) && (
        <footer className="coverage-recommendations-actions">
          {onBack && (
            <button type="button" onClick={onBack}>
              <ArrowLeft />
              {fr ? 'Modifier le plan' : 'Edit the plan'}
            </button>
          )}
          {onContinue && (
            <button type="button" className="home-setup-primary" onClick={onContinue}>
              {fr ? 'Terminer la création' : 'Finish setup'}
              <ArrowRight />
            </button>
          )}
        </footer>
      )}
    </section>
  );
}

function CoverageList({
  locale,
  title,
  subtitle,
  items,
  empty,
  optional = false,
}: {
  locale: 'fr' | 'en';
  title: string;
  subtitle?: string;
  items: EquipmentCoverage['summary']['main'];
  empty?: string;
  optional?: boolean;
}) {
  const fr = locale === 'fr';
  const toAdd = items.reduce((total, item) => total + item.toAdd, 0);
  return (
    <section className={`coverage-kit-section${optional ? ' is-optional' : ''}`}>
      <header>
        <span className="coverage-section-number">{optional ? '02' : '01'}</span>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {!!items.length && (
          <strong className="coverage-section-count">
            {toAdd} {fr ? 'à prévoir' : 'to add'}
          </strong>
        )}
      </header>
      {!items.length && empty && (
        <div className="coverage-kit-empty">
          <Check />
          {empty}
        </div>
      )}
      <div className="coverage-kit-grid">
        {items.map((item) => (
          <article key={item.id} className="coverage-kit-card">
            <header>
              <span className="coverage-product-icon">
                <Radio />
              </span>
              <div className="coverage-product-copy">
                <span>{capabilitySummary(item.capabilities, fr)}</span>
                <h3>{item.label}</h3>
                <p>
                  {[item.manufacturer, item.model].filter(Boolean).join(' · ') ||
                    (fr ? 'Profil compatible' : 'Compatible profile')}
                </p>
              </div>
              <strong className="coverage-product-quantity">
                <small>{fr ? 'Qté' : 'Qty'}</small>
                {item.total}
              </strong>
            </header>
            <div className="coverage-kit-counts">
              <span>
                <CircleCheck />
                {item.covered} {fr ? 'présent(s)' : 'present'}
              </span>
              <span>
                <PackageCheck />
                {item.toAdd} {fr ? 'à prévoir' : 'to add'}
              </span>
            </div>
            <div className="coverage-card-progress" aria-hidden="true">
              <span style={{ width: `${item.total ? (item.covered / item.total) * 100 : 0}%` }} />
            </div>
            <div className="coverage-locations">
              <h4>
                <MapPin />
                {fr ? 'Où les placer' : 'Where to place them'}
              </h4>
              <ul>
                {item.targets.map((entry, index) => (
                  <li key={`${entry.target.type}:${entry.target.id}:${index}`}>
                    <span className={entry.fulfilled ? 'is-covered' : ''}>
                      {entry.fulfilled ? <Check /> : <Radio />}
                    </span>
                    <div>
                      <strong>{localizedTarget(entry.target, fr)}</strong>
                      <small>
                        {capabilitySummary(entry.capabilities, fr)}
                        {entry.deviceName ? ` · ${entry.deviceName}` : ''}
                      </small>
                    </div>
                    <em className={entry.fulfilled ? 'is-covered' : ''}>
                      {entry.fulfilled
                        ? fr
                          ? 'En place'
                          : 'Installed'
                        : fr
                          ? 'À équiper'
                          : 'To equip'}
                    </em>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
