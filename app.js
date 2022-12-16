const Emitter = require('events');
const assert = require('assert');
const transform = require('sdp-transform');
const { v4: uuidv4 } = require('uuid');
const {
  getBoundaryTag,
  getSipRecSdp
} = require('./utils')(process.env.JAMBONES_SIPREC_TYPE);
const boundaryTag = getBoundaryTag();

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
  aorFrom,
  aorTo,
  callingNumber,
  calledNumber,
  direction
}) => {
  const groupId = uuidv4();
  const sessionId = uuidv4();
  const uuidStream1 = uuidv4();
  const uuidStream2 = uuidv4();
  const participant1 = uuidv4();
  const participant2 = uuidv4();
  const sipSessionId = originalInvite.get('Call-ID');
  const { originator = 'unknown', carrier = 'unknown' } = originalInvite.locals;

  return getSipRecSdp({
    boundaryTag,
    callSid,
    direction,
    accountSid,
    applicationSid,
    srsRecordingId,
    originator,
    carrier,
    callingNumber,
    calledNumber,
    sipSessionId,
    sessionId,
    participant1,
    participant2,
    uuidStream1,
    uuidStream2,
    aorFrom,
    aorTo,
    groupId,
    sdp
  });
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
      unsubscribe
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
  }

  async start() {
    assert(!this.activated);

    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'from-tag': this.sipRecFromTag
    };

    let response = await this.subscribeRequest({ ...opts, label: '1', flags: ['all'], interface: 'public' });
    if (response.result !== 'ok') {
      this.logger.error({ response, opts }, 'SrsClient:start error calling subscribe request');
      throw new Error('error calling subscribe request');
    }
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
          'Supported': 'replaces,resource-priority,sdp-anat',
          'Allow': 'REGISTER,OPTIONS,INVITE,ACK,CANCEL,BYE,NOTIFY,PRACK,REFER,INFO,SUBSCRIBE,UPDATE',
          'Content-Type': 'multipart/mixed;boundary=' + boundaryTag.replace('--', ''),
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
      'from-tag': this.sipRecFromTag
    };

    this.del(opts)
      .catch((err) => this.logger.info({ err }, 'Error deleting siprec media session'));
    this.uac.destroy().catch(() => { });
    this.activated = false;
    return true;
  }

  async pause() {
    if (this.paused) return;
    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'from-tag': this.sipRecFromTag
    };
    try {
      const parsed = transform.parse(this.sdpOffer);
      parsed.origin.sessionVersion = incrementVersion(parsed.origin.sessionVersion);
      this.sdpOffer = transform.write(parsed).replace(/sendonly/g, 'inactive');
      await this.blockMedia(opts);
      await this.uac.modify(this.sdpOffer);
      this.paused = true;
      return true;
    } catch (err) {
      this.logger.info({ err }, 'Error pausing siprec media session');
    }
    return false;
  }

  async resume() {
    if (!this.paused) return;
    const opts = {
      'call-id': this.rtpEngineOpts.common['call-id'],
      'from-tag': this.sipRecFromTag
    };
    try {
      const parsed = transform.parse(this.sdpOffer);
      parsed.origin.sessionVersion = incrementVersion(parsed.origin.sessionVersion);
      this.sdpOffer = transform.write(parsed).replace(/inactive/g, 'sendonly');
      await this.blockMedia(opts);
      await this.uac.modify(this.sdpOffer);
    } catch (err) {
      this.logger.info({ err }, 'Error resuming siprec media session');
    }
    return true;
  }
}

module.exports = SrsClient;
