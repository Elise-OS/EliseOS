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
import type { EquipmentCoverage, SensorProduct } from '@elise/contracts';
import { ROOM_SENSOR_CATEGORIES } from '@elise/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { ProductPhoto, SensorProductCard } from './SensorProductCard';
import {
  COVERAGE_FAMILIES,
  COVERAGE_TYPES,
  coverageProducts,
  type CoverageType,
} from './coverage-model';
import './coverage-explorer.css';
import { t, type Locale } from './i18n';
import {
  coverageFamilyLabel,
  coverageTypeDescription,
  coverageTypeLabel,
  productTexts,
  sensorCategoryLabel,
} from './i18n/data';

const familyIcons = [Activity, Wind, DoorOpen, Camera, ShieldAlert, HeartHandshake, Zap];

export function SensorCoverageRecommendations({
  coverage,
  loading,
  error,
  onRetry,
  onBack,
  onContinue,
  onClose,
}: {
  locale: Locale;
  coverage: EquipmentCoverage | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onBack?: () => void;
  onContinue?: () => void;
  onClose?: () => void;
}) {
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
        title={previewProduct.brand + ' · ' + productTexts(previewProduct).name}
        onClose={() => setPreviewProduct(null)}
      >
        <div className="equipment-category-content coverage-product-sheet">
          <div className="equipment-product-detail">
            <ProductPhoto product={previewProduct} />
            <div>
              <span className="equipment-kicker">{previewProduct.brand}</span>
              <h3>{productTexts(previewProduct).name}</h3>
              <p>{previewProduct.model}</p>
              <span className="equipment-product-badge">
                {t('sensorCoverageRecommendations.documentedCompatibility')}
              </span>
            </div>
          </div>
          {!!categoryLabels.length && (
            <div className="equipment-capability-tags">
              {categoryLabels.map((category) => (
                <span key={category!.id}>{sensorCategoryLabel(category!.id)}</span>
              ))}
            </div>
          )}
          <div className="coverage-product-specs">
            <div>
              <small>{t('sensorCoverageRecommendations.power')}</small>
              <strong>{productTexts(previewProduct).power}</strong>
            </div>
            <div>
              <small>{t('sensorCoverageRecommendations.protocol')}</small>
              <strong>{previewProduct.protocol.toUpperCase()}</strong>
            </div>
          </div>
          <h4>{t('sensorCoverageRecommendations.documentedFeatures')}</h4>
          <ul>
            {productTexts(previewProduct).features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <h4>{t('sensorCoverageRecommendations.placementGuidance')}</h4>
          <ul>
            {productTexts(previewProduct).placement.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>{t('sensorCoverageRecommendations.preparation')}</h4>
          <ul>
            {productTexts(previewProduct).preparation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="equipment-product-links">
            <a href={previewProduct.sourceUrl} target="_blank" rel="noreferrer">
              {t('sensorCoverageRecommendations.officialProductPage')} ↗
            </a>
            <a href={previewProduct.manualUrl} target="_blank" rel="noreferrer">
              {t('sensorCoverageRecommendations.manufacturerManual')} ↗
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
          <p>{t('sensorCoverageRecommendations.loadingTheCatalogue')}</p>
        </div>
      ) : error || !coverage ? (
        <div className="coverage-explorer-state" role="alert">
          <p>{error || t('sensorCoverageRecommendations.catalogueUnavailable')}</p>
          <button className="equipment-secondary" onClick={onRetry}>
            <RefreshCw />
            {t('sensorCoverageRecommendations.tryAgain')}
          </button>
        </div>
      ) : (
        <>
          <header className="coverage-explorer-intro">
            <span className="coverage-explorer-eyebrow">
              <Sparkles aria-hidden="true" />
              {t('sensorCoverageRecommendations.compatibilityCatalogue')}
            </span>
            <h2>{t('sensorCoverageRecommendations.sensorsDocumentedByElise')}</h2>
            <p>{t('sensorCoverageRecommendations.chooseAFamilyAndSensor')}</p>
          </header>
          <nav
            className="coverage-family-list"
            aria-label={t('sensorCoverageRecommendations.sensorFamilies')}
          >
            {COVERAGE_FAMILIES.map((family, index) => {
              const Icon = familyIcons[index] ?? Activity;
              const active = family === activeFamily;
              return (
                <button
                  type="button"
                  key={family.id}
                  aria-pressed={active}
                  className={active ? 'is-active' : ''}
                  onClick={() => setChosenType(family.types[0]!)}
                >
                  <span className="coverage-family-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="coverage-family-copy">
                    <strong>{coverageFamilyLabel(family.id)}</strong>
                    <small>
                      {t('sensorCoverageRecommendations.typeCount', { count: family.types.length })}
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
                  {t('sensorCoverageRecommendations.browseByType')}
                </span>
                <strong>{coverageFamilyLabel(activeFamily.id)}</strong>
              </div>
              <nav
                className="coverage-type-list"
                aria-label={t('sensorCoverageRecommendations.sensorTypes')}
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
                      <span>{coverageTypeLabel(item.id)}</span>
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
                    {t('sensorCoverageRecommendations.sensorType')}
                  </span>
                  <h3>{coverageTypeLabel(definition.id)}</h3>
                  <p>{coverageTypeDescription(definition.id)}</p>
                </div>
              </header>
              <div className="coverage-product-heading">
                <h4>{t('sensorCoverageRecommendations.documentedModels')}</h4>
                <span>{products.length}</span>
              </div>
              {!products.length ? (
                <div className="coverage-empty-products">
                  <span className="coverage-empty-icon">
                    <Radio aria-hidden="true" />
                  </span>
                  <strong>
                    {t('sensorCoverageRecommendations.noDocumentedModelCurrentlyAvailable')}
                  </strong>
                  <p>{t('sensorCoverageRecommendations.theTypeRemainsVisibleTo')}</p>
                </div>
              ) : (
                <div className="equipment-product-grid">
                  {products.map((product) => (
                    <article className="coverage-product" key={product.id}>
                      <SensorProductCard
                        product={product}
                        onSelect={() => setPreviewProduct(product)}
                      />
                      <p>{productTexts(product).advice}</p>
                      {product.recommendation?.detectionDistanceM && (
                        <small>
                          {product.recommendation.detectionDistanceM} m ·{' '}
                          {t('sensorCoverageRecommendations.documentedDetectionDistance')}
                        </small>
                      )}
                      <a
                        href={product.recommendation?.sourceUrl ?? product.manualUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('sensorCoverageRecommendations.manufacturerSource')} ↗
                      </a>
                    </article>
                  ))}
                </div>
              )}
              <p className="coverage-explorer-note">
                {t('sensorCoverageRecommendations.aMultifunctionDeviceAppearsUnder')}
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
              {t('sensorCoverageRecommendations.editThePlan')}
            </button>
          )}
          {onContinue && (
            <button className="equipment-primary" onClick={onContinue}>
              {t('sensorCoverageRecommendations.finishSetup')}
              <ArrowRight />
            </button>
          )}
        </footer>
      )}
    </section>
  );

  return onClose ? (
    <EquipmentDialog
      title={t('sensorCoverageRecommendations.whatEliseCovers')}
      wide
      onClose={onClose}
    >
      {content}
    </EquipmentDialog>
  ) : (
    content
  );
}
