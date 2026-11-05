const mediamtxServer = require('./mediamtxServer');
const ffmpegPublisher = require('./ffmpegPublisher');
const rtspH264CompatProxy = require('./rtspH264CompatProxy');
const logger = require('../logger');

// mediamtx itself only ever listens on the loopback interface, on this offset
// from the public port; ffmpeg publishes into it directly (also loopback-only
// already), and rtspH264CompatProxy.js is the only thing standing between it
// and the network - see that file for why (mediamtx's own H264 RTP output
// can't be made compatible with some RTSP clients through config alone).
const INTERNAL_PORT_OFFSET = 1;

// Starts the built-in RTSP streaming server: one shared mediamtx instance
// serves RTSP internally (loopback-only), one ffmpeg process per camera
// publishes that camera's configured video source into its own path, and a
// thin compatibility proxy (rtspH264CompatProxy.js) is what viewers (ODM,
// VLC, NVRs, ...) actually connect to on the configured public port.
function start(cfg) {
  if (!cfg.rtspServer.enabled) {
    logger.info('[RTSP] built-in RTSP server disabled (rtspServer.enabled: false) - using external RTSP source from stream.rtspUrl');
    return { stop: () => {} };
  }

  const publicPort = cfg.rtspServer.port;
  const internalPort = publicPort + INTERNAL_PORT_OFFSET;
  const internalRtspServer = { ...cfg.rtspServer, port: internalPort };

  logger.info(`[RTSP] serving rtsp://${cfg.network.advertiseAddress}:${publicPort} for ${cfg.cameras.length} camera(s) (mediamtx internally on 127.0.0.1:${internalPort})`);

  const mediamtx = mediamtxServer.start({ ...cfg, rtspServer: internalRtspServer });
  const publishers = cfg.cameras.map((camera) => ffmpegPublisher.start(camera, internalRtspServer));
  const compatProxy = rtspH264CompatProxy.start(publicPort, '127.0.0.1', internalPort);

  return {
    stop: () => {
      for (const p of publishers) p.stop();
      compatProxy.stop();
      mediamtx.stop();
    },
  };
}

module.exports = { start };
