Virtual ONVIF Camera - 사용 안내
================================

이 폴더는 그 자체로 실행 가능합니다. Node.js, ffmpeg, mediamtx를 별도로 설치할
필요가 없습니다(모두 이 폴더 안에 포함되어 있습니다).

1. 실행
   VirtualONVIFCamera.exe 를 더블클릭하세요. 검은 콘솔 창이 뜨고 로그가 출력되면
   정상 동작 중인 것입니다. 창을 닫으면(또는 Ctrl+C) 프로그램이 종료됩니다.

   처음 실행하면 Windows 방화벽이 "VirtualONVIFCamera.exe이(가) 공용/개인
   네트워크에서 통신하도록 허용하시겠습니까?" 라고 물어봅니다 -> "액세스 허용"을
   눌러야 ODM 등 다른 장치에서 검색/재생이 됩니다.

2. 기본 동작
   기본 설정은 별도 영상 파일 없이 합성 테스트 영상(컬러바)을 10대의 가상 카메라로
   내보냅니다. 바로 ODM(ONVIF Device Manager)에서 검색해 확인할 수 있습니다.

3. 내 영상 파일로 바꾸기
   - cam 폴더에 ch1.mp4 ~ ch10.mp4 (카메라 수만큼) 파일을 넣으세요.
   - config.yaml 파일을 메모장으로 열어 cameraDefaults 아래
       source:
         type: "testPattern"
     부분을
       source:
         type: "file"
     로 바꾸고 저장하세요.
   - 다시 실행하면 cam 폴더의 영상이 카메라 번호에 맞춰(ch1.mp4 -> 카메라1, ...)
     자동으로 재생됩니다.

4. 설정 바꾸기
   config.yaml 을 메모장으로 열어 편집할 수 있습니다. 자주 바꾸는 항목:
     - cameras.count        : 가상 카메라 대수 (기본 10)
     - cameras.httpPortStart: 카메라별 ONVIF 포트 시작값 (기본 8500)
     - rtspServer.port       : RTSP 포트 (기본 8554)
     - network.advertiseAddress : 보통 "auto"로 충분 (자동으로 이 PC의 LAN IP 사용)
   설정을 바꾼 뒤에는 프로그램을 껐다가 다시 켜야 반영됩니다.

5. 문제 해결
   - "listen EACCES" 로 특정 카메라만 안 뜸: 그 포트를 Windows가 예약해 막아둔
     경우입니다. PowerShell에서
       netsh interface ipv4 show excludedportrange protocol=tcp
     로 예약 범위를 확인하고 config.yaml의 cameras.httpPortStart 를 겹치지 않는
     값으로 바꾸세요.
   - ODM 자동 검색에서 안 보임: Windows 방화벽 허용을 안 눌렀거나(위 1번),
     회사망처럼 멀티캐스트가 막힌 네트워크일 수 있습니다. 이 경우 ODM에서
     IP/포트를 수동으로 추가하세요: http://<이 PC의 IP>:<카메라 포트>/onvif/device_service
   - 영상이 안 나옴: 콘솔 창의 로그에서 [RTSP][ffmpeg:...] / [RTSP][mediamtx]
     줄에 에러가 없는지 확인하세요.

폴더 구성
  VirtualONVIFCamera.exe   실행 파일 (Node.js 런타임 포함)
  config.yaml              설정 파일
  bin\ffmpeg.exe           영상 인코딩
  bin\mediamtx.exe         실제 RTSP 서버
  cam\                     여기에 직접 촬영한 mp4를 넣으면 재생됩니다
