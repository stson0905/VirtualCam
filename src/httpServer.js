const net = require('net');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const soap = require('./onvif/soapEnvelope');
const deviceService = require('./onvif/deviceService');
const mediaService = require('./onvif/mediaService');
const { isValidUsernameToken } = require('./onvif/wsSecurityAuth');
const snapshot = require('./assets/placeholderSnapshot');
const { baseDir } = require('./baseDir');
const logger = require('./logger');

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extractAction(bodyNode) {
  if (!bodyNode) return null;
  return Object.keys(bodyNode).find((k) => !k.startsWith('@_') && k !== '#text') || null;
}

function sendXml(res, status, xml) {
  const buf = Buffer.from(xml, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/soap+xml; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

async function handleSoap(req, res, cfg, handlers, unauthenticatedActions) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return sendXml(res, 400, soap.fault('Failed to read request body'));
  }

  let parsed;
  try {
    parsed = parser.parse(raw);
  } catch (e) {
    return sendXml(res, 400, soap.fault('Malformed XML'));
  }

  const envelope = parsed.Envelope;
  const action = extractAction(envelope && envelope.Body);
  if (!action) {
    return sendXml(res, 400, soap.fault('Could not determine SOAP action'));
  }

  const requiresAuth = cfg.auth.enabled && !(unauthenticatedActions && unauthenticatedActions.has(action));
  if (requiresAuth) {
    const header = envelope.Header;
    if (!isValidUsernameToken(header, cfg)) {
      logger.warn(`[ONVIF] rejected unauthenticated ${action}`);
      return sendXml(res, 401, soap.fault('Not Authorized', 'Sender'));
    }
  }

  const handler = handlers[action];
  if (!handler) {
    logger.warn(`[ONVIF] no handler for action: ${action}`);
    return sendXml(res, 500, soap.fault(`Action not supported: ${action}`));
  }

  try {
    const bodyXml = handler(cfg, envelope.Body[action]);
    logger.info(`[ONVIF] ${action} -> 200`);
    sendXml(res, 200, soap.envelope(bodyXml));
  } catch (e) {
    logger.error(`[ONVIF] handler for ${action} threw:`, e.message);
    sendXml(res, 500, soap.fault('Internal error handling request'));
  }
}

function buildRequestListener(cfg) {
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/onvif/snapshot.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': snapshot.buffer.length });
      return res.end(snapshot.buffer);
    }

    if (req.method === 'GET' && req.url === '/') {
      const msg = `Virtual ONVIF camera "${cfg.device.name}" is running.\n`;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(msg);
    }

    if (req.method === 'POST' && req.url === '/onvif/device_service') {
      return handleSoap(req, res, cfg, deviceService.handlers, deviceService.unauthenticatedActions);
    }

    if (req.method === 'POST' && req.url === '/onvif/media_service') {
      return handleSoap(req, res, cfg, mediaService.handlers, null);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
}

// Some ONVIF clients assume every device_service endpoint is HTTPS regardless
// of the "http://" scheme WS-Discovery/GetCapabilities actually advertised -
// one confirmed case: a client whose manual "add camera" form only takes an
// IP/port (no scheme) opens a TLS connection straight to that port, gets our
// plain-HTTP response, and fails with a generic "couldn't retrieve device
// info" error, even though the exact same client's automatic discovery flow
// (which does read the XAddr scheme) talks to other cameras over plain HTTP
// on the same port range without issue. Confirmed via packet capture: the
// first bytes sent were a TLS ClientHello (0x16 0x03 ...), not an HTTP
// request line.
//
// Rather than switch every ONVIF port to HTTPS-only (which would break every
// client that correctly uses the plain-HTTP XAddr we advertise), this peeks
// at the first byte of each new connection and routes it to a plain
// http.Server or a TLS-terminating tls.Server on the *same* port, so both
// kinds of client work against the one port ONVIF discovery already
// advertises. The cert (auto.crt/auto.key, self-signed) lives at the project
// root; if it's missing, this just logs once and serves HTTP only, exactly
// like before this existed.
let httpsCredentials;
let httpsCredentialsLoaded = false;
function loadHttpsCredentials() {
  if (httpsCredentialsLoaded) return httpsCredentials;
  httpsCredentialsLoaded = true;
  try {
    httpsCredentials = {
      cert: fs.readFileSync(path.join(baseDir, 'auto.crt')),
      key: fs.readFileSync(path.join(baseDir, 'auto.key')),
    };
  } catch (e) {
    httpsCredentials = null;
    logger.warn(
      `[HTTP] auto.crt/auto.key not found next to config.yaml - ONVIF ports will only answer plain HTTP. ` +
        `Some ONVIF clients open an HTTPS connection to the device_service port regardless of the advertised ` +
        `"http://" XAddr and will fail to read device info until these exist. (${e.message})`
    );
  }
  return httpsCredentials;
}

function start(cfg) {
  const requestListener = buildRequestListener(cfg);
  const httpServer = http.createServer(requestListener);
  const credentials = loadHttpsCredentials();
  // A raw net.Socket can't just be handed to https.Server via emit('connection', ...) -
  // by the time anything reads from it, it's already past the point where a
  // fresh TLS handshake can be layered on top (see nodejs/node#8752). The
  // pattern that actually works: run a plain tls.Server whose *connection
  // listener* receives the already-decrypted socket, and feed that into the
  // plain http.Server exactly like a normal connection - i.e. TLS is peeled
  // off first, then handled as if it were the http.Server's own accept.
  const tlsServer = credentials
    ? tls.createServer(credentials, (tlsSocket) => httpServer.emit('connection', tlsSocket))
    : null;
  if (tlsServer) {
    tlsServer.on('tlsClientError', () => {}); // a client probing/aborting the handshake is not our problem
  }

  // Neither inner server is ever .listen()'d - connections are dispatched to
  // them by hand below, once we've peeked at what the client actually sent.
  const server = net.createServer((socket) => {
    // `read(1)` (not a 'data' listener) is what keeps the socket in paused
    // mode, which is what lets tls.Server's connection listener take it over
    // cleanly afterwards - see the comment above.
    socket.once('readable', () => {
      const firstByte = socket.read(1);
      if (firstByte === null) return; // connection closed before sending anything
      socket.unshift(firstByte);
      // TLS record header: ContentType=0x16 (Handshake). Real HTTP requests
      // always start with an ASCII method (GET, POST, ...), never this byte.
      const target = tlsServer && firstByte[0] === 0x16 ? tlsServer : httpServer;
      target.emit('connection', socket);
    });
    socket.on('error', () => {}); // a connection that closes before sending anything is not our problem
  });

  server.on('error', (err) => {
    logger.error(
      `[HTTP:${cfg.device.name}] failed to listen on port ${cfg.network.httpPort} (${err.code}): ${err.message}. ` +
        `This camera will be unavailable; other cameras keep running. If this is EACCES, the port is likely reserved ` +
        `by Windows (check "netsh interface ipv4 show excludedportrange protocol=tcp") - pick a different ` +
        `network.httpPortStart in config.yaml.`
    );
  });

  server.listen(cfg.network.httpPort, () => {
    const httpsNote = tlsServer ? ' (also answers HTTPS on the same port for clients that assume it)' : '';
    logger.info(`[HTTP:${cfg.device.name}] ONVIF services listening on http://${cfg.network.advertiseAddress}:${cfg.network.httpPort}${httpsNote}`);
  });

  return server;
}

module.exports = { start };
