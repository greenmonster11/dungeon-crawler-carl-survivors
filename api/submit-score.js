import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Valid class and race IDs
const VALID_CLASSES = ['pugilist', 'berserker', 'elementalist', 'trapper', 'beastmaster', 'necromancer'];
const VALID_RACES = ['human', 'primal', 'halfElf', 'goblin'];

// Simple djb2 hash — must match client-side implementation
function computeChecksum(name, floor, kills, level, time, bossKills, bbEarned, viewers, classId, raceId) {
  const SECRET = 'dcc_survivors_2024';
  const str = [name, floor, kills, level, Math.floor(time), bossKills, bbEarned, viewers, classId, raceId, SECRET].join('|');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16);
}

// Compute composite score server-side
function computeScore(data) {
  return (data.floor * 1000)
    + (data.bossKills * 500)
    + (data.kills * 2)
    + (data.level * 50)
    + Math.floor(data.viewers / 100)
    + (data.victory ? 5000 : 0)
    - Math.floor(data.time / 10);
}

// Sanitize player name
function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  // Strip HTML, limit chars
  let clean = name.replace(/<[^>]*>/g, '').replace(/[^\w\s\-_.!]/g, '').trim();
  if (clean.length < 2) return '';
  if (clean.length > 16) clean = clean.substring(0, 16);
  return clean;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Rate limiting (1 per 30s per IP)
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
    const rateLimitKey = `rl:${ip}`;
    const current = await redis.incr(rateLimitKey);
    if (current === 1) await redis.expire(rateLimitKey, 30);
    if (current > 2) {
      return res.status(429).json({ error: 'Too many submissions. Wait 30 seconds.' });
    }

    // Daily limit (20 per day per IP)
    const dailyKey = `dl:${ip}`;
    const dailyCount = await redis.incr(dailyKey);
    if (dailyCount === 1) await redis.expire(dailyKey, 86400);
    if (dailyCount > 20) {
      return res.status(429).json({ error: 'Daily submission limit reached.' });
    }

    const body = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Missing request body' });
    }

    // Validate and parse fields
    const name = sanitizeName(body.name);
    if (!name) {
      return res.status(400).json({ error: 'Invalid name (2-16 characters required)' });
    }

    const floor = parseInt(body.floor);
    const kills = parseInt(body.kills);
    const level = parseInt(body.level);
    const time = parseFloat(body.time);
    const bossKills = parseInt(body.bossKills);
    const bbEarned = parseInt(body.bbEarned);
    const viewers = parseInt(body.viewers);
    const classId = String(body.classId || '');
    const raceId = String(body.raceId || '');
    const victory = !!body.victory;
    const checksum = String(body.checksum || '');

    // Plausibility validation
    if (isNaN(floor) || floor < 1 || floor > 9) {
      return res.status(400).json({ error: 'Invalid floor (1-9)' });
    }
    if (isNaN(kills) || kills < 0 || kills > 5000) {
      return res.status(400).json({ error: 'Invalid kills' });
    }
    if (isNaN(level) || level < 1 || level > 60) {
      return res.status(400).json({ error: 'Invalid level' });
    }
    if (isNaN(time) || time < 20) {
      return res.status(400).json({ error: 'Invalid time' });
    }
    if (isNaN(bossKills) || bossKills < 0 || bossKills > floor) {
      return res.status(400).json({ error: 'Invalid boss kills' });
    }
    if (isNaN(bbEarned) || bbEarned < 0) {
      return res.status(400).json({ error: 'Invalid BB earned' });
    }
    if (isNaN(viewers) || viewers < 0) {
      return res.status(400).json({ error: 'Invalid viewers' });
    }
    if (!VALID_CLASSES.includes(classId)) {
      return res.status(400).json({ error: 'Invalid class' });
    }
    if (!VALID_RACES.includes(raceId)) {
      return res.status(400).json({ error: 'Invalid race' });
    }
    if (victory && (floor < 9 || bossKills < 9)) {
      return res.status(400).json({ error: 'Invalid victory claim' });
    }

    // Verify checksum
    const expectedChecksum = computeChecksum(name, floor, kills, level, time, bossKills, bbEarned, viewers, classId, raceId);
    if (checksum !== expectedChecksum) {
      return res.status(400).json({ error: 'Invalid checksum' });
    }

    // Compute score server-side
    const data = { floor, kills, level, time, bossKills, viewers, victory };
    const score = computeScore(data);

    // Generate unique ID
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    // Store run data
    const runData = {
      id, name, score, floor, kills, level,
      time: Math.round(time),
      bossKills, bbEarned, viewers,
      classId, raceId,
      victory: victory.toString(),
      timestamp,
    };

    await redis.hset(`run:${id}`, runData);
    await redis.expire(`run:${id}`, 7776000); // 90 days

    // Add to leaderboard sorted set
    await redis.zadd('leaderboard', { score, member: id });

    // Add to player's personal set
    const normalizedName = name.toLowerCase().trim();
    await redis.zadd(`player:${normalizedName}`, { score, member: id });

    // Get rank
    const rank = await redis.zrevrank('leaderboard', id);

    return res.status(200).json({
      success: true,
      id,
      score,
      rank: rank !== null ? rank + 1 : null,
    });
  } catch (err) {
    console.error('Submit score error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
