import { loadAllLanguages } from './i18n';

// The app downloads one language at a time; tests switch language synchronously.
await loadAllLanguages();
