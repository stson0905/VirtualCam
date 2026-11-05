const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { baseDir } = require('../baseDir');

function isRunnable(exePath) {
  try {
    const result = spawnSync(exePath, ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Winget installs ffmpeg under a versioned folder we can't predict exactly,
// so glob for it instead of hardcoding a version number. ffprobe.exe ships
// in the same bin/ folder as ffmpeg.exe, so this works for both.
function findUnderWinget(exeName) {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return null;

  const packageDirs = fs.readdirSync(base).filter((d) => d.startsWith('Gyan.FFmpeg'));
  for (const pkgDir of packageDirs) {
    const pkgPath = path.join(base, pkgDir);
    const buildDirs = fs.readdirSync(pkgPath).filter((d) => d.toLowerCase().startsWith('ffmpeg-'));
    for (const buildDir of buildDirs) {
      const candidate = path.join(pkgPath, buildDir, 'bin', exeName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveFfmpegPath(configuredPath) {
  if (configuredPath && configuredPath !== 'auto') {
    if (!fs.existsSync(configuredPath)) {
      throw new Error(`configured rtspServer.ffmpegPath does not exist: ${configuredPath}`);
    }
    return configuredPath;
  }

  // Packaged builds ship ffmpeg.exe next to the app in bin/ - check there
  // first so an end-user machine with no PATH entry or winget install still
  // works out of the box.
  const bundledPath = path.join(baseDir, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(bundledPath)) return bundledPath;

  if (isRunnable('ffmpeg')) return 'ffmpeg';

  const wingetPath = findUnderWinget('ffmpeg.exe');
  if (wingetPath && isRunnable(wingetPath)) return wingetPath;

  throw new Error(
    'ffmpeg not found. Install it (e.g. "winget install Gyan.FFmpeg"), open a new terminal, ' +
      'or set rtspServer.ffmpegPath in config.yaml to the full path of ffmpeg.exe.'
  );
}

// ffprobe is only used to decide whether a file source can be RTSP-copied
// without re-encoding (see sourceProbe.js), so unlike ffmpeg it's optional:
// if it can't be found, callers just fall back to always re-encoding.
function resolveFfprobePath(resolvedFfmpegPath) {
  const bundledPath = path.join(baseDir, 'bin', 'ffprobe.exe');
  if (fs.existsSync(bundledPath) && isRunnable(bundledPath)) return bundledPath;

  // Try next to the resolved ffmpeg binary first (same install/bin folder).
  if (path.isAbsolute(resolvedFfmpegPath)) {
    const sibling = path.join(path.dirname(resolvedFfmpegPath), 'ffprobe.exe');
    if (fs.existsSync(sibling) && isRunnable(sibling)) return sibling;
  }

  if (isRunnable('ffprobe')) return 'ffprobe';

  const wingetPath = findUnderWinget('ffprobe.exe');
  if (wingetPath && isRunnable(wingetPath)) return wingetPath;

  return null;
}

module.exports = { resolveFfmpegPath, resolveFfprobePath };
