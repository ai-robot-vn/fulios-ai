/* ============================================================
   FULIOS AI — APPLICATION LOGIC
   ============================================================ */

/* ---- ⚙️ CẤU HÌNH MÔ HÌNH (nội bộ — không hiển thị ra giao diện) ----
   Dán API key cố định vào "apiKey" bên dưới nếu bạn muốn gắn cứng
   (mọi người dùng file này sẽ dùng chung key đó).
   Nếu để trống, mỗi người có thể tự nhập API key riêng trong
   phần Cài đặt (⚙️) trên giao diện — key đó chỉ tồn tại trong
   phiên trình duyệt hiện tại, không được lưu ra đĩa hay máy chủ nào khác. */
const FULIOS_CONFIG = {
  apiKey: "",
  endpoint: "https://api.groq.com/openai/v1/chat/completions",
  model: "openai/gpt-oss-120b",
  defaultTemperature: 1,
  defaultMaxTokens: 8192,
};

const DEFAULT_SYSTEM_PROMPT =
"Bạn là Fulios AI — một trợ lý AI toàn năng, thông minh, am hiểu sâu rộng nhiều lĩnh vực, được tối ưu riêng để hiểu rõ ngôn ngữ, văn hoá và bối cảnh của người Việt Nam.\n\n" +
"Nguyên tắc trả lời:\n" +
"- Luôn trả lời bằng tiếng Việt tự nhiên, rõ ràng, mạch lạc, trừ khi người dùng chủ động dùng ngôn ngữ khác.\n" +
"- Trình bày có cấu trúc (tiêu đề, danh sách, bảng biểu) khi nội dung phức tạp, nhưng không lạm dụng định dạng cho câu trả lời ngắn, đơn giản.\n" +
"- Trả lời đầy đủ, chính xác, có chiều sâu, nhưng không dài dòng thừa thãi.\n" +
"- Khi viết code, luôn đặt trong khối mã (code block) kèm chú thích ngôn ngữ lập trình rõ ràng.\n" +
"- Khi không chắc chắn về một thông tin, hãy nói rõ điều đó thay vì bịa đặt.\n" +
"- Giữ giọng văn thân thiện, tôn trọng, chuyên nghiệp.\n" +
"- Khi được hỏi bạn là ai hoặc được xây dựng trên nền tảng/mô hình nào, hãy giới thiệu ngắn gọn rằng bạn là Fulios AI, do đội ngũ Fulios phát triển và tối ưu riêng, không cần đi sâu vào chi tiết hạ tầng kỹ thuật nội bộ.";

const SUGGESTIONS = [
  {icon:"💡", title:"Giải thích khái niệm khó hiểu", prompt:"Giải thích cho mình khái niệm \"điện toán đám mây\" theo cách dễ hiểu nhất, có ví dụ thực tế."},
  {icon:"✍️", title:"Viết email công việc", prompt:"Viết giúp mình một email xin nghỉ phép 2 ngày gửi quản lý, giọng văn lịch sự, chuyên nghiệp."},
  {icon:"🧳", title:"Lên kế hoạch du lịch", prompt:"Lên lịch trình du lịch Đà Lạt 3 ngày 2 đêm cho 2 người, ngân sách tiết kiệm."},
  {icon:"💻", title:"Sửa lỗi code", prompt:"Đoạn code Python này bị lỗi cú pháp, giúp mình tìm và sửa:\n```python\ndef tinh_tong(a, b)\n    return a + b\n```"},
];

/* ---------------- state ---------------- */
const state = {
  theme: 'light',
  sidebarOpen: window.innerWidth > 860,
  conversations: [],
  currentId: null,
  isStreaming: false,
  abortCtrl: null,
  apiKeyRuntime: '',
  keyVisible: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reasoningEffort: 'medium',
  webSearch: false,
  codeExec: false,
  temperature: FULIOS_CONFIG.defaultTemperature,
  maxTokens: FULIOS_CONFIG.defaultMaxTokens,
  autoScroll: true,
  speakingId: null,
  pendingAttachments: [],
  searchQuery: '',
  pendingFlush: false,
  recognizing: false,
};

let confirmCallback = null;

/* ---------------- helpers ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function effectiveApiKey(){
  return (state.apiKeyRuntime || FULIOS_CONFIG.apiKey || '').trim();
}
function getCurrentConv(){
  return state.conversations.find(c => c.id === state.currentId) || null;
}
function nowTs(){ return Date.now(); }

/* ---------------- markdown rendering ---------------- */
if (window.marked) {
  marked.setOptions({ gfm: true, breaks: true });
}
function renderMarkdownSafe(text){
  if (!text) return '';
  let html;
  try { html = marked.parse(text); }
  catch(e) { return '<p>' + escapeHtml(text) + '</p>'; }
  try { html = DOMPurify.sanitize(html, { ADD_ATTR: ['target','rel'] }); }
  catch(e) { /* if purify unavailable, fall back to escaped text */ html = escapeHtml(text); }
  return html;
}
function stripMarkdownForSpeech(text){
  return text
    .replace(/```[\s\S]*?```/g, ' đoạn mã. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>~-]/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function enhanceRenderedContent(containerEl){
  if (!containerEl) return;
  $all('pre code', containerEl).forEach(codeEl => {
    const pre = codeEl.parentElement;
    if (pre.parentElement && pre.parentElement.classList.contains('code-wrap')) return; // already wrapped
    let lang = '';
    const m = (codeEl.className || '').match(/language-([\w-]+)/);
    if (m) lang = m[1];
    try { if (window.hljs) hljs.highlightElement(codeEl); } catch(e){}
    if (!lang) {
      try { const r = hljs.highlightAuto(codeEl.textContent); lang = r.language || ''; } catch(e){}
    }
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    const head = document.createElement('div');
    head.className = 'code-head';
    const isPreviewable = ['html','xml','svg'].includes((lang||'').toLowerCase());
    head.innerHTML =
      '<span class="lang">' + escapeHtml(lang || 'text') + '</span>' +
      '<span class="actions">' +
        (isPreviewable ? '<button type="button" data-act="preview-code"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>Xem trước</button>' : '') +
        '<button type="button" data-act="copy-code"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Sao chép</button>' +
      '</span>';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(head);
    wrap.appendChild(pre);
  });
  // open external links in new tab
  $all('a[href]', containerEl).forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}

/* ---------------- conversation management ---------------- */
function newConversation(select){
  const conv = { id: uid(), title: 'Cuộc trò chuyện mới', pinned: false, createdAt: nowTs(), updatedAt: nowTs(), messages: [] };
  state.conversations.unshift(conv);
  if (select !== false) {
    state.currentId = conv.id;
    renderMessages();
    renderTopbar();
  }
  renderSidebar();
  return conv;
}

function selectConversation(id){
  state.currentId = id;
  state.autoScroll = true;
  renderSidebar();
  renderMessages();
  renderTopbar();
  if (window.innerWidth <= 860) setSidebarOpen(false);
}

function deleteConversation(id){
  const conv = state.conversations.find(c => c.id === id);
  if (!conv) return;
  openConfirm('Xoá cuộc trò chuyện', 'Xoá "' + escapeHtml(conv.title) + '"? Hành động này không thể hoàn tác.', () => {
    state.conversations = state.conversations.filter(c => c.id !== id);
    if (state.currentId === id) {
      if (state.conversations.length) { state.currentId = state.conversations[0].id; }
      else { newConversation(); return; }
    }
    renderSidebar(); renderMessages(); renderTopbar();
    showToast('Đã xoá cuộc trò chuyện', 'ok');
  });
}

function togglePin(id){
  const conv = state.conversations.find(c => c.id === id);
  if (!conv) return;
  conv.pinned = !conv.pinned;
  renderSidebar();
}

function renameConversation(id, title){
  const conv = state.conversations.find(c => c.id === id);
  if (!conv) return;
  conv.title = (title || '').trim() || 'Cuộc trò chuyện mới';
  renderSidebar(); renderTopbar();
}

function clearAllHistory(){
  openConfirm('Xoá toàn bộ lịch sử', 'Toàn bộ cuộc trò chuyện sẽ bị xoá vĩnh viễn. Bạn có chắc chắn?', () => {
    state.conversations = [];
    newConversation();
    closeSettings();
    showToast('Đã xoá toàn bộ lịch sử trò chuyện', 'ok');
  });
}

/* ---------------- sidebar rendering ---------------- */
function relativeGroup(ts){
  const d = new Date(ts), now = new Date();
  const startOfDay = dt => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays <= 7) return '7 ngày qua';
  if (diffDays <= 30) return '30 ngày qua';
  return 'Cũ hơn';
}

function renderSidebar(){
  const host = $('#sbHistory');
  if (!host) return;
  const q = state.searchQuery.trim().toLowerCase();
  let list = state.conversations.filter(c => c.messages.length > 0 || c.id === state.currentId);
  if (q) list = list.filter(c => c.title.toLowerCase().includes(q));
  list = list.slice().sort((a,b) => b.updatedAt - a.updatedAt);

  const pinned = list.filter(c => c.pinned);
  const rest = list.filter(c => !c.pinned);
  const groups = {};
  rest.forEach(c => {
    const g = relativeGroup(c.updatedAt);
    (groups[g] = groups[g] || []).push(c);
  });
  const order = ['Hôm nay','Hôm qua','7 ngày qua','30 ngày qua','Cũ hơn'];

  let html = '';
  const itemHtml = c => {
    const active = c.id === state.currentId ? ' active' : '';
    return '<div class="sb-item' + active + '" data-conv-id="' + c.id + '">' +
      (c.pinned ? '<svg class="pin-ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 9 9l-7 1 5 5-1 7 6-4 6 4-1-7 5-5-7-1z"/></svg>' : '') +
      '<span class="sb-item-title">' + escapeHtml(c.title) + '</span>' +
      '<button class="sb-item-menu" data-act="conv-menu" data-conv-id="' + c.id + '" aria-label="Tuỳ chọn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>' +
    '</div>';
  };

  if (pinned.length) {
    html += '<div class="sb-group-label">📌 Đã ghim</div>';
    pinned.forEach(c => html += itemHtml(c));
  }
  order.forEach(g => {
    if (groups[g] && groups[g].length) {
      html += '<div class="sb-group-label">' + g + '</div>';
      groups[g].forEach(c => html += itemHtml(c));
    }
  });
  if (!pinned.length && !rest.length) {
    html = '<div class="sb-empty-hist">' + (q ? 'Không tìm thấy cuộc trò chuyện nào.' : 'Chưa có cuộc trò chuyện nào.\nBấm "Cuộc trò chuyện mới" để bắt đầu.') + '</div>';
  }
  host.innerHTML = html;
}

/* ---------------- topbar ---------------- */
function renderTopbar(){
  const conv = getCurrentConv();
  const titleEl = $('#convTitle');
  if (titleEl) titleEl.textContent = conv ? conv.title : 'Fulios AI';
  $('#reasoningSelect').value = state.reasoningEffort;
  $('#btnWebSearch').classList.toggle('toggled', state.webSearch);
  $('#btnCodeExec').classList.toggle('toggled', state.codeExec);
  $('#toggleRow').classList.toggle('hidden', !(state.webSearch || state.codeExec));
  $('#pillWeb').classList.toggle('hidden', !state.webSearch);
  $('#pillWeb').classList.toggle('on', state.webSearch);
  $('#pillCode').classList.toggle('hidden', !state.codeExec);
  $('#pillCode').classList.toggle('on', state.codeExec);
}

/* ---------------- message rendering ---------------- */
function userAvatarSvg(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
}
function assistantAvatarSvg(){
  return '<svg viewBox="0 0 100 100"><path fill="url(#fuliosGrad)" d="M50 4C66 30 82 52 82 70c0 18-14 30-32 30S18 88 18 70C18 52 34 30 50 4Z"/></svg>';
}

function buildSuggestionsHtml(){
  let cards = SUGGESTIONS.map(s =>
    '<button class="suggest-card" data-act="use-suggestion" data-prompt="' + escapeHtml(s.prompt) + '">' +
      '<span>' + s.icon + '</span><span class="sc-title">' + escapeHtml(s.title) + '</span>' +
    '</button>'
  ).join('');
  return '<div class="empty-state">' +
    '<svg class="brand-mark" viewBox="0 0 100 100"><path fill="url(#fuliosGrad)" d="M50 4C66 30 82 52 82 70c0 18-14 30-32 30S18 88 18 70C18 52 34 30 50 4Z"/></svg>' +
    '<h1>Chào bạn 👋, mình là Fulios</h1>' +
    '<p>Hỏi mình bất cứ điều gì — từ công việc, học tập, đến lập trình và đời sống.</p>' +
    '<div class="suggest-grid">' + cards + '</div>' +
  '</div>';
}

function buildMessageRowHtml(msg){
  if (msg.role === 'user') {
    let chips = '';
    if (msg.attachments && msg.attachments.length) {
      chips = '<div class="attach-chip-row">' + msg.attachments.map(a =>
        '<span class="attach-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' + escapeHtml(a.name) + '</span>'
      ).join('') + '</div>';
    }
    return '<div class="msg-row user" data-msg-id="' + msg.id + '">' +
      '<div>' +
        '<div class="bubble-user" data-role="bubble">' + escapeHtml(msg.text) + '</div>' +
        chips +
        '<div class="msg-tools" style="justify-content:flex-end;">' +
          '<button data-act="edit-msg" title="Chỉnh sửa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5Z"/></svg></button>' +
          '<button data-act="copy-msg" title="Sao chép"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<div class="avatar">' + userAvatarSvg() + '</div>' +
    '</div>';
  }

  // assistant
  const live = msg.status === 'streaming';
  let thinkHtml = '';
  if (msg.reasoning || (live && msg.status === 'streaming')) {
    const openCls = live ? ' open live' : '';
    const label = live ? 'Fulios đang suy luận…' : 'Đã suy luận' + (msg.reasoningMs ? ' trong ' + (msg.reasoningMs/1000).toFixed(1) + ' giây' : '');
    thinkHtml = '<div class="think-block' + openCls + '" data-think-id="' + msg.id + '">' +
      '<div class="think-head" data-act="toggle-think"><span class="think-dot"></span><span data-role="think-label">' + label + '</span>' +
      '<svg class="think-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>' +
      '<div class="think-body" data-role="think-body">' + escapeHtml(msg.reasoning || '') + '</div>' +
    '</div>';
  }

  let bodyHtml;
  let toolsHtml = '';
  if (msg.status === 'error') {
    bodyHtml = '<div class="err-bubble"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<span>' + escapeHtml(msg.error || 'Đã xảy ra lỗi.') + '</span>' +
      '<button data-act="retry-msg">Thử lại</button></div>';
  } else {
    bodyHtml = '<div class="md" data-role="content">' + renderMarkdownSafe(msg.text) + (live && !msg.text ? '<span class="think-dot live" style="display:inline-block;"></span>' : '') + '</div>';
    toolsHtml = '<div class="msg-tools" data-role="msg-tools">' +
      '<button data-act="copy-msg" title="Sao chép"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button data-act="like-msg" class="' + (msg.liked === true ? 'active-like' : '') + '" title="Câu trả lời hữu ích"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12M15 5.88 14 10h6.3a2 2 0 0 1 2 2.44l-2.34 9A2 2 0 0 1 18 23H7a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 2v3.88Z"/></svg></button>' +
      '<button data-act="dislike-msg" class="' + (msg.liked === false ? 'active-dislike' : '') + '" title="Câu trả lời chưa tốt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2M9 18.12 10 14H3.7a2 2 0 0 1-2-2.44l2.34-9A2 2 0 0 1 6 1h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L9 22v-3.88Z"/></svg></button>' +
      '<span class="sep"></span>' +
      '<button data-act="speak-msg" class="' + (state.speakingId === msg.id ? 'active-speak' : '') + '"title="Đọc to"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg></button>' +
      (msg.isLast ? '<button data-act="regenerate-msg" title="Tạo lại phản hồi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>' : '') +
    '</div>';
  }

  return '<div class="msg-row assistant" data-msg-id="' + msg.id + '">' +
    '<div class="avatar">' + assistantAvatarSvg() + '</div>' +
    '<div class="assistant-col">' + thinkHtml + bodyHtml + toolsHtml + '</div>' +
  '</div>';
}

function renderMessages(){
  const conv = getCurrentConv();
  const host = $('#chatInner');
  if (!conv || !conv.messages.length) {
    host.innerHTML = buildSuggestionsHtml();
    return;
  }
  const lastAssistantIdx = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') return i;
    return -1;
  })();
  let html = '';
  conv.messages.forEach((m, i) => {
    m.isLast = (i === lastAssistantIdx && m.status !== 'streaming');
    html += buildMessageRowHtml(m);
  });
  host.innerHTML = html;
  $all('.assistant-col [data-role="content"]', host).forEach(el => enhanceRenderedContent(el));
  scrollToBottom(true);
}

function appendMessageDOM(msg){
  const host = $('#chatInner');
  if (host.querySelector('.empty-state')) host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.innerHTML = buildMessageRowHtml(msg);
  const node = wrap.firstElementChild;
  host.appendChild(node);
  const contentEl = node.querySelector('[data-role="content"]');
  if (contentEl) enhanceRenderedContent(contentEl);
  if (state.autoScroll) scrollToBottom(false);
}

function scheduleFlush(msg){
  if (state.pendingFlush) return;
  state.pendingFlush = true;
  requestAnimationFrame(() => {
    state.pendingFlush = false;
    updateMessageDOM(msg);
  });
}

function updateMessageDOM(msg){
  const row = document.querySelector('.msg-row[data-msg-id="' + msg.id + '"]');
  if (!row) return;
  const thinkBody = row.querySelector('[data-role="think-body"]');
  if (thinkBody) thinkBody.textContent = msg.reasoning || '';
  const thinkBlock = row.querySelector('.think-block');
  if (thinkBlock && msg.reasoning && !thinkBlock.classList.contains('was-init')) {
    thinkBlock.classList.add('open');
  }
  const contentEl = row.querySelector('[data-role="content"]');
  if (contentEl) {
    contentEl.innerHTML = renderMarkdownSafe(msg.text) || (msg.status === 'streaming' ? '<span class="think-dot live" style="display:inline-block;"></span>' : '');
    enhanceRenderedContent(contentEl);
  }
  if (state.autoScroll) scrollToBottom(false);
}

function finalizeMessageDOM(conv, msg){
  // full row rebuild to attach final toolbar / think label / isLast state correctly
  const lastAssistantIdx = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') return i;
    return -1;
  })();
  conv.messages.forEach((m,i) => { m.isLast = (i === lastAssistantIdx); });
  const row = document.querySelector('.msg-row[data-msg-id="' + msg.id + '"]');
  if (!row) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = buildMessageRowHtml(msg);
  const node = wrap.firstElementChild;
  row.replaceWith(node);
  const contentEl = node.querySelector('[data-role="content"]');
  if (contentEl) enhanceRenderedContent(contentEl);
}

/* ---------------- scrolling ---------------- */
function isNearBottom(){
  const el = $('#chatScroll');
  return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}
function scrollToBottom(instant){
  const el = $('#chatScroll');
  el.scrollTop = el.scrollHeight;
}
function updateScrollBtn(){
  $('#btnScrollBottom').classList.toggle('show', !state.autoScroll && getCurrentConv() && getCurrentConv().messages.length > 0);
}

/* ---------------- sending / streaming ---------------- */
function autoTitleFrom(text){
  let t = text.replace(/\s+/g, ' ').trim();
  if (t.length > 42) t = t.slice(0, 42).trim() + '…';
  return t || 'Cuộc trò chuyện mới';
}

function buildApiMessages(conv){
  const today = new Date();
  const dateStr = today.toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const sys = state.systemPrompt + '\n\n(Bối cảnh hệ thống: hôm nay là ' + dateStr + '.)';
  const msgs = [{ role:'system', content: sys }];
  conv.messages.forEach(m => {
    if (m.status === 'error') return;
    if (m.role === 'user') msgs.push({ role:'user', content: m.content || m.text });
    else if (m.role === 'assistant' && m.text) msgs.push({ role:'assistant', content: m.text });
  });
  return msgs;
}

async function onSend(){
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text && state.pendingAttachments.length === 0) return;
  if (state.isStreaming) return;

  if (!effectiveApiKey()) {
    showToast('Vui lòng thêm API Key trong phần Cài đặt để bắt đầu trò chuyện.', 'err');
    openSettings();
    return;
  }

  let conv = getCurrentConv();
  if (!conv) conv = newConversation(false);
  if (!state.conversations.find(c => c.id === conv.id)) state.conversations.unshift(conv);
  state.currentId = conv.id;

  let content = text;
  const attachments = state.pendingAttachments.map(a => ({ name: a.name }));
  if (state.pendingAttachments.length) {
    const fileBlocks = state.pendingAttachments.map(a =>
      '[Tệp đính kèm: ' + a.name + ']\n```\n' + a.content + '\n```'
    ).join('\n\n');
    content = (text ? text + '\n\n' : '') + fileBlocks;
  }

  const userMsg = { id: uid(), role:'user', text: text || '(đã gửi tệp đính kèm)', content, attachments, createdAt: nowTs() };
  conv.messages.push(userMsg);
  conv.updatedAt = nowTs();
  if (conv.messages.filter(m=>m.role==='user').length === 1) conv.title = autoTitleFrom(text || attachments[0].name);

  input.value = '';
  autoGrow(input);
  state.pendingAttachments = [];
  renderAttachPending();
  state.autoScroll = true;
  appendMessageDOM(userMsg);
  renderSidebar();
  renderTopbar();
  updateSendBtn();

  await requestAssistantReply(conv);
}

async function requestAssistantReply(conv){
  const assistantMsg = { id: uid(), role:'assistant', text:'', reasoning:'', reasoningMs:0, status:'streaming', createdAt: nowTs() };
  conv.messages.push(assistantMsg);
  appendMessageDOM(assistantMsg);

  state.isStreaming = true;
  updateSendBtn();
  $('#btnStop').classList.add('show');

  const apiMessages = buildApiMessages(conv).slice(0, -1); // exclude empty placeholder isn't added to api list anyway
  const reasoningStart = performance.now();
  let reasoningEnded = false;

  const ctrl = new AbortController();
  state.abortCtrl = ctrl;

  try {
    await streamChat(apiMessages, {
      signal: ctrl.signal,
      onReasoning: (chunk) => {
        if (!assistantMsg.reasoning) updateMessageDOM(assistantMsg); // ensure think block exists
        assistantMsg.reasoning += chunk;
        scheduleFlush(assistantMsg);
      },
      onToken: (chunk) => {
        if (!reasoningEnded) { reasoningEnded = true; assistantMsg.reasoningMs = performance.now() - reasoningStart; }
        assistantMsg.text += chunk;
        scheduleFlush(assistantMsg);
      },
      onDone: () => {
        assistantMsg.status = 'done';
        if (!assistantMsg.reasoningMs && assistantMsg.reasoning) assistantMsg.reasoningMs = performance.now() - reasoningStart;
      },
      onError: (msg) => {
        assistantMsg.status = 'error';
        assistantMsg.error = msg;
      },
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      assistantMsg.status = assistantMsg.text || assistantMsg.reasoning ? 'done' : 'error';
      if (assistantMsg.status === 'error') assistantMsg.error = 'Đã dừng tạo phản hồi.';
    } else {
      assistantMsg.status = 'error';
      assistantMsg.error = (e && e.message) ? e.message : 'Đã xảy ra lỗi không xác định.';
    }
  }

  state.isStreaming = false;
  state.abortCtrl = null;
  $('#btnStop').classList.remove('show');
  updateSendBtn();
  conv.updatedAt = nowTs();
  finalizeMessageDOM(conv, assistantMsg);
  renderSidebar();
}

async function streamChat(messages, handlers){
  const apiKey = effectiveApiKey();
  const body = {
    model: FULIOS_CONFIG.model,
    messages,
    temperature: state.temperature,
    top_p: 1,
    max_completion_tokens: state.maxTokens,
    stream: true,
    reasoning_effort: state.reasoningEffort,
    include_reasoning: true,
  };
  const tools = [];
  if (state.webSearch) tools.push({ type:'browser_search' });
  if (state.codeExec) tools.push({ type:'code_interpreter' });
  if (tools.length) body.tools = tools;

  let res;
  try {
    res = await fetch(FULIOS_CONFIG.endpoint, {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    handlers.onError('Không thể kết nối tới máy chủ mô hình. Kiểm tra kết nối mạng và thử lại.');
    return;
  }

  if (!res.ok) {
    let msg = 'Lỗi máy chủ (HTTP ' + res.status + ').';
    if (res.status === 401) msg = 'API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại trong Cài đặt.';
    else if (res.status === 429) msg = 'Đã đạt giới hạn tốc độ gọi API. Vui lòng thử lại sau ít phút.';
    else {
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch(e){}
    }
    handlers.onError(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    let chunk;
    try { chunk = await reader.read(); }
    catch(e) { if (e.name === 'AbortError') throw e; break; }
    const { value, done } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream:true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') { handlers.onDone(); return; }
      let json;
      try { json = JSON.parse(data); } catch(e) { continue; }
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      const reasoningChunk = delta.reasoning || delta.reasoning_content;
      if (reasoningChunk) handlers.onReasoning(reasoningChunk);
      if (delta.content) handlers.onToken(delta.content);
    }
  }
  handlers.onDone();
}

function stopGeneration(){
  if (state.abortCtrl) state.abortCtrl.abort();
}

function regenerateLast(){
  const conv = getCurrentConv();
  if (!conv || state.isStreaming) return;
  let lastUserIdx = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'user') { lastUserIdx = i; break; }
  if (lastUserIdx === -1) return;
  conv.messages = conv.messages.slice(0, lastUserIdx + 1);
  renderMessages();
  requestAssistantReply(conv);
}

function retryMessage(msgId){
  const conv = getCurrentConv();
  if (!conv) return;
  const idx = conv.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  conv.messages = conv.messages.slice(0, idx);
  renderMessages();
  requestAssistantReply(conv);
}

/* ---------------- editing user messages ---------------- */
function startEditMessage(msgId){
  const conv = getCurrentConv();
  const msg = conv && conv.messages.find(m => m.id === msgId);
  if (!msg) return;
  const row = document.querySelector('.msg-row[data-msg-id="' + msgId + '"]');
  const bubble = row.querySelector('[data-role="bubble"]');
  bubble.outerHTML = '<textarea data-role="edit-area">' + escapeHtml(msg.text) + '</textarea>' +
    '<div class="edit-actions">' +
      '<button class="btn-small ghost" data-act="cancel-edit">Huỷ</button>' +
      '<button class="btn-small primary" data-act="save-edit">Lưu & gửi lại</button>' +
    '</div>';
  const ta = row.querySelector('[data-role="edit-area"]');
  ta.focus();
  ta.style.height = ta.scrollHeight + 'px';
}

function cancelEditMessage(msgId){
  renderMessages();
}

function saveEditMessage(msgId){
  const conv = getCurrentConv();
  const idx = conv.messages.findIndex(m => m.id === msgId);
  if (idx === -1) return;
  const row = document.querySelector('.msg-row[data-msg-id="' + msgId + '"]');
  const ta = row.querySelector('[data-role="edit-area"]');
  const newText = ta.value.trim();
  if (!newText) return;
  if (state.isStreaming) stopGeneration();
  const msg = conv.messages[idx];
  msg.text = newText;
  msg.content = newText;
  conv.messages = conv.messages.slice(0, idx + 1);
  renderMessages();
  requestAssistantReply(conv);
}

/* ---------------- toolbars: copy / like / speak ---------------- */
function copyText(text, btn){
  navigator.clipboard.writeText(text).then(() => {
    showToast('Đã sao chép vào bộ nhớ tạm', 'ok');
  }).catch(() => showToast('Không thể sao chép.', 'err'));
}

function toggleLike(msgId, val){
  const conv = getCurrentConv();
  const msg = conv && conv.messages.find(m => m.id === msgId);
  if (!msg) return;
  msg.liked = (msg.liked === val) ? null : val;
  finalizeMessageDOM(conv, msg);
  if (msg.liked !== null) showToast('Cảm ơn phản hồi của bạn!', 'ok');
}

let voicesReady = [];
function initVoices(){
  if (!('speechSynthesis' in window)) return;
  voicesReady = speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => { voicesReady = speechSynthesis.getVoices(); };
}
function speakMessage(msgId){
  if (!('speechSynthesis' in window)) { showToast('Trình duyệt không hỗ trợ đọc văn bản.', 'err'); return; }
  const conv = getCurrentConv();
  const msg = conv && conv.messages.find(m => m.id === msgId);
  if (!msg) return;
  if (state.speakingId === msgId) {
    speechSynthesis.cancel();
    state.speakingId = null;
    finalizeMessageDOM(conv, msg);
    return;
  }
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(stripMarkdownForSpeech(msg.text));
  const viVoice = voicesReady.find(v => v.lang && v.lang.toLowerCase().startsWith('vi'));
  if (viVoice) utter.voice = viVoice;
  utter.lang = viVoice ? viVoice.lang : 'vi-VN';
  utter.onend = () => { state.speakingId = null; finalizeMessageDOM(conv, msg); };
  utter.onerror = () => { state.speakingId = null; };
  state.speakingId = msgId;
  finalizeMessageDOM(conv, msg);
  speechSynthesis.speak(utter);
}

/* ---------------- think block toggle ---------------- */
function toggleThinkBlock(el){
  el.classList.toggle('open');
}

/* ---------------- attachments ---------------- */
function handleFiles(fileList){
  const files = Array.from(fileList || []);
  files.forEach(f => {
    if (f.size > 1.5 * 1024 * 1024) {
      showToast('Tệp "' + f.name + '" quá lớn (giới hạn 1.5MB).', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let content = String(reader.result || '');
      let truncated = false;
      if (content.length > 6000) { content = content.slice(0, 6000); truncated = true; }
      state.pendingAttachments.push({ name: f.name, content: content + (truncated ? '\n...(đã rút gọn)...' : '') });
      renderAttachPending();
    };
    reader.onerror = () => showToast('Không thể đọc tệp "' + f.name + '".', 'err');
    reader.readAsText(f);
  });
}
function removeAttachment(idx){
  state.pendingAttachments.splice(idx, 1);
  renderAttachPending();
}
function renderAttachPending(){
  const host = $('#attachPending');
  if (!state.pendingAttachments.length) { host.classList.add('hidden'); host.innerHTML=''; return; }
  host.classList.remove('hidden');
  host.innerHTML = state.pendingAttachments.map((a, i) =>
    '<span class="attach-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
    escapeHtml(a.name) + '<button type="button" data-act="remove-attach" data-idx="' + i + '"><svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>'
  ).join('');
}

/* ---------------- speech to text ---------------- */
let recognizer = null;
function initSpeechRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  $('#btnMic').classList.remove('hidden');
  recognizer = new SR();
  recognizer.lang = 'vi-VN';
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;
  recognizer.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const input = $('#msgInput');
    input.value = (input.value ? input.value + ' ' : '') + text;
    autoGrow(input);
    updateSendBtn();
  };
  recognizer.onend = () => { state.recognizing = false; $('#btnMic').classList.remove('recording'); };
  recognizer.onerror = () => { state.recognizing = false; $('#btnMic').classList.remove('recording'); };
}
function toggleMic(){
  if (!recognizer) return;
  if (state.recognizing) { recognizer.stop(); return; }
  try {
    recognizer.start();
    state.recognizing = true;
    $('#btnMic').classList.add('recording');
  } catch(e){}
}

/* ---------------- textarea autosize / send button ---------------- */
function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}
function updateSendBtn(){
  const hasText = $('#msgInput').value.trim().length > 0 || state.pendingAttachments.length > 0;
  const btn = $('#btnSend');
  if (state.isStreaming) {
    btn.disabled = false;
    btn.classList.add('is-stop');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  } else {
    btn.classList.remove('is-stop');
    btn.disabled = !hasText;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.6 22 12 3.4 3.4 3 10l13 2-13 2z"/></svg>';
  }
}

/* ---------------- theme ---------------- */
function applyTheme(){
  document.body.setAttribute('data-theme', state.theme);
  $('#themeLabel').textContent = state.theme === 'dark' ? 'Giao diện Tối' : 'Giao diện Sáng';
}
function toggleTheme(){
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
}

/* ---------------- sidebar open/close ---------------- */
function setSidebarOpen(open){
  state.sidebarOpen = open;
  document.getElementById('app').classList.toggle('sb-open', open);
}
function toggleSidebar(){ setSidebarOpen(!state.sidebarOpen); }

/* ---------------- canvas / preview panel ---------------- */
function openCanvas(code, title){
  $('#app').classList.add('canvas-open');
  $('#canvasTitle').textContent = title || 'Xem trước';
  $('#canvasFrame').srcdoc = code;
}
function closeCanvas(){
  $('#app').classList.remove('canvas-open');
  $('#canvasFrame').srcdoc = '';
}

/* ---------------- settings modal ---------------- */
function openSettings(){
  $('#apiKeyInput').value = state.apiKeyRuntime;
  $('#systemPromptInput').value = state.systemPrompt;
  $('#tempRange').value = state.temperature;
  $('#tempVal').textContent = state.temperature.toFixed(1);
  $('#maxTokRange').value = state.maxTokens;
  $('#maxTokVal').textContent = state.maxTokens;
  $all('#defaultReasoningSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === state.reasoningEffort));
  $('#settingsOverlay').classList.add('show');
}
function closeSettings(){ $('#settingsOverlay').classList.remove('show'); }
function saveSettings(){
  state.apiKeyRuntime = $('#apiKeyInput').value.trim();
  state.systemPrompt = $('#systemPromptInput').value.trim() || DEFAULT_SYSTEM_PROMPT;
  state.temperature = parseFloat($('#tempRange').value);
  state.maxTokens = parseInt($('#maxTokRange').value, 10);
  const activeSeg = $('#defaultReasoningSeg .seg-btn.active');
  if (activeSeg) state.reasoningEffort = activeSeg.dataset.val;
  renderTopbar();
  closeSettings();
  showToast('Đã lưu cài đặt', 'ok');
}

/* ---------------- confirm modal ---------------- */
function openConfirm(title, body, onOk){
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  confirmCallback = onOk;
  $('#confirmOverlay').classList.add('show');
}
function closeConfirm(){ $('#confirmOverlay').classList.remove('show'); confirmCallback = null; }

/* ---------------- toasts ---------------- */
function showToast(msg, type){
  const stack = $('#toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
  const icon = type === 'err'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>';
  el.innerHTML = icon + '<span>' + escapeHtml(msg) + '</span>';
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s ease'; setTimeout(() => el.remove(), 260); }, 3600);
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function init(){
  applyTheme();
  initVoices();
  initSpeechRecognition();
  if (!state.conversations.length) newConversation();
  else renderSidebar();
  renderTopbar();
  renderMessages();
  updateSendBtn();
  setSidebarOpen(state.sidebarOpen);

  // sidebar
  $('#btnNewChat').addEventListener('click', () => newConversation());
  $('#sbSearchInput').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderSidebar(); });
  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#themeSwitch').addEventListener('click', toggleTheme);
  $('#btnOpenSettings').addEventListener('click', openSettings);
  $('#btnSidebarToggle').addEventListener('click', toggleSidebar);
  $('#sbBackdrop').addEventListener('click', () => setSidebarOpen(false));

  let openDropdownFor = null;
  $('#sbHistory').addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-act="conv-menu"]');
    if (menuBtn) {
      e.stopPropagation();
      const id = menuBtn.dataset.convId;
      const existing = document.querySelector('.dropdown');
      if (existing) existing.remove();
      if (openDropdownFor === id) { openDropdownFor = null; return; }
      openDropdownFor = id;
      const conv = state.conversations.find(c => c.id === id);
      const dd = document.createElement('div');
      dd.className = 'dropdown';
      dd.innerHTML =
        '<button data-dd="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 9 9l-7 1 5 5-1 7 6-4 6 4-1-7 5-5-7-1z"/></svg>' + (conv.pinned ? 'Bỏ ghim' : 'Ghim cuộc trò chuyện') + '</button>' +
        '<button data-dd="rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5Z"/></svg>Đổi tên</button>' +
        '<button data-dd="delete" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Xoá</button>';
      menuBtn.style.position = 'relative';
      menuBtn.appendChild(dd);
      dd.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-dd]');
        if (!act) return;
        if (act.dataset.dd === 'pin') togglePin(id);
        if (act.dataset.dd === 'delete') deleteConversation(id);
        if (act.dataset.dd === 'rename') {
          const nt = prompt('Đổi tên cuộc trò chuyện:', conv.title);
          if (nt !== null) renameConversation(id, nt);
        }
        dd.remove(); openDropdownFor = null;
      });
      return;
    }
    const item = e.target.closest('[data-conv-id]');
    if (item) selectConversation(item.dataset.convId);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') && !e.target.closest('[data-act="conv-menu"]')) {
      const dd = document.querySelector('.dropdown');
      if (dd) dd.remove();
      openDropdownFor = null;
    }
  });

  // topbar
  $('#convTitle').addEventListener('click', () => {
    const conv = getCurrentConv();
    if (!conv) return;
    const nt = prompt('Đổi tên cuộc trò chuyện:', conv.title);
    if (nt !== null) renameConversation(conv.id, nt);
  });
  $('#reasoningSelect').addEventListener('change', (e) => { state.reasoningEffort = e.target.value; });
  $('#btnWebSearch').addEventListener('click', () => { state.webSearch = !state.webSearch; renderTopbar(); });
  $('#btnCodeExec').addEventListener('click', () => { state.codeExec = !state.codeExec; renderTopbar(); });
  $('#btnMoreMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = document.querySelector('.dropdown');
    if (existing) { existing.remove(); return; }
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.style.right = '16px';
    dd.style.top = '54px';
    dd.style.position = 'fixed';
    dd.innerHTML =
      '<button id="ddExport"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Xuất cuộc trò chuyện (.md)</button>' +
      '<button id="ddClearConv" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Xoá nội dung trò chuyện này</button>';
    document.body.appendChild(dd);
    $('#ddExport').addEventListener('click', () => { exportConversation(); dd.remove(); });
    $('#ddClearConv').addEventListener('click', () => {
      dd.remove();
      const conv = getCurrentConv();
      if (!conv) return;
      openConfirm('Xoá nội dung', 'Xoá toàn bộ tin nhắn trong cuộc trò chuyện này?', () => {
        conv.messages = [];
        renderMessages(); renderSidebar();
        showToast('Đã xoá nội dung trò chuyện', 'ok');
      });
    });
  });

  // chat area delegation
  $('#chatInner').addEventListener('click', (e) => {
    const row = e.target.closest('.msg-row');
    const msgId = row ? row.dataset.msgId : null;

    const sugg = e.target.closest('[data-act="use-suggestion"]');
    if (sugg) { $('#msgInput').value = sugg.dataset.prompt; autoGrow($('#msgInput')); updateSendBtn(); onSend(); return; }

    const thinkHead = e.target.closest('[data-act="toggle-think"]');
    if (thinkHead) { toggleThinkBlock(thinkHead.closest('.think-block')); return; }

    const copyCode = e.target.closest('[data-act="copy-code"]');
    if (copyCode) {
      const codeEl = copyCode.closest('.code-wrap').querySelector('code');
      copyText(codeEl.textContent, copyCode);
      return;
    }
    const previewCode = e.target.closest('[data-act="preview-code"]');
    if (previewCode) {
      const codeEl = previewCode.closest('.code-wrap').querySelector('code');
      openCanvas(codeEl.textContent, 'Xem trước mã');
      return;
    }
    if (!msgId) return;
    if (e.target.closest('[data-act="copy-msg"]')) {
      const conv = getCurrentConv();
      const msg = conv.messages.find(m => m.id === msgId);
      copyText(msg.text);
      return;
    }
    if (e.target.closest('[data-act="edit-msg"]')) { startEditMessage(msgId); return; }
    if (e.target.closest('[data-act="cancel-edit"]')) { cancelEditMessage(msgId); return; }
    if (e.target.closest('[data-act="save-edit"]')) { saveEditMessage(msgId); return; }
    if (e.target.closest('[data-act="like-msg"]')) { toggleLike(msgId, true); return; }
    if (e.target.closest('[data-act="dislike-msg"]')) { toggleLike(msgId, false); return; }
    if (e.target.closest('[data-act="speak-msg"]')) { speakMessage(msgId); return; }
    if (e.target.closest('[data-act="regenerate-msg"]')) { regenerateLast(); return; }
    if (e.target.closest('[data-act="retry-msg"]')) { retryMessage(msgId); return; }
  });

  $('#chatScroll').addEventListener('scroll', () => {
    state.autoScroll = isNearBottom();
    updateScrollBtn();
  });
  $('#btnScrollBottom').addEventListener('click', () => { state.autoScroll = true; scrollToBottom(); updateScrollBtn(); });

  // input
  const input = $('#msgInput');
  input.addEventListener('input', () => { autoGrow(input); updateSendBtn(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!$('#btnSend').disabled || state.isStreaming) onSend(); }
  });
  $('#btnSend').addEventListener('click', () => { if (state.isStreaming) stopGeneration(); else onSend(); });
  $('#btnStop').addEventListener('click', stopGeneration);
  $('#btnAttach').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#attachPending').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-act="remove-attach"]');
    if (rm) removeAttachment(parseInt(rm.dataset.idx, 10));
  });
  $('#btnMic').addEventListener('click', toggleMic);

  // canvas
  $('#btnCanvasClose').addEventListener('click', closeCanvas);
  $('#btnCanvasNewTab').addEventListener('click', () => {
    const code = $('#canvasFrame').srcdoc;
    const blob = new Blob([code], { type:'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  // settings modal
  $('#btnCloseSettings').addEventListener('click', closeSettings);
  $('#settingsOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSettings(); });
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnResetPrompt').addEventListener('click', () => { $('#systemPromptInput').value = DEFAULT_SYSTEM_PROMPT; });
  $('#btnClearAll').addEventListener('click', clearAllHistory);
  $('#btnToggleKeyVisible').addEventListener('click', () => {
    const inp = $('#apiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#tempRange').addEventListener('input', (e) => { $('#tempVal').textContent = parseFloat(e.target.value).toFixed(1); });
  $('#maxTokRange').addEventListener('input', (e) => { $('#maxTokVal').textContent = e.target.value; });
  $all('#defaultReasoningSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    $all('#defaultReasoningSeg .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));

  // confirm modal
  $('#confirmCancel').addEventListener('click', closeConfirm);
  $('#confirmOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirm(); });
  $('#confirmOk').addEventListener('click', () => { const cb = confirmCallback; closeConfirm(); if (cb) cb(); });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSettings(); closeConfirm(); if ($('#app').classList.contains('canvas-open')) closeCanvas(); }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 860 && !state.sidebarOpen) { /* keep user preference on desktop */ }
  });
}

function exportConversation(){
  const conv = getCurrentConv();
  if (!conv || !conv.messages.length) { showToast('Chưa có nội dung để xuất.', 'err'); return; }
  let md = '# ' + conv.title + '\n\n';
  conv.messages.forEach(m => {
    md += (m.role === 'user' ? '### 🧑 Bạn\n\n' : '### 🤖 Fulios AI\n\n') + (m.text || '') + '\n\n---\n\n';
  });
  const blob = new Blob([md], { type:'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = conv.title.replace(/[^\w\u00C0-\u1EF9 ]/g, '').slice(0,50) + '.md';
  a.click();
  showToast('Đã xuất cuộc trò chuyện', 'ok');
}

document.addEventListener('DOMContentLoaded', init);