// Helper function to add CORS headers to a response
const addCorsHeaders = (response) => {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
};

// Helper function to create a JSON response
const jsonResponse = (data, status = 200) => {
  const response = new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  return addCorsHeaders(response);
};

export default {
  async fetch(request, env) {
    console.log(`Request received: ${request.method} ${request.url}`);
    
    try {
      // OPTIONS 요청 처리 (preflight)
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }
      
      const url = new URL(request.url);

      if (url.pathname === '/api/send-push' && request.method === 'POST') {
        return sendPushNotification(request, env);
      }
      
      const userId = await verifyFirebaseToken(request, env);
      if (!userId) {
        return jsonResponse({ error: 'Invalid or missing authentication token.' }, 401);
      }

      switch (url.pathname) {
        case '/api/notes':
          if (request.method === 'GET') return getNotes(userId, env);
          if (request.method === 'POST') return saveNote(request, userId, env);
          break;
        case '/api/subscribe':
          if (request.method === 'POST') return saveSubscription(request, userId, env);
          break;
      }
      
      return jsonResponse({ error: 'Not Found' }, 404);

    } catch (error) {
      console.error('Internal Server Error:', error.stack);
      return jsonResponse({ error: 'Internal Server Error', message: error.message }, 500);
    }
  },
};

// --- API Handlers ---
async function getNotes(userId, env) { /* ... */ }
async function saveNote(request, userId, env) { /* ... */ }
async function saveSubscription(request, userId, env) { /* ... */ }

// --- Push Notification ---
async function sendPushNotification(request, env) {
  const { record } = await request.json();
  const { content, user_id } = record;
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;

  const subResponse = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}&select=subscription`,{ 
    headers: { 
      apikey: SUPABASE_SERVICE_KEY, 
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` 
    } 
  });
  const subs = await subResponse.json();
  if (!subs || !subs.length) return jsonResponse({ message: "No subscriptions found." });
  
  const notificationPayload = JSON.stringify({
    title: '새로운 메모!',
    body: content.substring(0, 100),
    url: '/',
  });

  const promises = subs.map(s => triggerPush(s.subscription, notificationPayload, env));
  await Promise.allSettled(promises);
  return jsonResponse({ success: true, sentTo: subs.length });
}

async function triggerPush(subscription, payload, env) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  const { endpoint } = subscription;
  const audience = new URL(endpoint).origin;

  const vapidJwt = await createVapidJwt(audience, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '60',
      'Content-Length': payload.length,
      'Content-Type': 'application/octet-stream',
      'Authorization': `WebPush ${vapidJwt}`,
    },
    body: payload,
  });

  if (response.status !== 201) {
    console.error(`Failed to send push notification to ${endpoint}: ${response.status} ${response.statusText}`);
  }
}

async function createVapidJwt(audience, publicKey, privateKey) {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlDecode(publicKey).slice(1, 33),
    y: base64UrlDecode(publicKey).slice(33, 65),
    d: base64UrlDecode(privateKey),
  };

  const importedKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);

  const header = { typ: 'JWT', alg: 'ES256' };
  const body = { aud: audience, exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60), sub: 'mailto:test@example.com' };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(body))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: {name: 'SHA-256'} }, importedKey, new TextEncoder().encode(unsignedToken));
  
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

// --- CORS & Helpers ---
function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function base64UrlEncode(data) {
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  return btoa(String.fromCharCode.apply(null, data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(base64UrlString) {
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// --- Auth Verification ---
async function verifyFirebaseToken(request, env) { /* ... */ }