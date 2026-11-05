const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../logger');
const { baseDir } = require('../baseDir');

const RESTART_DELAY_MS = 2000;
const GENERATED_DIR = path.join(baseDir, 'run');
const GENERATED_CONFIG_PATH = path.join(GENERATED_DIR, 'mediamtx.generated.yml');

// Minimal MediaMTX config: RTSP only (no RTMP/HLS/WebRTC/SRT), with an open
// catch-all path so ffmpeg can publish to any path name without per-path
// setup. mediamtx itself is bound to 127.0.0.1 only, on an internal port one
// above the public one (see rtspServer/index.js) - it is NOT what viewers
// connect to. ffmpeg publishes directly into it; everything else goes through
// rtspH264CompatProxy.js, which is the public-facing RTSP endpoint. That
// detour exists because mediamtx's own H264 RTP output can't be made
// compatible with some RTSP clients through config alone - see the long
// comment at the top of rtspH264CompatProxy.js for why.
//
// tcp-only is fine here even though real NVR viewers often default to UDP:
// the compat proxy is a plain TCP relay (that's the only transport ffmpeg and
// the proxy itself ever use to reach mediamtx), and a client asking mediamtx
// for UDP just gets mediamtx's normal 461 Unsupported Transport back through
// the proxy unchanged, which every RTSP client already needs to handle by
// retrying over TCP - the public-facing behavior for UDP-preferring viewers
// is unaffected by mediamtx itself only speaking TCP internally.
function buildConfigYaml(cfg) {
  return `logLevel: info
rtsp: yes
rtspAddress: 127.0.0.1:${cfg.rtspServer.port}
rtspTransports: [tcp]
rtmp: no
hls: no
webrtc: no
srt: no
paths:
  all_others:
`;
}

function writeGeneratedConfig(cfg) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(GENERATED_CONFIG_PATH, buildConfigYaml(cfg), 'utf8');
  return GENERATED_CONFIG_PATH;
}

function start(cfg) {
  const configPath = writeGeneratedConfig(cfg);

  let child = null;
  let stopped = false;

  const spawnMediamtx = () => {
    logger.info(`[RTSP][mediamtx] starting: ${cfg.rtspServer.mediamtxPath} ${configPath}`);
    child = spawn(cfg.rtspServer.mediamtxPath, [configPath], { stdio: ['ignore', 'pipe', 'pipe'] });

    const logLine = (chunk) => {
      const line = chunk.toString('utf8').trim();
      if (line) logger.info(`[RTSP][mediamtx] ${line}`);
    };
    child.stdout.on('data', logLine);
    child.stderr.on('data', logLine);

    child.on('error', (err) => {
      logger.error('[RTSP][mediamtx] failed to launch:', err.message);
    });

    child.on('exit', (code, signal) => {
      if (stopped) return;
      logger.warn(`[RTSP][mediamtx] exited (code=${code}, signal=${signal}), restarting in ${RESTART_DELAY_MS}ms`);
      setTimeout(spawnMediamtx, RESTART_DELAY_MS);
    });
  };

  spawnMediamtx();

  return {
    stop: () => {
      stopped = true;
      if (child) child.kill();
    },
  };
}

module.exports = { start };
