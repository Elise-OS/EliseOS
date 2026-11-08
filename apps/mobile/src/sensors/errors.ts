import type { SensorErrorCode } from '@elise/contracts';
import { t } from '../i18n';
import type { PairingError } from './pairing';

const codeTexts: Record<SensorErrorCode, () => string> = {
  NO_PAIRING_MODULE: () => t('sensorSetup.errors.noPairingModule'),
  ADMIN_REQUIRED: () => t('sensorSetup.errors.adminRequired'),
  ACCESS_DENIED: () => t('sensorSetup.errors.accessDenied'),
  NO_SENSOR_TO_INSTALL: () => t('sensorSetup.errors.noSensorToInstall'),
  ALREADY_COMPLETED: () => t('sensorSetup.errors.alreadyCompleted'),
};

/** Plain-language text of an error of the sensor flow, in the language of the app. */
export function pairingErrorText(error: PairingError): string {
  switch (error.kind) {
    case 'CODE':
      return codeTexts[error.code]();
    case 'TIMEOUT':
      return t('sensorSetup.eliseDidNotAnswer');
    case 'UNREACHABLE':
      return t('sensorSetup.eliseUnreachable');
    case 'GENERIC':
      return t('sensorSetup.errors.generic');
  }
}
