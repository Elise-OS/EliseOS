import { ArrowLeft, ChevronRight, Radio } from 'lucide-react';
import { useState } from 'react';
import { type SensorProduct } from '@elise/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { SENSOR_PRODUCTS } from './sensor-products';
import { type Locale, t } from './i18n';
import { productTexts, sensorCategoryLabel } from './i18n/data';

function ProductPhoto({ product }: { product: SensorProduct }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="equipment-product-image-fallback">
      <Radio />
      <span>{product.model}</span>
    </div>
  ) : (
    <img
      src={product.image}
      alt={`${product.brand} ${product.name}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

const familyLabel = (product: SensorProduct) =>
  product.kind === 'SMART_PLUG'
    ? t('hardwareCatalogDialog.smartPlug')
    : product.kind === 'ENERGY_MONITOR'
      ? t('hardwareCatalogDialog.energyMonitoring')
      : t('hardwareCatalogDialog.roomSensor');

export function HardwareCatalogDialog({
  open,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SensorProduct | null>(null);
  if (!open) return null;
  const close = () => {
    setSelected(null);
    onClose();
  };
  return (
    <EquipmentDialog wide title={t('hardwareCatalogDialog.testHardware')} onClose={close}>
      <div className="equipment-category-content">
        {selected ? (
          <>
            <button className="equipment-text-button" onClick={() => setSelected(null)}>
              <ArrowLeft />
              {t('hardwareCatalogDialog.allHardware')}
            </button>
            <div className="equipment-product-detail">
              <ProductPhoto product={selected} />
              <div>
                <span className="equipment-kicker">
                  {selected.brand} · {familyLabel(selected)}
                </span>
                <h3>{productTexts(selected).name}</h3>
                <p>{selected.model}</p>
                <span className="equipment-product-badge">
                  {selected.eliseValidated
                    ? t('hardwareCatalogDialog.validatedWithElise')
                    : t('hardwareCatalogDialog.documentedEliseTestPending')}
                </span>
              </div>
            </div>
            {!!selected.categories.length && (
              <div className="equipment-capability-tags">
                {selected.categories.map((id) => (
                  <span key={id}>{sensorCategoryLabel(id)}</span>
                ))}
              </div>
            )}
            <h4>{t('hardwareCatalogDialog.documentedFeatures')}</h4>
            <ul>
              {productTexts(selected).features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <dl className="equipment-product-specs">
              <div>
                <dt>{t('hardwareCatalogDialog.power')}</dt>
                <dd>{productTexts(selected).power}</dd>
              </div>
              <div>
                <dt>{t('hardwareCatalogDialog.connection')}</dt>
                <dd>Zigbee 3.0</dd>
              </div>
            </dl>
            <h4>{t('hardwareCatalogDialog.prepareConnection')}</h4>
            <ol className="equipment-guide-steps">
              {productTexts(selected).preparation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <h4>{t('hardwareCatalogDialog.placementTips')}</h4>
            <ul>
              {productTexts(selected).placement.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <div className="equipment-product-links">
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                {t('hardwareCatalogDialog.officialProductPage')} ↗
              </a>
              <a href={selected.manualUrl} target="_blank" rel="noreferrer">
                {t('hardwareCatalogDialog.manufacturerManual')} ↗
              </a>
              <a href={selected.integrationUrl} target="_blank" rel="noreferrer">
                {t('hardwareCatalogDialog.functionsRecognizedByIntegration')} ↗
              </a>
            </div>
            <small className="equipment-muted">
              {t('hardwareCatalogDialog.documentationCheckedOn')} {selected.verifiedAt}
            </small>
          </>
        ) : (
          <>
            <p className="equipment-note">{t('hardwareCatalogDialog.thisListExactlyMatchesThe')}</p>
            <div className="equipment-product-grid equipment-hardware-grid">
              {SENSOR_PRODUCTS.map((product) => (
                <button
                  className="equipment-product-card"
                  key={product.id}
                  onClick={() => setSelected(product)}
                >
                  <ProductPhoto product={product} />
                  <span className="equipment-kicker">
                    {product.brand} · {familyLabel(product)}
                  </span>
                  <strong>{productTexts(product).name}</strong>
                  <small>{product.model}</small>
                  <span>
                    {t('hardwareCatalogDialog.viewDetails')}
                    <ChevronRight />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </EquipmentDialog>
  );
}
