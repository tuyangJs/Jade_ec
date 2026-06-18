/**
 * 统一模态框模块
 * 提供通用提示、确认、密码输入、更新提示等模态框功能
 */

// 单例状态
let currentOverlay = null;
let currentDialog = null;
let closeFn = null;
let dismissable = true; // 是否允许通过遮罩层/关闭按钮关闭

function getElements() {
  return {
    overlay: document.getElementById('modalOverlay'),
    dialog: document.getElementById('modalDialog'),
    closeBtn: document.getElementById('modalCloseBtn'),
    iconWrap: document.getElementById('modalIconWrap'),
    title: document.getElementById('modalTitle'),
    body: document.getElementById('modalBody'),
    actions: document.getElementById('modalActions'),
  };
}

function open() {
  const { overlay, dialog } = getElements();
  overlay.classList.add('active');
  dialog.classList.add('active');
  currentOverlay = overlay;
  currentDialog = dialog;
}

function close() {
  if (currentOverlay) currentOverlay.classList.remove('active');
  if (currentDialog) currentDialog.classList.remove('active');
  currentOverlay = null;
  currentDialog = null;
  if (closeFn) { closeFn(); closeFn = null; }
}

function setCloseFn(fn) {
  closeFn = fn;
}

function renderActions(buttons) {
  const { actions } = getElements();
  actions.innerHTML = '';
  buttons.forEach(btn => {
    const el = document.createElement(btn.href ? 'a' : 'button');
    el.className = 'modal-btn ' + (btn.primary ? 'modal-btn--primary' : 'modal-btn--secondary');
    el.textContent = btn.text;
    if (btn.href) {
      el.href = btn.href;
      el.target = '_blank';
      el.rel = 'noopener';
    }
    el.addEventListener('click', btn.onClick);
    actions.appendChild(el);
  });
}

// 图标 SVG 模板
const ICONS = {
  info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  success: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" stroke="#34C759" stroke-width="1.5"/><path d="M8 12l2.5 2.5L16 9" stroke="#34C759" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" stroke="#FF3B30" stroke-width="1.5"/><path d="M9 9l6 6M15 9l-6 6" stroke="#FF3B30" stroke-width="1.5" stroke-linecap="round"/></svg>',
  warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L1 21h22L12 2z" stroke="#FF9500" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke="#FF9500" stroke-width="1.5" stroke-linecap="round"/></svg>',
  update: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 12a9 9 0 1 1-3.3-6.9" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round"/><path d="M21 3v5h-5" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="var(--color-primary)" stroke-width="1.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

/**
 * 通用提示模态框
 */
export function alert(title, message, type = 'info') {
  const { iconWrap, title: titleEl, body, closeBtn } = getElements();

  iconWrap.innerHTML = ICONS[type] || ICONS.info;
  titleEl.textContent = title || '提示';
  body.innerHTML = '<p class="modal-message"></p>';
  body.querySelector('.modal-message').textContent = message || '';
  closeBtn.style.display = '';
  dismissable = true;

  renderActions([
    { text: '确定', primary: true, onClick: close },
  ]);

  setCloseFn(null);
  open();
}

/**
 * 确认模态框
 */
export function confirm(title, message, onConfirm, onDismiss, opts = {}) {
  const { iconWrap, title: titleEl, body, closeBtn } = getElements();

  iconWrap.innerHTML = ICONS[opts.type || 'info'] || ICONS.info;
  titleEl.textContent = title || '确认';
  body.innerHTML = '<p class="modal-message"></p>';
  body.querySelector('.modal-message').textContent = message || '';
  closeBtn.style.display = opts.dismissable === false ? 'none' : '';
  dismissable = opts.dismissable !== false;

  renderActions([
    { text: opts.dismissText || '取消', primary: false, onClick: () => { close(); if (onDismiss) onDismiss(); } },
    { text: opts.confirmText || '确认', primary: true, onClick: () => { close(); if (onConfirm) onConfirm(); } },
  ]);

  setCloseFn(null);
  open();
}

/**
 * 密码输入模态框
 * @returns {Promise<{password: string, remember: boolean}|null>}
 */
export function password(message, isWrongPassword) {
  return new Promise(resolve => {
    const { iconWrap, title: titleEl, body, closeBtn } = getElements();

    iconWrap.innerHTML = ICONS.lock;
    titleEl.textContent = '模块需要密码';
    closeBtn.style.display = 'none';
    dismissable = false; // 密码框不允许通过遮罩层关闭，必须走 doClose 来 resolve Promise

    body.innerHTML =
      '<div class="password-message-box">' +
        '<span class="password-message-label">文件提示</span>' +
        '<p class="modal-message" id="modalPasswordMsg"></p>' +
      '</div>' +
      '<label class="password-field-label" for="modalPasswordInput">密码</label>' +
      '<div class="password-input-wrap">' +
        '<input type="password" class="password-input" id="modalPasswordInput" placeholder="请输入密码" autocomplete="off">' +
        '<button class="password-toggle" id="modalPasswordToggle" title="显示密码">' +
          '<svg class="password-eye-open" width="16" height="16" viewBox="0 0 24 24" fill="none">' +
            '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" stroke-width="1.5"/>' +
            '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>' +
          '</svg>' +
          '<svg class="password-eye-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" style="display:none">' +
            '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
            '<line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<p class="password-error" id="modalPasswordError" style="display:none"></p>' +
      '<label class="password-remember">' +
        '<input type="checkbox" id="modalPasswordRemember">' +
        '<span class="checkbox-mark"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '<span>记住密码</span>' +
      '</label>';

    const msgEl = document.getElementById('modalPasswordMsg');
    const input = document.getElementById('modalPasswordInput');
    const errorEl = document.getElementById('modalPasswordError');
    const toggleBtn = document.getElementById('modalPasswordToggle');
    const rememberCb = document.getElementById('modalPasswordRemember');
    const eyeOpen = toggleBtn.querySelector('.password-eye-open');
    const eyeClosed = toggleBtn.querySelector('.password-eye-closed');

    if (message && msgEl) msgEl.textContent = message;
    input.value = '';
    input.type = 'password';
    if (isWrongPassword) {
      errorEl.textContent = '密码错误，请重新输入。';
      errorEl.style.display = '';
    } else {
      errorEl.style.display = 'none';
    }
    rememberCb.checked = false;
    eyeOpen.style.display = '';
    eyeClosed.style.display = 'none';

    function doClose(result) {
      close();
      input.removeEventListener('keydown', onKeydown);
      toggleBtn.removeEventListener('click', onToggle);
      resolve(result);
    }

    function showError(msg) {
      errorEl.textContent = msg || '密码错误，请重新输入。';
      errorEl.style.display = '';
      input.select();
      input.focus();
    }

    function onConfirm() {
      const val = input.value;
      if (!val) { showError('请输入密码。'); return; }
      doClose({ password: val, remember: rememberCb.checked });
    }

    function onCancel() { doClose(null); }

    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }

    function onToggle() {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      eyeOpen.style.display = isPassword ? 'none' : '';
      eyeClosed.style.display = isPassword ? '' : 'none';
    }

    toggleBtn.addEventListener('click', onToggle);
    input.addEventListener('keydown', onKeydown);

    renderActions([
      { text: '取消', primary: false, onClick: onCancel },
      { text: '确认', primary: true, onClick: onConfirm },
    ]);

    setCloseFn(() => {
      input.removeEventListener('keydown', onKeydown);
      toggleBtn.removeEventListener('click', onToggle);
    });

    open();
    setTimeout(() => input.focus(), 100);
  });
}

/**
 * 更新提示模态框
 */
export function update(info) {
  const { iconWrap, title: titleEl, body, closeBtn } = getElements();

  iconWrap.innerHTML = ICONS.update;
  titleEl.textContent = '发现新版本';
  closeBtn.style.display = '';
  dismissable = true;

  body.innerHTML =
    '<p class="update-version"></p>' +
    '<div class="update-changelog"></div>';

  body.querySelector('.update-version').textContent = 'v' + info.version;
  body.querySelector('.update-changelog').innerHTML = info.changelog;

  renderActions([
    { text: '跳过此版本', primary: false, onClick: () => { if (typeof UpdateChecker !== 'undefined') UpdateChecker.skip(); close(); } },
    { text: '前往下载', primary: true, href: info.htmlUrl || '#', onClick: close },
  ]);

  setCloseFn(null);
  open();
}

// 点击遮罩层关闭（仅 dismissable 时）
document.addEventListener('click', function (e) {
  if (e.target.id === 'modalOverlay' && dismissable) close();
});

// 关闭按钮
document.addEventListener('click', function (e) {
  if (e.target.closest('#modalCloseBtn') && dismissable) close();
});

// 暴露到全局供非模块脚本使用
window.Modal = { alert, confirm, password, update };
