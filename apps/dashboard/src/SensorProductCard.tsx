import { useState } from 'react';
import { ChevronRight, Radio } from 'lucide-react';
import { ROOM_SENSOR_CATEGORIES, type SensorProduct } from '@michel/contracts';

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
  fr,
  onSelect,
}: {
  product: SensorProduct;
  fr: boolean;
  onSelect: () => void;
}) {
  return (
    <button className="equipment-product-card" onClick={onSelect}>
      <ProductPhoto product={product} />
      <span className="equipment-kicker">{product.brand}</span>
      <strong>{fr ? product.name : product.nameEn}</strong>
      <small>
        {product.testQuantity}{' '}
        {fr
          ? `${product.testQuantity > 1 ? 'disponibles' : 'disponible'} pour les tests`
          : 'available for testing'}
      </small>
      <small>
        {product.categories.length
          ? product.categories
              .map(
                (id) => ROOM_SENSOR_CATEGORIES.find((c) => c.id === id)?.[fr ? 'label' : 'labelEn'],
              )
              .join(' · ')
          : fr
            ? 'Puissance · Énergie'
            : 'Power · Energy'}
      </small>
      <span>
        {fr ? 'Voir le produit' : 'View product'}
        <ChevronRight />
      </span>
    </button>
  );
}
