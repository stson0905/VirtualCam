const dgram = require('dgram');
const { XMLParser } = require('fast-xml-parser');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

const MCAST_ADDR = '239.255.255.250';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

function buildScopes(camera) {
  const d = camera.device;
  return [
    'onvif://www.onvif.org/type/video_encoder',
    'onvif://www.onvif.org/type/Network_Video_Transmitter',
    `onvif://www.onvif.org/hardware/${encodeURIComponent(d.hardwareId)}`,
    `onvif://www.onvif.org/name/${encodeURIComponent(d.name)}`,
    `onvif://www.onvif.org/location/${encodeURIComponent(d.location)}`,
  ];
}

function buildProbeMatch({ messageId, relatesTo, endpointUuid, xaddr, scopes }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsdd="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:tdn="http://www.onvif.org/ver10/network/wsdl">
  <soap:Header>
    <wsa:MessageID>urn:uuid:${messageId}</wsa:MessageID>
    <wsa:RelatesTo>${relatesTo}</wsa:RelatesTo>
    <wsa:To soap:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
    <wsa:Action soap:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
  </soap:Header>
  <soap:Body>
    <wsdd:ProbeMatches>
      <wsdd:ProbeMatch>
        <wsa:EndpointReference>
          <wsa:Address>urn:uuid:${endpointUuid}</wsa:Address>
        </wsa:EndpointReference>
        <wsdd:Types>tdn:NetworkVideoTransmitter</wsdd:Types>
        <wsdd:Scopes>${scopes.join(' ')}</wsdd:Scopes>
        <wsdd:XAddrs>${xaddr}</wsdd:XAddrs>
        <wsdd:MetadataVersion>1</wsdd:MetadataVersion>
      </wsdd:ProbeMatch>
    </wsdd:ProbeMatches>
  </soap:Body>
</soap:Envelope>`;
}

// One shared UDP socket handles discovery for every virtual camera: a single
// incoming Probe gets one ProbeMatch reply per camera (own endpoint UUID, own
// XAddr/port, own scopes), so ODM sees N distinct devices from N replies.
function start(cameras, network) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  const targets = cameras.map((camera) => ({
    camera,
    scopes: buildScopes(camera),
    xaddr: `http://${camera.network.advertiseAddress}:${camera.network.httpPort}/onvif/device_service`,
  }));

  socket.on('error', (err) => {
    logger.error('[WS-Discovery] socket error:', err.message);
  });

  socket.on('message', (msg, rinfo) => {
    const xml = msg.toString('utf8');
    if (!xml.includes('Probe')) return;

    let messageId;
    try {
      const parsed = parser.parse(xml);
      const envelope = parsed.Envelope;
      if (!envelope || !envelope.Body || !envelope.Body.Probe) return;
      messageId = envelope.Header && envelope.Header.MessageID;
    } catch (e) {
      logger.warn('[WS-Discovery] ignored unparsable probe:', e.message);
      return;
    }

    for (const target of targets) {
      const reply = buildProbeMatch({
        messageId: uuidv4(),
        relatesTo: messageId || '',
        endpointUuid: target.camera.endpointUuid,
        xaddr: target.xaddr,
        scopes: target.scopes,
      });

      const buf = Buffer.from(reply, 'utf8');
      socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
        if (err) {
          logger.error(`[WS-Discovery] failed to send ProbeMatch for ${target.camera.device.name}:`, err.message);
        } else {
          logger.info(`[WS-Discovery] ProbeMatch (${target.camera.device.name}) -> ${rinfo.address}:${rinfo.port}`);
        }
      });
    }
  });

  socket.bind(network.discoveryPort, () => {
    try {
      socket.addMembership(MCAST_ADDR, network.advertiseAddress);
    } catch (e) {
      logger.warn(`[WS-Discovery] addMembership with interface ${network.advertiseAddress} failed, retrying with default interface:`, e.message);
      socket.addMembership(MCAST_ADDR);
    }
    socket.setMulticastLoopback(true);
    logger.info(`[WS-Discovery] listening on ${MCAST_ADDR}:${network.discoveryPort} for ${cameras.length} camera(s)`);
  });

  return socket;
}

module.exports = { start };
