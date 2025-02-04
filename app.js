const Emitter = require('events');
const assert = require('assert');
const transform = require('sdp-transform');
const { v4: uuidv4 } = require('uuid');
let BoundaryTag = '--uniqueBoundary';

if (process.env.JAMBONES_SIPREC_TYPE == 'SMART_TAP') {
  BoundaryTag = '--boundary_ac18f3';
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function(c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

const incrementVersion = (version) => {
  console.log(`started with ${version}`);
  const arr = [];
  const str = '' + version;
  if (str.length > 10) {
    arr.push(str.slice(0, 10));
    arr.push(str.slice(10));
  }
  else {
    arr.push(str);
  }
  const added = '' + (parseInt(arr.pop()) + 1);
  arr.push(added);
  const result = arr.join('');
  console.log(`ended with ${result}`);
  return result;
};

const createMultipartSdp = (sdp, {
  originalInvite,
  srsRecordingId,
  callSid,
  accountSid,
  applicationSid,
  sipCallId,
  aorFrom,
  aorTo,
  callingNumber,
  calledNumber,
  direction
}) => {
  var now = new Date().toISOString();
  now = now.slice(0, now.length - 5);
  const groupId = uuidv4();
  const sessionId = uuidv4();
  const uuidStream1 = uuidv4();
  const uuidStream2 = uuidv4();
  const participant1 = uuidv4();
  const participant2 = uuidv4();
  const sipSessionId = originalInvite.get('Call-ID');
  const { originator = 'unknown', carrier = 'unknown' } = originalInvite.locals;

  if (process.env.JAMBONES_SIPREC_TYPE == 'SMART_TAP') {

    const x = `${BoundaryTag}
Content-Type: application/sdp

--sdp-placeholder--
${BoundaryTag}
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
      .replace(/\n/g, '\r\n')
      .replace('--sdp-placeholder--', sdp);
    return `${x}\r\n${BoundaryTag}--`;
  } else {
    const x = `${BoundaryTag}
Content-Disposition: session;handling=required
Content-Type: application/sdp

--sdp-placeholder--
${BoundaryTag}
Content-Disposition: recording-session
Content-Type: application/rs-metadata+xml

<?xml version="1.0" encoding="UTF-8"?>
<recording xmlns="urn:ietf:params:xml:ns:recording:1">
  <datamode>complete</datamode>
  <session session_id="${sessionId}">
    <sipSessionID>${sipSessionId}</sipSessionID>
  </session>
  <extensiondata xmlns:jb="http://jambonz.org/siprec">
    <jb:callsid>${callSid}</jb:callsid>
    <jb:direction>${direction}</jb:direction>
    <jb:accountsid>${accountSid}</jb:accountsid>
    <jb:applicationsid>${applicationSid}</jb:applicationsid>
    <jb:recordingid>${srsRecordingId}</jb:recordingid>
    <jb:originationsource>${originator}</jb:originationsource>
    <jb:carrier>${escapeXml(carrier)}</jb:carrier>
    <jb:callednumber>${callingNumber}</jb:callednumber>
    <jb:callingnumber>${calledNumber}</jb:callingnumber>
  </extensiondata>
  <participant participant_id="${participant1}">
    <nameID aor="${aorFrom}">
      <name>${callingNumber}</name>
    </nameID>
  </participant>
  <participantsessionassoc participant_id="${participant1}" session_id="${sessionId}">
  </participantsessionassoc>
  <stream stream_id="${uuidStream1}" session_id="${sessionId}">
    <label>1</label>
  </stream>
  <participant participant_id="${participant2}">
    <nameID aor="${aorTo}">
      <name>${calledNumber}</name>
    </nameID>
  </participant>
  <participantsessionassoc participant_id="${participant2}" session_id="${sessionId}">
  </participantsessionassoc>
  <stream stream_id="${uuidStream2}" session_id="${sessionId}">
    <label>2</label>
  </stream>
  <participantstreamassoc participant_id="${participant1}">
    <send>${uuidStream1}</send>
    <recv>${uuidStream2}</recv>
  </participantstreamassoc>
  <participantstreamassoc participant_id="${participant2}">
    <send>${uuidStream2}</send>
    <recv>${uuidStream1}</recv>
  </participantstreamassoc>
</recording>`
      .replace(/\n/g, '\r\n')
      .replace('--sdp-placeholder--', sdp);
    return `${x}\r\n${BoundaryTag}--`;
  }
};

class SrsClient extends Emitter {
  constructor(logger, opts) {
    super();
    const {
      srf,
      direction,
      originalInvite,
      calledNumber,
      callingNumber,
      srsUrl,
      srsRecordingId,
      callSid,
      accountSid,
      applicationSid,
      srsDestUserName,
      rtpEngineOpts,
      //fromTag,
      toTag,
      aorFrom,
      aorTo,
      subscribeRequest,
      subscribeAnswer,
      del,
      blockMedia,
      unblockMedia,
      unsubscribe,
      headers
    } = opts;
    this.logger = logger;
    this.srf = srf;
    this.direction = direction;
    this.originalInvite = originalInvite;
    this.callingNumber = callingNumber;
    this.calledNumber = calledNumber;
    this.subscribeRequest = subscribeRequest;
    this.subscribeAnswer = subscribeAnswer;
    this.del = del;
    this.blockMedia = blockMedia;
    this.unblockMedia = unblockMedia;
    this.unsubscribe = unsubscribe;
    this.srsUrl = srsUrl;
    this.srsRecordingId = srsRecordingId;
    this.callSid = callSid;
    this.accountSid = accountSid;
    this.applicationSid = applicationSid;
    this.srsDestUserName = srsDestUserName;
    this.rtpEngineOpts = rtpEngineOpts;
    this.sipRecFromTag = toTag;
    this.aorFrom = aorFrom;
    this.aorTo = aorTo;

    /* state */
    this.activated = false;
    this.paused = false;
    this.headers = headers || {};
  }

  async start() {
    assert(!this.activated);
    const codec = this.rtpEngineOpts.common['codec'];

    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'from-tag': this.sipRecFromTag,
      'transport protocol': 'RTP/AVP',
      'ICE': 'remove',
      'flags': [
        ...(process.env.JAMBONES_DISABLE_RTP_ADDRESS_LEARNING ? ['asymmetric'] : []),
        'allow transcoding'],
      // inherit codec flags from application.
      ...(process.env.JAMBONESE_SIPREC_TRANSCODE_ENABLED && codec && {codec})
    };

    let response = await this.subscribeRequest({ ...opts, label: '1', flags: ['all'], interface: 'public' });
    if (response.result !== 'ok') {
      this.logger.error({ response, opts }, 'SrsClient:start error calling subscribe request');
      throw new Error('error calling subscribe request');
    }
    this.siprecFromTags = response['from-tags'];
    this.siprecToTag = response['to-tag'];

    const parsed = transform.parse(response.sdp);
    parsed.name = 'jambonz Siprec Client';
    parsed.media[0].label = '1';
    parsed.media[1].label = '2';
    this.sdpOffer = transform.write(parsed);
    const sdp = createMultipartSdp(this.sdpOffer, {
      originalInvite: this.originalInvite,
      srsRecordingId: this.srsRecordingId,
      callSid: this.callSid,
      accountSid: this.accountSid,
      applicationSid: this.applicationSid,
      calledNumber: this.calledNumber,
      callingNumber: this.callingNumber,
      aorFrom: this.aorFrom,
      aorTo: this.aorTo,
      direction: this.direction
    });

    this.logger.info({ response }, `SrsClient: sending SDP ${sdp}`);

    /* */
    try {
      this.uac = await this.srf.createUAC(this.srsUrl, {
        headers: {
          ...this.headers,
          'Supported': 'replaces,resource-priority,sdp-anat',
          'Allow': 'REGISTER,OPTIONS,INVITE,ACK,CANCEL,BYE,NOTIFY,PRACK,REFER,INFO,SUBSCRIBE,UPDATE',
          'Content-Type': 'multipart/mixed;boundary=' + BoundaryTag.replace('--', ''),
          'Require': 'siprec',
          ...(process.env.JAMBONES_SIPREC_TYPE == 'SMART_TAP' && { 'x-audc-call-id': this.srsRecordingId })},
        localSdp: sdp
      });
    } catch (err) {
      this.logger.info({ err }, `Error sending SIPREC INVITE to ${this.srsUrl}`);
      throw err;
    }

    this.logger.info({ sdp: this.uac.remote.sdp }, `SrsClient:start - successfully connected to SRS ${this.srsUrl}`);
    response = await this.subscribeAnswer({
      ...opts,
      sdp: this.uac.remote.sdp,
      'to-tag': response['to-tag'],
      label: '2'
    });
    if (response.result !== 'ok') {
      this.logger.error({ response }, 'SrsClient:start error calling subscribe answer');
      throw new Error('error calling subscribe answer');
    }

    this.activated = true;
    this.logger.info('successfully established siprec connection');
    return true;
  }

  async stop() {
    if (!this.activated) return;
    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'from-tag': this.sipRecFromTag,
      'to-tag': this.siprecToTag
    };

    this.unsubscribe(opts)
      .catch((err) => this.logger.info({ err }, 'Error deleting siprec media session'));
    this.uac.destroy().catch(() => { });
    this.activated = false;
    return true;
  }

  async pause(options) {
    if (this.paused) return;
    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'all': 'except-offer-answer'
    };
    try {
      const parsed = transform.parse(this.sdpOffer);
      parsed.origin.sessionVersion = incrementVersion(parsed.origin.sessionVersion);
      this.sdpOffer = transform.write(parsed).replace(/sendonly/g, 'inactive');
      for (const fromTag of this.siprecFromTags) {
        await this.blockMedia({
          ...opts,
          'from-tag': fromTag
        });
      }
      await this.uac.modify(this.sdpOffer, {
        headers: options?.headers || {}
      });
      this.paused = true;
      return true;
    } catch (err) {
      this.logger.info({ err }, 'Error pausing siprec media session');
    }
    return false;
  }

  async resume(options) {
    if (!this.paused) return;
    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'all': 'except-offer-answer'
    };
    try {
      const parsed = transform.parse(this.sdpOffer);
      parsed.origin.sessionVersion = incrementVersion(parsed.origin.sessionVersion);
      this.sdpOffer = transform.write(parsed).replace(/inactive/g, 'sendonly');
      for (const fromTag of this.siprecFromTags) {
        await this.unblockMedia({
          ...opts,
          'from-tag': fromTag
        });
      }
      await this.uac.modify(this.sdpOffer, {
        headers: options?.headers || {}
      });
      this.paused = false;
      return true;
    } catch (err) {
      this.logger.info({ err }, 'Error resuming siprec media session');
    }
    return false;
  }
}

module.exports = SrsClient;
