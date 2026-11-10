import { describe, expect, it } from 'vitest';
import { SENSOR_PRODUCTS } from '../sensor-products';
import { productTexts } from './data';
import en from './locales/en.json';
import fr from './locales/fr.json';
import { inLanguage } from './test-language';

// The sensor texts shown come from the catalogs; they must match sensor-products.ts.
describe('Sensor product texts', () => {
  const catalog = (language: typeof fr | typeof en, id: string) =>
    (language.sensorProducts as Record<string, Record<string, unknown>>)[id];

  it.each(SENSOR_PRODUCTS.map((product) => [product.id, product] as const))(
    '%s reads the same in the catalogs and in the product list',
    (id, product) => {
      expect(catalog(fr, id)).toMatchObject({
        name: product.name,
        power: product.power,
        features: product.features,
        preparation: product.preparation,
        placement: product.placement,
      });
      expect(catalog(en, id)).toMatchObject({
        name: product.nameEn,
        power: product.powerEn,
        features: product.featuresEn,
        preparation: product.preparationEn,
        placement: product.placementEn,
      });
      expect(inLanguage('en', () => productTexts(product).advice)).toBe(
        product.recommendation?.adviceEn,
      );
    },
  );
});
