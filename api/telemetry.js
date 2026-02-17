import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ACTIVE_WINDOW_SECONDS = 120;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function parseIntSafe(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function sanitizeId(value, maxLen = 96) {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  if (!clean || clean.length > maxLen) return '';
  if (!/^[a-zA-Z0-9_-]+$/.test(clean)) return '';
  return clean;
}

function sanitizeBossAbility(value) {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  if (!clean || clean.length > 40) return '';
  if (!/^[a-zA-Z0-9_-]+$/.test(clean)) return '';
  return clean;
}

async function readStats(now) {
  const cutoff = now - (ACTIVE_WINDOW_SECONDS * 1000);
  const daily = `play:daily:${dayKey(now)}`;
  await redis.zremrangebyscore('play:active', 0, cutoff);

  const [globalStats, dailyStats, activeSessions] = await Promise.all([
    redis.hgetall('play:stats'),
    redis.hgetall(daily),
    redis.zcount('play:active', cutoff, '+inf'),
  ]);

  const totalSeconds = parseIntSafe(globalStats?.totalSeconds);
  const totalSessions = parseIntSafe(globalStats?.totalSessions);
  const endedSessions = parseIntSafe(globalStats?.endedSessions);
  const avgSessionSeconds = endedSessions > 0 ? Math.round(totalSeconds / endedSessions) : 0;

  return {
    totalSeconds,
    totalHours: Number((totalSeconds / 3600).toFixed(2)),
    totalSessions,
    endedSessions,
    avgSessionSeconds,
    activeSessions: parseIntSafe(activeSessions),
    todaySeconds: parseIntSafe(dailyStats?.totalSeconds),
    todaySessions: parseIntSafe(dailyStats?.sessions),
    updatedAt: now,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const stats = await readStats(Date.now());
      return res.status(200).json(stats);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const event = String(body.event || '');
    const sessionId = sanitizeId(body.sessionId, 80);
    const playerId = sanitizeId(body.playerId, 80);
    const elapsedSec = Math.max(0, Math.min(172800, parseIntSafe(body.elapsedSec)));
    const bossAbilityId = sanitizeBossAbility(body.boss_ability_id);
    const bossPhase = Math.max(0, Math.min(8, parseIntSafe(body.boss_phase, 0)));
    const telegraphMs = Math.max(0, Math.min(5000, parseIntSafe(body.telegraph_ms, 0)));
    const now = Date.now();

    if (!['start', 'heartbeat', 'end'].includes(event)) {
      return res.status(400).json({ error: 'Invalid event' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
    const sessionKey = `play:session:${sessionId}`;
    const existing = await redis.hgetall(sessionKey);

    const alreadyStarted = !!(existing && existing.startedAt);
    const alreadyEnded = existing?.ended === '1' || existing?.ended === 1 || existing?.ended === true;
    const lastReportedSec = parseIntSafe(existing?.lastReportedSec);
    const monotonicElapsed = Math.max(elapsedSec, lastReportedSec);
    const delta = Math.max(0, monotonicElapsed - lastReportedSec);
    const today = `play:daily:${dayKey(now)}`;

    if (!alreadyStarted) {
      await redis.hincrby('play:stats', 'totalSessions', 1);
      await redis.hincrby(today, 'sessions', 1);
    }

    if (delta > 0) {
      await redis.hincrby('play:stats', 'totalSeconds', delta);
      await redis.hincrby(today, 'totalSeconds', delta);
    }

    if (event === 'end' && !alreadyEnded) {
      await redis.hincrby('play:stats', 'endedSessions', 1);
    }

    const sessionData = {
      startedAt: alreadyStarted ? existing.startedAt : now,
      lastSeenAt: now,
      lastReportedSec: monotonicElapsed,
      ended: event === 'end' ? '1' : (alreadyEnded ? '1' : '0'),
      event,
      ip,
    };
    if (playerId) {
      sessionData.playerId = playerId;
    }
    if (event === 'end') {
      sessionData.endedAt = now;
    }
    if (bossAbilityId) {
      sessionData.bossAbilityId = bossAbilityId;
      sessionData.bossPhase = bossPhase;
      sessionData.telegraphMs = telegraphMs;
    }

    await redis.hset(sessionKey, sessionData);
    await redis.expire(sessionKey, SESSION_TTL_SECONDS);

    if (event === 'end') {
      await redis.zrem('play:active', sessionId);
    } else {
      await redis.zadd('play:active', { score: now, member: sessionId });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Telemetry error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
