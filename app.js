/* DsspSeek · 深海档案（01） · round 03
   本地 mock 对话，无网络请求。状态：idle / typing / sending / loading / replied / error
   取证用地址参数：?state=idle|typing|loading|replied|error，?mock=fail（首次发送失败） */
(function () {
  'use strict';

  var root = document.documentElement;
  var transcript = document.getElementById('transcript');
  var form = document.getElementById('composer');
  var input = document.getElementById('message');
  var sendButton = document.getElementById('send-button');
  var stateText = document.getElementById('state-text');
  var startButton = document.getElementById('start-button');
  var rail = document.getElementById('scroll-rail');
  var railBar = document.getElementById('scroll-bar');
  var conversation = document.getElementById('conversation');

  var params = new URLSearchParams(window.location.search);
  var mockFailOnce = params.get('mock') === 'fail';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = 'idle';
  var busy = false;
  var pendingText = '';
  var typingRow = null;
  var errorRow = null;
  var separatorEl = null;
  var liveUserEl = null;
  var failedEl = null;

  var STATUS = {
    idle: '在线，随时开始',
    typing: '她在等你说完。',
    sending: '正在把话送下去…',
    loading: '她在读。',
    replied: '她写好了。',
    error: '信没送到。再递一次。'
  };

  var REPLIES = [
    {
      q: '你在深海做什么？',
      a: '替人收着那些没说完的话。等潮水退了，再一句句还回去。\n\n你今天想先捞哪一句？'
    },
    {
      q: '帮我写个开场',
      a: '那就从潮水退下去的地方写起：\n\n「她第一次听见海底的回声，是有人在叫她的名字。」\n\n要更轻一点，还是更冷一点？'
    },
    {
      q: '随便聊聊',
      a: '那就聊今天的风。它从你那边吹过来的时候，是暖的，还是带着雨的？'
    }
  ];

  var STATE_INPUT = '如果把开头留白，读者会不会更想往下读？';
  var STATE_ERROR_INPUT = '随便聊聊';
  var STATE_REPLIED_REPLY = '那就先别急着写开头。告诉我，那个人此刻正站在哪儿——海面、甲板，还是她自己的房间里？';

  /* ---------- 基础工具 ---------- */

  function paragraphs(text) {
    return text.split('\n\n');
  }

  function appendMessage(kind, text, options) {
    options = options || {};
    var article = document.createElement('article');
    article.className = 'msg msg-' + kind + (options.fresh ? ' is-new' : '');

    var who = document.createElement('p');
    who.className = 'msg-who';
    who.textContent = kind === 'her' ? '鲸鱼娘' : (kind === 'guest' ? '来访者' : '你');

    var body = document.createElement('div');
    body.className = 'msg-body';

    paragraphs(text).forEach(function (part) {
      var p = document.createElement('p');
      p.textContent = part;
      body.appendChild(p);
    });

    article.appendChild(who);
    article.appendChild(body);
    transcript.appendChild(article);
    scrollTranscriptIntoView(article);
    return article;
  }

  function scrollTranscriptIntoView(el) {
    var rect = el.getBoundingClientRect();
    var viewH = window.innerHeight || 800;
    if ((rect.bottom > viewH - 24 || rect.top < 88) && !reduceMotion.matches) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setState(next) {
    state = next;
    form.dataset.state = next;
    stateText.textContent = STATUS[next] || STATUS.idle;

    var isBusy = next === 'sending' || next === 'loading';
    busy = isBusy;
    transcript.setAttribute('aria-busy', isBusy ? 'true' : 'false');

    if (next === 'sending') {
      sendButton.textContent = '发送中…';
      sendButton.classList.add('is-loading');
    } else if (next === 'loading') {
      sendButton.textContent = '发送中…';
      sendButton.classList.add('is-loading');
    } else {
      sendButton.textContent = '发送';
      sendButton.classList.remove('is-loading');
    }
    refreshSendButton();
  }

  function refreshSendButton() {
    var empty = input.value.trim().length === 0;
    sendButton.disabled = busy || empty;
    sendButton.setAttribute('aria-disabled', sendButton.disabled ? 'true' : 'false');
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  function delay(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function addTypingRow() {
    removeTypingRow();
    typingRow = document.createElement('article');
    typingRow.className = 'msg msg-her msg-typing is-new';
    typingRow.setAttribute('aria-label', '鲸鱼娘正在写');
    var who = document.createElement('p');
    who.className = 'msg-who';
    who.textContent = '鲸鱼娘';
    var body = document.createElement('div');
    body.className = 'msg-body';
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('span');
      dot.className = 'dot';
      body.appendChild(dot);
    }
    typingRow.appendChild(who);
    typingRow.appendChild(body);
    transcript.appendChild(typingRow);
  }

  function removeTypingRow() {
    if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;
  }

  function addErrorRow() {
    removeErrorRow();
    errorRow = document.createElement('article');
    errorRow.className = 'msg msg-her msg-error is-new';
    var who = document.createElement('p');
    who.className = 'msg-who';
    who.textContent = '鲸鱼娘';
    var body = document.createElement('div');
    body.className = 'msg-body';
    var p = document.createElement('p');
    p.textContent = '这封没送到。';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry';
    retry.id = 'retry-button';
    retry.textContent = '重试';
    retry.addEventListener('click', function () { retrySend(); });
    body.appendChild(p);
    body.appendChild(retry);
    errorRow.appendChild(who);
    errorRow.appendChild(body);
    transcript.appendChild(errorRow);
  }

  function removeErrorRow() {
    if (errorRow && errorRow.parentNode) errorRow.parentNode.removeChild(errorRow);
    errorRow = null;
  }

  function ensureSeparator() {
    if (separatorEl) return;
    separatorEl = document.createElement('article');
    separatorEl.className = 'msg-sep';
    separatorEl.setAttribute('aria-hidden', 'true');
    var span = document.createElement('span');
    span.textContent = '现在的对话';
    separatorEl.appendChild(span);
    transcript.appendChild(separatorEl);
  }

  function markFailed(el) {
    if (!el) return;
    failedEl = el;
    el.classList.add('is-failed');
    if (el.querySelector('.msg-flag')) return;
    var flag = document.createElement('span');
    flag.className = 'msg-flag';
    flag.textContent = '未送达';
    var who = el.querySelector('.msg-who');
    if (who) who.appendChild(flag);
  }

  function clearFailed() {
    if (!failedEl) return;
    failedEl.classList.remove('is-failed');
    var flag = failedEl.querySelector('.msg-flag');
    if (flag && flag.parentNode) flag.parentNode.removeChild(flag);
    failedEl = null;
  }

  function removeFailedMessage() {
    if (failedEl && failedEl.parentNode) failedEl.parentNode.removeChild(failedEl);
    failedEl = null;
    liveUserEl = null;
    if (separatorEl && !transcript.querySelector('.msg-user') && separatorEl.parentNode) {
      separatorEl.parentNode.removeChild(separatorEl);
      separatorEl = null;
    }
  }

  function replyFor(text) {
    var hit = REPLIES.filter(function (item) { return item.q === text; })[0];
    if (hit) return hit.a;
    return '我记下了：「' + text + '」。\n\n让我先问一句——你希望它被写成什么样子？';
  }

  /* ---------- 发送流程 ---------- */

  async function send() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;

    if (state === 'error' && text === pendingText) {
      retrySend();
      return;
    }

    pendingText = text;
    input.value = '';
    autoGrow();
    removeErrorRow();
    ensureSeparator();
    liveUserEl = appendMessage('user', text, { fresh: true });
    await deliver(text);
  }

  async function deliver(text) {
    setState('sending');
    refreshSendButton();
    await delay(180);

    setState('loading');
    addTypingRow();
    await delay(420 + Math.random() * 580);

    if (mockFailOnce) {
      mockFailOnce = false;
      removeTypingRow();
      setState('error');
      addErrorRow();
      markFailed(liveUserEl);
      if (!input.value.trim()) {
        input.value = pendingText;
        autoGrow();
      }
      refreshSendButton();
      var retryButton = document.getElementById('retry-button');
      if (retryButton) retryButton.focus({ preventScroll: true });
      return;
    }

    removeTypingRow();
    clearFailed();
    appendMessage('her', replyFor(text), { fresh: true });
    pendingText = '';
    autoGrow();
    setState('replied');
    input.focus({ preventScroll: true });
  }

  function retrySend() {
    if (busy || !pendingText) return;
    removeErrorRow();
    input.value = '';
    autoGrow();
    refreshSendButton();
    deliver(pendingText);
  }

  /* ---------- 事件 ---------- */

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    send();
  });

  input.addEventListener('input', function () {
    autoGrow();
    refreshSendButton();
    if (state === 'error') {
      if (input.value.trim() !== pendingText) {
        removeErrorRow();
        setState(input.value.trim() ? 'typing' : 'idle');
      }
      return;
    }
    if (!busy) setState(input.value.trim() ? 'typing' : (state === 'replied' ? 'replied' : 'idle'));
  });

  var composing = false;
  input.addEventListener('compositionstart', function () { composing = true; });
  input.addEventListener('compositionend', function () { composing = false; });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.shiftKey && !composing && !event.isComposing) {
      event.preventDefault();
      if (busy) return;
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      autoGrow();
      refreshSendButton();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });

  function dismissError() {
    if (!errorRow) return false;
    removeErrorRow();
    removeFailedMessage();
    pendingText = '';
    input.value = '';
    autoGrow();
    setState('idle');
    refreshSendButton();
    input.focus({ preventScroll: true });
    return true;
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (dismissError()) return;
    if (input.value) {
      input.value = '';
      autoGrow();
      setState('idle');
      refreshSendButton();
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      removeErrorRow();
      pendingText = '';
      input.value = chip.getAttribute('data-fill') || '';
      autoGrow();
      refreshSendButton();
      setState('typing');
      input.focus({ preventScroll: true });
    });
  });

  startButton.addEventListener('click', function () {
    var narrow = window.matchMedia('(max-width: 700px)').matches;
    if (narrow) {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    conversation.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(function () {
      input.focus({ preventScroll: true });
    }, reduceMotion.matches ? 0 : 420);
  });

  /* ---------- 区块进入动效 ---------- */

  root.classList.add('js');
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('is-in'); });
  }

  /* ---------- 滚动进度 ---------- */

  var ticking = false;
  function onScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    railBar.style.height = (progress * 100) + '%';
    rail.classList.toggle('is-on', window.scrollY > 40);
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();

  /* ---------- 取证状态（?state=…），默认不启用 ---------- */

  function scrollToConversation() {
    var panel = document.querySelector('.panel');
    if (window.innerWidth <= 700 && panel) {
      var bottom = panel.getBoundingClientRect().bottom + window.scrollY;
      window.scrollTo(0, Math.max(0, bottom - window.innerHeight + 16));
      return;
    }
    var top = conversation.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top);
  }

  function enterScreenshotState(name) {
    if (name === 'typing') {
      input.value = STATE_INPUT;
      autoGrow();
      setState('typing');
      refreshSendButton();
    } else if (name === 'loading') {
      ensureSeparator();
      appendMessage('user', STATE_INPUT, { fresh: false });
      pendingText = STATE_INPUT;
      setState('loading');
      addTypingRow();
      sendButton.disabled = true;
      sendButton.textContent = '发送中…';
      sendButton.classList.add('is-loading');
    } else if (name === 'replied') {
      pendingText = '帮我写个开场';
      ensureSeparator();
      appendMessage('user', '帮我写个开场', { fresh: false });
      appendMessage('her', STATE_REPLIED_REPLY, { fresh: false });
      setState('replied');
    } else if (name === 'error') {
      pendingText = STATE_ERROR_INPUT;
      ensureSeparator();
      liveUserEl = appendMessage('user', STATE_ERROR_INPUT, { fresh: false });
      setState('error');
      addErrorRow();
      markFailed(liveUserEl);
      input.value = STATE_ERROR_INPUT;
      autoGrow();
      refreshSendButton();
    } else {
      setState('idle');
    }
    scrollToConversation();
  }

  var stateParam = params.get('state');
  if (stateParam) {
    enterScreenshotState(stateParam);
  } else {
    setState('idle');
  }
  refreshSendButton();
})();
