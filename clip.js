/* =========================================================
 * Cr专属工具箱 · 用户中心脚本 (clip.js)
 * 功能：
 *   1. 访问上报（每次打开页面自动记录 IP/时间/来源/页面）
 *   2. 右上角用户栏：游客模式 / 注册 / 登录 / 退出
 *   3. 登录后备忘录：保存/读取自己的备忘录
 * 后端地址自动从 api_config.json 读取（由本地后端动态推送）
 * 后端不在线时全部静默降级，不影响网页正常使用
 * ========================================================= */
(function () {
  var CFG_URL = 'https://CaesarPC.github.io/website-finder/api_config.json';
  var apiUrl = localStorage.getItem('cr_api_url') || '';
  var TOKEN_KEY = 'cr_token';
  var USER_KEY = 'cr_username';

  /* ---------- 基础 ---------- */
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getUsername() { return localStorage.getItem(USER_KEY) || ''; }

  function post(path, data, cb) {
    if (!apiUrl) return cb && cb({ ok: false, msg: '后端未连接' });
    fetch(apiUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); })
      .then(function (j) { cb && cb(j); })
      .catch(function () { cb && cb({ ok: false, msg: '网络错误' }); });
  }

  function get(path, cb) {
    if (!apiUrl) return cb && cb({ ok: false, msg: '后端未连接' });
    fetch(apiUrl + path)
      .then(function (r) { return r.json(); })
      .then(function (j) { cb && cb(j); })
      .catch(function () { cb && cb({ ok: false, msg: '网络错误' }); });
  }

  /* ---------- 读取后端地址 ---------- */
  function loadApiConfig() {
    fetch(CFG_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg && cfg.api_url && cfg.online) {
          apiUrl = cfg.api_url;
          localStorage.setItem('cr_api_url', apiUrl);
        }
        doReport();
      })
      .catch(function () { doReport(); }); // 后端配置读不到就静默
  }

  /* ---------- 访问上报 ---------- */
  function doReport() {
    var page = (location.pathname || '/').split('/').pop() || 'index.html';
    if (!apiUrl) return;
    var data = { page: page };
    var fd = new FormData();
    // 用 fetch 上报（静默失败）
    try {
      fetch(apiUrl + '/api/report?page=' + encodeURIComponent(page), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- 界面 ---------- */
  var CSS = '.cr-ubar{position:fixed;top:10px;right:10px;z-index:99999;font-family:Segoe UI,Arial,sans-serif;}' +
    '.cr-ubar .cr-btn{background:#1e1e2e;color:#e6e6e6;border:1px solid #44475a;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:13px;margin-left:6px;}' +
    '.cr-ubar .cr-btn:hover{border-color:#50fa7b;color:#50fa7b;}' +
    '.cr-ubar .cr-name{color:#50fa7b;font-size:13px;font-weight:bold;}' +
    '.cr-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:none;align-items:center;justify-content:center;}' +
    '.cr-modal.on{display:flex;}' +
    '.cr-box{background:#1e1e2e;color:#e6e6e6;border:1px solid #44475a;border-radius:12px;padding:22px;width:320px;max-width:90vw;}' +
    '.cr-box h3{margin:0 0 14px;color:#50fa7b;font-size:17px;}' +
    '.cr-box input{width:100%;box-sizing:border-box;margin:6px 0;padding:8px 10px;border-radius:6px;border:1px solid #44475a;background:#282a36;color:#e6e6e6;font-size:14px;}' +
    '.cr-box textarea{width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border-radius:6px;border:1px solid #44475a;background:#282a36;color:#e6e6e6;font-size:14px;min-height:140px;resize:vertical;}' +
    '.cr-box .cr-row{display:flex;justify-content:space-between;margin-top:12px;}' +
    '.cr-box .cr-ok{background:#50fa7b;color:#1e1e2e;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-weight:bold;}' +
    '.cr-box .cr-cancel{background:#44475a;color:#e6e6e6;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;}' +
    '.cr-msg{font-size:12px;color:#ff5555;margin-top:6px;min-height:16px;}' +
    '.cr-note{font-size:12px;color:#6272a4;margin-top:6px;}' +
    '.cr-fb{position:fixed;bottom:18px;right:18px;z-index:99998;background:#1e1e2e;color:#50fa7b;border:1px solid #50fa7b;border-radius:50px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:bold;box-shadow:0 2px 10px rgba(0,0,0,.4);}' +
    '.cr-fb:hover{background:#50fa7b;color:#1e1e2e;}';

  var root = document.createElement('div');
  root.className = 'cr-ubar';
  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<span class="cr-name" id="cr-name"></span>' +
    '<button class="cr-btn" id="cr-login">登录 / 注册</button>' +
    '<button class="cr-btn" id="cr-note" style="display:none">📝 备忘录</button>' +
    '<button class="cr-btn" id="cr-logout" style="display:none">退出</button>' +
    '<div class="cr-modal" id="cr-modal"><div class="cr-box" id="cr-box"></div></div>' +
    '<button class="cr-fb" id="cr-feedback">📮 意见反馈</button>';

  (document.body || document.documentElement).appendChild(root);
  var nameEl = document.getElementById('cr-name');
  var loginBtn = document.getElementById('cr-login');
  var noteBtn = document.getElementById('cr-note');
  var logoutBtn = document.getElementById('cr-logout');
  var modal = document.getElementById('cr-modal');
  var box = document.getElementById('cr-box');

  function refresh() {
    var u = getUsername();
    if (u) {
      nameEl.textContent = u;
      loginBtn.style.display = 'none';
      noteBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'inline-block';
    } else {
      nameEl.textContent = '游客模式';
      loginBtn.style.display = 'inline-block';
      noteBtn.style.display = 'none';
      logoutBtn.style.display = 'none';
    }
  }

  function showBox(html) { box.innerHTML = html; modal.classList.add('on'); }
  function hideBox() { modal.classList.remove('on'); }
  function err(el, msg) { var m = document.getElementById(el); if (m) m.textContent = msg; }

  /* 登录页 */
  loginBtn.onclick = function () {
    showBox(
      '<h3>🔑 登录</h3>' +
      '<input id="l-user" placeholder="用户名" autocomplete="off">' +
      '<input id="l-pass" type="password" placeholder="密码">' +
      '<div class="cr-msg" id="l-msg"></div>' +
      '<div class="cr-row">' +
      '<button class="cr-ok" id="l-go">登录</button>' +
      '<button class="cr-cancel" id="l-reg">没有账号？注册</button>' +
      '<button class="cr-cancel" id="l-close">关闭</button>' +
      '</div>' +
      '<div class="cr-note">密码经过单向哈希存储，不存明文。</div>'
    );
    document.getElementById('l-go').onclick = function () {
      post('/api/login', { username: document.getElementById('l-user').value.trim(), password: document.getElementById('l-pass').value },
        function (j) {
          if (j.ok) {
            localStorage.setItem(TOKEN_KEY, j.token);
            localStorage.setItem(USER_KEY, j.username);
            hideBox(); refresh();
          } else err('l-msg', j.msg || '登录失败');
        });
    };
    document.getElementById('l-reg').onclick = function () { showReg(); };
    document.getElementById('l-close').onclick = hideBox;
  };

  /* 注册页 */
  function showReg() {
    showBox(
      '<h3>📝 注册新账号</h3>' +
      '<input id="r-user" placeholder="用户名（2-20字符）" autocomplete="off">' +
      '<input id="r-pass" type="password" placeholder="密码（至少4位）">' +
      '<input id="r-pass2" type="password" placeholder="再输一次密码">' +
      '<div class="cr-msg" id="r-msg"></div>' +
      '<div class="cr-row">' +
      '<button class="cr-ok" id="r-go">注册</button>' +
      '<button class="cr-cancel" id="r-back">返回登录</button>' +
      '<button class="cr-cancel" id="r-close">关闭</button>' +
      '</div>' +
      '<div class="cr-note">密码会加盐哈希后存储，任何人（包括站长）都无法看到原文。</div>'
    );
    document.getElementById('r-go').onclick = function () {
      var u = document.getElementById('r-user').value.trim();
      var p1 = document.getElementById('r-pass').value;
      var p2 = document.getElementById('r-pass2').value;
      if (p1 !== p2) return err('r-msg', '两次密码不一致');
      if (!u || p1.length < 4) return err('r-msg', '用户名或密码不符合要求');
      post('/api/register', { username: u, password: p1 }, function (j) {
        if (j.ok) {
          localStorage.setItem(TOKEN_KEY, j.token);
          localStorage.setItem(USER_KEY, j.username);
          hideBox(); refresh();
        } else err('r-msg', j.msg || '注册失败');
      });
    };
    document.getElementById('r-back').onclick = function () { loginBtn.onclick(); };
    document.getElementById('r-close').onclick = hideBox;
  }

  /* 备忘录 */
  noteBtn.onclick = function () {
    var u = getUsername();
    if (!u) return;
    showBox(
      '<h3>📝 ' + u + ' 的备忘录</h3>' +
      '<textarea id="n-text" placeholder="记点什么...（最多5000字）"></textarea>' +
      '<div class="cr-msg" id="n-msg"></div>' +
      '<div class="cr-row">' +
      '<button class="cr-ok" id="n-save">💾 保存</button>' +
      '<button class="cr-cancel" id="n-close">关闭</button>' +
      '</div>'
    );
    get('/api/note?token=' + encodeURIComponent(getToken()), function (j) {
      if (j.ok) document.getElementById('n-text').value = j.note || '';
    });
    document.getElementById('n-save').onclick = function () {
      post('/api/note', { token: getToken(), note: document.getElementById('n-text').value }, function (j) {
        if (j.ok) { err('n-msg', ''); alert('✅ 已保存'); }
        else err('n-msg', j.msg || '保存失败（可能已掉线）');
      });
    };
    document.getElementById('n-close').onclick = hideBox;
  };

  logoutBtn.onclick = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    refresh();
  };

  /* 意见反馈 */
  var fbBtn = document.getElementById('cr-feedback');
  fbBtn.onclick = function () {
    var page = (location.pathname || '/').split('/').pop() || 'index.html';
    showBox(
      '<h3>📮 意见反馈</h3>' +
      '<input id="f-name" placeholder="你的名字（可不填）" autocomplete="off">' +
      '<textarea id="f-content" placeholder="写下你的意见、建议或遇到的问题..." style="min-height:120px"></textarea>' +
      '<div class="cr-msg" id="f-msg"></div>' +
      '<div class="cr-row">' +
      '<button class="cr-ok" id="f-go">提交</button>' +
      '<button class="cr-cancel" id="f-close">关闭</button>' +
      '</div>' +
      '<div class="cr-note">提交后会自动同步到站长后台，谢谢你的反馈！</div>'
    );
    document.getElementById('f-go').onclick = function () {
      var content = document.getElementById('f-content').value.trim();
      if (!content) return err('f-msg', '意见内容不能为空');
      post('/api/feedback', {
        name: document.getElementById('f-name').value.trim(),
        content: content,
        page: page
      }, function (j) {
        if (j.ok) { alert('✅ 感谢反馈！已提交到站长后台'); hideBox(); }
        else err('f-msg', j.msg || '提交失败（可能已掉线）');
      });
    };
    document.getElementById('f-close').onclick = hideBox;
  };

  /* 启动 */
  refresh();
  loadApiConfig();
})();
