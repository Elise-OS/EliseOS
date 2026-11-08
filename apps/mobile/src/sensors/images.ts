import type { ImageSourcePropType } from 'react-native';
import image3RDS17BZ from '../../assets/sensor-products/3RDS17BZ.png';
import image3RMS16BZ from '../../assets/sensor-products/3RMS16BZ.png';
import image3RPL01084Z from '../../assets/sensor-products/3RPL01084Z.png';
import image3RSB22BZ from '../../assets/sensor-products/3RSB22BZ.png';
import image3RSPE01044BZ from '../../assets/sensor-products/3RSPE01044BZ.png';
import image3RTHS0224Z from '../../assets/sensor-products/3RTHS0224Z.png';
import image3RWS18BZ from '../../assets/sensor-products/3RWS18BZ.png';
import imageHS1SAE from '../../assets/sensor-products/HS1SA-E.png';
import imageHS2FDE from '../../assets/sensor-products/HS2FD-E.png';
import imageSDC4100 from '../../assets/sensor-products/SDC-4-1-00.png';
import imageSDO4100 from '../../assets/sensor-products/SDO-4-1-00.png';
import imageSEM4100 from '../../assets/sensor-products/SEM-4-1-00.png';
import imageSNZB02P from '../../assets/sensor-products/SNZB-02P.png';
import imageSTPH4100 from '../../assets/sensor-products/STPH-4-1-00.png';
import imageTuyaBedPressure from '../../assets/sensor-products/TS0601_bed_presence_sensor.png';

/** The pictures bundled with the app, by file name (the catalogue lists `/sensor-products/<file>.png`). */
const bundled: Record<string, ImageSourcePropType> = {
  '3RDS17BZ': image3RDS17BZ,
  '3RMS16BZ': image3RMS16BZ,
  '3RPL01084Z': image3RPL01084Z,
  '3RSB22BZ': image3RSB22BZ,
  '3RSPE01044BZ': image3RSPE01044BZ,
  '3RTHS0224Z': image3RTHS0224Z,
  '3RWS18BZ': image3RWS18BZ,
  'HS1SA-E': imageHS1SAE,
  'HS2FD-E': imageHS2FDE,
  'SDC-4-1-00': imageSDC4100,
  'SDO-4-1-00': imageSDO4100,
  'SEM-4-1-00': imageSEM4100,
  'SNZB-02P': imageSNZB02P,
  'STPH-4-1-00': imageSTPH4100,
  TS0601_bed_presence_sensor: imageTuyaBedPressure,
};

/** Picture for a catalogue path such as `/sensor-products/3RDS17BZ.png`, or null. */
export function sensorImage(path: string | null | undefined): ImageSourcePropType | null {
  const name = path?.match(/([^/]+)\.png$/)?.[1];
  return (name && bundled[name]) || null;
}
