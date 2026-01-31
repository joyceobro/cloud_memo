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
    if (request.method === 'GET') return getNotes(request, env);
    if (request.method === 'POST') return saveNote(request, userId, env);
    break;
  case '/api/subscribe':
    if (request.method === 'POST') return saveSubscription(request, userId, env);
    break;
  // ✅ 아래 내용을 추가하세요
  case '/api/subscription-status':
    if (request.method === 'GET') return getSubscriptionStatus(userId, env);
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

async function getNotes(request, env) { // request 인자 추가
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  
  // 1. URL에서 page 파라미터 추출 (기본값 1)
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 15;
  
  // 2. Range 계산 (0부터 시작)
  // page 1 -> 0 to 14
  // page 2 -> 15 to 29
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // 3. Supabase 호출
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/notes?select=*&order=created_at.desc`, 
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        // ✅ 핵심: 필요한 범위만 요청
        'Range': `${from}-${to}`
      },
    }
  );

  const notes = await response.json();
  
  // 4. 응답 반환
  return jsonResponse({ notes, page });
}

async function saveNote(request, userId, env) {
  const { content, author_name } = await request.json();
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: userId, content,author_name }),
  });
  
  const data = await response.json();
  return jsonResponse({ success: true, note: data[0] });
}

async function saveSubscription(request, userId, env) {
  try {
    const { token } = await request.json();
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          // 1. return=representation을 추가해야 생성된 데이터를 받아올 수 있습니다.
          // 2. resolution=merge-duplicates는 upsert 처럼 작동하게 합니다.
          'Prefer': 'return=representation,resolution=merge-duplicates', 
        },
        body: JSON.stringify({
          user_id: userId,
          subscription: token, // 테이블 컬럼명이 'subscription'이 맞는지 꼭 확인!
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Supabase 저장 실패:", errorText);
      return jsonResponse({ success: false, error: errorText }, 500);
    }

    const data = await response.json();
    // 데이터가 성공적으로 들어갔다면 첫 번째 아이템 반환
    return jsonResponse({ success: true, data: data[0] || { token } });

  } catch (error) {
    console.error("saveSubscription 함수 내 에러:", error.message);
    return jsonResponse({ success: false, error: error.message }, 500);
  }
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
      `${SUPABASE_URL}/rest/v1/subscriptions?select=subscription`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    const rows = await res.json();
    const tokens = [...new Set(rows.map(r => r.subscription))];

    if (!tokens.length) {
      return jsonResponse({ message: 'No tokens' });
    }

    // 2️⃣ FCM 전송
    await sendFcm(tokens, {
      title: '새로운 메모!',
      body: content.length > 50 ? content.slice(0, 50) + '...' : content,
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

async function getFirebaseAccessToken(env) {
  const { FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID } = env;

  // 1. 키 정제 (모든 불순물 제거)
  const cleanKey = FIREBASE_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')    // 역슬래시+n 제거
    .replace(/\n/g, '')     // 실제 줄바꿈 제거
    .replace(/\s+/g, '')    // 공백 제거
    .replace(/["']/g, '')   // 따옴표 제거
    .trim();

  // 2. JWT 헤더 및 페이로드 설정
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  // 3. 서명 (Crypto API)
  const binaryKeyString = atob(cleanKey);
  const binaryKey = new Uint8Array(binaryKeyString.length);
  for (let i = 0; i < binaryKeyString.length; i++) {
    binaryKey[i] = binaryKeyString.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${unsignedToken}.${encodedSignature}`;

  // 4. 구글 토큰 서버에 요청
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(`Google Auth Failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
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

// --- 구독 상태 확인 핸들러 ---
async function getSubscriptionStatus(userId, env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?select=subscription&user_id=eq.${userId}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const data = await response.json();
  
  // 데이터가 존재하면 구독 중인 것으로 간주
  const isSubscribed = Array.isArray(data) && data.length > 0;

  return jsonResponse({ subscribed: isSubscribed });
}

