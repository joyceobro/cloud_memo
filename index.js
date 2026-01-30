// Helper function to create a JSON response
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }

      // The /api/send-push endpoint is public (triggered by Supabase)
      // and does not need user auth.
      if (url.pathname === '/api/send-push' && request.method === 'POST') {
        return sendPushNotification(request, env);
      }
      
      // All other API routes require user authentication.
      const userId = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
      if (!userId) {
        return jsonResponse({ error: 'Invalid or missing authentication token.' }, 401);
      }

      if (url.pathname === '/api/notes' && request.method === 'GET') {
        return getNotes(userId, env);
      }
      if (url.pathname === '/api/notes' && request.method === 'POST') {
        return saveNote(request, userId, env);
      }
      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        return saveSubscription(request, userId, env);
      }
      
      return jsonResponse({ error: 'Not Found' }, 404);

    } catch (error) {
      console.error('Internal Server Error:', error);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500);
    }
  },
};

// --- API Handlers ---
async function getNotes(userId, env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/memos?user_id=eq.${userId}&select=*&order=created_at.desc`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  return new Response(response.body, response);
}

async function saveNote(request, userId, env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  const { content } = await request.json();
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/memos`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ content, user_id: userId }),
  });

  return response.status === 201 ? jsonResponse({ success: true }) : jsonResponse({ error: 'Failed to save memo' }, 500);
}

async function saveSubscription(request, userId, env) {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
    const subscription = await request.json();

    const response = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId, subscription: subscription }),
    });
    return jsonResponse({ success: response.ok });
}

// --- Manual Web Push Implementation ---
async function sendPushNotification(request, env) {
  const { record } = await request.json();
  const { content, user_id } = record;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;

  const subResponse = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}&select=subscription`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const subs = await subResponse.json();
  if (!subs || subs.length === 0) {
    return jsonResponse({ message: "No subscriptions found." });
  }

  const payload = JSON.stringify({
    title: '새로운 메모!', body: content.substring(0, 100), url: '/',
  });

  const promises = subs.map(s => triggerPush(s.subscription, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY));
  await Promise.all(promises);

  return jsonResponse({ success: true, sentTo: subs.length });
}

async function triggerPush(subscription, payload, vapidPublicKey, vapidPrivateKey) {
  const { endpoint, keys } = subscription;
  const origin = new URL(endpoint).origin;

  const vapidJwt = await createVapidJwt(origin, vapidPublicKey, vapidPrivateKey);

  // For now, we are not encrypting the payload for simplicity.
  // Production apps should encrypt the payload.
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '60',
      'Content-Type': 'application/octet-stream',
      'Authorization': `WebPush ${vapidJwt}`
    },
    body: payload
  });
  
  if(response.status !== 201) {
    console.error(`Failed to send push notification: ${response.status} ${response.statusText}`);
  }
}

async function createVapidJwt(audience, vapidPublicKey, vapidPrivateKey) {
  const privateKey = await crypto.subtle.importKey(
    'jwk', 
    { kty: 'EC', crv: 'P-256', x: vapidPublicKey.substring(0, 43), y: vapidPublicKey.substring(43), d: vapidPrivateKey }, 
    { name: 'ECDSA', namedCurve: 'P-256' }, 
    true, 
    ['sign']
  );

  const header = { typ: 'JWT', alg: 'ES256' };
  const body = { aud: audience, exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60), sub: 'mailto:test@example.com' };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(body))}`;
  
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}


// --- CORS & Helpers ---
function handleOptions(request) {
    let headers = request.headers;
    if (headers.get("Origin") !== null && headers.get("Access-Control-Request-Method") !== null && headers.get("Access-Control-Request-Headers") !== null) {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": headers.get("Access-Control-Request-Headers"),
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    return new Response(null, { headers: { Allow: "GET, HEAD, POST, OPTIONS" } });
}

function base64UrlEncode(str) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Simplified JWT decoding and verification for Firebase
// (This part remains the same)
async function verifyFirebaseToken(request, firebaseProjectId) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);

  const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const publicKeys = await response.json();
  const { header, payload } = decodeJWT(token);
  if (!header.kid || !publicKeys[header.kid]) return null;

  const pem = `-----BEGIN CERTIFICATE-----\n${publicKeys[header.kid].replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
  const key = await crypto.subtle.importKey(
    'spki', 
    pemToBinary(pem), 
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, 
    false, 
    ['verify']
  );
  
  const data = new TextEncoder().encode(token.split('.').slice(0, 2).join('.'));
  const signature = new Uint8Array(atob(token.split('.')[2].replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));

  const isValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!isValid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== firebaseProjectId || payload.iss !== `https://securetoken.google.com/${firebaseProjectId}` || payload.exp < now) return null;
  
  return payload.user_id;
}

function decodeJWT(token) {
  const [headerB64, payloadB64] = token.split('.');
  const header = JSON.parse(atob(headerB64));
  const payload = JSON.parse(atob(payloadB64));
  return { header, payload };
}

function pemToBinary(pem) {
  const lines = pem.split('\n');
  const encoded = lines.filter(line => line.length > 0 && !line.startsWith('-----')).join('');
  const binary = atob(encoded);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
}
