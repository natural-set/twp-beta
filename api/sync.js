// api/sync.js
// Persists TWP tracker state as a single JSON file committed to a GitHub repo,
// using the GitHub Contents API. Requires these Vercel Environment Variables:
//
//   GITHUB_TOKEN   - a GitHub Personal Access Token (classic) with "repo" scope,
//                    or a fine-grained token with Contents: Read & Write on the repo
//   GITHUB_OWNER   - your GitHub username or org, e.g. "natural-set"
//   GITHUB_REPO    - the repo name, e.g. "twp-beta"
//   GITHUB_PATH    - (optional) path to the JSON file in the repo,
//                    defaults to "data/twp-sync.json"
//   GITHUB_BRANCH  - (optional) branch to commit to, defaults to "main"
//
// GET  /api/sync  -> returns the current state JSON ({ workouts, userName, profile, customTags, timestamp })
// POST /api/sync  -> body: { deviceId, state: { workouts, userName, profile, customTags, timestamp } }
//                    merges into the stored file and commits it to GitHub.
// https://github.com/settings/tokens

module.exports = async function handler(req, res) {
  const {
    GITHUB_TOKEN,
    GITHUB_OWNER = 'natural-set',
    GITHUB_REPO = 'twp-beta',
    GITHUB_PATH = 'data/twp-sync.json',
    GITHUB_BRANCH = 'main',
  } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    res.status(500).json({
      message: 'Server misconfigured: set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in Vercel env vars',
    });
    return;
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}`;
  const ghHeaders = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'twp-sync-function',
  };

  const emptyState = { workouts: [], userName: 'Athlete', profile: {}, customTags: [], timestamp: 0 };

  try {
    if (req.method === 'GET') {
      const fileResp = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });

      if (fileResp.status === 404) {
        res.status(200).json(emptyState);
        return;
      }
      if (!fileResp.ok) {
        const t = await fileResp.text();
        res.status(502).json({ message: 'GitHub read failed: ' + t });
        return;
      }

      const fileJson = await fileResp.json();
      const content = Buffer.from(fileJson.content, 'base64').toString('utf-8');
      let data;
      try { data = JSON.parse(content); } catch (e) { data = emptyState; }
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const incoming = body.state || body;

      // Fetch current file for its sha (needed to update) and to merge instead of clobber.
      let sha;
      let current = emptyState;
      const fileResp = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
      if (fileResp.ok) {
        const fileJson = await fileResp.json();
        sha = fileJson.sha;
        try {
          current = JSON.parse(Buffer.from(fileJson.content, 'base64').toString('utf-8'));
        } catch (e) { /* keep emptyState */ }
      } else if (fileResp.status !== 404) {
        const t = await fileResp.text();
        res.status(502).json({ message: 'GitHub read failed: ' + t });
        return;
      }

      // The client now pushes right after every local mutation (add, edit, delete,
      // import) with its full, already-authoritative state — so we overwrite rather
      // than union-merge. Union-merging would resurrect workouts the client just
      // deleted, since they'd still be sitting in the GitHub-stored "current" copy.

      // Compare content only — `timestamp` is bookkeeping that changes on every
      // request, so it's excluded here to avoid creating a commit (and a
      // duplicate-looking entry) when nothing about the actual data changed.
      const beforeStr = JSON.stringify({
        workouts: current.workouts || [],
        userName: current.userName,
        profile: current.profile || {},
        customTags: current.customTags || [],
      });
      const afterStr = JSON.stringify({
        workouts: incoming.workouts || [],
        userName: incoming.userName,
        profile: incoming.profile || {},
        customTags: incoming.customTags || [],
      });

      if (afterStr === beforeStr) {
        res.status(200).json({ ok: true, unchanged: true, workouts: (incoming.workouts || []).length });
        return;
      }

      const merged = { ...incoming, timestamp: Date.now() };
      const newContentB64 = Buffer.from(JSON.stringify(merged, null, 2)).toString('base64');

      const putResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Sync update ${new Date().toISOString()} (device ${body.deviceId || 'unknown'})`,
          content: newContentB64,
          branch: GITHUB_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });

      if (!putResp.ok) {
        const t = await putResp.text();
        res.status(502).json({ message: 'GitHub write failed: ' + t });
        return;
      }

      res.status(200).json({ ok: true, unchanged: false, workouts: merged.workouts.length });
      return;
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).json({ message: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ message: err && err.message ? err.message : 'Unknown server error' });
  }
};

function mergeState(current, incoming) {
  const byId = new Map();
  (current.workouts || []).forEach(w => byId.set(w.id, w));
  (incoming.workouts || []).forEach(w => byId.set(w.id, w)); // incoming (client) wins on same id
  const workouts = Array.from(byId.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
  return {
    workouts,
    userName: incoming.userName || current.userName || 'Athlete',
    profile: { ...(current.profile || {}), ...(incoming.profile || {}) },
    customTags: Array.from(new Set([...(current.customTags || []), ...(incoming.customTags || [])])),
    timestamp: Date.now(),
  };
}