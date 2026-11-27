import { SENSOR_PRODUCTS } from '@elise/contracts';
import { describe, expect, it } from 'vitest';
import { sensorImage } from './images';
import { lightReading, productTexts, sensorCategoryLabel } from './texts';

describe('lighting texts', () => {
  it('reads a light as on (with its brightness) or off', () => {
    expect(lightReading({ active: false })).toBe('Éteint');
    expect(lightReading({ active: true })).toBe('Allumé');
    expect(lightReading({ active: true, brightnessPercent: 24.6 })).toBe('Allumé · Intensité 25 %');
    expect(lightReading({ state: 'on' })).toBeNull();
    expect(lightReading(null)).toBeNull();
  });

  it('names the lighting category and the Innr strip, with its picture', () => {
    expect(sensorCategoryLabel('light')).toBe('Éclairage');
    const strip = SENSOR_PRODUCTS.find(({ id }) => id === 'innr-flex-light-colour-fl230c');
    expect(strip).toBeDefined();
    expect(productTexts(strip!).name).toBe('Ruban LED Zigbee couleur 3 m');
    expect(sensorImage(strip!.image)).not.toBeNull();
  });
});
