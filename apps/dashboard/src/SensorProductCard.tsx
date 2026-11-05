import { useState } from 'react';
import { ChevronRight, Radio } from 'lucide-react';
import { type SensorProduct } from '@elise/contracts';
import { t } from './i18n';
import { productTexts, sensorCategoryLabel } from './i18n/data';

export function ProductPhoto({ product }: { product: SensorProduct }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="equipment-product-image-fallback">
      <Radio />
      <span>{product.model}</span>
    </div>
  ) : (
    <img
      src={product.image}
      alt={product.brand + ' ' + product.name}
      width={512}
      height={512}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function SensorProductCard({
  product,
  onSelect,
}: {
  product: SensorProduct;
  onSelect: () => void;
}) {
  return (
    <button className="equipment-product-card" onClick={onSelect}>
      <ProductPhoto product={product} />
      <span className="equipment-kicker">{product.brand}</span>
      <strong>{productTexts(product).name}</strong>
      <small>
        {product.categories.length
          ? product.categories.map((id) => sensorCategoryLabel(id)).join(' · ')
          : t('sensorProductCard.powerEnergy')}
      </small>
      <span>
        {t('sensorProductCard.viewProduct')}
        <ChevronRight />
      </span>
    </button>
  );
}
