# Virtual ONVIF Camera

RTSP 영상을 ONVIF Profile S를 지원하는 가상 IP 카메라처럼 ODM(ONVIF Device Manager) 등에서
검색/등록할 수 있도록 만들어주는 프로젝트입니다. RTSP 스트리밍 서버 자체도 이 프로젝트 안에
내장되어 있어서, 별도 카메라나 외부 RTSP 서버 없이 바로 실행해서 테스트할 수 있습니다.
**카메라 1대가 아니라 여러 대(기본 10대)를 동시에 흉내 낼 수 있습니다.**

이 프로젝트는 세 가지 역할을 동시에 수행합니다.

- **WS-Discovery** (UDP 멀티캐스트 239.255.255.250:3702) — ODM의 "카메라 검색"에 카메라별로 각각 응답
- **ONVIF Device / Media 서비스** (HTTP SOAP) — 카메라마다 자기만의 포트에서 장치 정보/프로필/스트림 URI 제공
- **RTSP 스트리밍 서버** (내장, 기본 포트 8554) — 카메라마다 다른 경로(`/cam1`, `/cam2`, ...)로 합성 테스트 영상(또는 지정한 영상 파일)을 RTSP로 송출

이미 별도의 RTSP 카메라/서버가 있다면 내장 서버를 끄고 그 주소를 그대로 사용할 수도 있습니다
(`config.yaml`의 `rtspServer.enabled: false`).

## 아키텍처

```
                              ┌───────────────────────────────────────────────────┐
                              │                  이 프로젝트 (node)                  │
                              │                                                     │
  [ODM / NVR] ────────────────┼──> ONVIF Device/Media SOAP (카메라마다 다른 포트)      │
       │                      │        │ 예) cam1→:8500, cam2→:8501, ...            │
       │                      │        │ GetStreamUri → rtsp://.../camN            │
       │                      │        v                                           │
       │                      │  ┌───────────┐  publish   ┌─────────────────────┐  │
       └── RTSP 재생 ───────────┼──┤ mediamtx  │ <────────── │ ffmpeg × N (카메라당) │  │
   (:8554/cam1 ~ /camN)       │  │(RTSP 서버)│  (rtsp)     │ 테스트영상/파일        │  │
                              │  └───────────┘             └─────────────────────┘  │
       │                      │                                                     │
       └── WS-Discovery Probe ─┼─> UDP 3702 응답기 (Probe 1개 → 카메라 수만큼 응답)     │
                              └───────────────────────────────────────────────────┘
```

- **mediamtx**: 실제 RTSP 서버 역할. 인스턴스는 1개뿐이며, 카메라마다 다른 경로로 여러 스트림을
  동시에 서비스합니다. ODM/VLC 등 여러 클라이언트의 동시 접속(pull)도 지원합니다.
- **ffmpeg**: 카메라마다 1개씩 프로세스가 떠서, 각자 합성 테스트 패턴(또는 지정한 영상 파일)을
  인코딩해 mediamtx의 자기 경로로 송출(publish)합니다. 최신 ffmpeg는 더 이상 자체적으로 RTSP
  서버(listen) 역할을 하지 못하기 때문에, 검증된 경량 RTSP 서버인 mediamtx를 실제 서버로 앞에 둔
  구조입니다.
- **HTTP(ONVIF) 서버**: 카메라마다 1개씩, 서로 다른 포트에서 뜹니다. ONVIF 규격상 디바이스 1대 =
  포트 1개이기 때문입니다.
- **WS-Discovery**: UDP 소켓은 1개만 사용합니다. ODM이 보낸 Probe 1개에 대해 카메라 수만큼
  ProbeMatch를 각각 다른 엔드포인트로 응답해서, ODM 입장에서는 카메라가 여러 대 있는 것처럼 보입니다.
- 모든 자식 프로세스(mediamtx, ffmpeg × N)는 이 Node.js 앱이 기동/재시작을 관리합니다.

## 폴더 구조

```
config.yaml                        실행 설정 (카메라 목록 생성 규칙, 네트워크, RTSP 서버, 인증)
src/
  index.js                         진입점 (카메라 수만큼 HTTP 서버 + RTSP 서버 + WS-Discovery 기동)
  config.js                        config.yaml 로딩 + 카메라 N대 설정 생성 + ffmpeg/mediamtx 경로 탐색
  logger.js                        콘솔 로거
  httpServer.js                    카메라 1대분 HTTP 서버, SOAP 라우팅, 스냅샷 제공 (카메라마다 인스턴스화)
  discovery/wsDiscovery.js         WS-Discovery UDP 응답기 (카메라 목록을 받아 다중 응답)
  onvif/soapEnvelope.js            SOAP envelope/fault 빌더
  onvif/deviceService.js           Device 서비스 (GetCapabilities 등)
  onvif/mediaService.js            Media 서비스 (GetProfiles, GetStreamUri 등)
  onvif/wsSecurityAuth.js          WS-Security UsernameToken 검증 (선택)
  assets/placeholderSnapshot.js    GetSnapshotUri용 자리표시 이미지
  rtspServer/index.js              mediamtx(내부 전용) + compat 프록시(공개) + 카메라별 ffmpeg publisher N개 기동 오케스트레이션
  rtspServer/mediamtxServer.js     mediamtx 프로세스 관리 + 설정 파일 생성 (127.0.0.1:포트+1 내부 전용)
  rtspServer/rtspH264CompatProxy.js 공개 RTSP 포트 - mediamtx 앞단 투명 프록시, H264 STAP-A를 단일 NAL로 풀어줌
  rtspServer/ffmpegPublisher.js    카메라 1대분 ffmpeg 송출 프로세스 (카메라마다 인스턴스화, mediamtx 내부 포트로 발행)
  rtspServer/ffmpegLocator.js      ffmpeg.exe 경로 자동 탐색
  rtspServer/mediamtxLocator.js    mediamtx.exe 경로 자동 탐색
  baseDir.js                       exe/소스 기준 경로 판별 (개발 모드 vs 패키징된 exe)
run/mediamtx.generated.yml         실행 시 자동 생성되는 mediamtx 설정 (수정 불필요)
packaging/build.ps1                다른 PC에 배포할 포터블 패키지 빌드 스크립트
packaging/config.dist.yaml         배포 패키지에 들어가는 기본 config.yaml 템플릿
packaging/README-package.txt       배포 패키지에 동봉되는 사용 안내문
.vscode/launch.json                VS Code 디버그 실행 설정
```

## 사전 준비물

- Node.js (설치되어 있음)
- **ffmpeg**, **mediamtx** — winget으로 설치:
  ```powershell
  winget install --id Gyan.FFmpeg -e
  winget install --id bluenviron.mediamtx -e
  ```
  설치 직후에는 PATH가 새 터미널에서만 반영되므로, 설치 후 **새 PowerShell/VS Code 터미널**을
  열어서 실행하세요. PATH에 안 잡히면 `config.yaml`의 `rtspServer.ffmpegPath` /
  `rtspServer.mediamtxPath`에 `.exe` 전체 경로를 직접 적어도 됩니다.

## 사용 방법

### 1. 설정 — 카메라 대수 지정

`config.yaml`의 `cameras.count`만 바꾸면 그 수만큼 가상 카메라가 뜹니다. 기본값(10대) 그대로도
바로 동작합니다.

```yaml
cameraDefaults:            # 모든 카메라 공통 기본값
  stream:
    width: 1280
    height: 720
    frameRate: 25
    bitrateKbps: 2048
  source:
    type: "testPattern"    # testPattern(합성 컬러바) | file(영상 파일 반복 재생)
    file: ""

cameras:
  count: 10                 # <- 카메라 대수. 20대 원하면 20으로.
  namePrefix: "Virtual ONVIF Camera"   # -> "Virtual ONVIF Camera 1", "... 2", ...
  macPrefix: "aa:bb:cc:dd:ee:"          # -> ee:01, ee:02, ...
  httpPortStart: 8500                   # -> 8500, 8501, ... (카메라마다 ONVIF 포트 +1)
  rtspPathPrefix: "/cam"                # -> /cam1, /cam2, ...
  overrides: {}              # 특정 카메라만 다르게 설정 (아래 참고)
```

- 카메라마다 다른 영상 파일을 자동으로 매핑하고 싶다면(예: `ch1.mp4` ~ `ch10.mp4`) 개별 `overrides`를 다
  적을 필요 없이 `cameras.sourceFilePattern`에 `{n}` 자리표시자를 쓰면 카메라 번호로 자동 치환됩니다.
  ```yaml
  cameraDefaults:
    source:
      type: "file"
      file: ""    # 비워두면 sourceFilePattern으로 자동 채워짐
  cameras:
    sourceFilePattern: "D:\\vsproject\\virtualCam\\cam\\ch{n}.mp4"   # -> ch1.mp4, ch2.mp4, ...
  ```
  파일이 없으면 실행 시 어느 카메라의 어떤 경로가 없는지 바로 에러로 알려줍니다.
- 특정 카메라 몇 대만 다르게 하고 싶다면 `overrides`에 카메라 번호(1부터)를 키로 원하는 항목만 적으면 됩니다.
  ```yaml
  cameras:
    overrides:
      3:
        name: "Loading Dock Camera"
        source: { type: "file", file: "C:\\videos\\dock.mp4" }
  ```
- `network.advertiseAddress`를 `"auto"`로 두면 실행 시 이 PC의 첫 번째 외부 IPv4를 자동 사용합니다.
  VPN 어댑터(VMware, WSL 등) 때문에 잘못된 인터페이스가 잡히면 실제 LAN IP를 직접 입력하세요.
- `httpPortStart`부터 `count`개 연속 포트가 쓰입니다(예: 10대면 8500~8509). Windows가 특정 포트를
  예약해서 막아둔 경우 `listen EACCES` 에러가 날 수 있는데, 이때 해당 카메라만 비활성화되고 나머지는
  정상 동작합니다 — 아래 트러블슈팅 참고.
- RTSP는 `rtspServer.port`(기본 8554) 하나를 모든 카메라가 공유하고, 경로(`/cam1` 등)로만 구분됩니다.
  카메라 수를 늘려도 RTSP 포트는 그대로 둬도 됩니다.

### 2. 설치 및 실행

```powershell
npm install
npm start
```

VS Code에서는 `F5` (Run and Debug → "Run Virtual ONVIF Camera")로 바로 디버깅 실행할 수 있습니다.

정상 실행되면 카메라 목록과 함께 다음과 같은 로그가 보입니다.

```
Virtual ONVIF Cameras : 10
  Virtual ONVIF Camera 1   onvif=http://192.168.x.x:8500/onvif/device_service  rtsp=rtsp://192.168.x.x:8554/cam1
  Virtual ONVIF Camera 2   onvif=http://192.168.x.x:8501/onvif/device_service  rtsp=rtsp://192.168.x.x:8554/cam2
  ...
[RTSP][mediamtx] ... [path cam1] stream is available and online, 1 track (H264)
[HTTP:Virtual ONVIF Camera 1] ONVIF services listening on http://192.168.x.x:8500
[WS-Discovery] listening on 239.255.255.250:3702 for 10 camera(s)
```

### 3. ODM에서 등록

1. ODM 실행 → "Add device" / 검색(돋보기) 버튼 클릭
2. 같은 네트워크에 있으면 자동 검색 목록에 카메라 수만큼(`Virtual ONVIF Camera 1` ~ `10`) 각각 나타납니다.
3. 자동 검색이 안 되면 카메라별로 IP/포트를 수동 입력: `http://<advertiseAddress>:<해당 카메라 httpPort>/onvif/device_service`
4. `auth.enabled: true`로 설정한 경우 모든 카메라가 `config.yaml`의 `auth.username` / `auth.password`를 공통으로 사용합니다.
5. 영상 재생 시 RTSP 주소는 카메라별로 `rtsp://<advertiseAddress>:8554/camN`로 자동 전달됩니다.

### 4. 동작 확인 (선택)

RTSP 스트림을 ffprobe/VLC로 직접 열어볼 수 있습니다(카메라 번호만 바꿔서 반복 확인).

```powershell
ffprobe -rtsp_transport tcp rtsp://127.0.0.1:8554/cam1
```

특정 카메라의 SOAP 응답을 직접 확인하고 싶다면 해당 카메라의 포트로 요청하면 됩니다.

```powershell
$body = @'
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <soap:Body><tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities></soap:Body>
</soap:Envelope>
'@
Invoke-WebRequest -Uri "http://127.0.0.1:8500/onvif/device_service" -Method Post -Body $body -ContentType "application/soap+xml"
```

## 다른 사람 PC에서 실행할 수 있는 배포 패키지 만들기

개발 중인 이 폴더가 아니라, Node.js/ffmpeg/mediamtx가 전혀 설치되어 있지 않은 다른 PC에 그대로
복사해서 실행할 수 있는 포터블 패키지(zip)를 만들 수 있습니다. Node.js 런타임 자체가
`VirtualONVIFCamera.exe` 안에 번들되고, ffmpeg/mediamtx도 `bin\` 폴더에 함께 담깁니다(영상
파일은 용량 문제로 포함되지 않으며, 기본값은 합성 테스트 영상으로 바로 동작합니다).

### 빌드 (이 개발 PC에서)

```powershell
npm run package
```

내부적으로 `packaging/build.ps1`이 다음을 수행합니다.
1. `@yao-pkg/pkg`로 `src/index.js`를 Node 런타임 포함 단일 exe로 빌드
2. winget으로 설치된 ffmpeg.exe / mediamtx.exe를 찾아 `bin\`에 복사
3. 배포용 기본 `config.yaml`(`packaging/config.dist.yaml`, 합성 테스트 영상이 기본값)과
   안내문(`packaging/README-package.txt`)을 포함
4. 결과를 `dist\VirtualONVIFCamera\` 폴더와 `dist\VirtualONVIFCamera-win-x64.zip`으로 생성

### 배포

`dist\VirtualONVIFCamera-win-x64.zip` 파일 하나만 상대방에게 전달하면 됩니다. 상대방은 압축을
풀고 `VirtualONVIFCamera.exe`를 더블클릭하면 바로 실행됩니다(설치 과정 없음). 자기 영상으로
바꾸려면 `cam\` 폴더에 `ch1.mp4` ~ `chN.mp4`를 넣고 `config.yaml`의 `source.type`을 `file`로
바꾸면 됩니다 — 자세한 사용법은 패키지 안의 `README.txt`에 있습니다.

### 참고

- 패키지 exe는 자기 폴더의 `config.yaml` / `bin\` / `cam\`을 읽으므로, 압축을 푼 폴더 구조를
  그대로 유지해야 합니다(폴더 내부 파일만 따로 옮기면 안 됨).
- 대상 PC에서도 처음 실행 시 Windows 방화벽 허용 프롬프트가 뜨는 것은 동일합니다.
- ffmpeg full build를 그대로 포함하기 때문에 패키지가 약 130MB(zip 기준)입니다. 용량을 더
  줄이고 싶다면 `packaging/build.ps1`이 찾는 ffmpeg를 Gyan의 "essentials" 빌드로 바꿔도 됩니다
  (단, 사용 중인 필터/코덱이 빠지지 않았는지 직접 확인 필요).

## 트러블슈팅

- **`listen EACCES` 로 특정 카메라만 안 뜸**: 그 포트가 Windows에 예약(exclude)되어 있는 경우입니다.
  ```powershell
  netsh interface ipv4 show excludedportrange protocol=tcp
  ```
  로 예약 범위를 확인하고, `config.yaml`의 `cameras.httpPortStart`를 겹치지 않는 값으로 바꾸세요.
  이 에러가 나도 앱 전체가 죽지 않고 나머지 카메라는 정상 동작합니다.
- **ffmpeg/mediamtx를 찾지 못함 (`ENOENT`, "not found")**: winget 설치 직후에는 기존 터미널의
  PATH가 갱신되지 않습니다. 새 터미널을 열거나, `config.yaml`의 `rtspServer.ffmpegPath` /
  `rtspServer.mediamtxPath`에 `.exe` 전체 경로를 직접 지정하세요.
- **ODM 자동 검색에서 안 보임**: Windows 방화벽에서 Node.js의 인바운드 UDP/TCP가 허용되어 있는지 확인하세요
  (`Get-NetFirewallRule -DisplayName "*Node.js*"`). 회사망 등 멀티캐스트가 차단된 네트워크에서는
  WS-Discovery 자체가 통과하지 못할 수 있으니, 이 경우 3단계처럼 IP/포트를 수동으로 추가하세요.
- **가상 머신/다중 NIC 환경**: VMware, WSL, VPN 어댑터가 함께 떠 있으면 `advertiseAddress: auto`가
  엉뚱한 인터페이스를 고를 수 있습니다. `ipconfig`으로 실제 LAN IP를 확인해 직접 지정하세요.
- **영상이 재생되지 않음**: `[RTSP][ffmpeg:<카메라 이름>]`, `[RTSP][mediamtx]` 로그에 에러가 없는지
  먼저 확인하고, `ffprobe rtsp://127.0.0.1:8554/camN`로 로컬에서 재생 가능한지 확인하세요.
- **검색(등록)도 되고 RTSP 접속(TCP 연결/SETUP/PLAY)까지 성공하고 RTP도 계속 들어오는데 특정 NVR/뷰어
  프로그램에서만 화면이 안 나옴(ODM/VLC/ffprobe는 정상 재생)**: 내장 RTSP 서버 mediamtx는 매 키프레임 앞에
  SPS/PPS를 항상 넣는데, 이 둘을 **STAP-A**(RFC 6184 - 여러 NAL을 한 RTP 패킷에 묶는 방식)로 묶어서 보내며,
  이를 끄는 설정이 없습니다(mediamtx가 쓰는 gortsplib 라이브러리에 하드코딩되어 있음). 일부 RTSP 클라이언트
  (특히 실제 IP 카메라만 상대해본 벤더 SDK 기반 NVR 뷰어)는 단일 NAL과 FU-A(조각화)만 지원하고 STAP-A를
  풀 줄 몰라서, SPS/PPS가 STAP-A에 묶여 오면 디코더가 파라미터 세트를 못 받아 영원히 디코딩을 못 합니다 -
  RTSP 세션은 계속 연결돼 있고 RTP도 계속 오는데 화면만 안 나오는 증상으로 나타납니다(실제 카메라는 SPS/PPS를
  항상 개별 단일-NAL 패킷으로 보내서 이 문제가 없습니다). `src/rtspServer/rtspH264CompatProxy.js`가 mediamtx와
  뷰어 사이에 투명 프록시로 들어가서 STAP-A 패킷을 만나면 그 자리에서 개별 단일-NAL 패킷으로 풀어 재전송합니다 -
  이제 mediamtx는 `127.0.0.1:<rtspServer.port + 1>`에서만 내부적으로 떠 있고, 뷰어/ONVIF GetStreamUri가
  가리키는 공개 포트(`rtspServer.port`)는 이 프록시입니다. 로그에
  `[RTSP][compat-proxy] rtsp://<host>:8554 -> mediamtx on 127.0.0.1:8555`가 보이면 정상 동작 중입니다.
- **카메라 수가 많아 리소스가 부담될 때**: 카메라 1대당 ffmpeg 프로세스 1개가 뜹니다. `source.type`이
  `file`이고 그 파일이 이미 H264 영상이면, 실행 시 ffprobe로 자동 확인해서 재인코딩 없이 그대로
  RTSP로 remux합니다(CPU 거의 사용 안 함) — 로그에 `using RTSP stream copy, no re-encode`가 보이면
  적용된 것입니다. 이 경우 `cameraDefaults.stream`의 해상도/비트레이트 설정은 무시되고 ONVIF에는
  파일의 실제 값이 보고됩니다(카메라별로 강제 인코딩하려면 해당 카메라 `source`에 `forceEncode: true`
  추가). `testPattern` 소스이거나 파일이 H264가 아니면 소프트웨어 인코딩(`libx264`)으로 동작하며, 이때는
  `cameraDefaults.stream`의 해상도/비트레이트를 낮추거나 `cameras.count`를 줄이면 CPU 사용량이 줄어듭니다.
- **외부 RTSP 서버를 대신 쓰고 싶을 때**: `rtspServer.enabled: false`로 끄면 내장 서버는 뜨지 않습니다.
  이 경우 카메라별 `stream.rtspUrl`을 직접 관리해야 하므로 `src/config.js`에서 URL 생성 로직을 맞게
  조정해야 합니다.
