const { spawnSync } = require('child_process');

// Probes a file's first video stream so config.js can decide whether it's
// already H264 (safe to RTSP stream-copy, skipping software re-encode
// entirely) and, if so, what its real width/height/frameRate/bitrate are -
// used to keep the ONVIF-reported profile truthful when we bypass the
// encoder that would otherwise apply the configured values. Also reports the
// H.264 *encoder* profile (Baseline/Main/High/...) so config.js can refuse to
// stream-copy a file that isn't Baseline - see applyStreamCopyDecision().
function probeVideoStream(ffprobePath, filePath) {
  if (!ffprobePath) return null;

  const result = spawnSync(
    ffprobePath,
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,profile,width,height,avg_frame_rate:format=bit_rate',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0 || !result.stdout) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams && parsed.streams[0];
    if (!stream || !stream.width || !stream.height) return null;

    const [num, den] = String(stream.avg_frame_rate || '0/0').split('/').map(Number);
    const frameRate = den ? num / den : 0;
    const bitrateKbps = parsed.format && parsed.format.bit_rate ? Math.round(Number(parsed.format.bit_rate) / 1000) : null;

    return { codec: stream.codec_name, profile: stream.profile || null, width: stream.width, height: stream.height, frameRate, bitrateKbps };
  } catch {
    return null;
  }
}

module.exports = { probeVideoStream };
