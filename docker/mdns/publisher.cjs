const { Bonjour } = require('bonjour-service');

const discoveryUrl = process.env.MICHEL_DISCOVERY_URL || 'http://127.0.0.1:8080/api/v1/discovery';
const port = Number(process.env.MICHEL_DISCOVERY_PORT || 8080);
const host = String(process.env.MICHEL_DISCOVERY_HOST || '').trim();
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
    throw new Error('Invalid Michel discovery payload');
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
  bonjour = new Bonjour(undefined, (error) => console.warn(`Michel mDNS: ${error.message}`));
  service = bonjour.publish({
    name: serviceName,
    type: 'michel',
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
    console.log(`${serviceName}._michel._tcp.local -> ${host || 'host'}:${port}`),
  );
  service.on('error', (error) => console.warn(`Michel mDNS publish failed: ${error.message}`));
};

const refresh = async () => {
  try {
    publish(await readInfo());
  } catch (error) {
    console.warn(`Waiting for Michel at ${discoveryUrl}: ${error.message}`);
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
