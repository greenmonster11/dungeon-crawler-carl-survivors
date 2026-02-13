import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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
    const topResults = await redis.zrange('leaderboard', 0, limit - 1, { rev: true, withScores: true });

    // topResults is an array of [member, score, member, score, ...]
    // With @upstash/redis it returns [{member, score}, ...] when withScores is true
    const entries = [];

    for (let i = 0; i < topResults.length; i++) {
      const item = topResults[i];
      const id = typeof item === 'object' ? item.member || item.value : item;
      const score = typeof item === 'object' ? item.score : topResults[i + 1];

      if (typeof item !== 'object') {
        // Skip score entries in flat array format
        if (i % 2 !== 0) continue;
        i++; // skip next (score)
      }

      const data = await redis.hgetall(`run:${id}`);
      if (data && data.name) {
        entries.push({
          rank: entries.length + 1,
          id: id,
          name: data.name,
          score: parseInt(data.score) || 0,
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

    const total = await redis.zcard('leaderboard');

    return res.status(200).json({ entries, total, playerBest });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
