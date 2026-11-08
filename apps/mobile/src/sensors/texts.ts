import type { ContactRole, RoomSensorCategory, SensorProduct } from '@elise/contracts';
import { t, textBlock } from '../i18n';

export const sensorCategoryLabel = (id: RoomSensorCategory) => t(`sensorCategories.${id}.label`);
export const sensorCategoryDescription = (id: RoomSensorCategory) =>
  t(`sensorCategories.${id}.description`);
// A bed contact has no entry of its own in CONTACT_TYPES: it reads as the bed category.
export const contactTypeLabel = (id: ContactRole) =>
  id === 'BED' ? t('sensorCategories.bed.label') : t(`contactTypes.${id}`);

export interface ProductTexts {
  name: string;
  power: string;
  features: string[];
  preparation: string[];
  placement: string[];
  advice?: string | undefined;
}

// Product ids are plain strings, so their texts are read without key checking.
const readBlock = textBlock as unknown as (path: string) => Partial<ProductTexts>;

/** Name, power, features, preparation, placement and advice of a sensor in the current language. */
export function productTexts(product: SensorProduct): ProductTexts {
  const own = {
    name: product.name,
    power: product.power,
    features: product.features,
    preparation: product.preparation,
    placement: product.placement,
    advice: product.recommendation?.advice,
  };
  try {
    return { ...own, ...readBlock(`sensorProducts.${product.id}`) };
  } catch {
    // A product without catalog entry keeps its own French texts.
    return own;
  }
}
