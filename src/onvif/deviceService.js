function baseUrl(cfg) {
  return `http://${cfg.network.advertiseAddress}:${cfg.network.httpPort}`;
}

function getSystemDateAndTime() {
  const now = new Date();
  return `<tds:GetSystemDateAndTimeResponse>
      <tds:SystemDateAndTime>
        <tt:DateTimeType>Manual</tt:DateTimeType>
        <tt:DaylightSavings>false</tt:DaylightSavings>
        <tt:UTCDateTime>
          <tt:Time>
            <tt:Hour>${now.getUTCHours()}</tt:Hour>
            <tt:Minute>${now.getUTCMinutes()}</tt:Minute>
            <tt:Second>${now.getUTCSeconds()}</tt:Second>
          </tt:Time>
          <tt:Date>
            <tt:Year>${now.getUTCFullYear()}</tt:Year>
            <tt:Month>${now.getUTCMonth() + 1}</tt:Month>
            <tt:Day>${now.getUTCDate()}</tt:Day>
          </tt:Date>
        </tt:UTCDateTime>
      </tds:SystemDateAndTime>
    </tds:GetSystemDateAndTimeResponse>`;
}

function getDeviceInformation(cfg) {
  const d = cfg.device;
  return `<tds:GetDeviceInformationResponse>
      <tds:Manufacturer>${d.manufacturer}</tds:Manufacturer>
      <tds:Model>${d.model}</tds:Model>
      <tds:FirmwareVersion>${d.firmwareVersion}</tds:FirmwareVersion>
      <tds:SerialNumber>${d.serialNumber}</tds:SerialNumber>
      <tds:HardwareId>${d.hardwareId}</tds:HardwareId>
    </tds:GetDeviceInformationResponse>`;
}

function getCapabilities(cfg) {
  const base = baseUrl(cfg);
  return `<tds:GetCapabilitiesResponse>
      <tds:Capabilities>
        <tt:Device>
          <tt:XAddr>${base}/onvif/device_service</tt:XAddr>
          <tt:Network>
            <tt:IPFilter>false</tt:IPFilter>
            <tt:ZeroConfiguration>false</tt:ZeroConfiguration>
            <tt:IPVersion6>false</tt:IPVersion6>
            <tt:DynDNS>false</tt:DynDNS>
          </tt:Network>
          <tt:System>
            <tt:DiscoveryResolve>false</tt:DiscoveryResolve>
            <tt:DiscoveryBye>true</tt:DiscoveryBye>
            <tt:RemoteDiscovery>false</tt:RemoteDiscovery>
            <tt:SystemBackup>false</tt:SystemBackup>
            <tt:SystemLogging>false</tt:SystemLogging>
            <tt:FirmwareUpgrade>false</tt:FirmwareUpgrade>
            <tt:SupportedVersions>
              <tt:Major>2</tt:Major>
              <tt:Minor>60</tt:Minor>
            </tt:SupportedVersions>
          </tt:System>
        </tt:Device>
        <tt:Media>
          <tt:XAddr>${base}/onvif/media_service</tt:XAddr>
          <tt:StreamingCapabilities>
            <tt:RTPMulticast>false</tt:RTPMulticast>
            <tt:RTP_TCP>true</tt:RTP_TCP>
            <tt:RTP_RTSP_TCP>true</tt:RTP_RTSP_TCP>
          </tt:StreamingCapabilities>
        </tt:Media>
      </tds:Capabilities>
    </tds:GetCapabilitiesResponse>`;
}

function getServices(cfg) {
  const base = baseUrl(cfg);
  return `<tds:GetServicesResponse>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/device/wsdl</tds:Namespace>
        <tds:XAddr>${base}/onvif/device_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>60</tt:Minor></tds:Version>
      </tds:Service>
      <tds:Service>
        <tds:Namespace>http://www.onvif.org/ver10/media/wsdl</tds:Namespace>
        <tds:XAddr>${base}/onvif/media_service</tds:XAddr>
        <tds:Version><tt:Major>2</tt:Major><tt:Minor>60</tt:Minor></tds:Version>
      </tds:Service>
    </tds:GetServicesResponse>`;
}

function getScopes(cfg) {
  const d = cfg.device;
  const scopes = [
    'onvif://www.onvif.org/type/video_encoder',
    'onvif://www.onvif.org/type/Network_Video_Transmitter',
    `onvif://www.onvif.org/hardware/${encodeURIComponent(d.hardwareId)}`,
    `onvif://www.onvif.org/name/${encodeURIComponent(d.name)}`,
    `onvif://www.onvif.org/location/${encodeURIComponent(d.location)}`,
  ];
  return `<tds:GetScopesResponse>
      ${scopes.map((s) => `<tds:Scopes><tt:ScopeDef>Configurable</tt:ScopeDef><tt:ScopeItem>${s}</tt:ScopeItem></tds:Scopes>`).join('\n      ')}
    </tds:GetScopesResponse>`;
}

function getNetworkInterfaces() {
  return `<tds:GetNetworkInterfacesResponse>
      <tds:NetworkInterfaces token="eth0">
        <tt:Enabled>true</tt:Enabled>
        <tt:Info>
          <tt:Name>eth0</tt:Name>
          <tt:HwAddress>aa:bb:cc:dd:ee:01</tt:HwAddress>
          <tt:MTU>1500</tt:MTU>
        </tt:Info>
      </tds:NetworkInterfaces>
    </tds:GetNetworkInterfacesResponse>`;
}

function getUsers(cfg) {
  if (!cfg.auth.enabled) {
    return `<tds:GetUsersResponse></tds:GetUsersResponse>`;
  }
  return `<tds:GetUsersResponse>
      <tds:User>
        <tt:Username>${cfg.auth.username}</tt:Username>
        <tt:UserLevel>Administrator</tt:UserLevel>
      </tds:User>
    </tds:GetUsersResponse>`;
}

const handlers = {
  GetSystemDateAndTime: (cfg) => getSystemDateAndTime(),
  GetDeviceInformation: (cfg) => getDeviceInformation(cfg),
  GetCapabilities: (cfg) => getCapabilities(cfg),
  GetServices: (cfg) => getServices(cfg),
  GetServiceCapabilities: () => `<tds:GetServiceCapabilitiesResponse></tds:GetServiceCapabilitiesResponse>`,
  GetScopes: (cfg) => getScopes(cfg),
  GetNetworkInterfaces: (cfg) => getNetworkInterfaces(cfg),
  GetUsers: (cfg) => getUsers(cfg),
  GetHostname: (cfg) => `<tds:GetHostnameResponse><tds:HostnameInformation><tt:FromDHCP>false</tt:FromDHCP><tt:Name>${cfg.device.name.replace(/\s+/g, '-')}</tt:Name></tds:HostnameInformation></tds:GetHostnameResponse>`,
};

// GetSystemDateAndTime must be reachable without authentication per the ONVIF
// spec (clients use it to compute clock skew before they can even build a
// valid WS-Security digest for anything else).
const unauthenticatedActions = new Set(['GetSystemDateAndTime']);

module.exports = { handlers, unauthenticatedActions };
