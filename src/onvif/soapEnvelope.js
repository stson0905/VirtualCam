function envelope(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
  xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:tt="http://www.onvif.org/ver10/schema"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:tns1="http://www.onvif.org/ver10/topics">
  <SOAP-ENV:Body>
    ${body}
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function fault(reason, code = 'Receiver') {
  return envelope(`<SOAP-ENV:Fault>
      <SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:${code}</SOAP-ENV:Value></SOAP-ENV:Code>
      <SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">${reason}</SOAP-ENV:Text></SOAP-ENV:Reason>
    </SOAP-ENV:Fault>`);
}

module.exports = { envelope, fault };
