const PROFILE_TOKEN = 'profile_1';
const VIDEO_SOURCE_TOKEN = 'video_source_1';
const VIDEO_SOURCE_CONFIG_TOKEN = 'video_source_config_1';
const VIDEO_ENCODER_TOKEN = 'video_encoder_1';

function baseUrl(cfg) {
  return `http://${cfg.network.advertiseAddress}:${cfg.network.httpPort}`;
}

function videoEncoderConfig(cfg) {
  const s = cfg.stream;
  return `<tt:VideoEncoderConfiguration token="${VIDEO_ENCODER_TOKEN}">
      <tt:Name>VideoEncoder</tt:Name>
      <tt:UseCount>1</tt:UseCount>
      <tt:Encoding>${s.encoding}</tt:Encoding>
      <tt:Resolution>
        <tt:Width>${s.width}</tt:Width>
        <tt:Height>${s.height}</tt:Height>
      </tt:Resolution>
      <tt:Quality>5</tt:Quality>
      <tt:RateControl>
        <tt:FrameRateLimit>${s.frameRate}</tt:FrameRateLimit>
        <tt:EncodingInterval>1</tt:EncodingInterval>
        <tt:BitrateLimit>${s.bitrateKbps}</tt:BitrateLimit>
      </tt:RateControl>
      <tt:SessionTimeout>PT60S</tt:SessionTimeout>
    </tt:VideoEncoderConfiguration>`;
}

function videoSourceConfig() {
  return `<tt:VideoSourceConfiguration token="${VIDEO_SOURCE_CONFIG_TOKEN}">
      <tt:Name>VideoSourceConfig</tt:Name>
      <tt:UseCount>1</tt:UseCount>
      <tt:SourceToken>${VIDEO_SOURCE_TOKEN}</tt:SourceToken>
      <tt:Bounds x="0" y="0" width="0" height="0"/>
    </tt:VideoSourceConfiguration>`;
}

function profileBody(cfg) {
  return `<tt:Name>Profile1</tt:Name>
        ${videoSourceConfig()}
        ${videoEncoderConfig(cfg)}`;
}

function getProfiles(cfg) {
  return `<trt:GetProfilesResponse>
      <trt:Profiles token="${PROFILE_TOKEN}" fixed="true">
        ${profileBody(cfg)}
      </trt:Profiles>
    </trt:GetProfilesResponse>`;
}

// Singular counterpart to GetProfiles (takes a ProfileToken, returns one
// Profile). ODM's "Live video" action calls this before GetStreamUri, so
// without it ODM shows "Action not supported: GetProfile" and never gets to
// the stream URI request.
function getProfile(cfg) {
  return `<trt:GetProfileResponse>
      <trt:Profile token="${PROFILE_TOKEN}" fixed="true">
        ${profileBody(cfg)}
      </trt:Profile>
    </trt:GetProfileResponse>`;
}

function getVideoSources(cfg) {
  const s = cfg.stream;
  return `<trt:GetVideoSourcesResponse>
      <trt:VideoSources token="${VIDEO_SOURCE_TOKEN}">
        <tt:Framerate>${s.frameRate}</tt:Framerate>
        <tt:Resolution>
          <tt:Width>${s.width}</tt:Width>
          <tt:Height>${s.height}</tt:Height>
        </tt:Resolution>
      </trt:VideoSources>
    </trt:GetVideoSourcesResponse>`;
}

function getVideoSourceConfigurations() {
  return `<trt:GetVideoSourceConfigurationsResponse>
      ${videoSourceConfig()}
    </trt:GetVideoSourceConfigurationsResponse>`;
}

// Singular counterparts (take a ConfigurationToken, return one config).
// ODM's Live video flow walks GetProfile -> GetVideoSourceConfiguration ->
// GetVideoEncoderConfiguration -> GetStreamUri, calling each of these by
// name even though we only ever have one of each.
function getVideoSourceConfiguration() {
  return `<trt:GetVideoSourceConfigurationResponse>
      ${videoSourceConfig()}
    </trt:GetVideoSourceConfigurationResponse>`;
}

function getVideoEncoderConfigurations(cfg) {
  return `<trt:GetVideoEncoderConfigurationsResponse>
      ${videoEncoderConfig(cfg)}
    </trt:GetVideoEncoderConfigurationsResponse>`;
}

function getVideoEncoderConfiguration(cfg) {
  return `<trt:GetVideoEncoderConfigurationResponse>
      ${videoEncoderConfig(cfg)}
    </trt:GetVideoEncoderConfigurationResponse>`;
}

function getStreamUri(cfg) {
  return `<trt:GetStreamUriResponse>
      <trt:MediaUri>
        <tt:Uri>${cfg.stream.rtspUrl}</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT30S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetStreamUriResponse>`;
}

function getSnapshotUri(cfg) {
  return `<trt:GetSnapshotUriResponse>
      <trt:MediaUri>
        <tt:Uri>${baseUrl(cfg)}/onvif/snapshot.jpg</tt:Uri>
        <tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>
        <tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>
        <tt:Timeout>PT30S</tt:Timeout>
      </trt:MediaUri>
    </trt:GetSnapshotUriResponse>`;
}

const handlers = {
  GetProfiles: (cfg) => getProfiles(cfg),
  GetProfile: (cfg) => getProfile(cfg),
  GetVideoSources: (cfg) => getVideoSources(cfg),
  GetVideoSourceConfigurations: (cfg) => getVideoSourceConfigurations(cfg),
  GetVideoSourceConfiguration: () => getVideoSourceConfiguration(),
  GetVideoEncoderConfigurations: (cfg) => getVideoEncoderConfigurations(cfg),
  GetVideoEncoderConfiguration: (cfg) => getVideoEncoderConfiguration(cfg),
  GetStreamUri: (cfg) => getStreamUri(cfg),
  GetSnapshotUri: (cfg) => getSnapshotUri(cfg),
  GetServiceCapabilities: () => `<trt:GetServiceCapabilitiesResponse></trt:GetServiceCapabilitiesResponse>`,
};

module.exports = { handlers };
