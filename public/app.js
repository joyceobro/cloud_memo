// ... (Firebase 임포트 및 초기화 부분은 기존과 동일) ...

document.addEventListener('DOMContentLoaded', () => {
  // --- Global State ---
  let currentUser = null;
  let idToken = null;
  let currentPage = 1; // ✅ 현재 페이지 추적

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

  // ✅ 더 보기 버튼 동적 생성 또는 참조
  // HTML에 없다면 직접 만듭니다.
  let loadMoreBtn = document.getElementById('load-more-btn');
  if (!loadMoreBtn) {
    const btnContainer = document.createElement('div');
    btnContainer.style.textAlign = 'center';
    btnContainer.style.margin = '20px 0';
    btnContainer.innerHTML = `<button id="load-more-btn" style="display:none;">더 보기</button>`;
    memoListDiv.after(btnContainer);
    loadMoreBtn = document.getElementById('load-more-btn');
  }

  // ✅ 페이지 로드 시 알림 권한 상태 체크
  if (Notification.permission === 'granted') {
    subscribeBtn.disabled = true;
    subscribeBtn.innerText = '🔔 알림 구독 중';
    subscribeBtn.style.backgroundColor = '#ccc';
  }

  // ... (Service Worker 및 Auth State Change는 기존과 동일) ...
  // 단, onAuthStateChanged 내부 fetchMemos() 호출 시 인자 전달 필요
  onAuthStateChanged(auth, async (user) => {
    if (appLoadingDiv) appLoadingDiv.style.display = 'none';
    if (user) {
      currentUser = user;
      idToken = await user.getIdToken();
      userNameSpan.textContent = user.displayName || user.email;
      userInfoDiv.style.display = 'flex';
      loginBtn.style.display = 'none';
      appContentDiv.style.display = 'block';
      
      currentPage = 1; // 로그인 시 페이지 초기화
      fetchMemos(true); // 첫 로딩임을 알림
      updateSubscriptionStatus();
    } else {
      // ... (로그아웃 처리 로직)
      loadMoreBtn.style.display = 'none';
    }
  });

  // --- Event Listeners ---
  loginBtn.addEventListener('click', () => signInWithPopup(auth, googleProvider));
  logoutBtn.addEventListener('click', () => signOut(auth));
  saveMemoBtn.addEventListener('click', saveMemo);
  subscribeBtn.addEventListener('click', subscribeToPush);
  
  // ✅ 더 보기 버튼 리스너
  loadMoreBtn.addEventListener('click', () => {
    currentPage++;
    fetchMemos(false);
  });

  // --- API Functions ---
  async function apiFetch(path, options = {}) {
    if (!idToken) throw new Error("인증 토큰이 없습니다.");
    const defaultHeaders = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
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

  // ✅ 수정된 fetchMemos: 페이지 번호를 전달하고 데이터를 이어붙임
  async function fetchMemos(isInitial = true) {
    try {
      if (isInitial) {
        memoListDiv.innerHTML = '로딩 중...';
        loadMoreBtn.style.display = 'none';
      }

      const data = await apiFetch(`/api/notes?page=${currentPage}`);
      const notes = data.notes || [];

      renderMemos(notes, isInitial);

      // ✅ 15개를 다 채웠다면 더 보기 버튼 표시, 아니면 숨김
      if (notes.length === 15) {
        loadMoreBtn.style.display = 'inline-block';
      } else {
        loadMoreBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Error fetching memos:', error);
      memoListDiv.innerHTML = `<div class="error">메모 로드 실패: ${error.message}</div>`;
    }
  }

  async function saveMemo() {
    const content = memoInput.value.trim();
    if (!content) return;
    saveMemoBtn.disabled = true;
    try {
      await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify({ content }) });
      memoInput.value = '';
      currentPage = 1; // 새 메모 저장 시 다시 첫 페이지부터
      await fetchMemos(true);
    } catch (error) {
      alert(`저장 실패: ${error.message}`);
    } finally {
      saveMemoBtn.disabled = false;
    }
  }

  // ✅ 수정된 renderMemos: 이어붙이기(append) 기능 추가
  function renderMemos(memos, isInitial) {
    if (isInitial && memos.length === 0) {
      memoListDiv.innerHTML = '저장된 메모가 없습니다.';
      return;
    }

    const html = memos.map(memo => `
      <div class="memo">
        <div class="date">${new Date(memo.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</div>
        <div class="content">${escapeHtml(memo.content)}</div>
      </div>
    `).join('');

    if (isInitial) {
      memoListDiv.innerHTML = html;
    } else {
      memoListDiv.insertAdjacentHTML('beforeend', html);
    }
  }

  // ... (subscribeToPush, escapeHtml 등 나머지 함수는 기존과 동일) ...
});