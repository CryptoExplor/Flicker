// api/notification.js – FIXED VERSION WITH PROPER KV STORAGE
// Complete rewrite with robust error handling

export const runtime = 'nodejs';

// ===== KV STORAGE INITIALIZATION =====
let kv = null;
let useKV = false;

async function initializeKV() {
  if (kv !== null) return useKV;
  
  try {
    const vercelKV = await import('@vercel/kv');
    kv = vercelKV.kv;
    
    // Test connection
    await kv.ping();
    
    useKV = true;
    console.log('✅ Vercel KV initialized for notifications');
    return true;
  } catch (e) {
    console.warn('⚠️ KV not available, using memory fallback:', e.message);
    useKV = false;
    return false;
  }
}

// In-memory fallback
const memoryUsers = new Map();
const memoryUserSet = new Set();

// ===== STORAGE WRAPPER =====
class NotificationStorage {
  constructor() {
    this.initialized = false;
    this.USER_KEY_PREFIX = 'notif_user_';
    this.USER_SET_KEY = 'notif_users';
  }

  async init() {
    if (!this.initialized) {
      await initializeKV();
      this.initialized = true;
    }
  }

  userKey(fid) {
    return `${this.USER_KEY_PREFIX}${fid}`;
  }

  async saveUser(user) {
    await this.init();
    
    const key = this.userKey(user.fid);
    const data = JSON.stringify(user);
    
    console.log(`💾 Saving user ${user.fid}...`);
    
    // Try KV first
    if (useKV && kv) {
      try {
        await kv.set(key, data);
        await kv.sadd(this.USER_SET_KEY, String(user.fid));
        console.log(`✅ KV saved user ${user.fid}`);
      } catch (e) {
        console.error('❌ KV save failed:', e.message);
      }
    }
    
    // Always save to memory as backup
    memoryUsers.set(key, user);
    memoryUserSet.add(String(user.fid));
    console.log(`✅ Memory saved user ${user.fid}`);
    
    return true;
  }

  async loadUser(fid) {
    await this.init();
    
    const key = this.userKey(fid);
    console.log(`🔍 Loading user ${fid}...`);
    
    // Try KV first
    if (useKV && kv) {
      try {
        const raw = await kv.get(key);
        if (raw) {
          const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
          console.log(`✅ KV loaded user ${fid}`);
          return user;
        }
      } catch (e) {
        console.error('❌ KV load failed:', e.message);
      }
    }
    
    // Fallback to memory
    const user = memoryUsers.get(key);
    if (user) {
      console.log(`✅ Memory loaded user ${fid}`);
      return user;
    }
    
    console.log(`❌ User ${fid} not found`);
    return null;
  }

  async getRegisteredFids() {
    await this.init();
    
    console.log('📋 Getting registered FIDs...');
    
    // Try KV first
    if (useKV && kv) {
      try {
        const fids = await kv.smembers(this.USER_SET_KEY);
        if (fids && fids.length > 0) {
          const validFids = fids
            .map(f => Number(f))
            .filter(n => Number.isInteger(n) && n > 0);
          console.log(`✅ KV returned ${validFids.length} FIDs`);
          return validFids;
        }
      } catch (e) {
        console.error('❌ KV smembers failed:', e.message);
      }
    }
    
    // Fallback to memory
    const fids = Array.from(memoryUserSet)
      .map(f => Number(f))
      .filter(n => Number.isInteger(n) && n > 0);
    console.log(`✅ Memory returned ${fids.length} FIDs`);
    return fids;
  }

  async deleteUser(fid) {
    await this.init();
    
    const key = this.userKey(fid);
    console.log(`🗑️ Deleting user ${fid}...`);
    
    // Try KV first
    if (useKV && kv) {
      try {
        await kv.del(key);
        await kv.srem(this.USER_SET_KEY, String(fid));
        console.log(`✅ KV deleted user ${fid}`);
      } catch (e) {
        console.error('❌ KV delete failed:', e.message);
      }
    }
    
    // Always delete from memory
    memoryUsers.delete(key);
    memoryUserSet.delete(String(fid));
    console.log(`✅ Memory deleted user ${fid}`);
    
    return true;
  }
}

const storage = new NotificationStorage();

// ===== NOTIFICATION MESSAGES =====
const NOTIFICATION_MESSAGES = [
  {
    id: 'daily-mint',
    title: '🔥 Flicker Daily Drop!',
    body: 'CELO price is moving! Mint an NFT with live price snapshot and get instant airdrop today! 💰'
  },
  {
    id: 'daily-airdrop',
    title: '⚡ Predict & Earn on Flicker',
    body: 'Mint a CELO NFT now → Get instant airdrop + predict price for 2x bonus! 🎯'
  },
  {
    id: 'prediction-challenge',
    title: '📈 Price Prediction Challenge!',
    body: 'Will CELO go UP or DOWN in 60 seconds? Predict correctly and double your airdrop! 🚀'
  },
  {
    id: 'lucky-numbers',
    title: '🍀 Lucky Numbers Alert!',
    body: 'Today might be your lucky day! Some tokens give 2x–4x airdrop bonuses. Try your luck! ✨'
  },
  {
    id: 'free-daily-mint',
    title: '🎁 Free Daily Mint + Rewards!',
    body: "Don't miss today's free NFT mint with instant CELO airdrop. Claim yours now! 🎉"
  }
];

function pickRandomMessage() {
  const idx = Math.floor(Math.random() * NOTIFICATION_MESSAGES.length);
  return NOTIFICATION_MESSAGES[idx];
}

// ===== NEYNAR API SENDER =====
async function sendMiniAppNotificationsToFids(targetFids, message, uuid) {
  const apiKey = process.env.NEYNAR_API_KEY;
  const miniAppUrl = process.env.MINIAPP_URL || 'https://celo-nft-phi.vercel.app/';

  if (!apiKey) {
    throw new Error('NEYNAR_API_KEY is not configured');
  }

  if (!Array.isArray(targetFids) || targetFids.length === 0) {
    throw new Error('targetFids must be a non-empty array');
  }

  if (targetFids.length > 100) {
    throw new Error('targetFids length must be <= 100');
  }

  const notificationUuid = uuid || `celo-nft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const payload = {
    target_fids: targetFids,
    notification: {
      title: message.title,
      body: message.body,
      target_url: miniAppUrl,
      uuid: notificationUuid
    }
  };

  console.log(`📤 Sending notification to ${targetFids.length} users`);

  const response = await fetch(
    'https://api.neynar.com/v2/farcaster/frame/notifications/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    }
  );

  const responseText = await response.text();
  console.log(`📥 Neynar response (${response.status}):`, responseText);

  if (!response.ok) {
    throw new Error(`Neynar API error: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText);

  const deliveries = Array.isArray(data.notification_deliveries)
    ? data.notification_deliveries
    : [];

  const successfulFids = deliveries
    .filter(d => d.status === 'success')
    .map(d => d.fid);

  console.log(`✅ Successfully sent to ${successfulFids.length} users`);

  return { successfulFids, deliveries };
}

// ===== MAIN API HANDLER =====
export default async function handler(req, res) {
  console.log(`📨 Notification API: ${req.method} ${req.url}`);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vercel-cron, x-cron-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Initialize storage
    await storage.init();

    // ===== HEALTH CHECK =====
    if (req.method === 'GET' && !req.query.fid && !req.query.health) {
      return res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        storage: useKV ? 'kv' : 'memory',
        env_check: {
          neynar_api_key: !!process.env.NEYNAR_API_KEY,
          cron_secret: !!process.env.CRON_SECRET,
          miniapp_url: !!process.env.MINIAPP_URL
        }
      });
    }

    // ===== STORAGE HEALTH CHECK =====
    if (req.method === 'GET' && req.query.health === 'true') {
      const testKey = 'health_check_' + Date.now();
      const testValue = { test: true, timestamp: Date.now() };
      
      try {
        await storage.saveUser({ fid: 999999, username: 'test', ...testValue });
        const retrieved = await storage.loadUser(999999);
        await storage.deleteUser(999999);
        
        return res.json({
          status: 'healthy',
          storage: useKV ? 'kv' : 'memory',
          writeSuccess: true,
          readSuccess: !!retrieved,
          deleteSuccess: true
        });
      } catch (e) {
        return res.json({
          status: 'degraded',
          storage: useKV ? 'kv' : 'memory',
          error: e.message
        });
      }
    }

    // ===== AUTO-REGISTER USER =====
    if (req.method === 'POST' && req.body?.action === 'register') {
      const { fid, username } = req.body;

      const fidNum = Number(fid);
      if (!fidNum || !Number.isInteger(fidNum) || fidNum <= 0) {
        console.error('❌ Invalid FID:', fid);
        return res.status(400).json({ error: 'Invalid fid' });
      }

      console.log(`🔔 Registration request for FID ${fidNum}`);

      const existingUser = await storage.loadUser(fidNum);

      if (!existingUser) {
        const now = Date.now();
        const userData = {
          fid: fidNum,
          username: username || `User ${fidNum}`,
          registeredAt: now,
          lastNotification: null,
          enabled: true,
          totalNotificationsSent: 0
        };

        await storage.saveUser(userData);

        console.log(`✅ Auto-registered user ${fidNum} (${userData.username})`);

        return res.json({
          success: true,
          message: 'Registered for daily reminders',
          isNew: true,
          storage: useKV ? 'kv' : 'memory'
        });
      } else {
        // Update username if changed
        if (username && existingUser.username !== username) {
          existingUser.username = username;
          await storage.saveUser(existingUser);
          console.log(`✅ Updated username for ${fidNum}`);
        }

        console.log(`ℹ️ User ${fidNum} already registered`);
        return res.json({
          success: true,
          message: 'Already registered',
          isNew: false,
          storage: useKV ? 'kv' : 'memory'
        });
      }
    }

    // ===== ENABLE/DISABLE NOTIFICATIONS =====
    if (req.method === 'POST' && req.body?.action === 'setEnabled') {
      const { fid, enabled } = req.body;
      const fidNum = Number(fid);

      if (!fidNum || !Number.isInteger(fidNum) || fidNum <= 0) {
        return res.status(400).json({ error: 'Invalid fid' });
      }

      const user = await storage.loadUser(fidNum) || {
        fid: fidNum,
        username: `User ${fidNum}`,
        registeredAt: Date.now(),
        lastNotification: null,
        totalNotificationsSent: 0
      };

      user.enabled = Boolean(enabled);
      await storage.saveUser(user);

      console.log(`${user.enabled ? '✅ Enabled' : '🚫 Disabled'} notifications for ${fidNum}`);

      return res.json({
        success: true,
        enabled: user.enabled,
        storage: useKV ? 'kv' : 'memory'
      });
    }

    // ===== SEND DAILY NOTIFICATIONS =====
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const isSendDaily = req.method === 'POST' && req.body?.action === 'sendDaily';

    if (isVercelCron || isSendDaily) {
      // Authorization
      if (!isVercelCron) {
        const cronSecret = req.headers['x-cron-secret'];
        if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
          console.error('❌ Unauthorized cron request');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }

      console.log('🔔 Starting daily notification batch...');

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      const allFids = await storage.getRegisteredFids();
      console.log(`📊 Found ${allFids.length} registered users`);

      if (allFids.length === 0) {
        const summary = {
          success: true,
          sent: 0,
          skipped: 0,
          errors: 0,
          total: 0,
          timestamp: new Date().toISOString(),
          message: 'No registered users yet'
        };
        console.log('📧 Notification batch complete:', summary);
        return res.json(summary);
      }

      const eligibleFids = [];
      const userCache = new Map();

      // Filter eligible users
      for (const fidNum of allFids) {
        try {
          const user = await storage.loadUser(fidNum);
          if (!user) continue;
          
          userCache.set(fidNum, user);

          if (user.enabled === false) {
            console.log(`⏭️ User ${fidNum} disabled notifications`);
            continue;
          }

          if (user.lastNotification && user.lastNotification > oneDayAgo) {
            console.log(`⏭️ User ${fidNum} already notified today`);
            continue;
          }

          eligibleFids.push(fidNum);
        } catch (e) {
          console.error(`💥 Error loading user ${fidNum}:`, e);
        }
      }

      console.log(`✅ Eligible users: ${eligibleFids.length}`);

      if (eligibleFids.length === 0) {
        const summary = {
          success: true,
          sent: 0,
          skipped: allFids.length,
          errors: 0,
          total: allFids.length,
          timestamp: new Date().toISOString(),
          message: 'No eligible users for daily notification'
        };
        console.log('📧 Notification batch complete:', summary);
        return res.json(summary);
      }

      const message = pickRandomMessage();
      const todayStr = new Date().toISOString().slice(0, 10);
      const baseUuid = `celo-nft-daily-${todayStr}-${message.id}`;

      const batchSize = 100;
      let sentCount = 0;
      let errorCount = 0;

      for (let i = 0; i < eligibleFids.length; i += batchSize) {
        const batchFids = eligibleFids.slice(i, i + batchSize);
        const batchUuid = `${baseUuid}-batch-${Math.floor(i / batchSize)}`;

        try {
          const { successfulFids } = await sendMiniAppNotificationsToFids(
            batchFids,
            message,
            batchUuid
          );

          // Update user metadata
          for (const fid of successfulFids) {
            const user = userCache.get(fid) || await storage.loadUser(fid) || {
              fid,
              username: `User ${fid}`,
              registeredAt: now,
              totalNotificationsSent: 0,
              enabled: true
            };

            user.lastNotification = now;
            user.totalNotificationsSent = (user.totalNotificationsSent || 0) + 1;

            await storage.saveUser(user);
          }

          sentCount += successfulFids.length;
          console.log(`📨 Batch sent: ${successfulFids.length}/${batchFids.length} successful`);
        } catch (e) {
          errorCount++;
          console.error(`❌ Batch failed at index ${i}:`, e.message || e);
        }
      }

      const summary = {
        success: true,
        sent: sentCount,
        skipped: allFids.length - sentCount,
        errors: errorCount,
        total: allFids.length,
        timestamp: new Date().toISOString(),
        notificationTitle: message.title,
        storage: useKV ? 'kv' : 'memory'
      };

      console.log('📧 Daily notification batch complete:', summary);
      return res.json(summary);
    }

    // ===== GET USER STATUS =====
    if (req.method === 'GET' && req.query.fid) {
      const fid = Array.isArray(req.query.fid) ? req.query.fid[0] : req.query.fid;
      const fidNum = Number(fid);
      
      if (!fidNum || !Number.isInteger(fidNum) || fidNum <= 0) {
        return res.status(400).json({ error: 'Invalid fid' });
      }

      const userData = await storage.loadUser(fidNum);

      return res.json({
        registered: !!userData,
        enabled: userData ? userData.enabled !== false : false,
        lastNotification: userData ? userData.lastNotification : null,
        totalSent: userData ? userData.totalNotificationsSent || 0 : 0,
        storage: useKV ? 'kv' : 'memory'
      });
    }

    // Unknown request
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (err) {
    console.error('💥 Notification API error:', err);
    return res.status(500).json({ 
      error: 'Server error', 
      message: err.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
