const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const playbackTokens = new Map();

function localRoot() {
  return path.resolve(process.env.RECORDING_DIR || path.join(process.cwd(), 'storage', 'recordings'));
}

function saveLocal(buffer, mimeType) {
  const ext = /mp4|m4a|aac/.test(mimeType) ? 'm4a'
    : /wav/.test(mimeType) ? 'wav'
      : /ogg/.test(mimeType) ? 'ogg'
        : /3gpp|amr/.test(mimeType) ? '3gp'
          : 'mp3';
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.mkdirSync(localRoot(), { recursive: true });
  fs.writeFileSync(path.join(localRoot(), name), buffer);
  return `local:${name}`;
}

function openLocal(storageKey) {
  if (!String(storageKey).startsWith('local:')) return null;
  const name = String(storageKey).slice(6);
  if (!/^[\w.-]+$/.test(name)) return null;
  const root = localRoot();
  const file = path.resolve(root, name);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(file)) return null;
  return file;
}

function localPlayback(storageKey, mimeType) {
  if (!openLocal(storageKey)) return unavailable('The recording file is no longer on the server.');
  const token = crypto.randomBytes(24).toString('hex');
  playbackTokens.set(token, { key: storageKey, mime: mimeType || 'audio/mpeg', exp: Date.now() + 300000 });
  return { playable: true, url: `/api/v1/call-recordings/stream/${token}`, expiresIn: 300, reason: '' };
}

function readStream(token) {
  const row = playbackTokens.get(token);
  if (!row || row.exp < Date.now()) {
    playbackTokens.delete(token);
    return null;
  }
  const file = openLocal(row.key);
  if (!file) return null;
  return { file, mime: row.mime };
}

function storageConfig() {
  const bucket = process.env.RECORDING_S3_BUCKET || '';
  const region = process.env.RECORDING_S3_REGION || '';
  const accessKeyId = process.env.RECORDING_S3_ACCESS_KEY || '';
  const secretAccessKey = process.env.RECORDING_S3_SECRET || '';
  const endpoint = process.env.RECORDING_S3_ENDPOINT || '';
  return {
    configured: Boolean(bucket && region && accessKeyId && secretAccessKey),
    bucket,
    region,
    endpoint,
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
  };
}

function unavailable(reason) {
  return { playable: false, url: '', expiresIn: 0, reason };
}

async function signPlayback(recording) {
  const key = recording?.storageKey || '';
  if (String(key).startsWith('local:')) return localPlayback(key, recording.mimeType);
  if (!key) {
    return unavailable('No audio file is stored. A device app or telephony provider has to upload the recording before it can play.');
  }
  const config = storageConfig();
  if (!config.configured) {
    return unavailable('Recording storage is not configured on the server.');
  }
  let S3Client;
  let GetObjectCommand;
  let getSignedUrl;
  try {
    ({ S3Client, GetObjectCommand } = require('@aws-sdk/client-s3'));
    ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  } catch (error) {
    return unavailable('The recording storage library is not installed on the server.');
  }
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: Boolean(config.endpoint),
    credentials: config.credentials,
  });
  const expiresIn = Math.min(900, Math.max(60, Number(process.env.RECORDING_URL_SECONDS) || 300));
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn });
  return { playable: true, url, expiresIn, reason: '' };
}

function publicStatus() {
  const config = storageConfig();
  return {
    configured: config.configured,
    bucketSet: Boolean(config.bucket),
    endpointSet: Boolean(config.endpoint),
  };
}

module.exports = { signPlayback, publicStatus, saveLocal, readStream };
