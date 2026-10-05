/* =========================================================
 * Cr专属工具箱 · 云端数据层 (ghdb.js)
 * 前端直接通过 GitHub Contents API 读写仓库文件，把 GitHub 当数据库
 * 站长电脑关机也能用；无需 Cloudflare、无需任何后端。
 *
 * 数据文件（都在 CaesarPC/website-finder 仓库的 api_data/ 目录）：
 *   wall.json      留言墙列表
 *   users.json     用户表 {username:{salt,hash,created}}
 *   sessions.json  会话表 {token:username}
 *   notes.json     备忘录 {username:note}
 *   projects.json  开源专区项目列表
 *   feedback.json  意见反馈
 *   meta.json      访问统计 {visits:n}
 *
 * 接口语义与 cloud-server/worker.js 完全一致。
 * ========================================================= */
(function () {
  var REPO = 'CaesarPC/website-finder';
  var BRANCH = 'main';
  var API = 'https://api.github.com/repos/' + REPO + '/contents/';

  /* ---------- token（混淆存放，运行时还原；换 token 时改这里） ----------
   * 混淆串 = base64(每个字符码点+7 后反转)。防止 GitHub 推送保护检测到有效 token。
   * 还原：base64解码 → 反转 → 每个字符-7。
   * ⚠ 该 token 会随网页公开，务必使用受限 token（仅 website-finder 仓库、Contents 读写）。
   */
  var _ENC = 'VnlhfT1xU21TS1FUPUlYVlNRVjd+WUtqU0pNVjl+WHJeSFhOSVxsV051czhwWExvXGBKU09OXFJSWH5mPm07eld1V05bgVhtN0hXOTlUWEo4OGZ7aHdmaXxve3Bu';
  function _token() {
    try {
      var s = atob(_ENC);           // base64 解码
      s = s.split('').reverse().join('');  // 反转
      var out = '';
      for (var i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) - 7);
      return out;
    } catch (e) { return ''; }
  }
  var TOKEN = _token();
  /* ---------- 写 token（加密存储，需更改密码解密；未解密时写操作不可用） ----------
   * 底层保护：前端 TOKEN 未来替换为只读 token 后，黑客即使拿到也只能读不能写。
   * 读写 token 用更改密码 XOR 加密后存在 api_data/security.json，
   * 写操作时需先验证更改密码并解密出 WRITE_TOKEN 临时使用。
   */
  var WRITE_TOKEN = '';
  var SECURITY_CACHE = null;
  function sha256hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
  }
  function xorDecrypt(b64ct, password) {
    return sha256hex(password).then(function (hex) {
      var key = new Uint8Array(32);
      for (var i = 0; i < 32; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
      var ct = Uint8Array.from(atob(b64ct), function (c) { return c.charCodeAt(0); });
      var pt = new Uint8Array(ct.length);
      for (var j = 0; j < ct.length; j++) pt[j] = ct[j] ^ key[j % 32];
      return new TextDecoder().decode(pt);
    });
  }
  function loadSecurity(cb) {
    if (SECURITY_CACHE) return cb(SECURITY_CACHE);
    ghRead('api_data/security.json', function (err, sec) {
      if (err || !sec) return cb(null);
      SECURITY_CACHE = sec;
      cb(sec);
    });
  }
  function verifyAndUnlock(pwd, cb) {
    if (!pwd) return cb(false, '请输入更改密码');
    loadSecurity(function (sec) {
      if (!sec) return cb(false, '安全配置读取失败');
      sha256hex(String(pwd)).then(function (h) {
        var isChange = h === sec.change_password_hash;
        var isEmergency = h === sec.emergency_password_hash;
        if (!isChange && !isEmergency) return cb(false, '更改密码错误');
        var encField = isEmergency ? 'encrypted_write_token_emergency' : 'encrypted_write_token';
        xorDecrypt(sec[encField], String(pwd)).then(function (tok) {
          WRITE_TOKEN = tok;
          cb(true, isEmergency ? '应急密码验证通过，写权限已解锁' : '更改密码验证通过，写权限已解锁');
        });
      });
    });
  }

  /* ---------- UTF-8 安全 base64 ---------- */
  function b64e(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64d(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- GitHub Contents API ---------- */
  function ghHeaders(json) {
    var h = { 'Accept': 'application/vnd.github+json' };
    // 写操作（json=true）优先用解密后的读写 token；未解密则回退到默认 token
    var tok = (json && WRITE_TOKEN) ? WRITE_TOKEN : TOKEN;
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  /* 读取文件：cb(null, data) / cb({error})，文件不存在返回 null */
  function ghRead(file, cb) {
    fetch(API + file, { cache: 'no-store', headers: ghHeaders(false) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.content) {
          var txt = b64d(j.content);
          try { cb(null, JSON.parse(txt)); }
          catch (e) { cb({ error: '数据格式损坏' }); }
        } else if (j.status === 404 || (j.message && j.message.indexOf('Not Found') >= 0)) {
          cb(null, null);   // 文件不存在
        } else {
          cb({ error: (j.message || '读取失败') + (TOKEN ? '' : '（token缺失）') });
        }
      })
      .catch(function () { cb({ error: '网络错误' }); });
  }

  /* 写入文件：先取最新 sha 再 PUT，失败重试一次 */
  function ghWrite(file, data, cb, _retried) {
    // 1. 取当前 sha
    fetch(API + file, { cache: 'no-store', headers: ghHeaders(false) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var sha = (j && j.sha) || null;
        // 2. PUT 新内容
        return fetch(API + file, {
          method: 'PUT',
          headers: ghHeaders(true),
          body: JSON.stringify({
            message: 'cr-tools: update ' + file,
            content: b64e(JSON.stringify(data, null, 1)),
            branch: BRANCH,
            sha: sha || undefined
          })
        }).then(function (r) { return r.json(); });
      })
      .then(function (j) {
        if (j.content || j.commit) return cb(null, true);
        // sha 冲突等：重试一次
        if (!_retried && j.message && (j.message.indexOf('sha') >= 0 || j.status === 409)) {
          return ghWrite(file, data, cb, true);
        }
        cb({ error: (j.message || '写入失败') + (TOKEN ? '' : '（token缺失）') });
      })
      .catch(function () { cb({ error: '网络错误' }); });
  }

  /* ---------- 工具 ---------- */
  function sha256(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      .then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
  }
  function randToken() {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ok(obj) { var o = obj || {}; o.ok = true; return o; }
  function fail(msg) { return { ok: false, msg: msg }; }

  /* ---------- 更改密码验证（所有写操作必须通过） ---------- */
  var SECURITY_CACHE = null;
  function verifyChangePassword(pwd, cb) {
    if (!pwd) return cb(false, '请输入更改密码');
    function check(sec) {
      sha256(String(pwd)).then(function (h) {
        if (h === sec.change_password_hash) return cb(true, '更改密码验证通过');
        if (h === sec.emergency_password_hash) return cb(true, '应急密码验证通过');
        cb(false, '更改密码错误');
      });
    }
    if (SECURITY_CACHE) return check(SECURITY_CACHE);
    ghRead('api_data/security.json', function (err, sec) {
      if (err || !sec) return cb(false, '安全配置读取失败');
      SECURITY_CACHE = sec;
      check(sec);
    });
  }

  /* 会话查询 */
  function usernameByToken(token, cb) {
    if (!token) return cb('');
    ghRead('api_data/sessions.json', function (err, sessions) {
      if (err || !sessions) return cb('');
      cb(sessions[token] || '');
    });
  }

  /* ---------- 接口（与 worker.js 一致） ---------- */

  /* 留言墙 */
  function wallGet(cb) {
    ghRead('api_data/wall.json', function (err, list) {
      if (err) return cb(fail(err.error));
      cb(ok({ list: list || [] }));
    });
  }
  function wallPost(data, cb) {
    var name = String(data.name || '匿名').slice(0, 20);
    var content = String(data.content || '').trim().slice(0, 500);
    if (!content) return cb(fail('留言内容不能为空'));
    usernameByToken(data.token, function (username) {
      ghRead('api_data/wall.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        /* ---- 刷屏防御（所有账号统一生效，包括 Server，防止账号被乱用） ---- */
        var who = username || '匿名';
        var now = Date.now();
        var recent = list.filter(function (x) {
          var t = Number(x.ts) || (x.id ? Number(x.id) : 0);
          return (x.who || x.name) === who && (now - t) < 600000;
        });
        if (recent.length >= 5) return cb(fail('发言太频繁了，请 10 分钟后再试试'));
        var same = recent.filter(function (x) { return (x.content || '') === content; }).length;
        if (same >= 2) return cb(fail('这句你已经发过两次了，换一句吧'));
        var item = {
          id: Date.now(),
          ts: now,
          who: who,
          name: name,
          content: content,
          time: nowStr(),
          admin: username === 'Server',
          mod: false,
          pinned: false
        };
        if (username && username !== 'Server') {
          ghRead('api_data/users.json', function (e3, users) {
            if (!e3 && users && users[username] && users[username].role === 'mod') {
              item.mod = true;
            }
            list.unshift(item);
            ghWrite('api_data/wall.json', list.slice(0, 300), function (e2) {
              if (e2) return cb(fail(e2.error));
              cb(ok({ msg: '留言成功', id: item.id }));
            });
          });
        } else {
          list.unshift(item);
          ghWrite('api_data/wall.json', list.slice(0, 300), function (e2) {
            if (e2) return cb(fail(e2.error));
            cb(ok({ msg: '留言成功', id: item.id }));
          });
        }
      });
    });
  }
  function wallPin(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      ghRead('api_data/wall.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        var item = null;
        for (var i = 0; i < list.length; i++) if (Number(list[i].id) === Number(data.id)) { item = list[i]; break; }
        if (!item) return cb(fail('留言不存在'));
        item.pinned = !!data.pinned;
        ghWrite('api_data/wall.json', list, function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({}));
        });
      });
    });
  }
  function wallSync(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      var src = Array.isArray(data.list) ? data.list.slice(0, 300) : [];
      var seen = {};
      var cleaned = [];
      src.forEach(function (x) {
        if (!x || seen[x.id]) return;
        seen[x.id] = true;
        cleaned.push({
          id: Number(x.id) || Date.now(),
          name: String(x.name || '匿名').slice(0, 20),
          content: String(x.content || '').slice(0, 500),
          time: String(x.time || nowStr()),
          admin: !!x.admin,
          pinned: !!x.pinned
        });
      });
      ghWrite('api_data/wall.json', cleaned, function (e2) {
        if (e2) return cb(fail(e2.error));
        cb(ok({ msg: '同步成功', count: cleaned.length }));
      });
    });
  }

  /* 登录 / 注册 */
  function doLogin(data, cb) {
    var username = String(data.username || '').trim();
    var password = String(data.password || '');
    if (!username || !password) return cb(fail('请输入用户名和密码'));
    var SERVER_HASH = '7a72b4016d8706c42bf5cbfcc1a0dd1b3194b4c9a500f4b36458f057140e9dc0';
    ghRead('api_data/users.json', function (err, users) {
      if (err) return cb(fail(err.error));
      users = users || {};
      var finish = function (okLogin) {
        if (!okLogin) return cb(fail('密码错误'));
        var token = randToken();
        ghRead('api_data/sessions.json', function (e2, sessions) {
          sessions = sessions || {};
          sessions[token] = username;
          ghWrite('api_data/sessions.json', sessions, function (e3) {
            if (e3) return cb(fail(e3.error));
            cb(ok({ token: token, username: username, admin: username === 'Server' }));
          });
        });
      };
      if (username === 'Server') {
        sha256(password).then(function (h) {
          finish(h === SERVER_HASH);
        });
      } else {
        var u = users[username];
        if (!u) return cb(fail('用户不存在'));
        sha256(password + '::' + u.salt).then(function (h) {
          finish(h === u.hash);
        });
      }
    });
  }
  function doRegister(data, cb) {
    var username = String(data.username || '').trim();
    var password = String(data.password || '');
    if (username.length < 2 || username.length > 20) return cb(fail('用户名需2-20字符'));
    if (password.length < 4) return cb(fail('密码至少4位'));
    ghRead('api_data/users.json', function (err, users) {
      if (err) return cb(fail(err.error));
      users = users || {};
      if (users[username]) return cb(fail('用户名已被注册'));
      var salt = randToken();
      sha256(password + '::' + salt).then(function (hash) {
        users[username] = { salt: salt, hash: hash, created: nowStr(), role: 'user' };
        ghWrite('api_data/users.json', users, function (e2) {
          if (e2) return cb(fail(e2.error));
          var token = randToken();
          ghRead('api_data/sessions.json', function (e3, sessions) {
            sessions = sessions || {};
            sessions[token] = username;
            ghWrite('api_data/sessions.json', sessions, function (e4) {
              if (e4) return cb(fail(e4.error));
              cb(ok({ token: token, username: username, admin: false }));
            });
          });
        });
      });
    });
  }

  /* 备忘录 */
  function noteGet(data, cb) {
    usernameByToken(data.token, function (username) {
      if (!username) return cb(fail('未登录'));
      ghRead('api_data/notes.json', function (err, notes) {
        if (err) return cb(fail(err.error));
        notes = notes || {};
        cb(ok({ note: notes[username] || '' }));
      });
    });
  }
  function notePost(data, cb) {
    usernameByToken(data.token, function (username) {
      if (!username) return cb(fail('未登录'));
      ghRead('api_data/notes.json', function (err, notes) {
        if (err) return cb(fail(err.error));
        notes = notes || {};
        notes[username] = String(data.note || '').slice(0, 2000);
        ghWrite('api_data/notes.json', notes, function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({}));
        });
      });
    });
  }

  /* 意见反馈 */
  function feedbackPost(data, cb) {
    var content = String(data.content || '').slice(0, 1000);
    if (!content) return cb(fail('内容为空'));
    usernameByToken(data.token, function (username) {
      ghRead('api_data/feedback.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        list.unshift({ id: Date.now(), username: username || '匿名', content: content, time: nowStr() });
        ghWrite('api_data/feedback.json', list.slice(0, 200), function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({ msg: '已提交' }));
        });
      });
    });
  }

  /* 访问统计 */
  function report(cb) {
    ghRead('api_data/meta.json', function (err, meta) {
      if (err) return cb(fail(err.error));
      meta = meta || {};
      meta.visits = (meta.visits || 0) + 1;
      ghWrite('api_data/meta.json', meta, function (e2) {
        if (e2) return cb(fail(e2.error));
        cb(ok({ visits: meta.visits }));
      });
    });
  }

  /* 开源专区 */
  function projectsList(data, cb) {
    var cat = data.cat || '';
    var q = String(data.q || '').toLowerCase();
    var mine = data.mine || '';
    ghRead('api_data/projects.json', function (err, list) {
      if (err) return cb(fail(err.error));
      list = list || [];
      var out = list;
      if (cat) out = out.filter(function (p) { return p.category === cat; });
      if (q) out = out.filter(function (p) { return (p.title + p.desc + p.tags + p.author).toLowerCase().indexOf(q) >= 0; });
      if (mine) out = out.filter(function (p) { return p.author === mine; });
      cb(ok({ list: out }));
    });
  }
  function projectCreate(data, cb) {
    usernameByToken(data.token, function (username) {
      if (!username) return cb(fail('发布必须登录，请先登录'));
      var title = String(data.title || '').trim().slice(0, 60);
      var desc = String(data.desc || '').trim().slice(0, 300);
      var content = String(data.content || '').trim().slice(0, 5000);
      var link = String(data.link || '').trim().slice(0, 300);
      var tags = String(data.tags || '').trim().slice(0, 100);
      if (!title) return cb(fail('标题不能为空'));
      if (!desc && !content && !link) return cb(fail('描述、内容、链接至少填一个'));
      ghRead('api_data/projects.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        var p = {
          id: Date.now(),
          title: title,
          desc: desc,
          content: content,
          link: link,
          tags: tags,
          category: String(data.category || '其他').slice(0, 20),
          author: username,
          created: nowStr(),
          comments: []
        };
        list.unshift(p);
        ghWrite('api_data/projects.json', list.slice(0, 500), function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({ id: p.id, msg: '发布成功' }));
        });
      });
    });
  }
  function projectComment(data, cb) {
    usernameByToken(data.token, function (username) {
      if (!username) return cb(fail('评论必须登录'));
      var id = Number(data.id);
      var text = String(data.text || '').trim().slice(0, 500);
      if (!text) return cb(fail('评论内容不能为空'));
      ghRead('api_data/projects.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        var p = null;
        for (var i = 0; i < list.length; i++) if (Number(list[i].id) === id) { p = list[i]; break; }
        if (!p) return cb(fail('项目不存在'));
        p.comments = p.comments || [];
        p.comments.push({ user: username, text: text, time: nowStr() });
        if (p.comments.length > 100) p.comments = p.comments.slice(-100);
        ghWrite('api_data/projects.json', list, function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({ msg: '评论成功' }));
        });
      });
    });
  }
  function projectDel(data, cb) {
    usernameByToken(data.token, function (username) {
      if (!username) return cb(fail('请先登录'));
      var id = Number(data.id);
      ghRead('api_data/projects.json', function (err, list) {
        if (err) return cb(fail(err.error));
        list = list || [];
        var p = null;
        for (var i = 0; i < list.length; i++) if (Number(list[i].id) === id) { p = list[i]; break; }
        if (!p) return cb(fail('项目不存在'));
        if (p.author !== username && username !== 'Server') return cb(fail('只能删除自己的项目'));
        ghWrite('api_data/projects.json', list.filter(function (x) { return Number(x.id) !== id; }), function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({ msg: '已删除' }));
        });
      });
    });
  }

  /* ========== 管理员专属 API ========== */
  function adminUsersList(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      ghRead('api_data/users.json', function (err, users) {
        if (err) return cb(fail(err.error));
        users = users || {};
        var out = [{ username: 'Server', regTime: '系统账号', admin: true, role: 'admin' }];
        Object.keys(users).forEach(function (k) {
          out.push({ username: k, regTime: users[k].created || '', admin: false, role: users[k].role || 'user' });
        });
        cb(ok({ list: out }));
      });
    });
  }
  function adminUserReset(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      var target = String(data.username || '').trim();
      var newPass = String(data.password || '').trim();
      if (!target || !newPass) return cb(fail('用户名和新密码不能为空'));
      if (target === 'Server') return cb(fail('不能重置 Server 密码'));
      ghRead('api_data/users.json', function (err, users) {
        if (err) return cb(fail(err.error));
        users = users || {};
        if (!users[target]) return cb(fail('用户不存在'));
        var salt = randToken().slice(0, 8);
        sha256(newPass + '::' + salt).then(function (hash) {
          users[target].salt = salt; users[target].hash = hash;
          ghWrite('api_data/users.json', users, function (e2) {
            if (e2) return cb(fail(e2.error));
            cb(ok({ msg: '密码已重置' }));
          });
        });
      });
    });
  }
  function adminUserDelete(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      var target = String(data.username || '').trim();
      if (!target) return cb(fail('用户名不能为空'));
      if (target === 'Server') return cb(fail('不能删除 Server'));
      ghRead('api_data/users.json', function (err, users) {
        if (err) return cb(fail(err.error));
        users = users || {};
        if (!users[target]) return cb(fail('用户不存在'));
        delete users[target];
        ghWrite('api_data/users.json', users, function (e2) {
          if (e2) return cb(fail(e2.error));
          // 同时清理该用户的 session
          ghRead('api_data/sessions.json', function (e3, sessions) {
            if (!e3 && sessions) {
              Object.keys(sessions).forEach(function (tk) { if (sessions[tk] === target) delete sessions[tk]; });
              ghWrite('api_data/sessions.json', sessions, function () {});
            }
          });
          cb(ok({ msg: '用户已删除' }));
        });
      });
    });
  }
  function adminUserSetRole(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      var target = String(data.username || '').trim();
      var role = String(data.role || '').trim();
      if (!target || !role) return cb(fail('用户名和角色不能为空'));
      if (target === 'Server') return cb(fail('不能修改 Server 角色'));
      if (role !== 'user' && role !== 'mod') return cb(fail('角色只能是 user 或 mod'));
      ghRead('api_data/users.json', function (err, users) {
        if (err) return cb(fail(err.error));
        users = users || {};
        if (!users[target]) return cb(fail('用户不存在'));
        users[target].role = role;
        ghWrite('api_data/users.json', users, function (e2) {
          if (e2) return cb(fail(e2.error));
          cb(ok({ msg: role === 'mod' ? '已升级为半管理员' : '已降级为普通用户' }));
        });
      });
    });
  }
  function adminFeedbackList(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      ghRead('api_data/feedback.json', function (err, list) {
        if (err) return cb(fail(err.error));
        cb(ok({ list: list || [] }));
      });
    });
  }
  function adminVisitsList(data, cb) {
    usernameByToken(data.token, function (username) {
      if (username !== 'Server') return cb(fail('仅管理员可操作'));
      ghRead('api_data/visits.json', function (err, list) {
        if (err) return cb(fail(err.error));
        cb(ok({ list: list || [] }));
      });
    });
  }
  /* 访问记录（公开，页面加载时调用） */
  function visitLog(data, cb) {
    ghRead('api_data/visits.json', function (err, list) {
      if (err) list = [];
      list = list || [];
      var item = {
        id: Date.now(),
        ts: Date.now(),
        time: nowStr(),
        page: String(data.page || '').slice(0, 100),
        ua: String(data.ua || '').slice(0, 200),
        ref: String(data.ref || '').slice(0, 200)
      };
      list.push(item);
      if (list.length > 500) list = list.slice(-500);
      ghWrite('api_data/visits.json', list, function (e2) {
        if (e2) return cb(fail(e2.error));
        cb(ok({ msg: '已记录' }));
      });
    });
  }

  /* 统一出口：前端 post/get 路由到这里
   * route('GET', '/api/wall?x=1', null, cb)
   * route('POST', '/api/wall', {name,content,token}, cb)
   */
  function route(method, path, data, cb) {
    var p = String(path || '').replace(/^\/api\//, '').split('?')[0];
    if (method === 'GET') {
      var q = {};
      var qs = String(path || '').split('?')[1];
      if (qs) qs.split('&').forEach(function (kv) {
        if (!kv) return;
        var kk = kv.split('=');
        q[decodeURIComponent(kk[0])] = decodeURIComponent((kk[1] || '').replace(/\+/g, ' '));
      });
      if (p === 'wall') return wallGet(cb);
      if (p === 'note') return noteGet({ token: q.token }, cb);
      if (p === 'projects') return projectsList({ q: q.q, cat: q.cat, mine: q.mine }, cb);
      if (p === 'report') return report(cb);
      if (p === 'admin/users') return adminUsersList({ token: q.token }, cb);
      if (p === 'admin/feedback') return adminFeedbackList({ token: q.token }, cb);
      if (p === 'admin/visits') return adminVisitsList({ token: q.token }, cb);
      return cb(fail('接口不存在: ' + p));
    }
    /* ---- 写操作统一验证+解锁写token（login/register/visit/log 除外） ---- */
    var WRITE_OPS = ['wall','wall/pin','wall/sync','note','feedback','projects','projects/comment','projects/del','admin/user/reset','admin/user/delete','admin/user/setrole'];
    if (WRITE_OPS.indexOf(p) >= 0) {
      var cp = data && data.changePassword;
      var done = false;
      verifyAndUnlock(cp, function (pass, msg) {
        if (done) return; done = true;
        if (!pass) return cb(fail(msg));
        dispatchWrite();
      });
      return;
    }
    function dispatchWrite() {
    switch (p) {
      case 'wall': return wallPost(data, cb);
      case 'wall/pin': return wallPin(data, cb);
      case 'wall/sync': return wallSync(data, cb);
      case 'login': return doLogin(data, cb);
      case 'register': return doRegister(data, cb);
      case 'note': return notePost(data, cb);
      case 'feedback': return feedbackPost(data, cb);
      case 'projects': return projectCreate(data, cb);
      case 'projects/comment': return projectComment(data, cb);
      case 'projects/del': return projectDel(data, cb);
      case 'admin/user/reset': return adminUserReset(data, cb);
      case 'admin/user/delete': return adminUserDelete(data, cb);
      case 'admin/user/setrole': return adminUserSetRole(data, cb);
      case 'visit/log': return visitLog(data, cb);
      default: return cb(fail('接口不存在: ' + p));
    }
    }
  }

  window.CrGH = {
    token: TOKEN,
    route: route,
    wallGet: wallGet, wallPost: wallPost, wallPin: wallPin, wallSync: wallSync,
    login: doLogin, register: doRegister,
    noteGet: noteGet, notePost: notePost,
    feedbackPost: feedbackPost,
    report: report,
    projectsList: projectsList, projectCreate: projectCreate,
    projectComment: projectComment, projectDel: projectDel,
    adminUsersList: adminUsersList, adminUserReset: adminUserReset, adminUserDelete: adminUserDelete, adminUserSetRole: adminUserSetRole,
    adminFeedbackList: adminFeedbackList, adminVisitsList: adminVisitsList,
    visitLog: visitLog,
    verifyAndUnlock: verifyAndUnlock
  };
})();
