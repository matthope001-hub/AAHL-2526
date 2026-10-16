/**
 * FirestoreCRUD.gs
 * Generic read/write helpers for Firestore REST API.
 * Depends on FirebaseAuth.gs (getFirebaseAccessToken, getFirebaseProjectId, FIRESTORE_BASE)
 *
 * NOTE: functions here are suffixed _Firestore_ rather than being named
 * fsGet/fsSet/fsList/fsDelete directly. That's because SupabaseCRUD.gs now
 * exists alongside this file with the same interface, and Apps Script
 * merges all .gs files into one global scope - two files each defining a
 * plain fsGet() would silently collide. DbSwitch.gs defines the real
 * fsGet/fsSet/fsList/fsDelete functions and routes to whichever backend
 * DB_BACKEND points at.
 */

function fsBaseUrl_() {
  const projectId = getFirebaseProjectId();
  return `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents`;
}

function fsHeaders_() {
  return { Authorization: 'Bearer ' + getFirebaseAccessToken() };
}

/**
 * Converts a plain JS object into Firestore's typed field format.
 */
function fsEncode_(obj) {
  const fields = {};
  for (const key in obj) {
    fields[key] = fsEncodeValue_(obj[key]);
  }
  return { fields };
}

function fsEncodeValue_(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: val } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(fsEncodeValue_) } };
  }
  if (typeof val === 'object') {
    return { mapValue: fsEncode_(val) };
  }
  return { stringValue: String(val) };
}

/**
 * Converts Firestore's typed field format back into a plain JS object.
 */
function fsDecode_(fields) {
  const obj = {};
  for (const key in fields) {
    obj[key] = fsDecodeValue_(fields[key]);
  }
  return obj;
}

function fsDecodeValue_(val) {
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fsDecodeValue_);
  }
  if ('mapValue' in val) {
    return fsDecode_(val.mapValue.fields || {});
  }
  return null;
}

/**
 * Get a single document. Returns null if not found.
 * collection: e.g. 'entries', docId: e.g. 'abc123'
 */
function fsGetFirestore_(collection, docId) {
  const url = `${fsBaseUrl_()}/${collection}/${docId}`;
  const response = UrlFetchApp.fetch(url, { headers: fsHeaders_(), muteHttpExceptions: true });
  if (response.getResponseCode() === 404) return null;
  const json = JSON.parse(response.getContentText());
  return fsDecode_(json.fields || {});
}

/**
 * Set (overwrite) a document at collection/docId.
 */
function fsSetFirestore_(collection, docId, data) {
  const url = `${fsBaseUrl_()}/${collection}/${docId}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: fsHeaders_(),
    payload: JSON.stringify(fsEncode_(data)),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200) throw new Error(`fsSetFirestore_ failed (${code}): ${response.getContentText()}`);
  return true;
}

/**
 * List all documents in a collection. Returns array of {id, ...fields}.
 * Paginates through all pages. Cached for 5 minutes (chunked, since
 * CacheService caps each key at 100KB and large collections exceed that)
 * to avoid burning through Firestore's free-tier daily read quota.
 */
function fsListFirestore_(collection, skipCache) {
  const cache = CacheService.getScriptCache();
  const chunkCountKey = 'fslist_' + collection + '_chunks';

  if (!skipCache) {
    const chunkCountRaw = cache.get(chunkCountKey);
    if (chunkCountRaw) {
      const chunkCount = parseInt(chunkCountRaw, 10);
      const chunkKeys = [];
      for (let i = 0; i < chunkCount; i++) chunkKeys.push('fslist_' + collection + '_c' + i);
      const chunks = cache.getAll(chunkKeys);
      if (Object.keys(chunks).length === chunkCount) {
        let results = [];
        for (let i = 0; i < chunkCount; i++) {
          results = results.concat(JSON.parse(chunks['fslist_' + collection + '_c' + i]));
        }
        return results;
      }
    }
  }

  const results = [];
  let pageToken = null;

  do {
    let url = `${fsBaseUrl_()}/${collection}?pageSize=300`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const response = UrlFetchApp.fetch(url, { headers: fsHeaders_(), muteHttpExceptions: true });
    const json = JSON.parse(response.getContentText());

    (json.documents || []).forEach(doc => {
      const id = doc.name.split('/').pop();
      results.push(Object.assign({ id }, fsDecode_(doc.fields || {})));
    });

    pageToken = json.nextPageToken || null;
  } while (pageToken);

  try {
    const CHUNK_SIZE = 150;
    const chunkMap = {};
    let chunkCount = 0;
    for (let i = 0; i < results.length; i += CHUNK_SIZE) {
      chunkMap['fslist_' + collection + '_c' + chunkCount] = JSON.stringify(results.slice(i, i + CHUNK_SIZE));
      chunkCount++;
    }
    cache.putAll(chunkMap, 300); // 5 min
    cache.put(chunkCountKey, String(chunkCount), 300);
  } catch (e) {
    // Caching failed - not fatal, just means this call wasn't cached.
  }

  return results;
}

/**
 * Clears the cache for a collection. Call after writes that should be
 * immediately reflected (e.g. after seeding). Shared across both backends
 * since it's just a cache-key helper, not Firestore-specific.
 */
function clearListCache(collection) {
  const cache = CacheService.getScriptCache();
  const chunkCountRaw = cache.get('fslist_' + collection + '_chunks');
  if (chunkCountRaw) {
    const chunkCount = parseInt(chunkCountRaw, 10);
    for (let i = 0; i < chunkCount; i++) cache.remove('fslist_' + collection + '_c' + i);
    cache.remove('fslist_' + collection + '_chunks');
  }
}

/**
 * Delete a document.
 */
function fsDeleteFirestore_(collection, docId) {
  const url = `${fsBaseUrl_()}/${collection}/${docId}`;
  const response = UrlFetchApp.fetch(url, { method: 'delete', headers: fsHeaders_(), muteHttpExceptions: true });
  return response.getResponseCode() === 200;
}

/**
 * Test: writes a doc, reads it back, lists collection, deletes it.
 * Tests the Firestore backend directly, bypassing the DB_BACKEND switch.
 */
function testFirestoreCRUD() {
  fsSetFirestore_('players', 'testPlayer1', { fullName: 'Test Player', team: 'TOR', stats: { goals: 5, assists: 3 } });
  Logger.log('Written.');

  const doc = fsGetFirestore_('players', 'testPlayer1');
  Logger.log(JSON.stringify(doc));

  const list = fsListFirestore_('players');
  Logger.log(JSON.stringify(list));

  fsDeleteFirestore_('players', 'testPlayer1');
  Logger.log('Deleted.');
}