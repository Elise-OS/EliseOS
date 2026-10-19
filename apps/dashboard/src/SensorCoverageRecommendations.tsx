import { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Camera,
  DoorOpen,
  HeartHandshake,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wind,
  Zap,
} from 'lucide-react';
import type { EquipmentCoverage, SensorProduct } from '@michel/contracts';
import { ROOM_SENSOR_CATEGORIES } from '@michel/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import {
  COVERAGE_FAMILIES,
  COVERAGE_TYPES,
  coverageProducts,
  type CoverageType,
} from './coverage-model';
import './coverage-explorer.css';

const familyIcons = [Activity, Wind, DoorOpen, Camera, ShieldAlert, HeartHandshake, Zap];

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
  const [chosenType, setChosenType] = useState<CoverageType | null>(null);
  const [previewProduct, setPreviewProduct] = useState<SensorProduct | null>(null);
  const type = chosenType ?? 'presence';
  const definition = COVERAGE_TYPES.find((item) => item.id === type)!;
  const activeFamily = COVERAGE_FAMILIES.find((family) => family.types.includes(type))!;
  const products = coverageProducts(type);

  if (previewProduct) {
    const categoryLabels = previewProduct.categories
      .map((id) => ROOM_SENSOR_CATEGORIES.find((category) => category.id === id))
      .filter(Boolean);
    return (
      <EquipmentDialog
        title={previewProduct.brand + ' · ' + (fr ? previewProduct.name : previewProduct.nameEn)}
        onClose={() => setPreviewProduct(null)}
      >
        <div className="equipment-category-content coverage-product-sheet">
          <div className="equipment-product-detail">
            <ProductPhoto product={previewProduct} />
            <div>
              <span className="equipment-kicker">{previewProduct.brand}</span>
              <h3>{fr ? previewProduct.name : previewProduct.nameEn}</h3>
              <p>{previewProduct.model}</p>
              <span className="equipment-product-badge">
                {fr ? 'Compatibilité documentée' : 'Documented compatibility'}
              </span>
            </div>
          </div>
          {!!categoryLabels.length && (
            <div className="equipment-capability-tags">
              {categoryLabels.map((category) => (
                <span key={category!.id}>{category![fr ? 'label' : 'labelEn']}</span>
              ))}
            </div>
          )}
          <div className="coverage-product-specs">
            <div>
              <small>{fr ? 'Alimentation' : 'Power'}</small>
              <strong>{fr ? previewProduct.power : previewProduct.powerEn}</strong>
            </div>
            <div>
              <small>{fr ? 'Protocole' : 'Protocol'}</small>
              <strong>{previewProduct.protocol.toUpperCase()}</strong>
            </div>
          </div>
          <h4>{fr ? 'Fonctions documentées' : 'Documented features'}</h4>
          <ul>
            {(fr ? previewProduct.features : previewProduct.featuresEn).map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <h4>{fr ? 'Conseils de placement' : 'Placement guidance'}</h4>
          <ul>
            {(fr ? previewProduct.placement : previewProduct.placementEn).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>{fr ? 'Préparation' : 'Preparation'}</h4>
          <ul>
            {(fr ? previewProduct.preparation : previewProduct.preparationEn).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="equipment-product-links">
            <a href={previewProduct.sourceUrl} target="_blank" rel="noreferrer">
              {fr ? 'Page officielle du produit' : 'Official product page'} ↗
            </a>
            <a href={previewProduct.manualUrl} target="_blank" rel="noreferrer">
              {fr ? 'Notice fabricant' : 'Manufacturer manual'} ↗
            </a>
          </div>
        </div>
      </EquipmentDialog>
    );
  }

  const content = (
    <section className="coverage-explorer">
      {loading ? (
        <div className="coverage-explorer-state" role="status">
          <Sparkles />
          <p>{fr ? 'Chargement du catalogue…' : 'Loading the catalogue…'}</p>
        </div>
      ) : error || !coverage ? (
        <div className="coverage-explorer-state" role="alert">
          <p>{error || (fr ? 'Catalogue indisponible.' : 'Catalogue unavailable.')}</p>
          <button className="equipment-secondary" onClick={onRetry}>
            <RefreshCw />
            {fr ? 'Réessayer' : 'Try again'}
          </button>
        </div>
      ) : (
        <>
          <header className="coverage-explorer-intro">
            <span className="coverage-explorer-eyebrow">
              <Sparkles aria-hidden="true" />
              {fr ? 'Catalogue de compatibilité' : 'Compatibility catalogue'}
            </span>
            <h2>{fr ? 'Les capteurs documentés par Élise' : 'Sensors documented by Élise'}</h2>
            <p>
              {fr
                ? 'Choisissez une famille puis un type de capteur pour consulter les modèles compatibles.'
                : 'Choose a family and sensor type to browse compatible models.'}
            </p>
          </header>
          <nav
            className="coverage-family-list"
            aria-label={fr ? 'Familles de capteurs' : 'Sensor families'}
          >
            {COVERAGE_FAMILIES.map((family, index) => {
              const Icon = familyIcons[index] ?? Activity;
              const active = family === activeFamily;
              return (
                <button
                  type="button"
                  key={family.labelEn}
                  aria-pressed={active}
                  className={active ? 'is-active' : ''}
                  onClick={() => setChosenType(family.types[0]!)}
                >
                  <span className="coverage-family-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="coverage-family-copy">
                    <strong>{fr ? family.label : family.labelEn}</strong>
                    <small>
                      {family.types.length} {family.types.length === 1 ? 'type' : 'types'}
                    </small>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="coverage-catalog-layout">
            <aside className="coverage-type-picker">
              <div className="coverage-type-picker-heading">
                <span className="coverage-section-eyebrow">
                  {fr ? 'Explorer par type' : 'Browse by type'}
                </span>
                <strong>{fr ? activeFamily.label : activeFamily.labelEn}</strong>
              </div>
              <nav
                className="coverage-type-list"
                aria-label={fr ? 'Types de capteurs' : 'Sensor types'}
              >
                {COVERAGE_TYPES.filter((item) => activeFamily.types.includes(item.id)).map(
                  (item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={type === item.id}
                      className={type === item.id ? 'is-active' : ''}
                      onClick={() => setChosenType(item.id)}
                    >
                      <span>{item[fr ? 'label' : 'labelEn']}</span>
                      <ArrowRight aria-hidden="true" />
                    </button>
                  ),
                )}
              </nav>
            </aside>
            <div className="coverage-type-detail">
              <header className="coverage-detail-heading">
                <div>
                  <span className="coverage-section-eyebrow">
                    {fr ? 'Type de capteur' : 'Sensor type'}
                  </span>
                  <h3>{definition[fr ? 'label' : 'labelEn']}</h3>
                  <p>{definition[fr ? 'description' : 'descriptionEn']}</p>
                </div>
              </header>
              <div className="coverage-product-heading">
                <h4>{fr ? 'Modèles documentés' : 'Documented models'}</h4>
                <span>{products.length}</span>
              </div>
              {!products.length ? (
                <div className="coverage-empty-products">
                  <span className="coverage-empty-icon">
                    <Radio aria-hidden="true" />
                  </span>
                  <strong>
                    {fr
                      ? 'Aucun modèle documenté actuellement'
                      : 'No documented model currently available'}
                  </strong>
                  <p>
                    {fr
                      ? 'Le type reste visible pour présenter tout ce qu’Élise peut couvrir.'
                      : 'The type remains visible to show everything Élise can cover.'}
                  </p>
                </div>
              ) : (
                <div className="equipment-product-grid">
                  {products.map((product) => (
                    <article className="coverage-product" key={product.id}>
                      <SensorProductCard
                        product={product}
                        fr={fr}
                        onSelect={() => setPreviewProduct(product)}
                      />
                      <p>
                        {fr ? product.recommendation?.advice : product.recommendation?.adviceEn}
                      </p>
                      {product.recommendation?.detectionDistanceM && (
                        <small>
                          {product.recommendation.detectionDistanceM} m ·{' '}
                          {fr
                            ? 'distance de détection documentée'
                            : 'documented detection distance'}
                        </small>
                      )}
                      <a
                        href={product.recommendation?.sourceUrl ?? product.manualUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {fr ? 'Source fabricant' : 'Manufacturer source'} ↗
                      </a>
                    </article>
                  ))}
                </div>
              )}
              <p className="coverage-explorer-note">
                {fr
                  ? 'Un appareil multifonction apparaît dans chaque type qu’il documente, mais il reste un seul produit.'
                  : 'A multifunction device appears under every documented type, but remains a single product.'}
              </p>
            </div>
          </div>
        </>
      )}
      {!loading && !error && coverage && (onBack || onContinue) && (
        <footer className="coverage-explorer-footer">
          {onBack && (
            <button className="equipment-secondary" onClick={onBack}>
              <ArrowLeft />
              {fr ? 'Modifier le plan' : 'Edit the plan'}
            </button>
          )}
          {onContinue && (
            <button className="equipment-primary" onClick={onContinue}>
              {fr ? 'Terminer la création' : 'Finish setup'}
              <ArrowRight />
            </button>
          )}
        </footer>
      )}
    </section>
  );

  return onClose ? (
    <EquipmentDialog title={fr ? 'Ce qu’Élise couvre' : 'What Élise covers'} wide onClose={onClose}>
      {content}
    </EquipmentDialog>
  ) : (
    content
  );
}
