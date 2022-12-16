const getBoundaryTag = (name) => {
  let boundaryTag;
  switch (name) {
    case 'SMART_TAP':
      boundaryTag = '--boundary_ac18f3';
      break;
    default:
      boundaryTag = '--uniqueBoundary';
      break;
  }
  return boundaryTag;
};

const getDefaultSipRecXML = () => {
};

const getSmartTapSipRecXML = ({
  boundaryTag,
  groupId,
  sessionId,
  participant1,
  participant2,
  uuidStream1,
  uuidStream2,
  aorFrom,
  aorTo,
}) => {
  const now = new Date().toISOString();
  now = now.slice(0, now.length - 5);
  Content-Type: application/sdp
  
  --sdp-placeholder--
  ${boundaryTag}
  Content-Disposition: recording-session
  Content-Type: application/rs-metadata
  
  <?xml version="1.0" encoding="UTF-8"?>
  <recording xmlns="urn:ietf:params:xml:ns:recording" xmlns:ac="http://AudioCodes">
    <datamode>complete</datamode>
    <group id="${groupId}">
      <associate-time>${now}</associate-time>
    </group>
    <session id="${sessionId}">
      <group-ref>${groupId}</group-ref>
      <associate-time>${now}</associate-time>
    </session>
    <participant id="${participant1}" session="${sessionId}">
      <nameID aor="${aorFrom.replace('sip:', '')}"></nameID>
      <associate-time>${now}</associate-time>
      <send>${uuidStream1}</send>
      <recv>${uuidStream2}</recv>
    </participant>
    <participant id="${participant2}" session="${sessionId}">
      <nameID aor="${aorTo.replace('sip:', '')}"></nameID>
      <associate-time>${now}</associate-time>
      <send>${uuidStream2}</send>
      <recv>${uuidStream1}</recv>
    </participant>
    <stream id="${uuidStream1}" session="${sessionId}">
      <label>1</label>
    </stream>
    <stream id="${uuidStream2}" session="${sessionId}">
      <label>2</label>
    </stream>
  </recording>`
        .replace('--sdp-placeholder--', sdp)
        .replace(/\n/g, '\r\n');
      return `${x}\r\n${boundaryTag}--`;
};

const getSipRecXML = (name) => {


};

module.exports = function(name) {
  return {
    getBoundaryTag: getBoundaryTag.bind(null, name),
    getSipRecXML: getSipRecXML.bind(null, name)
  };
};
