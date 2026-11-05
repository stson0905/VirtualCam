const { spawn } = require('child_process');
const logger = require('../logger');

const RESTART_DELAY_MS = 2000;

function buildArgs(camera, rtspShared) {
  const s = camera.stream;
  // ffmpeg connects to mediamtx (on this same host) as an RTSP client and
  // publishes into it; mediamtx is the process that actually serves viewers.
  const publishUrl = `rtsp://127.0.0.1:${rtspShared.port}${camera.rtspPath}`;

  // config.js already checked (via ffprobe) that this file is H264, so we
  // can remux it straight into mediamtx with no decode/encode at all - the
  // dominant CPU cost of running N cameras. See applyStreamCopyDecision().
  if (camera.source.type === 'file' && camera.source.copyMode) {
    return [
      '-stream_loop', '-1', '-re', '-i', camera.source.file,
      '-an',
      '-c:v', 'copy',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      publishUrl,
    ];
  }

  const gop = Math.max(1, Math.round(s.frameRate * 2));
  const inputArgs =
    camera.source.type === 'file'
      ? ['-stream_loop', '-1', '-re', '-i', camera.source.file, '-vf', `scale=${s.width}:${s.height}`]
      : ['-re', '-f', 'lavfi', '-i', `testsrc=size=${s.width}x${s.height}:rate=${s.frameRate}`];

  return [
    ...inputArgs,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${s.bitrateKbps}k`,
    '-maxrate', `${s.bitrateKbps}k`,
    '-bufsize', `${s.bitrateKbps * 2}k`,
    '-g', String(gop),
    '-f', 'rtsp',
    '-rtsp_transport', 'tcp',
    publishUrl,
  ];
}

// Feeds one camera's video into mediamtx (see mediamtxServer.js) as an RTSP
// publisher. mediamtx may not be accepting connections yet when this first
// runs (it's started a moment earlier); ffmpeg will simply exit non-zero on
// connection refused and the restart loop below retries until it succeeds.
// One instance of this runs per camera, all publishing into the same shared
// mediamtx server on different paths.
function start(camera, rtspShared) {
  const label = camera.device.name;
  let child = null;
  let stopped = false;

  const spawnFfmpeg = () => {
    const args = buildArgs(camera, rtspShared);
    logger.info(`[RTSP][ffmpeg:${label}] publishing to ${camera.rtspPath}: ${rtspShared.ffmpegPath} ${args.join(' ')}`);
    child = spawn(rtspShared.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    child.stderr.on('data', (chunk) => {
      const line = chunk.toString('utf8').trim();
      if (line) logger.info(`[RTSP][ffmpeg:${label}] ${line}`);
    });

    child.on('error', (err) => {
      logger.error(`[RTSP][ffmpeg:${label}] failed to launch:`, err.message);
    });

    child.on('exit', (code, signal) => {
      if (stopped) return;
      logger.warn(`[RTSP][ffmpeg:${label}] exited (code=${code}, signal=${signal}), retrying in ${RESTART_DELAY_MS}ms`);
      setTimeout(spawnFfmpeg, RESTART_DELAY_MS);
    });
  };

  spawnFfmpeg();

  return {
    stop: () => {
      stopped = true;
      if (child) child.kill();
    },
  };
}

module.exports = { start };
