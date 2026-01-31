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

// Handle OPTIONS preflight requests
function handleOptions() {
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

export default {
  async fetch(request, env) {
    console.log(`Request received: ${request.method} ${request.url}`);
    
    try {
      // Handle OPTIONS preflight request
      if (request.method === 'OPTIONS') {
        return handleOptions();
      }
      
      const url = new URL(request.url);

      // Push notification endpoint (no auth required)
      if (url.pathname === '/api/send-push' && request.method === 'POST') {
        return sendPushNotification(request, env);
      }
      
      // Verify authentication for other endpoints
      const userId = await verifyFirebaseToken(request, env);
      if (!userId) {
        return jsonResponse({ error: 'Invalid or missing authentication token.' }, 401);
      }

      // Protected routes
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
async function getNotes(userId, env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  
  // user_id 필터 제거 - 모든 메모 가져오기
  const response = await fetch(`${SUPABASE_URL}/rest/v1/notes?select=*&order=created_at.desc`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  const notes = await response.json();
  return jsonResponse({ notes });
}
async function saveNote(request, userId, env) {
  const { content } = await request.json();
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: userId, content }),
  });
  
  const data = await response.json();
  return jsonResponse({ success: true, note: data[0] });
}

async function saveSubscription(request, userId, env) {
  const { token } = await request.json(); // 🔥 명확히 token
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates', // 중복 방지
      },
      body: JSON.stringify({
        user_id: userId,
        subscription: token, // ✅ FCM token 저장
      }),
    }
  );

  const data = await response.json();
  return jsonResponse({ success: true, token: data[0] });
}

// --- Push Notification ---
async function sendPushNotification(request, env) {
  try {
    const payload = await request.json();
    const { record } = payload;

    if (!record?.content || !record?.user_id) {
      return jsonResponse({ error: 'Invalid payload' }, 400);
    }

    const { content, user_id } = record;
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;

    // 1️⃣ token 조회
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}&select=subscription`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const rows = await res.json();
    const tokens = rows.map(r => r.subscription);

    if (!tokens.length) {
      return jsonResponse({ message: 'No tokens' });
    }

    // 2️⃣ FCM 전송
    await sendFcm(tokens, {
      title: '새로운 메모!',
      body: content.slice(0, 100),
    }, env);

    return jsonResponse({ success: true, sentTo: tokens.length });

  } catch (e) {
    console.error(e);
    return jsonResponse({ error: e.message }, 500);
  }
}

async function sendFcm(tokens, notification, env) {
  const accessToken = await getFirebaseAccessToken(env);

  for (const token of tokens) {
    await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification,
          },
        }),
      }
    );
  }
}



// --- Auth Verification ---
async function verifyFirebaseToken(request, env) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Missing or invalid Authorization header');
    return null;
  }

  const idToken = authHeader.substring(7);
  
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      console.log('Invalid token format');
      return null;
    }
    
    const payloadB64 = parts[1];
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp < now) {
      console.log('Token expired');
      return null;
    }
    
    if (payload.aud !== 'soaho-5b92f') {
      console.log('Invalid audience');
      return null;
    }
    
    if (payload.iss !== 'https://securetoken.google.com/soaho-5b92f') {
      console.log('Invalid issuer');
      return null;
    }
    
    return payload.sub || payload.user_id;
    
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

