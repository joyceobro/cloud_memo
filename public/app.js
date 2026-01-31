// 1. 최상단에 모듈 임포트 (반드시 블록 밖에 위치)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// --- Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyAAqorZd78VjeaS7LxA3DykrR-zjb2jf6E",
  authDomain: "soaho-5b92f.firebaseapp.com",
  projectId: "soaho-5b92f",
  storageBucket: "soaho-5b92f.firebasestorage.app",
  messagingSenderId: "655094826656",
  appId: "1:655094826656:web:503233d31c9ca8c2f5abc5",
};

const VAPID_PUBLIC_KEY = "BAEad0BisKYLfcAgomxPGAZxdx4eqNsjI54rVO7pEOP_14_drJnPybDnXWVAkxziFIelTAVnFHnUqxVhKQBOJNc";
const WORKER_URL = "https://cloud-memo-worker.seliscos.workers.dev";

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const messaging = getMessaging(app);
const googleProvider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {
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

  // --- Service Worker Registration ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js') // sw.js 파일이 실제 경로에 있어야 함
      .then(reg => console.log('Service worker registered'))
      .catch(err => console.error('Service worker registration failed:', err));
    
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && event.data.type === 'new-memo-received') {
        fetchMemos();
      }
    });
  }

  // --- Auth State Change ---
  onAuthStateChanged(auth, async (user) => {
    // 여기서 로딩 화면을 무조건 끕니다.
    if (appLoadingDiv) appLoadingDiv.style.display = 'none';

    if (user) {
      currentUser = user;
      idToken = await user.getIdToken();
      
      userNameSpan.textContent = user.displayName || user.email;
      userInfoDiv.style.display = 'flex';
      loginBtn.style.display = 'none';
      appContentDiv.style.display = 'block';
      
      fetchMemos();
      updateSubscriptionStatus();
    } else {
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
    signInWithPopup(auth, googleProvider).catch(error => {
      console.error("Login failed:", error);
    });
  });

  logoutBtn.addEventListener('click', () => {
    signOut(auth);
  });

  saveMemoBtn.addEventListener('click', saveMemo);
  subscribeBtn.addEventListener('click', subscribeToPush);

  // --- API Functions ---
  async function apiFetch(path, options = {}) {
    if (!idToken) throw new Error("인증 토큰이 없습니다.");
    
    const defaultHeaders = {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    };
    
    const response = await fetch(`${WORKER_URL}${path}`, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP 오류: ${response.status}`);
    }
    return response.json();
  }

  async function fetchMemos() {
    try {
      memoListDiv.innerHTML = '로딩 중...';
      const data = await apiFetch('/api/notes');
      const memos = Array.isArray(data) ? data : (data.notes || []);
      renderMemos(memos);
    } catch (error) {
      console.error('Error fetching memos:', error);
      memoListDiv.innerHTML = `<div class="error">메모 로드 실패: ${error.message}</div>`;
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
      await fetchMemos();
    } catch (error) {
      alert(`저장 실패: ${error.message}`);
    } finally {
      saveMemoBtn.disabled = false;
      saveMemoBtn.textContent = '저장';
    }
  }

async function subscribeToPush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('알림 권한이 필요합니다.');
      return;
    }

    // 1. 서비스 워커 등록 상태 확인
    let registration = await navigator.serviceWorker.getRegistration();

    // 2. 만약 등록된 게 없다면 기다리거나 새로 등록
    if (!registration) {
      console.log("서비스 워커 등록 중...");
      registration = await navigator.serviceWorker.register('/sw.js');
    }

    // 3. 핵심: 서비스 워커가 'active' 상태가 될 때까지 대기
    // 등록은 됐지만 활성화되지 않았을 때 발생하는 AbortError 방지
    while (!registration.active) {
      console.log("서비스 워커 활성화 대기 중...");
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초마다 확인
      registration = await navigator.serviceWorker.getRegistration();
    }

    console.log("서비스 워커 준비 완료:", registration.active.state);

    // 4. 활성화된 registration을 사용하여 토큰 가져오기
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration // 명시적으로 등록 객체 전달
    });

    if (token) {
      console.log("FCM 토큰 발급 성공:", token);
      // 서버 전송 로직...
      alert('알림 구독 완료!');
    }
  } catch (e) {
    console.error('구독 에러:', e);
    // 여기서 AbortError가 나면 서비스 워커 파일 내부 로직 문제일 수도 있습니다.
  }
}

  async function updateSubscriptionStatus() {
    try {
        const { subscribed } = await apiFetch('/api/subscription-status');
        if (subscribed) {
          subscribeBtn.textContent = '✅ 구독 완료';
          subscribeBtn.disabled = true;
        }
    } catch (e) {
        console.log("구독 상태 확인 실패");
    }
  }

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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});