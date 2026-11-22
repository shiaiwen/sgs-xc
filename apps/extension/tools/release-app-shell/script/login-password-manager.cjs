/** 在游戏 webview 的 preload 启动登录助手。 */
function isSupportedLoginPage(location) {
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  if (location.protocol === 'https:' && host === 'web.sanguosha.com') return path.startsWith('/login/');
  if (location.protocol === 'https:' && host === 'preview-login.sanguosha.com') return true;
  if (location.protocol === 'https:' && host === 'my.4399.com') return path.startsWith('/yxsgs/wd-home');
  if ((location.protocol === 'https:' || location.protocol === 'http:') && host === 'web.kuaiwan.com') {
    return path.startsWith('/kwsgsn/');
  }
  return false;
}

function installLoginPasswordManager({ window, storage, focusWebview }) {
  if (!isSupportedLoginPage(window.location)) return;
  const document = window.document;

  function query(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function getAccessibleDocuments() {
    const documents = [];
    const visit = (currentDocument) => {
      if (!currentDocument || documents.includes(currentDocument)) return;
      documents.push(currentDocument);
      currentDocument.querySelectorAll('iframe').forEach((iframe) => {
        try {
          visit(iframe.contentDocument);
        } catch (error) {
          // The 4399 login frame becomes accessible after its document.domain setup runs.
        }
      });
    };
    visit(document);
    return documents;
  }

  function setNativeValue(input, value) {
    if (!input) return;
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    const InputEvent = input.ownerDocument.defaultView.Event;
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new InputEvent('change', { bubbles: true }));
  }

  let is4399Login = /(^|\.)4399\.com$/i.test(window.location.hostname);

  function getCredentialScope() {
    return is4399Login ? '4399' : 'official';
  }

  function getCredentialStoreKey() {
    return 'sgsol.rememberedCredentials.v2' + (is4399Login ? '.4399' : '');
  }

  function normalizeCredentials(list) {
    const merged = [];
    const add = (account, password, updatedAt, remark) => {
      account = String(account || '').trim();
      password = String(password || '');
      const note = String(remark || '').trim();
      if (!account || !password) return;
      const old = merged.find((item) => item.account === account);
      if (old) {
        old.password = password;
        old.updatedAt = Math.max(old.updatedAt || 0, updatedAt || 0);
        // 合并本地与共享两份时，别把已有的备注冲掉。
        if (note) old.remark = note;
      } else {
        merged.push({ account, password, updatedAt: updatedAt || 0, remark: note });
      }
    };

    if (Array.isArray(list)) {
      list.forEach((item) => add(item && item.account, item && item.password, item && item.updatedAt, item && item.remark));
    } else if (list && typeof list === 'object') {
      Object.keys(list).forEach((account) => add(account, list[account], 0));
    }
    return merged;
  }

  function readJsonStore(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(key + ' parse failed', error);
      return fallback;
    }
  }

  function getList() {
    const localList = normalizeCredentials(readJsonStore(getCredentialStoreKey(), []));
    const sharedList = typeof storage?.getCredentials === 'function'
      ? storage.getCredentials(getCredentialScope(), localList)
      : localList;
    return normalizeCredentials(sharedList)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function saveList(list) {
    const normalized = normalizeCredentials(list).slice(0, 30);
    const modernList = normalized.map((item) => ({
      account: item.account,
      password: item.password,
      updatedAt: item.updatedAt || Date.now(),
      remark: item.remark || ''
    }));
    window.localStorage.setItem(getCredentialStoreKey(), JSON.stringify(modernList));
    if (typeof storage?.saveCredentials === 'function') {
      storage.saveCredentials(getCredentialScope(), modernList);
    }
  }

  function maskPassword(password) {
    if (!password) return '未保存密码';
    return '••••••••';
  }

  function requestWebviewKeyboardFocus() {
    try {
      focusWebview?.();
    } catch (error) {}
  }

  function isCredentialPanelInput(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest('#sgsol-credential-panel .sgsol-remark-input, #sgsol-save-current, .sgsol-save-remark-input');
  }

  function bindRememberCheckbox() {
    const remember = query(['#SGS_login-remember', 'input[type="checkbox"][name*="remember"]']);
    if (!remember || remember.__sgsolBound) return;
    remember.__sgsolBound = true;
    remember.addEventListener('change', () => {
      if (remember.checked) window.localStorage.setItem('SGS_login-remember_checked', 'true');
      else window.localStorage.removeItem('SGS_login-remember_checked');
    });
    if (window.localStorage.getItem('SGS_login-remember_checked') === 'true') {
      if (!remember.checked) remember.click ? remember.click() : (remember.checked = true);
    } else {
      window.fetch('https://cas.dobest.cn/cas/logout?url=https%3A%2F%2Fweb.sanguosha.com%2Findex.html', {
        referrer: 'https://web.sanguosha.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'GET',
        mode: 'no-cors',
        credentials: 'include'
      }).catch(() => console.log('logout skipped'));
    }
  }

  function enableLogin(proto, loginButton) {
    if (proto) {
      if (!proto.checked) proto.click ? proto.click() : (proto.checked = true);
      if (proto.parentNode && proto.parentNode.classList) proto.parentNode.classList.add('on');
    }
    if (loginButton) {
      loginButton.removeAttribute('disabled');
      loginButton.classList.remove('SGS_loginbtn-disable');
    }
  }

  function findLoginParts(documents) {
    for (const loginDocument of documents) {
      if (!loginDocument.body) continue;
      const account = query(['#SGS_login-account', '#username', 'input[name="account"]', 'input[name="username"]'], loginDocument);
      const password = query(['#SGS_login-password', '#j-password', 'input[type="password"]'], loginDocument);
      if (!account || !password) continue;
      const is4399 = account.id === 'username' && password.id === 'j-password';
      if (is4399) is4399Login = true;
      const proto = query(['#SGS_userProto', 'input[type="checkbox"][name*="proto"]', 'input[type="checkbox"][id*="Proto"]'], loginDocument);
      const nativeRemember = query(['#SGS_login-remember', '#login_autoLogin', 'input[type="checkbox"][name*="remember"]'], loginDocument);
      const loginButton = query(['#SGS_login-btn', '#j-login-submit-btn', 'button[type="submit"]', 'input[type="submit"]', '.SGS_loginbtn', '.SGS_login-btn', '.ptlogin_btn'], loginDocument);
      const form = query(['#SGS_login-form', '#login_form'], loginDocument) || account.closest('form') || password.closest('form') || loginDocument.body;
      return { account, password, proto, nativeRemember, loginButton, form, loginDocument, is4399 };
    }
    return {};
  }

  function ensureStyle(loginDocument) {
    if (loginDocument.getElementById('sgsol-password-style')) return;
    const style = loginDocument.createElement('style');
    style.id = 'sgsol-password-style';
    style.textContent = [
      '#sgsol-credential-panel{position:fixed;z-index:2147483600;box-sizing:border-box;min-width:260px;max-height:248px;overflow:auto;background:rgba(20,16,13,.98);border:1px solid rgba(226,199,137,.72);box-shadow:0 10px 28px rgba(0,0,0,.45);font-family:Arial,"Microsoft YaHei",sans-serif;color:#e9dcc0}',
      '#sgsol-credential-panel.sgsol-hidden{display:none}',
      '.sgsol-credential-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(226,199,137,.22);font-size:13px;color:#cdbb93}',
      '.sgsol-credential-empty{padding:12px 10px;color:#9f9381;font-size:13px}',
      '.sgsol-credential-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05)}',
      '.sgsol-credential-row:hover,.sgsol-credential-row.sgsol-active{background:rgba(145,96,40,.36)}',
      '.sgsol-credential-row.sgsol-remark-editing{cursor:default}',
      '.sgsol-account-line{display:flex;align-items:baseline;gap:6px;min-width:0}',
      '.sgsol-account-remark{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;color:#f0c987;font-size:13px;line-height:20px}',
      '.sgsol-account-name{flex:1 1 auto;min-width:0;font-size:15px;line-height:20px;color:#f3ead5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sgsol-account-pass{font-size:12px;line-height:16px;color:#a99d89;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sgsol-row-actions{display:flex;align-items:center;gap:2px}',
      '.sgsol-remark{width:22px;height:22px;border:0;background:transparent;color:#b6aa96;font-size:15px;line-height:20px;cursor:pointer}',
      '.sgsol-remark:hover{color:#ffcf8a}',
      '.sgsol-remark-input{flex:1 1 auto;min-width:0;box-sizing:border-box;border:1px solid rgba(226,199,137,.6);border-radius:3px;background:#1b1712;color:#f3ead5;padding:1px 6px;font-size:14px;line-height:20px;outline:none}',
      '.sgsol-delete{width:22px;height:22px;border:0;background:transparent;color:#b6aa96;font-size:18px;line-height:20px;cursor:pointer}',
      '.sgsol-delete:hover{color:#ffcf8a}',
      '.sgsol-save-wrap{position:fixed;z-index:2147483599;display:inline-flex;align-items:center;flex-wrap:nowrap;gap:8px;margin-left:0;color:#cfc4b2;font-size:15px;line-height:22px;height:22px;vertical-align:middle;max-width:min(320px,calc(100vw - 16px))}',
      '.login_vertical .login_hor .sgsol-save-wrap.sgsol-save-wrap--4399{position:absolute;float:none;width:auto;margin-left:0;padding:0}',
      '.sgsol-save-line{display:inline-flex;align-items:center;gap:6px;height:22px;cursor:pointer;user-select:none;white-space:nowrap;flex:none}',
      '.login_vertical .login_hor .sgsol-save-wrap.sgsol-save-wrap--4399 .sgsol-save-line>span{float:none;width:auto;overflow:visible;line-height:20px}',
      '.sgsol-save-line input[type="checkbox"]{width:14px;height:14px;margin:0;accent-color:#c9984d;cursor:pointer}',
      '.sgsol-save-line:hover{color:#ead8b8}',
      '.sgsol-save-hint{margin-left:6px;color:#9f9381;font-size:12px}',
      '.sgsol-save-hint:empty{display:none}',
      '.sgsol-save-remark-input{display:inline-block;box-sizing:border-box;flex:none;width:132px;height:22px;margin:0;border:1px solid rgba(201,152,77,.5);border-radius:2px;background:rgba(32,22,15,.72);color:#ecdcb8;padding:0 6px;font-size:13px;line-height:20px;outline:none;cursor:text;transition:border-color .15s,background .15s}',
      '.sgsol-save-remark-input::placeholder{color:#8f8068}',
      '.sgsol-save-remark-input:hover{border-color:rgba(224,184,102,.75)}',
      '.sgsol-save-remark-input:focus{border-color:#e0b866;background:rgba(40,28,18,.88)}',
      '.sgsol-save-remark-input.sgsol-save-remark-input--floating{position:fixed;z-index:2147483599}'
    ].join('');
    (loginDocument.head || loginDocument.documentElement).appendChild(style);
  }

  function mountPasswordManager(parts) {
    const loginDocument = parts.loginDocument;
    const loginWindow = loginDocument.defaultView || window;
    const binding = new loginWindow.AbortController();
    function listen(target, type, callback, capture = false) {
      target.addEventListener(type, callback, { capture, signal: binding.signal });
    }

    const handleCredentialFocus = (event) => {
      const target = event.target;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') requestWebviewKeyboardFocus();
    };
    listen(loginDocument, 'focusin', handleCredentialFocus, true);
    listen(loginDocument, 'pointerdown', handleCredentialFocus, true);

    ensureStyle(loginDocument);
    function initializeNativeForm() {
      bindRememberCheckbox();
      enableLogin(parts.proto, parts.loginButton);
    }
    if (loginDocument.readyState === 'loading') listen(loginDocument, 'DOMContentLoaded', initializeNativeForm);
    else initializeNativeForm();
    parts.account.spellcheck = false;
    parts.account.setAttribute('autocomplete', 'off');
    parts.password.setAttribute('autocomplete', 'off');

    let userlist = normalizeCredentials(readJsonStore(getCredentialStoreKey(), []));
    let activeIndex = -1;
    let userWantsSave = false;
    let accountFilterKeyword = '';
    let panelAnchor = parts.account;

    const panel = loginDocument.createElement('div');
    panel.id = 'sgsol-credential-panel';
    panel.className = 'sgsol-hidden';
    loginDocument.body.appendChild(panel);

    const saveWrap = loginDocument.createElement('div');
    saveWrap.className = 'sgsol-save-wrap';
    const saveLine = loginDocument.createElement('label');
    saveLine.className = 'sgsol-save-line';
    saveLine.innerHTML = '<input id="sgsol-save-current" type="checkbox"><span>记住账号密码</span><span class="sgsol-save-hint"></span>';
    const saveCheckbox = saveLine.querySelector('input');
    const saveHint = saveLine.querySelector('.sgsol-save-hint');
    const saveRemarkInput = loginDocument.createElement('input');
    saveRemarkInput.className = 'sgsol-save-remark-input';
    saveRemarkInput.type = 'text';
    saveRemarkInput.maxLength = 24;
    saveRemarkInput.placeholder = '备注，选填';
    saveRemarkInput.setAttribute('autocomplete', 'off');
    saveRemarkInput.setAttribute('spellcheck', 'false');
    saveWrap.appendChild(saveLine);
    // 官方「自动登录」勾选框存在时，备注框单独摆在它左边；否则跟在勾选框后面。
    const remarkFloating = !parts.is4399 && !!parts.nativeRemember;
    if (remarkFloating) {
      saveRemarkInput.classList.add('sgsol-save-remark-input--floating');
      loginDocument.body.appendChild(saveRemarkInput);
    } else {
      saveWrap.appendChild(saveRemarkInput);
    }

    const rememberAnchor = parts.nativeRemember && (parts.nativeRemember.closest('label') || parts.nativeRemember.parentElement || parts.nativeRemember);
    if (parts.is4399 && parts.loginButton && parts.loginButton.parentElement) {
      saveWrap.classList.add('sgsol-save-wrap--4399');
      parts.loginButton.parentElement.insertBefore(saveWrap, parts.loginButton.nextSibling);
    } else {
      loginDocument.body.appendChild(saveWrap);
    }

    function setSaveExpanded(expanded) {
      saveWrap.classList.toggle('sgsol-save-expanded', !!expanded);
    }

    function readSaveRemarkDraft() {
      return String(saveRemarkInput.value || '').trim().slice(0, 24);
    }

    function setSaveHint(text) {
      saveHint.textContent = text || '';
      if (text) window.setTimeout(() => { if (saveHint.textContent === text) saveHint.textContent = ''; }, 1800);
    }

    function refreshRememberState() {
      const account = parts.account.value;
      const found = userlist.find((item) => item.account === account && item.password === parts.password.value);
      if (found) {
        saveCheckbox.checked = true;
        userWantsSave = false;
        saveRemarkInput.value = found.remark || '';
        setSaveExpanded(true);
      } else if (!userWantsSave) {
        saveCheckbox.checked = false;
        saveRemarkInput.value = '';
        setSaveExpanded(false);
      } else {
        setSaveExpanded(true);
      }
    }

    function saveCredential() {
      const account = parts.account.value.trim();
      const password = parts.password.value;
      if (!account || !password) return false;
      const remark = readSaveRemarkDraft();
      userlist = getList();
      const item = { account, password, updatedAt: Date.now(), remark };
      const existing = userlist.findIndex((entry) => entry.account === account);
      if (existing >= 0) userlist[existing] = { ...item, remark };
      else userlist.unshift(item);
      saveList(userlist);
      renderPanel();
      saveCheckbox.checked = true;
      setSaveExpanded(true);
      setSaveHint('已保存');
      return true;
    }

    /** 写备注：空字符串表示清除。 */
    function setRemark(index, remark) {
      const item = userlist[index];
      if (!item) return;
      const note = String(remark || '').trim().slice(0, 24);
      if ((item.remark || '') === note) {
        renderPanel();
        return;
      }
      item.remark = note;
      saveList(userlist);
      renderPanel();
    }

    function removeCredential(index) {
      const item = userlist[index];
      userlist.splice(index, 1);
      saveList(userlist);
      if (item && item.account === parts.account.value) {
        saveCheckbox.checked = false;
        userWantsSave = false;
      }
      renderPanel();
    }

    function fill(item) {
      if (!item) return;
      setNativeValue(parts.account, item.account || '');
      setNativeValue(parts.password, item.password || '');
      saveCheckbox.checked = true;
      userWantsSave = false;
      saveRemarkInput.value = item.remark || '';
      setSaveExpanded(true);
      enableLogin(parts.proto, parts.loginButton);
      hidePanel();
    }

    function getFilteredList() {
      const keyword = accountFilterKeyword;
      if (!keyword) return userlist;
      // 备注一起参与筛选，方便按备注找人。
      return userlist.filter((item) => String(item.account || '').toLowerCase().includes(keyword)
        || String(item.remark || '').toLowerCase().includes(keyword));
    }

    /** 备注行内编辑：回车保存，Esc 取消，失焦保存。 */
    let remarkEditing = false;
    function startRemarkEdit(row, index) {
      if (remarkEditing) return;
      const item = userlist[index];
      const remarkNode = row.querySelector('.sgsol-account-remark');
      if (!item || !remarkNode) return;
      remarkEditing = true;
      row.classList.add('sgsol-remark-editing');
      const input = loginDocument.createElement('input');
      input.className = 'sgsol-remark-input';
      input.type = 'text';
      input.maxLength = 24;
      input.placeholder = '备注，留空即清除';
      input.value = item.remark || '';
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      remarkNode.hidden = false;
      remarkNode.textContent = '';
      remarkNode.appendChild(input);
      const focusInput = () => {
        input.focus({ preventScroll: true });
        input.select();
        requestWebviewKeyboardFocus();
      };
      loginWindow.requestAnimationFrame(() => loginWindow.setTimeout(focusInput, 0));
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        remarkEditing = false;
        row.classList.remove('sgsol-remark-editing');
        const value = input.value;
        try { input.remove(); } catch (error) {}
        if (save) setRemark(index, value);
        else renderPanel();
      };
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('mousedown', (event) => event.stopPropagation());
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('focus', () => requestWebviewKeyboardFocus());
    }

    let positionFrame = 0;
    function schedulePosition() {
      if (positionFrame) return;
      positionFrame = loginWindow.requestAnimationFrame(() => {
        positionFrame = 0;
        positionPanel();
      });
    }

    function positionPanel() {
      const rect = panelAnchor.getBoundingClientRect();
      panel.style.left = Math.round(rect.left) + 'px';
      panel.style.top = Math.round(rect.bottom + 4) + 'px';
      panel.style.width = Math.round(rect.width) + 'px';
      positionSaveLine();
    }

    const REMARK_INPUT_MIN_WIDTH = 72;
    const REMARK_INPUT_HEIGHT = 22;
    // 备注框左边比密码框左边再往左多出密码框宽度的这个比例，正好和「密码」两个字的左边对齐。
    const REMARK_LEFT_SHIFT_RATIO = 0.45;
    // 备注框右边离官方勾选框的距离。
    const REMARK_RIGHT_GAP = 14;

    /** 备注框摆在官方勾选框左边：左边对齐「密码」字样，右边留出间距。 */
    function positionRemarkInput(nativeRect, anchorRect) {
      const passRect = parts.password.getBoundingClientRect();
      const left = Math.max(8, passRect.left - passRect.width * REMARK_LEFT_SHIFT_RATIO);
      const right = nativeRect.left - REMARK_RIGHT_GAP;
      const width = Math.max(REMARK_INPUT_MIN_WIDTH, Math.floor(right - left));
      const lineRect = nativeRect.height > 0 ? nativeRect : anchorRect;
      const top = lineRect.top + (lineRect.height - REMARK_INPUT_HEIGHT) / 2;
      saveRemarkInput.style.left = Math.round(left) + 'px';
      saveRemarkInput.style.top = Math.round(top) + 'px';
      saveRemarkInput.style.width = width + 'px';
    }

    function positionSaveLine() {
      const lineHeight = saveWrap.offsetHeight || 22;
      const gap = 18;
      let left;
      let top;

      if (parts.is4399 && parts.loginButton) {
        const buttonRect = parts.loginButton.getBoundingClientRect();
        const offsetParent = saveWrap.offsetParent || parts.loginButton.parentElement;
        const parentRect = offsetParent.getBoundingClientRect();
        left = buttonRect.right - parentRect.left + 10;
        top = buttonRect.top - parentRect.top + Math.max(0, (buttonRect.height - lineHeight) / 2);
        saveWrap.style.left = Math.round(left) + 'px';
        saveWrap.style.top = Math.round(top) + 'px';
        return;
      } else if (parts.nativeRemember) {
        const nativeRect = parts.nativeRemember.getBoundingClientRect();
        const anchorRect = rememberAnchor ? rememberAnchor.getBoundingClientRect() : nativeRect;
        const accountRect = parts.account.getBoundingClientRect();
        const anchorLooksTooWide = anchorRect.width > Math.max(220, accountRect.width * 0.7);
        const anchorRight = anchorLooksTooWide ? nativeRect.right + 96 : anchorRect.right;
        left = anchorRight + gap;
        // 以原生勾选框的中线为准，和同一行的文字对齐。
        const lineRect = nativeRect.height > 0 ? nativeRect : anchorRect;
        top = lineRect.top + (lineRect.height - lineHeight) / 2;
        if (remarkFloating) positionRemarkInput(nativeRect, anchorRect);
      } else {
        const passRect = parts.password.getBoundingClientRect();
        left = passRect.left;
        top = passRect.bottom + 10;
      }

      const lineWidth = saveWrap.offsetWidth || 120;
      left = Math.max(8, Math.min(left, loginWindow.innerWidth - lineWidth - 8));
      top = Math.max(8, Math.min(top, loginWindow.innerHeight - lineHeight - 8));
      saveWrap.style.left = Math.round(left) + 'px';
      saveWrap.style.top = Math.round(top) + 'px';
    }

    function renderPanel() {
      if (remarkEditing) return;
      const list = getFilteredList();
      panel.innerHTML = '';
      const header = loginDocument.createElement('div');
      header.className = 'sgsol-credential-header';
      header.innerHTML = '<span>已保存账号</span><span>' + list.length + '</span>';
      panel.appendChild(header);
      if (!list.length) {
        const empty = loginDocument.createElement('div');
        empty.className = 'sgsol-credential-empty';
        empty.textContent = '暂无匹配账号';
        panel.appendChild(empty);
        return;
      }
      list.forEach((item, filteredIndex) => {
        const realIndex = userlist.indexOf(item);
        const row = loginDocument.createElement('div');
        row.className = 'sgsol-credential-row' + (filteredIndex === activeIndex ? ' sgsol-active' : '');
        row.dataset.index = String(realIndex);
        row.innerHTML = '<div><div class="sgsol-account-line"><span class="sgsol-account-remark"></span><span class="sgsol-account-name"></span></div><div class="sgsol-account-pass"></div></div>'
          + '<div class="sgsol-row-actions"><button class="sgsol-remark" title="备注" type="button">✎</button><button class="sgsol-delete" title="删除" type="button">×</button></div>';
        const remarkNode = row.querySelector('.sgsol-account-remark');
        const remark = String(item.remark || '');
        remarkNode.textContent = remark;
        remarkNode.hidden = !remark;
        row.querySelector('.sgsol-account-name').textContent = item.account || '';
        row.querySelector('.sgsol-account-pass').textContent = maskPassword(item.password);
        panel.appendChild(row);
      });
    }

    function showPanel(filterByInput = false, anchor = parts.account) {
      if (remarkEditing) return;
      userlist = getList();
      panelAnchor = anchor;
      accountFilterKeyword = filterByInput ? parts.account.value.trim().toLowerCase() : '';
      activeIndex = -1;
      positionPanel();
      renderPanel();
      panel.classList.remove('sgsol-hidden');
    }

    function hidePanel() {
      const editingInput = panel.querySelector('.sgsol-remark-input');
      if (editingInput && typeof editingInput.blur === 'function') editingInput.blur();
      panel.classList.add('sgsol-hidden');
      activeIndex = -1;
    }

    function selectActive() {
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (activeIndex < 0 || activeIndex >= rows.length) return false;
      fill(userlist[Number(rows[activeIndex].dataset.index)]);
      return true;
    }

    function setActiveIndex(nextIndex) {
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (!rows.length) return;
      if (activeIndex >= 0 && rows[activeIndex]) rows[activeIndex].classList.remove('sgsol-active');
      activeIndex = Math.max(0, Math.min(rows.length - 1, nextIndex));
      if (rows[activeIndex]) rows[activeIndex].classList.add('sgsol-active');
    }

    function handlePanelKeydown(event) {
      if (remarkEditing || isCredentialPanelInput(loginDocument.activeElement)) return false;
      const rows = Array.from(panel.querySelectorAll('.sgsol-credential-row'));
      if (panel.classList.contains('sgsol-hidden') || !rows.length) return false;
      if (event.key === 'ArrowDown') {
        setActiveIndex(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        setActiveIndex(activeIndex - 1);
      } else if (event.key === 'Enter' && selectActive()) {
        // selectActive handles the chosen credential.
      } else if (event.key === 'Escape') {
        hidePanel();
      } else {
        return false;
      }
      event.preventDefault();
      return true;
    }

    listen(panel, 'mousedown', (event) => {
      if (event.target.closest('.sgsol-remark-input, .sgsol-row-actions, .sgsol-remark, .sgsol-delete, input, textarea')) return;
      event.preventDefault();
    });
    listen(panel, 'click', (event) => {
      if (remarkEditing && !event.target.closest('.sgsol-remark, .sgsol-delete, .sgsol-remark-input')) {
        event.stopPropagation();
        return;
      }
      const deleteButton = event.target.closest('.sgsol-delete');
      const remarkButton = event.target.closest('.sgsol-remark');
      const row = event.target.closest('.sgsol-credential-row');
      if (!row) return;
      const index = Number(row.dataset.index);
      if (deleteButton) {
        removeCredential(index);
        event.stopPropagation();
        return;
      }
      if (remarkButton) {
        startRemarkEdit(row, index);
        event.stopPropagation();
        return;
      }
      fill(userlist[index]);
    });

    listen(parts.account, 'focus', () => showPanel(false, parts.account));
    listen(parts.account, 'click', () => showPanel(false, parts.account));
    listen(parts.account, 'input', () => {
      refreshRememberState();
      if (!remarkEditing) showPanel(true, parts.account);
    });
    listen(parts.account, 'keydown', handlePanelKeydown);

    listen(parts.password, 'focus', () => showPanel(false, parts.password));
    listen(parts.password, 'click', () => showPanel(false, parts.password));
    listen(parts.password, 'input', refreshRememberState);
    listen(parts.password, 'keydown', (event) => {
      if (handlePanelKeydown(event)) return;
      if (event.key === 'Enter' && saveCheckbox.checked) saveCredential();
    });

    listen(saveCheckbox, 'change', () => {
      userWantsSave = saveCheckbox.checked;
      setSaveExpanded(saveCheckbox.checked);
      if (!saveCheckbox.checked) saveRemarkInput.value = '';
      if (saveCheckbox.checked) setSaveHint('登录时保存，可填备注');
    });

    // 第一次登录时直接填备注：写了内容就自动勾上「记住账号密码」，登录时一起存下。
    listen(saveRemarkInput, 'input', () => {
      if (!saveRemarkInput.value || saveCheckbox.checked) return;
      saveCheckbox.checked = true;
      userWantsSave = true;
      setSaveExpanded(true);
    });
    listen(saveRemarkInput, 'mousedown', (event) => event.stopPropagation());
    listen(saveRemarkInput, 'click', (event) => event.stopPropagation());
    listen(saveRemarkInput, 'keydown', (event) => event.stopPropagation());

    if (parts.loginButton) {
      listen(parts.loginButton, 'click', () => {
        if (saveCheckbox.checked) saveCredential();
      }, true);
    }

    listen(loginDocument, 'mousedown', (event) => {
      if (event.target === parts.account || event.target === parts.password || panel.contains(event.target)) return;
      if (saveWrap.contains(event.target)) return;
      hidePanel();
    });
    listen(loginWindow, 'resize', schedulePosition);
    listen(loginWindow, 'scroll', schedulePosition, true);
    listen(loginDocument, 'DOMContentLoaded', schedulePosition);
    listen(loginWindow, 'load', schedulePosition);
    const layoutObserver = typeof loginWindow.ResizeObserver === 'function'
      ? new loginWindow.ResizeObserver(schedulePosition)
      : null;
    for (const anchor of [parts.account, parts.password, parts.loginButton, parts.nativeRemember]) {
      if (anchor) layoutObserver?.observe(anchor);
    }

    refreshRememberState();
    positionPanel();
    // 先让控件上屏，之后再从主进程读取跨窗口的已保存账号。
    const readTimer = loginWindow.setTimeout(() => {
      if (binding.signal.aborted || userWantsSave || remarkEditing) return;
      userlist = getList();
      refreshRememberState();
    }, 150);

    return {
      parts,
      controlsConnected: () => panel.isConnected && saveWrap.isConnected && saveRemarkInput.isConnected,
      dispose() {
        loginWindow.clearTimeout(readTimer);
        if (positionFrame) loginWindow.cancelAnimationFrame(positionFrame);
        layoutObserver?.disconnect();
        binding.abort();
        panel.remove();
        saveWrap.remove();
        saveRemarkInput.remove();
      }
    };
  }

  let mounted = null;
  let watchedDocuments = [];
  let disposed = false;
  const observer = new window.MutationObserver(refresh);

  function refresh() {
    if (disposed) return;
    const documents = getAccessibleDocuments();
    if (watchedDocuments.length !== documents.length || documents.some((doc, index) => doc !== watchedDocuments[index])) {
      observer.disconnect();
      watchedDocuments = documents;
      for (const doc of documents) observer.observe(doc, { childList: true, subtree: true });
    }

    const parts = findLoginParts(documents);
    const current = mounted?.parts;
    if (current && current.account === parts.account && current.password === parts.password
      && current.form === parts.form && current.loginButton === parts.loginButton
      && current.nativeRemember === parts.nativeRemember && mounted.controlsConnected()) return;

    mounted?.dispose();
    mounted = null;
    if (parts.account && parts.password && parts.form) {
      mounted = mountPasswordManager(parts);
    }
  }

  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  document.addEventListener('load', refresh, true);
  // 4399 iframe 可能在 load 之后才设置 document.domain，轮询负责补上这一段。
  const retryTimer = window.setInterval(refresh, 250);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearInterval(retryTimer);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('DOMContentLoaded', refresh);
    document.removeEventListener('load', refresh, true);
    observer.disconnect();
    watchedDocuments = [];
    mounted?.dispose();
    mounted = null;
  };
  function onPageHide(event) {
    if (!event.persisted) dispose();
  }
  window.addEventListener('pagehide', onPageHide);
  refresh();
  return dispose;
}

module.exports = { installLoginPasswordManager, isSupportedLoginPage };
