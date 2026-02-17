import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function parseIntSafe(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getPlaytimeStats() {
  const now = Date.now();
  const activeCutoff = now - (120 * 1000);
  await redis.zremrangebyscore('play:active', 0, activeCutoff);

  const [stats, activeSessions] = await Promise.all([
    redis.hgetall('play:stats'),
    redis.zcount('play:active', activeCutoff, '+inf'),
  ]);

  const totalSeconds = parseIntSafe(stats?.totalSeconds);
  const endedSessions = parseIntSafe(stats?.endedSessions);

  return {
    totalSeconds,
    totalHours: Number((totalSeconds / 3600).toFixed(2)),
    totalSessions: parseIntSafe(stats?.totalSessions),
    endedSessions,
    avgSessionSeconds: endedSessions > 0 ? Math.round(totalSeconds / endedSessions) : 0,
    activeSessions: parseIntSafe(activeSessions),
  };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cache for 10s, serve stale for 30s while revalidating
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const playerName = req.query.player || '';

    // Get top run IDs with scores from sorted set (highest first)
    // @upstash/redis zrange with withScores returns [{member, score}, ...]
    const topResults = await redis.zrange('leaderboard', 0, limit - 1, { rev: true, withScores: true });

    // Extract IDs and fetch all run data in parallel (fixes N+1 sequential query bottleneck)
    const ids = topResults.map(item => typeof item === 'object' ? (item.member || item.value) : item);
    const scores = topResults.map(item => typeof item === 'object' ? item.score : 0);

    const runDataPromises = ids.map(id => redis.hgetall(`run:${id}`));
    const allRunData = await Promise.all(runDataPromises);

    // Build entries, preserving sorted set rank even when some entries have expired
    const entries = [];
    for (let i = 0; i < ids.length; i++) {
      const data = allRunData[i];
      if (data && data.name) {
        entries.push({
          rank: i + 1, // rank from sorted set position, not filtered array index
          id: ids[i],
          name: data.name,
          score: parseInt(data.score) || scores[i] || 0,
          floor: parseInt(data.floor) || 1,
          kills: parseInt(data.kills) || 0,
          level: parseInt(data.level) || 1,
          time: parseFloat(data.time) || 0,
          bossKills: parseInt(data.bossKills) || 0,
          bbEarned: parseInt(data.bbEarned) || 0,
          viewers: parseInt(data.viewers) || 0,
          classId: data.classId || '',
          raceId: data.raceId || '',
          victory: data.victory === 'true' || data.victory === true,
          timestamp: parseInt(data.timestamp) || 0,
        });
      }
    }

    // Player's personal best
    let playerBest = null;
    if (playerName) {
      const normalized = playerName.toLowerCase().trim();
      const bestResults = await redis.zrange(`player:${normalized}`, 0, 0, { rev: true });
      if (bestResults && bestResults.length > 0) {
        const bestId = typeof bestResults[0] === 'object' ? (bestResults[0].member || bestResults[0].value) : bestResults[0];
        const bestData = await redis.hgetall(`run:${bestId}`);
        if (bestData && bestData.name) {
          const bestRank = await redis.zrevrank('leaderboard', bestId);
          playerBest = {
            rank: bestRank !== null ? bestRank + 1 : null,
            id: bestId,
            name: bestData.name,
            score: parseInt(bestData.score) || 0,
            floor: parseInt(bestData.floor) || 1,
            kills: parseInt(bestData.kills) || 0,
            level: parseInt(bestData.level) || 1,
            classId: bestData.classId || '',
            victory: bestData.victory === 'true' || bestData.victory === true,
          };
        }
      }
    }

    const [total, playtimeStats] = await Promise.all([
      redis.zcard('leaderboard'),
      getPlaytimeStats(),
    ]);

    return res.status(200).json({ entries, total, playerBest, playtimeStats });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
