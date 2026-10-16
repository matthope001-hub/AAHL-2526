/**
 * FirebaseAuth.gs
 * Handles OAuth token generation for Firestore REST API calls
 * using the service account stored in Script Properties.
 */

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';

/**
 * Returns a valid OAuth2 access token for the Firebase service account.
 * Caches token for ~55 min to avoid re-signing JWT every call.
 */
function getFirebaseAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('fb_access_token');
  if (cached) return cached;

  const saJson = PropertiesService.getScriptProperties().getProperty('FIREBASE_SA_JSON');
  if (!saJson) throw new Error('FIREBASE_SA_JSON not set in Script Properties');
  const sa = JSON.parse(saJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const encClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  const signInput = encHeader + '.' + encClaim;

  const signatureBytes = Utilities.computeRsaSha256Signature(signInput, sa.private_key);
  const encSignature = Utilities.base64EncodeWebSafe(signatureBytes);
  const jwt = signInput + '.' + encSignature;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (!result.access_token) {
    throw new Error('Failed to get access token: ' + response.getContentText());
  }

  cache.put('fb_access_token', result.access_token, 3300); // 55 min
  return result.access_token;
}

/**
 * Returns the project ID from the stored service account JSON.
 */
function getFirebaseProjectId() {
  const saJson = PropertiesService.getScriptProperties().getProperty('FIREBASE_SA_JSON');
  const sa = JSON.parse(saJson);
  return sa.project_id;
}

/**
 * Quick connectivity test - run manually from Apps Script editor.
 */
function testFirebaseAuth() {
  const token = getFirebaseAccessToken();
  const projectId = getFirebaseProjectId();
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents`;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}