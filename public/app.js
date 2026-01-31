document.addEventListener('DOMContentLoaded', () => {

  // =================================================================
  // == 1. CONFIGURATION: 이 부분을 자신의 Firebase 설정으로 바꾸세요 ==
  // =================================================================
  const firebaseConfig = {
    apiKey: "AIzaSyAAqorZd78VjeaS7LxA3DykrR-zjb2jf6E",
    authDomain: "soaho-5b92f.firebaseapp.com",
    projectId: "soaho-5b92f",
    storageBucket: "soaho-5b92f.firebasestorage.app",
    messagingSenderId: "655094826656",
    appId: "1:655094826656:web:503233d31c9ca8c2f5abc5",
  };
  
  const VAPID_PUBLIC_KEY = "BAEad0BisKYLfcAgomxPGAZxdx4eqNsjI54rVO7pEOP_14_drJnPybDnXWVAkxziFIelTAVnFHnUqxVhKQBOJNc";
  const WORKER_URL = "https://cloud-memo-worker.seliscos.workers.dev"; // 본인의 Worker URL로 변경
  // =================================================================


  // --- Global State ---
  let currentUser = null;
  let idToken = null;

  // --- UI Elements ---
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInfoDiv = document.getElementById('user-info');
  const userNameSpan = document.getElementById('user-name');
  const appLoadingDiv = document.getElementById('app-loading');
  const appContentDiv = document.getElementById('app-content');
  const memoInput = document.getElementById('memo-input');
  const saveMemoBtn = document.getElementById('save-memo-btn');
  const memoListDiv = document.getElementById('memo-list');
  const subscribeBtn = document.getElementById('subscribe-btn');

  // --- Firebase Initialization ---
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();

  // --- Service Worker & Push ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('Service worker registered'))
        .catch(err => console.error('Service worker registration failed: ', err));
    });
    
    // Listen for messages from the service worker
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'new-memo-received') {
            console.log('New memo received from push, reloading list.');
            fetchMemos();
        }
    });
  }
  
  subscribeBtn.addEventListener('click', subscribeToPush);


  // --- Auth State Change ---
  auth.onAuthStateChanged(async (user) => {
    appLoadingDiv.style.display = 'none';
    if (user) {
      // User is signed in
      currentUser = user;
      idToken = await user.getIdToken();
      
      userNameSpan.textContent = user.displayName || user.email;
      userInfoDiv.style.display = 'flex';
      loginBtn.style.display = 'none';
      appContentDiv.style.display = 'block';
      
      fetchMemos();
      updateSubscriptionStatus();
    } else {
      // User is signed out
      currentUser = null;
      idToken = null;

      userInfoDiv.style.display = 'none';
      loginBtn.style.display = 'block';
      appContentDiv.style.display = 'none';
      memoListDiv.innerHTML = '';
    }
  });

  // --- Event Listeners ---
  loginBtn.addEventListener('click', () => {
    auth.signInWithPopup(googleProvider).catch(error => {
      console.error("Login failed:", error);
    });
  });

  logoutBtn.addEventListener('click', () => {
    auth.signOut();
  });

  saveMemoBtn.addEventListener('click', saveMemo);

  // --- API Functions ---
async function apiFetch(path, options = {}) {
  if (!idToken) throw new Error("Authentication token not available.");
  
  const defaultHeaders = {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json'
  };
  
  const response = await fetch(`${WORKER_URL}${path}`, {  // 여기 수정!
    ...options,
    headers: { ...defaultHeaders, ...options.headers }
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}
async function fetchMemos() {
  try {
    memoListDiv.innerHTML = '로딩 중...';
    const data = await apiFetch('/api/notes');
    
    // 콘솔에서 실제 데이터 구조 확인
    console.log('API Response:', data);
    
    // 안전하게 배열 추출
    let memos = [];
    if (Array.isArray(data)) {
      memos = data;
    } else if (data && Array.isArray(data.notes)) {
      memos = data.notes;
    }
    
    renderMemos(memos);
  } catch (error) {
    console.error('Error fetching memos:', error);
    memoListDiv.innerHTML = `<div class="error">메모를 불러오는데 실패했습니다: ${error.message}</div>`;
  }
}

async function saveMemo() {
  const content = memoInput.value.trim();
  if (!content) return;

  saveMemoBtn.disabled = true;
  saveMemoBtn.textContent = '저장 중...';

  try {
    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    memoInput.value = '';
    
    // 메모 저장 후 즉시 목록 새로고침 추가!
    await fetchMemos();
    
  } catch (error) {
    console.error('Error saving memo:', error);
    alert(`저장 실패: ${error.message}`);
  } finally {
    saveMemoBtn.disabled = false;
    saveMemoBtn.textContent = '저장';
  }
}
  
  async function subscribeToPush() {
    try {
      console.log('1. Service Worker 확인 중...');
      const registration = await navigator.serviceWorker.ready;
      
      console.log('2. 기존 구독 확인 중...');
      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        alert('이미 알림을 구독 중입니다.');
        return;
      }

      console.log('3. 새 구독 생성 중...');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('구독 생성 완료:', subscription);
      
      console.log('4. 서버로 전송 중...');
      const result = await apiFetch('/api/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription)
      });
      console.log('서버 응답:', result);

      alert('알림 구독이 완료되었습니다!');
      subscribeBtn.textContent = '✅ 구독 완료';
      subscribeBtn.disabled = true;

    } catch (error) {
      console.error('Push subscription failed:', error);
      alert(`알림 구독에 실패했습니다: ${error.message}`);
    }
  }
  
  async function updateSubscriptionStatus() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      subscribeBtn.textContent = '✅ 구독 완료';
      subscribeBtn.disabled = true;
    }
  }
  // --- Rendering ---
  function renderMemos(memos) {
    if (memos.length === 0) {
      memoListDiv.innerHTML = '저장된 메모가 없습니다.';
      return;
    }
    memoListDiv.innerHTML = memos.map(memo => `
      <div class="memo">
        <div class="date">${new Date(memo.created_at).toLocaleString('ko-KR')}</div>
        <div class="content">${escapeHtml(memo.content)}</div>
      </div>
    `).join('');
  }

  // --- Utils ---
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

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




});
