import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

// 1. 모든 상수 정의 (누락 방지)
const firebaseConfig = {
  apiKey: "AIzaSyAAqorZd78VjeaS7LxA3DykrR-zjb2jf6E",
  authDomain: "soaho-5b92f.firebaseapp.com",
  projectId: "soaho-5b92f",
  storageBucket: "soaho-5b92f.firebasestorage.app",
  messagingSenderId: "655094826656",
  appId: "1:655094826656:web:503233d31c9ca8c2f5abc5",
};

const VAPID_PUBLIC_KEY = "BM_3uYAByURiJYw4OTL71aBYmXfngKF-LTM86hTsdFtxDdQWZjXFNXTU4Ef2tCvIlyjNE-i9ufMjRN8b6U3E4J0";
const WORKER_URL = "https://cloud-memo-worker.seliscos.workers.dev";

// 2. 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const messaging = getMessaging(app);
const googleProvider = new GoogleAuthProvider();

// 3. 전역 상태 관리
let idToken = null;
let currentPage = 1;

document.addEventListener('DOMContentLoaded', () => {
  // UI 요소 참조
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

  // 더 보기 버튼 동적 생성 (HTML에 없을 경우 대비)
  let loadMoreBtn = document.getElementById('load-more-btn');
  if (!loadMoreBtn) {
    const btnContainer = document.createElement('div');
    btnContainer.style = "text-align: center; margin: 20px 0;";
    btnContainer.innerHTML = `<button id="load-more-btn" style="display:none; padding: 10px 20px;">더 보기</button>`;
    memoListDiv.after(btnContainer);
    loadMoreBtn = document.getElementById('load-more-btn');
  }

  // 초기 알림 권한 체크
  if (Notification.permission === 'granted') {
    subscribeBtn.disabled = true;
    subscribeBtn.innerText = '🔔 알림 구독 중';
    subscribeBtn.style.backgroundColor = '#ccc';
  }

  // 4. 인증 상태 감시
  onAuthStateChanged(auth, async (user) => {
    if (appLoadingDiv) appLoadingDiv.style.display = 'none';
    if (user) {
      idToken = await user.getIdToken();
      userNameSpan.textContent = user.displayName || user.email;
      userInfoDiv.style.display = 'flex';
      loginBtn.style.display = 'none';
      appContentDiv.style.display = 'block';
      
      currentPage = 1;
      await fetchMemos(true); // 첫 로딩
      updateSubscriptionStatus();
    } else {
      idToken = null;
      userInfoDiv.style.display = 'none';
      loginBtn.style.display = 'block';
      appContentDiv.style.display = 'none';
      memoListDiv.innerHTML = '';
      loadMoreBtn.style.display = 'none';
    }
  });

  // 5. 이벤트 리스너 연결
  loginBtn.onclick = () => signInWithPopup(auth, googleProvider);
  logoutBtn.onclick = () => signOut(auth);
  saveMemoBtn.onclick = saveMemo;
  subscribeBtn.onclick = subscribeToPush;
  loadMoreBtn.onclick = () => {
    currentPage++;
    fetchMemos(false); // 이어서 로딩
  };

  // 6. 핵심 기능 함수들
  async function apiFetch(path, options = {}) {
    if (!idToken) return;
    const headers = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    const res = await fetch(`${WORKER_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!res.ok) throw new Error("요청 실패");
    return res.json();
  }

  async function fetchMemos(isInitial = true) {
    try {
      if (isInitial) {
        memoListDiv.innerHTML = '로딩 중...';
        currentPage = 1;
      }

      const data = await apiFetch(`/api/notes?page=${currentPage}`);
      const notes = data.notes || [];

      renderMemos(notes, isInitial);

      // 15개면 더 보기 버튼 노출, 아니면 숨김
      loadMoreBtn.style.display = (notes.length === 15) ? 'inline-block' : 'none';
    } catch (e) {
      memoListDiv.innerHTML = "메모를 불러오지 못했습니다.";
      console.error(e);
    }
  }

  function renderMemos(memos, isInitial) {
    if (isInitial && memos.length === 0) {
      memoListDiv.innerHTML = '저장된 메모가 없습니다.';
      return;
    }

    const html = memos.map(m => `
      <div class="memo" style="border-bottom: 1px solid #eee; padding: 10px 0;">
        <div class="date" style="font-size: 0.8em; color: #888;">
          ${new Date(m.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
        </div>
        <div class="content" style="margin-top: 5px; white-space: pre-wrap;">${escapeHtml(m.content)}</div>
      </div>
    `).join('');

    if (isInitial) memoListDiv.innerHTML = html;
    else memoListDiv.insertAdjacentHTML('beforeend', html);
  }

  async function saveMemo() {
    const content = memoInput.value.trim();
    if (!content) return;
    
    saveMemoBtn.disabled = true;
    try {
      await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify({ content }) });
      memoInput.value = '';
      await fetchMemos(true); // 저장 후 최신순으로 다시 불러오기
    } catch (e) {
      alert("저장 실패");
    } finally {
      saveMemoBtn.disabled = false;
    }
  }

  async function subscribeToPush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return alert('알림 권한이 필요합니다.');

      const token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY });
      await apiFetch('/api/subscribe', { method: 'POST', body: JSON.stringify({ token }) });
      
      subscribeBtn.disabled = true;
      subscribeBtn.innerText = '🔔 알림 구독 완료';
      subscribeBtn.style.backgroundColor = '#ccc';
      alert('구독되었습니다!');
    } catch (e) {
      console.error(e);
      alert('구독 중 오류가 발생했습니다.');
    }
  }

  async function updateSubscriptionStatus() {
    try {
      const { subscribed } = await apiFetch('/api/subscription-status');
      if (subscribed) {
        subscribeBtn.disabled = true;
        subscribeBtn.innerText = '🔔 알림 구독 중';
        subscribeBtn.style.backgroundColor = '#ccc';
      }
    } catch (e) {
      console.log("구독 상태 확인 실패");
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});