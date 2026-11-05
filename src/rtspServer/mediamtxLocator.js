const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { baseDir } = require('../baseDir');

function isRunnable(exePath) {
  const result = spawnSync(exePath, ['--version'], { stdio: 'ignore' });
  // result.error (e.g. ENOENT) means the executable itself couldn't be
  // found/started; any exit status (0 or not) means it did run.
  return !result.error;
}

// Winget installs mediamtx under a versioned folder we can't predict exactly,
// so glob for it instead of hardcoding a version number.
function findUnderWinget() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return null;

  const packageDirs = fs.readdirSync(base).filter((d) => d.startsWith('bluenviron.mediamtx'));
  for (const pkgDir of packageDirs) {
    const pkgPath = path.join(base, pkgDir);
    const candidate = path.join(pkgPath, 'mediamtx.exe');
    if (fs.existsSync(candidate)) return candidate;

    // some releases nest the binary under a version subfolder
    const entries = fs.readdirSync(pkgPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nested = path.join(pkgPath, entry.name, 'mediamtx.exe');
        if (fs.existsSync(nested)) return nested;
      }
    }
  }
  return null;
}

function resolveMediamtxPath(configuredPath) {
  if (configuredPath && configuredPath !== 'auto') {
    if (!fs.existsSync(configuredPath)) {
      throw new Error(`configured rtspServer.mediamtxPath does not exist: ${configuredPath}`);
    }
    return configuredPath;
  }

  const bundledPath = path.join(baseDir, 'bin', 'mediamtx.exe');
  if (fs.existsSync(bundledPath)) return bundledPath;

  if (isRunnable('mediamtx')) return 'mediamtx';

  const wingetPath = findUnderWinget();
  if (wingetPath) return wingetPath;

  throw new Error(
    'mediamtx not found. Install it (e.g. "winget install bluenviron.mediamtx"), open a new terminal, ' +
      'or set rtspServer.mediamtxPath in config.yaml to the full path of mediamtx.exe.'
  );
}

module.exports = { resolveMediamtxPath };
