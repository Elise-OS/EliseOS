import { ArrowLeft, ChevronRight, Radio } from 'lucide-react';
import { useState } from 'react';
import { ROOM_SENSOR_CATEGORIES, type SensorProduct } from '@michel/contracts';
import { EquipmentDialog } from './EquipmentDialog';
import { SENSOR_PRODUCTS, TEST_HARDWARE_COUNT } from './sensor-products';
import type { Locale } from './i18n';

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

const familyLabel = (product: SensorProduct, fr: boolean) =>
  product.kind === 'SMART_PLUG'
    ? fr
      ? 'Prise connectée'
      : 'Smart plug'
    : product.kind === 'ENERGY_MONITOR'
      ? fr
        ? 'Mesure d’énergie'
        : 'Energy monitoring'
      : fr
        ? 'Capteur de pièce'
        : 'Room sensor';

export function HardwareCatalogDialog({
  open,
  locale,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SensorProduct | null>(null);
  const fr = locale === 'fr';
  if (!open) return null;
  const close = () => {
    setSelected(null);
    onClose();
  };
  return (
    <EquipmentDialog
      wide
      title={
        fr
          ? `Matériel de test · ${TEST_HARDWARE_COUNT} appareils`
          : `Test hardware · ${TEST_HARDWARE_COUNT} devices`
      }
      onClose={close}
    >
      <div className="equipment-category-content">
        {selected ? (
          <>
            <button className="equipment-text-button" onClick={() => setSelected(null)}>
              <ArrowLeft />
              {fr ? 'Tout le matériel' : 'All hardware'}
            </button>
            <div className="equipment-product-detail">
              <ProductPhoto product={selected} />
              <div>
                <span className="equipment-kicker">
                  {selected.brand} · {familyLabel(selected, fr)}
                </span>
                <h3>{fr ? selected.name : selected.nameEn}</h3>
                <p>{selected.model}</p>
                <span className="equipment-product-badge">
                  {selected.eliseValidated
                    ? fr
                      ? 'Validé avec Élise'
                      : 'Validated with Élise'
                    : fr
                      ? 'Documenté · test Élise à faire'
                      : 'Documented · Élise test pending'}
                </span>
                <p className="equipment-muted">
                  {fr
                    ? `${selected.testQuantity} exemplaire${selected.testQuantity > 1 ? 's' : ''} dans le matériel de test.`
                    : `${selected.testQuantity} unit${selected.testQuantity > 1 ? 's' : ''} in the test inventory.`}
                </p>
              </div>
            </div>
            {!!selected.categories.length && (
              <div className="equipment-capability-tags">
                {selected.categories.map((id) => (
                  <span key={id}>
                    {
                      ROOM_SENSOR_CATEGORIES.find((category) => category.id === id)?.[
                        fr ? 'label' : 'labelEn'
                      ]
                    }
                  </span>
                ))}
              </div>
            )}
            <h4>{fr ? 'Fonctions documentées' : 'Documented features'}</h4>
            <ul>
              {(fr ? selected.features : selected.featuresEn).map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <dl className="equipment-product-specs">
              <div>
                <dt>{fr ? 'Alimentation' : 'Power'}</dt>
                <dd>{fr ? selected.power : selected.powerEn}</dd>
              </div>
              <div>
                <dt>{fr ? 'Connexion' : 'Connection'}</dt>
                <dd>Zigbee 3.0</dd>
              </div>
            </dl>
            <h4>{fr ? 'Préparer la connexion' : 'Prepare connection'}</h4>
            <ol className="equipment-guide-steps">
              {(fr ? selected.preparation : selected.preparationEn).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <h4>{fr ? 'Conseils de placement' : 'Placement tips'}</h4>
            <ul>
              {(fr ? selected.placement : selected.placementEn).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <div className="equipment-product-links">
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                {fr ? 'Page officielle du produit' : 'Official product page'} ↗
              </a>
              <a href={selected.manualUrl} target="_blank" rel="noreferrer">
                {fr ? 'Notice fabricant' : 'Manufacturer manual'} ↗
              </a>
              <a href={selected.integrationUrl} target="_blank" rel="noreferrer">
                {fr
                  ? 'Fonctions reconnues par l’intégration'
                  : 'Functions recognized by integration'}{' '}
                ↗
              </a>
            </div>
            <small className="equipment-muted">
              {fr ? 'Documentation vérifiée le' : 'Documentation checked on'} {selected.verifiedAt}
            </small>
          </>
        ) : (
          <>
            <p className="equipment-note">
              {fr
                ? 'Cette liste correspond exactement aux références disponibles pour les essais. Une compatibilité documentée ne sera marquée « validée avec Élise » qu’après un test physique complet.'
                : 'This list exactly matches the hardware available for testing. Documented compatibility is only marked as validated with Élise after a full physical test.'}
            </p>
            <div className="equipment-product-grid equipment-hardware-grid">
              {SENSOR_PRODUCTS.map((product) => (
                <button
                  className="equipment-product-card"
                  key={product.id}
                  onClick={() => setSelected(product)}
                >
                  <ProductPhoto product={product} />
                  <span className="equipment-kicker">
                    {product.brand} · {familyLabel(product, fr)}
                  </span>
                  <strong>{fr ? product.name : product.nameEn}</strong>
                  <small>
                    {product.model} · {product.testQuantity} {fr ? 'disponible' : 'available'}
                    {product.testQuantity > 1 ? 's' : ''}
                  </small>
                  <span>
                    {fr ? 'Voir la fiche' : 'View details'}
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
