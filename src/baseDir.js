const path = require('path');

// When packaged with pkg, __dirname points inside the virtual snapshot
// filesystem baked into the exe, which can't be used to find sibling files
// (config.yaml, bin/ffmpeg.exe, the writable run/ folder) or written to.
// process.pkg only exists in packaged builds; in dev (`node src/index.js`)
// we fall back to the real project root.
const baseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

module.exports = { baseDir };
