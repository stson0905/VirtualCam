const net = require('net');
const crypto = require('crypto');
const logger = require('../logger');

// --- Why this file exists ---------------------------------------------------
//
// mediamtx (the RTSP server actually facing viewers - see mediamtxServer.js)
// always re-inserts SPS/PPS in-band before every keyframe, and its RTP/H264
// encoder (gortsplib's pkg/format/rtph264) unconditionally packs any 2+ NAL
// units that share a timestamp into a single STAP-A aggregation packet
// (RFC 6184 §5.7.1) whenever they fit under ~1450 bytes - which SPS+PPS+the
// first slice of a keyframe always do. There is no config flag to disable
// this: gortsplib's Encoder.writeAggregated() hard-codes the STAP-A NAL type,
// and PacketizationMode must be 1 (source-verified against
// github.com/bluenviron/gortsplib, pkg/format/rtph264/encoder.go).
//
// This is spec-legal, and ODM/VLC/ffprobe all handle it fine. But some real
// NVR-viewer RTSP client stacks only implement single-NAL and FU-A
// (fragmented) H264 RTP packets and never learned to unpack STAP-A - for
// those, SPS/PPS (always delivered via STAP-A here) never reach the decoder.
// The RTSP session connects, SETUP/PLAY both succeed, RTP keeps flowing
// continuously, but no frame ever decodes because the decoder never receives
// a parameter set it can parse - the live view just stays blank forever.
// Confirmed against a live capture of one such client's session (see project
// notes): its very first three "video channel" RTP packets were
// STAP-A, STAP-A, FU-A, repeating every frame, versus a real camera's
// SPS, PPS, FU-A, FU-A, ... (always as separate single-NAL packets - never
// STAP-A) for the same content.
//
// Since mediamtx can't be configured out of this, this module is a thin
// transparent TCP proxy that viewers connect to instead of mediamtx directly:
// it forwards everything both ways unchanged, except that on the way out it
// unpacks any STAP-A packet on the video channel into its constituent NAL
// units as separate single-NAL RTP packets (renumbering RTP sequence numbers
// to stay monotonic across the split). That's wire-compatible with every
// client mediamtx's own aggregated form already worked with, since
// packetization-mode=1 (already what our SDP declares) permits single-NAL
// packets too - we're just never choosing to aggregate.

const NALU_TYPE_STAP_A = 24;

function randomSeq() {
  return crypto.randomBytes(2).readUInt16BE(0);
}

// Parses an RTP packet's fixed header. `simple` is true when the packet uses
// none of padding/extension/CSRC - which is all mediamtx's encoder ever
// produces (verified against its source), so that's the only shape this
// module actually needs to unpack; anything else is forwarded with just its
// sequence number rewritten (see _handleInterleavedFrame).
function parseRtpHeader(buf) {
  if (buf.length < 12) return null;
  const b0 = buf[0];
  const version = (b0 >> 6) & 0x3;
  const padding = (b0 >> 5) & 0x1;
  const extension = (b0 >> 4) & 0x1;
  const csrcCount = b0 & 0xf;
  const b1 = buf[1];
  const marker = (b1 >> 7) & 0x1;
  const payloadType = b1 & 0x7f;
  const timestamp = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);
  let headerLen = 12 + csrcCount * 4;
  if (extension) {
    if (buf.length < headerLen + 4) return null;
    const extWords = buf.readUInt16BE(headerLen + 2);
    headerLen += 4 + extWords * 4;
  }
  if (buf.length < headerLen) return null;
  return {
    version,
    marker,
    payloadType,
    timestamp,
    ssrc,
    headerLen,
    simple: padding === 0 && extension === 0 && csrcCount === 0,
  };
}

function buildRtpPacket(h, seq, marker, nalu) {
  const buf = Buffer.alloc(12 + nalu.length);
  buf[0] = (h.version << 6) & 0xc0;
  buf[1] = (marker ? 0x80 : 0) | (h.payloadType & 0x7f);
  buf.writeUInt16BE(seq, 2);
  buf.writeUInt32BE(h.timestamp, 4);
  buf.writeUInt32BE(h.ssrc, 8);
  nalu.copy(buf, 12);
  return buf;
}

// Splits a STAP-A RTP payload into its constituent NAL units (each still
// carrying its own 1-byte NAL header). Returns null if the payload isn't a
// well-formed STAP-A - caller then forwards it untouched.
function splitStapA(payload) {
  if (payload.length < 1 || (payload[0] & 0x1f) !== NALU_TYPE_STAP_A) return null;
  const nalus = [];
  let pos = 1;
  while (pos + 2 <= payload.length) {
    const len = payload.readUInt16BE(pos);
    pos += 2;
    if (len === 0 || pos + len > payload.length) return null;
    nalus.push(payload.slice(pos, pos + len));
    pos += len;
  }
  if (nalus.length === 0 || pos !== payload.length) return null;
  return nalus;
}

function buildInterleavedFrame(channel, rtpPacket) {
  const frame = Buffer.alloc(4 + rtpPacket.length);
  frame[0] = 0x24; // '$'
  frame[1] = channel;
  frame.writeUInt16BE(rtpPacket.length, 2);
  rtpPacket.copy(frame, 4);
  return frame;
}

// Re-parses one proxied connection's mediamtx -> viewer byte stream, which is
// RTSP response text and `$`-interleaved RTP/RTCP frames mixed on the same
// TCP connection (standard RTSP-over-TCP interleaving). Passes RTSP text and
// non-video channels through unchanged; unpacks STAP-A on the video channel.
class Deinterleaver {
  constructor(onOutput) {
    this.onOutput = onOutput;
    this.buf = Buffer.alloc(0);
    this.rewriteChannel = null; // learned from the first SETUP response's Transport header
    this.nextSeq = null;
  }

  // The sequence number the next rewritten packet on the video channel will
  // get - used to patch PLAY's RTP-Info header before forwarding it, so the
  // client's expected starting sequence number matches what we're about to
  // actually send.
  peekNextSeq() {
    return this.nextSeq !== null ? this.nextSeq : 0;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    this._drain();
  }

  _drain() {
    for (;;) {
      if (this.buf.length === 0) return;

      if (this.buf[0] === 0x24) {
        if (this.buf.length < 4) return; // wait for the rest of the interleaved-frame header
        const channel = this.buf[1];
        const len = this.buf.readUInt16BE(2);
        if (this.buf.length < 4 + len) return; // wait for the full frame
        const rtpPacket = this.buf.slice(4, 4 + len);
        this.buf = this.buf.slice(4 + len);
        this._handleInterleavedFrame(channel, rtpPacket);
        continue;
      }

      // Otherwise this is RTSP response text - forward it (headers + body,
      // per Content-Length) once the whole thing has arrived.
      const text = this.buf.toString('latin1');
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd === -1) return; // wait for the rest of the headers
      const headerText = text.slice(0, headerEnd);
      const clMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      const contentLength = clMatch ? parseInt(clMatch[1], 10) : 0;
      const totalLength = headerEnd + 4 + contentLength;
      if (this.buf.length < totalLength) return; // wait for the body
      const message = this.buf.slice(0, totalLength);
      this.buf = this.buf.slice(totalLength);
      this._handleRtspMessage(message.toString('latin1'));
    }
  }

  _handleRtspMessage(text) {
    // Only our own single video track is ever declared (see mediaService.js),
    // so the first interleaved pair we see in any response is the one to
    // rewrite; everything else (e.g. its RTCP partner) passes through as-is.
    const transportMatch = text.match(/Transport:[^\r\n]*interleaved=(\d+)-(\d+)/i);
    if (transportMatch && this.rewriteChannel === null) {
      this.rewriteChannel = parseInt(transportMatch[1], 10);
      this.nextSeq = randomSeq();
    }

    if (this.rewriteChannel !== null && /^RTSP\/1\.0 200/i.test(text) && /RTP-Info:/i.test(text)) {
      const rewritten = text.replace(/(RTP-Info:[^\r\n]*)/i, (line) => line.replace(/seq=\d+/, `seq=${this.peekNextSeq()}`));
      this.onOutput(Buffer.from(rewritten, 'latin1'));
      return;
    }

    this.onOutput(Buffer.from(text, 'latin1'));
  }

  _handleInterleavedFrame(channel, rtpPacket) {
    if (channel !== this.rewriteChannel) {
      this.onOutput(buildInterleavedFrame(channel, rtpPacket)); // RTCP (or an unrelated channel) - untouched
      return;
    }

    if (rtpPacket.length < 4) {
      this.onOutput(buildInterleavedFrame(channel, rtpPacket)); // too short to even hold a sequence number
      return;
    }

    const h = parseRtpHeader(rtpPacket);
    if (!h || !h.simple) {
      // Not a shape mediamtx actually produces in practice - forward as-is,
      // just keeping our sequence counter consistent for what follows.
      const seq = this.nextSeq;
      this.nextSeq = (this.nextSeq + 1) & 0xffff;
      const copy = Buffer.from(rtpPacket);
      copy.writeUInt16BE(seq, 2);
      this.onOutput(buildInterleavedFrame(channel, copy));
      return;
    }

    const payload = rtpPacket.slice(h.headerLen);
    const nalus = splitStapA(payload);
    if (!nalus) {
      const seq = this.nextSeq;
      this.nextSeq = (this.nextSeq + 1) & 0xffff;
      this.onOutput(buildInterleavedFrame(channel, buildRtpPacket(h, seq, h.marker === 1, payload)));
      return;
    }

    nalus.forEach((nalu, i) => {
      const seq = this.nextSeq;
      this.nextSeq = (this.nextSeq + 1) & 0xffff;
      const isLast = i === nalus.length - 1;
      this.onOutput(buildInterleavedFrame(channel, buildRtpPacket(h, seq, isLast && h.marker === 1, nalu)));
    });
  }
}

// Starts the proxy: `publicPort` is what viewers (and ONVIF's GetStreamUri)
// see; every connection is relayed to mediamtx's real RTSP port
// (`internalHost`:`internalPort`, loopback-only - see mediamtxServer.js),
// rewriting H264 on the way out as described above. Client -> mediamtx bytes
// (RTSP requests, RTCP receiver reports) are forwarded completely unchanged.
function start(publicPort, internalHost, internalPort) {
  const server = net.createServer((clientSocket) => {
    clientSocket.setNoDelay(true);
    const upstream = net.createConnection({ host: internalHost, port: internalPort });
    upstream.setNoDelay(true);

    const deinterleaver = new Deinterleaver((out) => {
      if (!clientSocket.destroyed) clientSocket.write(out);
    });

    upstream.on('data', (chunk) => {
      try {
        deinterleaver.push(chunk);
      } catch (e) {
        logger.error('[RTSP][compat-proxy] failed to process data from mediamtx, closing connection:', e.message);
        clientSocket.destroy();
        upstream.destroy();
      }
    });

    clientSocket.on('data', (chunk) => {
      if (!upstream.destroyed) upstream.write(chunk);
    });

    const closeBoth = () => {
      clientSocket.destroy();
      upstream.destroy();
    };
    clientSocket.on('error', closeBoth);
    clientSocket.on('close', closeBoth);
    upstream.on('error', closeBoth);
    upstream.on('close', closeBoth);
  });

  server.on('error', (err) => {
    logger.error(`[RTSP][compat-proxy] failed to listen on port ${publicPort} (${err.code}):`, err.message);
  });

  server.listen(publicPort, () => {
    logger.info(
      `[RTSP][compat-proxy] rtsp://<host>:${publicPort} -> mediamtx on ${internalHost}:${internalPort} ` +
        `(unpacking H264 STAP-A for RTSP clients that only support single-NAL/FU-A)`
    );
  });

  return {
    stop: () => server.close(),
  };
}

module.exports = { start };
