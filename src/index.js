const { loadConfig } = require('./config');
const httpServer = require('./httpServer');
const wsDiscovery = require('./discovery/wsDiscovery');
const rtspServer = require('./rtspServer');
const logger = require('./logger');

// exe를 탐색기에서 더블클릭해 실행하면, 시작 중 에러로 죽을 때 콘솔 창이
// 메시지를 읽을 새도 없이 바로 닫혀버려 사용자가 원인을 알 수 없다.
// stdin이 TTY일 때(콘솔 창이 붙어 있을 때)만 키 입력을 기다렸다가 종료해서,
// 리다이렉트/백그라운드 실행(자동화, 스크립트)에서는 절대 멈춰있지 않게 한다.
function exitAfterStartupError(err) {
  logger.error('시작 중 오류가 발생해 프로그램을 종료합니다:');
  logger.error(err && err.message ? err.message : err);
  if (process.stdin.isTTY) {
    console.error('\n창을 닫으려면 Enter 키를 누르세요...');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
}

// 위 함수 정의 이후 시작 과정에서 발생하는 모든 미처리 예외(설정 로딩,
// RTSP/ONVIF 서버 기동 등)를 여기서 한 곳에 모아 처리한다.
process.on('uncaughtException', exitAfterStartupError);
process.on('unhandledRejection', exitAfterStartupError);

const cfg = loadConfig();

logger.info('='.repeat(70));
logger.info(`Virtual ONVIF Cameras : ${cfg.cameras.length}`);
logger.info(`Built-in RTSP server  : ${cfg.rtspServer.enabled ? 'enabled' : 'disabled (using external RTSP sources)'}`);
logger.info(`Advertised address    : ${cfg.network.advertiseAddress}`);
logger.info(`WS-Security auth      : ${cfg.auth.enabled ? `enabled (${cfg.auth.username})` : 'disabled'}`);
logger.info('-'.repeat(70));
for (const camera of cfg.cameras) {
  logger.info(
    `  ${camera.device.name.padEnd(24)} onvif=http://${camera.network.advertiseAddress}:${camera.network.httpPort}/onvif/device_service  rtsp=${camera.stream.rtspUrl}`
  );
}
logger.info('='.repeat(70));

const rtsp = rtspServer.start(cfg);
const httpServers = cfg.cameras.map((camera) => httpServer.start(camera));
wsDiscovery.start(cfg.cameras, cfg.network);

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  rtsp.stop();
  for (const server of httpServers) server.close();
  process.exit(0);
});
