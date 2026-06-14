/**
 * 版本更新检查模块
 * 从 GitHub Releases 获取最新版本信息并与当前版本比较
 */
(function () {
  var REPO = 'tuyangJs/Jade_ec';
  var API_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var PERIODIC_INTERVAL = 10 * 60 * 1000; // 10分钟定时检查

  var _currentVersion = '';
  var _onUpdate = null;
  var _periodicTimer = null;
  var _checking = false;

  /**
   * 比较语义化版本号，返回 1 表示 a > b，-1 表示 a < b，0 表示相等
   */
  function compareVersions(a, b) {
    var pa = (a || '').replace(/^v/i, '').split('.');
    var pb = (b || '').replace(/^v/i, '').split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i] || '0', 10);
      var nb = parseInt(pb[i] || '0', 10);
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  /**
   * 从 localStorage 获取上次检查时间
   */
  function getLastCheckTime() {
    try {
      var t = localStorage.getItem('updateCheck_lastTime');
      return t ? parseInt(t, 10) : 0;
    } catch (e) { return 0; }
  }

  /**
   * 记录检查时间
   */
  function setLastCheckTime() {
    try { localStorage.setItem('updateCheck_lastTime', Date.now().toString()); } catch (e) {}
  }

  /**
   * 获取上次已知的最新版本
   */
  function getLastKnownVersion() {
    try { return localStorage.getItem('updateCheck_lastVersion') || ''; } catch (e) { return ''; }
  }

  /**
   * 记录已知最新版本
   */
  function setLastKnownVersion(v) {
    try { localStorage.setItem('updateCheck_lastVersion', v); } catch (e) {}
  }

  /**
   * 获取用户是否跳过了某版本
   */
  function getSkippedVersion() {
    try { return localStorage.getItem('updateCheck_skipped') || ''; } catch (e) { return ''; }
  }

  /**
   * 跳过某版本
   */
  function setSkippedVersion(v) {
    try { localStorage.setItem('updateCheck_skipped', v); } catch (e) {}
  }

  /**
   * 将 Markdown 简单转换为 HTML
   */
  function simpleMarkdown(text) {
    if (!text) return '';
    var html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<strong>$1</strong>')
      .replace(/^# (.+)$/gm, '<strong>$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '<br>')
      .replace(/\n/g, '<br>');
    return html;
  }

  /**
   * 执行更新检查请求
   * @param {boolean} force - 是否强制（忽略跳过版本）
   * @param {function} onNoUpdate - 无更新时的回调（手动检查时用于提示"已是最新"）
   */
  function doCheck(force, onNoUpdate) {
    if (_checking || !_currentVersion) return;
    _checking = true;

    fetch(API_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (release) {
        setLastCheckTime();
        if (!release || !release.tag_name) {
          if (typeof onNoUpdate === 'function') onNoUpdate();
          return;
        }

        var latestVersion = release.tag_name.replace(/^v/i, '');
        var skipped = getSkippedVersion();

        if (compareVersions(latestVersion, _currentVersion) !== 1) {
          setLastKnownVersion(latestVersion);
          if (typeof onNoUpdate === 'function') onNoUpdate();
          return;
        }
        if (skipped === latestVersion && !force) {
          if (typeof onNoUpdate === 'function') onNoUpdate();
          return;
        }

        setLastKnownVersion(latestVersion);
        if (typeof _onUpdate === 'function') {
          _onUpdate({
            version: latestVersion,
            htmlUrl: release.html_url,
            changelog: simpleMarkdown(release.body || ''),
            downloadUrl: (release.assets && release.assets[0]) ? release.assets[0].browser_download_url : ''
          });
        }
      })
      .catch(function () {
        setLastCheckTime();
      })
      .finally(function () {
        _checking = false;
      });
  }

  /**
   * 启动更新检查
   * @param {string} currentVersion - 当前版本号
   * @param {function} onUpdate - 发现更新时的回调
   */
  function startChecking(currentVersion, onUpdate) {
    _currentVersion = (currentVersion || '').replace(/^v/i, '');
    _onUpdate = onUpdate;

    // 启动时立即检查
    doCheck(false);

    // 每10分钟定时检查
    if (_periodicTimer) clearInterval(_periodicTimer);
    _periodicTimer = setInterval(function () {
      doCheck(false);
    }, PERIODIC_INTERVAL);
  }

  /**
   * 手动检查更新（强制，忽略跳过版本）
   * @param {function} onNoUpdate - 无更新时的回调
   */
  function manualCheck(onNoUpdate) {
    doCheck(true, onNoUpdate);
  }

  /**
   * 跳过当前最新版本
   */
  function skipVersion() {
    var v = getLastKnownVersion();
    if (v) setSkippedVersion(v);
  }

  // 暴露到全局
  window.UpdateChecker = {
    start: startChecking,
    check: manualCheck,
    skip: skipVersion,
    compareVersions: compareVersions
  };
})();
