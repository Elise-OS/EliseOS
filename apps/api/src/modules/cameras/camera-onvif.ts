import { createHash, randomBytes } from 'node:crypto';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';

type SoapCredentials = { username: string; password: string };
type OnvifResult = { streamUris: string[]; manufacturer?: string; model?: string };

const SOAP_NS = 'http://www.w3.org/2003/05/soap-envelope';
const DEVICE_NS = 'http://www.onvif.org/ver10/device/wsdl';
const MEDIA_NS = 'http://www.onvif.org/ver10/media/wsdl';
const MEDIA_ENDPOINT_PATH = '/onvif/media_service';

function childElements(parent: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1) result.push(child as XmlElement);
  }
  return result;
}

function elementName(element: XmlElement): string {
  return element.localName || element.nodeName.split(':').at(-1) || '';
}

function descendants(parent: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (const child of childElements(parent)) {
    if (elementName(child).toLowerCase() === name.toLowerCase()) result.push(child);
    result.push(...descendants(child, name));
  }
  return result;
}

function xmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function parseXml(value: string): XmlElement {
  if (value.length > 256_000 || /<!DOCTYPE|<!ENTITY/i.test(value)) {
    throw new Error('Invalid ONVIF response.');
  }
  const document = new DOMParser().parseFromString(value, 'application/xml');
  const root = document.documentElement;
  if (!root || elementName(root).toLowerCase() === 'parsererror') {
    throw new Error('Invalid ONVIF response.');
  }
  const fault = descendants(root, 'Fault')[0];
  if (fault) {
    const message = descendants(fault, 'Text')[0]?.textContent?.trim();
    throw new Error(message || 'ONVIF request failed.');
  }
  return root;
}

function wsSecurityHeader(credentials: SoapCredentials): string {
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(credentials.password)]))
    .digest('base64');
  return `<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${xmlText(credentials.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
}

function soapEnvelope(body: string, credentials?: SoapCredentials): string {
  const header = credentials ? wsSecurityHeader(credentials) : '<s:Header/>';
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP_NS}" xmlns:tds="${DEVICE_NS}" xmlns:trt="${MEDIA_NS}" xmlns:tt="http://www.onvif.org/ver10/schema">${header}<s:Body>${body}</s:Body></s:Envelope>`;
}

function parseDigestChallenge(header: string): Record<string, string> | null {
  if (!/^Digest\s/i.test(header)) return null;
  const values: Record<string, string> = {};
  for (const match of header
    .slice(header.indexOf(' ') + 1)
    .matchAll(/([a-z]+)=("(?:[^"\\]|\\.)*"|[^,\s]+)/gi)) {
    values[match[1]!.toLowerCase()] = match[2]!.replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1');
  }
  return values.realm && values.nonce ? values : null;
}

function digestAuthorization(
  challenge: Record<string, string>,
  credentials: SoapCredentials,
  method: string,
  requestPath: string,
): string | null {
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
  const hashName = algorithm.startsWith('SHA-256')
    ? 'sha256'
    : algorithm.startsWith('MD5')
      ? 'md5'
      : null;
  if (!hashName) return null;
  const hash = (value: string) => createHash(hashName).update(value).digest('hex');
  const cnonce = randomBytes(12).toString('hex');
  const nonceCount = '00000001';
  let ha1 = hash(`${credentials.username}:${challenge.realm}:${credentials.password}`);
  if (algorithm.endsWith('-SESS')) ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = hash(`${method}:${requestPath}`);
  const qopValues = (challenge.qop || '').split(',').map((value) => value.trim().toLowerCase());
  const qop = qopValues.includes('auth') ? 'auth' : '';
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);
  const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const fields = [
    `username=${quote(credentials.username)}`,
    `realm=${quote(challenge.realm!)}`,
    `nonce=${quote(challenge.nonce!)}`,
    `uri=${quote(requestPath)}`,
    `response=${quote(response)}`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) fields.push(`opaque=${quote(challenge.opaque)}`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nonceCount}`, `cnonce=${quote(cnonce)}`);
  return `Digest ${fields.join(', ')}`;
}

async function postSoap(
  endpoint: URL,
  action: string,
  body: string,
  credentials: SoapCredentials,
): Promise<XmlElement> {
  const payload = soapEnvelope(body);
  const actionUri = `${action}`;
  const headers = {
    'content-type': `application/soap+xml; charset=utf-8; action="${actionUri}"`,
    soapaction: `"${actionUri}"`,
  };
  const request = (extraHeaders: Record<string, string> = {}) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, ...extraHeaders },
      body: payload,
      signal: AbortSignal.timeout(5_000),
    });

  let response = await request();
  let responseText = await response.text();
  if (response.status === 401) {
    const challenge = parseDigestChallenge(response.headers.get('www-authenticate') || '');
    const authorization = challenge
      ? digestAuthorization(
          challenge,
          credentials,
          'POST',
          `${endpoint.pathname}${endpoint.search}`,
        )
      : null;
    if (authorization) {
      response = await request({ authorization });
      responseText = await response.text();
      if (response.ok) {
        try {
          return parseXml(responseText);
        } catch {
          // Some cameras require WS-Security even after an HTTP Digest challenge.
        }
      }
    }
  } else if (response.ok) {
    try {
      return parseXml(responseText);
    } catch {
      // Retry once using the ONVIF WS-Security UsernameToken profile.
    }
  }

  response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: soapEnvelope(body, credentials),
    signal: AbortSignal.timeout(5_000),
  });
  responseText = await response.text();
  if (!response.ok) throw new Error(`ONVIF HTTP ${response.status}.`);
  return parseXml(responseText);
}

function endpointFromAdvertisedAddress(value: string, address: string): URL | null {
  try {
    const advertised = new URL(value);
    if (!['http:', 'https:'].includes(advertised.protocol) || advertised.hostname !== address)
      return null;
    advertised.username = '';
    advertised.password = '';
    advertised.hash = '';
    return advertised;
  } catch {
    return null;
  }
}

function readProfileTokens(xml: XmlElement): Array<{ token: string; name: string }> {
  return descendants(xml, 'Profiles')
    .map((profile) => {
      const token = profile.getAttribute('token') || '';
      const name = descendants(profile, 'Name')[0]?.textContent?.trim() || '';
      return { token, name };
    })
    .filter((profile) => profile.token)
    .sort((left, right) => {
      const score = (name: string) => (/main|high|primary|principal/i.test(name) ? 0 : 1);
      return score(left.name) - score(right.name);
    });
}

function getAdvertisedMediaEndpoint(xml: XmlElement, address: string): URL | null {
  const mediaCapabilities = descendants(xml, 'Media');
  for (const capability of mediaCapabilities) {
    for (const xaddr of descendants(capability, 'XAddr')) {
      const endpoint = endpointFromAdvertisedAddress(xaddr.textContent?.trim() || '', address);
      if (endpoint) return endpoint;
    }
  }
  return null;
}

function deviceText(xml: XmlElement, field: string): string | undefined {
  return descendants(xml, field)[0]?.textContent?.trim().slice(0, 80) || undefined;
}

export async function discoverOnvifStreams(
  address: string,
  username: string,
  password: string,
): Promise<OnvifResult> {
  const credentials = { username, password };
  const deviceEndpoint = new URL(`http://${address}/onvif/device_service`);
  try {
    let manufacturer: string | undefined;
    let model: string | undefined;
    try {
      const info = await postSoap(
        deviceEndpoint,
        `${DEVICE_NS}/GetDeviceInformation`,
        '<tds:GetDeviceInformation/>',
        credentials,
      );
      manufacturer = deviceText(info, 'Manufacturer');
      model = deviceText(info, 'Model');
    } catch {
      // Device information is optional; profiles remain discoverable without it.
    }

    let capabilities = await postSoap(
      deviceEndpoint,
      `${DEVICE_NS}/GetCapabilities`,
      '<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>',
      credentials,
    );
    let mediaEndpoint = getAdvertisedMediaEndpoint(capabilities, address);
    if (!mediaEndpoint) {
      mediaEndpoint = new URL(`http://${address}${MEDIA_ENDPOINT_PATH}`);
    }
    let profileResponse: XmlElement;
    try {
      profileResponse = await postSoap(
        mediaEndpoint,
        `${MEDIA_NS}/GetProfiles`,
        '<trt:GetProfiles/>',
        credentials,
      );
    } catch {
      // Some older devices only expose the media URL through GetServices.
      capabilities = await postSoap(
        deviceEndpoint,
        `${DEVICE_NS}/GetServices`,
        '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>',
        credentials,
      );
      const service = descendants(capabilities, 'Service').find((item) =>
        descendants(item, 'Namespace').some((value) => value.textContent?.includes('/media/wsdl')),
      );
      const serviceUrl = descendants(service ?? capabilities, 'XAddr')[0]?.textContent?.trim();
      const serviceEndpoint = serviceUrl
        ? endpointFromAdvertisedAddress(serviceUrl, address)
        : null;
      if (!serviceEndpoint) throw new Error('ONVIF media service was not found.');
      mediaEndpoint = serviceEndpoint;
      profileResponse = await postSoap(
        mediaEndpoint,
        `${MEDIA_NS}/GetProfiles`,
        '<trt:GetProfiles/>',
        credentials,
      );
    }

    const profiles = readProfileTokens(profileResponse).slice(0, 6);
    const streamUris: string[] = [];
    for (const profile of profiles) {
      try {
        const response = await postSoap(
          mediaEndpoint,
          `${MEDIA_NS}/GetStreamUri`,
          `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${xmlText(profile.token)}</trt:ProfileToken></trt:GetStreamUri>`,
          credentials,
        );
        const uri = descendants(response, 'Uri')[0]?.textContent?.trim();
        if (uri && /^rtsps?:\/\//i.test(uri)) streamUris.push(uri);
      } catch {
        // One unsupported profile should not prevent trying the others.
      }
    }
    return {
      streamUris,
      ...(manufacturer ? { manufacturer } : {}),
      ...(model ? { model } : {}),
    };
  } catch {
    return { streamUris: [] };
  }
}
