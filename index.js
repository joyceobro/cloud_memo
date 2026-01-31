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
    try {
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }
      
      const url = new URL(request.url);

      if (url.pathname === '/api/send-push' && request.method === 'POST') {
        return sendPushNotification(request, env);
      }
      
      const userId = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
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

// --- API Handlers (Unchanged) ---
async function getNotes(userId, env) { /* ... */ }
async function saveNote(request, userId, env) { /* ... */ }
async function saveSubscription(request, userId, env) { /* ... */ }
async function sendPushNotification(request, env) { /* ... */ }
async function triggerPush(subscription, payload, env) { /* ... */ }
async function createVapidJwt(audience, publicKey, privateKey) { /* ... */ }
function base64UrlEncode(data) { /* ... */ }

// --- CORS ---
function handleOptions(request) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    return new Response(null, { headers });
}

// --- FINAL ATTEMPT: Auth Verification using POST ---
async function verifyFirebaseToken(request, firebaseProjectId) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Missing or invalid Authorization header');
    return null;
  }
  const token = authHeader.substring(7);

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id_token=${token}` // Send token in the body
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Google token verification failed. Full error:', JSON.stringify(errorData));
      return null;
    }
    
    const payload = await response.json();

    if (payload.aud !== firebaseProjectId) {
      console.error(`Token audience ('${payload.aud}') does not match project ID ('${firebaseProjectId}')`);
      return null;
    }
    
    return payload.sub; // The 'sub' claim is the user_id

  } catch (error) {
    console.error('Exception during token verification fetch:', error);
    return null;
  }
}
