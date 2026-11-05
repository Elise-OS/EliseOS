const { Bonjour } = require('bonjour-service');

const discoveryUrl = process.env.ELISE_DISCOVERY_URL || 'http://127.0.0.1:8080/api/v1/discovery';
const port = Number(process.env.ELISE_DISCOVERY_PORT || 8080);
const host = String(process.env.ELISE_DISCOVERY_HOST || '').trim();
const refreshMs = 15000;

let bonjour;
let service;
let signature = '';

const stopPublication = () => {
  if (service?.published) service.stop();
  service = undefined;
  if (bonjour) bonjour.destroy();
  bonjour = undefined;
};

const readInfo = async () => {
  const response = await fetch(discoveryUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.instanceId || !data?.instanceName || data?.supportsMobile !== true) {
    throw new Error('Invalid Élise discovery payload');
  }
  return data;
};

const publish = (info) => {
  // serverTime changes on every read: republishing for it would send a goodbye every refresh.
  const nextSignature = JSON.stringify([
    info.instanceId,
    info.instanceName,
    info.version,
    info.apiVersion,
    Boolean(info.setupRequired),
  ]);
  if (nextSignature === signature && service?.published) return;
  signature = nextSignature;
  stopPublication();

  const suffix = String(info.instanceId)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8);
  const serviceName = suffix ? `${info.instanceName} (${suffix})` : info.instanceName;
  bonjour = new Bonjour(undefined, (error) => console.warn(`Élise mDNS: ${error.message}`));
  service = bonjour.publish({
    name: serviceName,
    type: 'elise',
    protocol: 'tcp',
    port,
    host: host || undefined,
    probe: false,
    txt: {
      instanceId: String(info.instanceId),
      instanceName: String(info.instanceName),
      version: String(info.version || ''),
      apiVersion: String(info.apiVersion || 1),
      setupRequired: String(Boolean(info.setupRequired)),
      https: 'false',
      ...(host ? { host } : {}),
      port: String(port),
    },
  });
  service.on('up', () =>
    console.log(`${serviceName}._elise._tcp.local -> ${host || 'host'}:${port}`),
  );
  service.on('error', (error) => console.warn(`Élise mDNS publish failed: ${error.message}`));
};

const refresh = async () => {
  try {
    publish(await readInfo());
  } catch (error) {
    console.warn(`Waiting for Élise at ${discoveryUrl}: ${error.message}`);
  }
};

process.on('SIGTERM', () => {
  stopPublication();
  process.exit(0);
});
process.on('SIGINT', () => {
  stopPublication();
  process.exit(0);
});

void refresh();
setInterval(() => void refresh(), refreshMs);
