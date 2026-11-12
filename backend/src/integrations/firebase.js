async function sendPush(token, message) {
  if (!token) return { sent: false, reason: 'Device has no FCM token' };
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return { sent: false, reason: 'FCM is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH to enable push.' };
  }
  return {
    sent: false,
    reason: 'The Firebase Admin adapter is present, but credentials have not been activated in this environment.',
    preview: { token, title: message.title },
  };
}

module.exports = { sendPush };
