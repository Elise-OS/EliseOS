import type {
  AppointmentPictogram,
  ContactRole,
  LiaisonMoodId,
  RoomSensorCategory,
  SensorProduct,
} from '@elise/contracts';
import type { CoverageFamily, CoverageType } from '../coverage-model';
import { t, textBlock } from '.';

// Labels of shared data (@elise/contracts keeps French and English for the server): the
// catalogs hold them by id so that every language of the dashboard can translate them.

export const sensorCategoryLabel = (id: RoomSensorCategory) => t(`sensorCategories.${id}.label`);
export const sensorCategoryDescription = (id: RoomSensorCategory) =>
  t(`sensorCategories.${id}.description`);
// A bed contact has no entry of its own in CONTACT_TYPES: it reads as the bed category.
export const contactTypeLabel = (id: ContactRole) =>
  id === 'BED' ? t('sensorCategories.bed.label') : t(`contactTypes.${id}`);
export const appointmentPictogramLabel = (value: AppointmentPictogram) =>
  t(`appointmentPictograms.${value}`);
export const moodLabel = (id: LiaisonMoodId) => t(`moods.${id}`);
export const coverageFamilyLabel = (id: CoverageFamily) => t(`coverageFamilies.${id}`);
export const coverageTypeLabel = (id: CoverageType) =>
  id === 'energy' ? t('coverageTypes.energy.label') : sensorCategoryLabel(id);
export const coverageTypeDescription = (id: CoverageType) =>
  id === 'energy' ? t('coverageTypes.energy.description') : sensorCategoryDescription(id);

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
    // A product without catalog entry (added on the server) keeps its own French texts.
    return own;
  }
}
