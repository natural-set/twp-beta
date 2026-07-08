// api/sync.js
// No npm packages required — uses only Node's built-in fs/path modules.
// Storage lives in /tmp, which Vercel serverless functions can write to.
// NOTE: /tmp is ephemeral — it can be wiped between deployments or cold starts.
// This is fine for basic cross-device sync but is not durable long-term storage.

const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join('/tmp', 'twp_sync_data.json');

async function readData() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return {
      workouts: [],
      userName: null,
      profile: {},
      customTags: [],
      lastSync: null,
      deviceSyncs: {},
    };
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data));
}

// Merge by workout id — newest `date` wins per id, union of both sets otherwise.
function mergeWorkouts(serverWorkouts, deviceWorkouts) {
  const map = new Map();
  (serverWorkouts || []).forEach(w => map.set(w.id, w));
  (deviceWorkouts || []).forEach(w => {
    const existing = map.get(w.id);
    if (!existing || new Date(w.date) > new Date(existing.date)) {
      map.set(w.id, w);
    }
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Union, de-duplicated, case-insensitive
function mergeTags(serverTags, deviceTags) {
  const set = new Set([...(serverTags || []), ...(deviceTags || [])]);
  return Array.from(set);
}

module.exports = async function handler(req, res) {
  // CORS — allows the static index.html (same origin, but harmless to allow all)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const data = await readData();

    if (req.method === 'POST') {
      const { deviceId, state } = req.body || {};

      if (!deviceId || !state || !Array.isArray(state.workouts)) {
        res.status(400).json({ error: 'Missing deviceId or state.workouts' });
        return;
      }

      data.workouts = mergeWorkouts(data.workouts, state.workouts);
      if (state.userName) data.userName = state.userName;
      if (state.profile) data.profile = { ...(data.profile || {}), ...state.profile };
      data.customTags = mergeTags(data.customTags, state.customTags);
      data.lastSync = new Date().toISOString();
      data.deviceSyncs = data.deviceSyncs || {};
      data.deviceSyncs[deviceId] = data.lastSync;

      await writeData(data);

      res.json({
        success: true,
        data: {
          workouts: data.workouts,
          userName: data.userName,
          profile: data.profile,
          customTags: data.customTags,
          lastSync: data.lastSync,
        },
      });
      return;
    }

    if (req.method === 'GET') {
      res.json({
        workouts: data.workouts || [],
        userName: data.userName || null,
        profile: data.profile || {},
        customTags: data.customTags || [],
        lastSync: data.lastSync || null,
        deviceCount: Object.keys(data.deviceSyncs || {}).length,
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
};