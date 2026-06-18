(function () {
  'use strict';

  var state = {
    moduleInfo: null,
    subroutines: [],
    dllCommands: [],
    classes: [],
    dataTypes: [],
    globalVars: [],
    constants: [],
    activeCategory: 'subroutines',
    activeItem: null,
    searchQuery: '',
    loading: false,
    loadedCategories: {}
  };

  // --- Settings ---
  var DEFAULT_SETTINGS = {
    theme: 'System',
    fontSize: 13,
    showRemark: true,
    defaultSearch: 'all',
    autoReload: false,
    backgroundMaterial: 'default',
    detailOpacity: 100,
    showTypeUnderline: true,
    showTypeTooltip: true,
    showListDivider: false
  };

  var isWindows11 = false;

  function loadSettings() {
    try {
      var saved = localStorage.getItem('appSettings');
      if (saved) {
        var parsed = JSON.parse(saved);
        var result = {};
        Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
          result[k] = parsed[k] !== undefined ? parsed[k] : DEFAULT_SETTINGS[k];
        });
        return result;
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem('appSettings', JSON.stringify(settings));
    } catch (e) {}
  }

  var appSettings = loadSettings();

  // --- Debounce ---
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(ctx, args); }, delay);
    };
  }

  // --- Search Text Cache (按需计算) ---
  function buildSearchCache(key) {
    // 惰性初始化：搜索时按需构建，此处不再预遍历
  }

  function searchItemTextCompute(item, category, mode) {
    var name = [item.name || ''];
    var remark = [item.remark || ''];
    var type = [];
    var method = [];
    var param = [];

    if (category === 'subroutines' || category === 'dllCommands') {
      type.push(item.returnType || '');
      (item.params || []).forEach(function (p) {
        param.push(p.name || '');
        type.push(p.dataType || '');
        remark.push(p.remark || '');
      });
    }
    if (category === 'classes') {
      type.push(item.baseClass || '');
      (item.methods || []).forEach(function (m) {
        method.push(m.name || '');
        type.push(m.returnType || '');
        remark.push(m.remark || '');
        (m.params || []).forEach(function (p) {
          param.push(p.name || '');
          type.push(p.dataType || '');
          remark.push(p.remark || '');
        });
      });
    }
    if (category === 'dataTypes') {
      (item.members || []).forEach(function (m) {
        name.push(m.name || '');
        type.push(m.dataType || '');
        remark.push(m.remark || '');
      });
    }
    if (category === 'globalVars') {
      type.push(item.dataType || '');
    }
    if (category === 'constants') {
      remark.push(String(item.value || ''));
    }

    if (mode === 'all') {
      return [].concat(name, remark, type, method, param).join('\n').toLowerCase();
    }
    return (({ name: name, remark: remark, type: type, method: method, param: param })[mode] || []).join('\n').toLowerCase();
  }

  // --- Type Lookup Maps ---
  var classNameMap = null;
  var dataTypeNameMap = null;
  var typeMapsDirty = false;

  function buildTypeMaps() {
    classNameMap = new Map();
    dataTypeNameMap = new Map();
    state.classes.forEach(function (cls, i) { classNameMap.set(cls.name, i); });
    state.dataTypes.forEach(function (dt, i) { dataTypeNameMap.set(dt.name, i); });
    typeMapsDirty = false;
  }

  function ensureTypeMaps() {
    if (typeMapsDirty || !classNameMap) buildTypeMaps();
  }

  // --- Navigation History ---
  var navHistory = [];
  var navIndex = -1;
  var navIgnore = false;
  var NAV_HISTORY_LIMIT = 100;

  function pushNav(category, itemIndex, searchQuery) {
    if (navIgnore) return;
    // 截断前进历史
    navHistory = navHistory.slice(0, navIndex + 1);
    navHistory.push({ category: category, itemIndex: itemIndex, searchQuery: searchQuery || '' });
    navIndex = navHistory.length - 1;
    // 限制历史记录长度
    if (navHistory.length > NAV_HISTORY_LIMIT) {
      navHistory = navHistory.slice(navHistory.length - NAV_HISTORY_LIMIT);
      navIndex = navHistory.length - 1;
    }
    updateNavButtons();
  }

  function goBack() {
    if (navIndex <= 0) return;
    navIndex--;
    navIgnore = true;
    applyNav(navHistory[navIndex]);
    navIgnore = false;
    updateNavButtons();
  }

  function goForward() {
    if (navIndex >= navHistory.length - 1) return;
    navIndex++;
    navIgnore = true;
    applyNav(navHistory[navIndex]);
    navIgnore = false;
    updateNavButtons();
  }

  function applyNav(entry) {
    state.activeCategory = entry.category;
    state.activeItem = entry.itemIndex;
    state.searchQuery = entry.searchQuery || '';
    searchInput.value = state.searchQuery;
    // 恢复搜索模式标签
    if (state.searchQuery) {
      var parsed = parseSearchQuery(state.searchQuery);
      if (parsed.mode && parsed.mode !== 'all') {
        setSearchModeTag(parsed.mode);
      } else {
        setSearchModeTag(null);
      }
    } else {
      setSearchModeTag(null);
    }
    // 处理关于页面
    if (entry.category === 'about') {
      setActiveNavBottom('about');
      listPanelEl.style.display = 'none';
      listResize.style.display = 'none';
      renderAboutPage();
      return;
    }
    // 处理设置页面
    if (entry.category === 'settings') {
      setActiveNavBottom('settings');
      listPanelEl.style.display = 'none';
      listResize.style.display = 'none';
      renderSettingsPage();
      return;
    }
    // 处理欢迎页
    if (entry.category === 'welcome') {
      clearActiveNav();
      listPanelEl.style.display = 'none';
      listResize.style.display = 'none';
      renderWelcome();
      return;
    }
    setActiveNav(entry.category);
    listPanelEl.style.display = '';
    listResize.style.display = '';
    renderList();

    // 搜索页面回退：恢复激活的搜索结果并滚动
    if (entry.category === 'search' && entry.searchActiveCat != null) {
      var targetEl = listItems.querySelector('.list-item[data-search-category="' + entry.searchActiveCat + '"][data-index="' + entry.searchActiveIdx + '"]');
      if (targetEl) {
        targetEl.classList.add('active');
        targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        var sCat = entry.searchActiveCat;
        var sIdx = entry.searchActiveIdx;
        var savedCategory = state.activeCategory;
        state.activeCategory = sCat;
        var sItems = state[sCat] || [];
        if (sItems[sIdx]) renderDetail(sItems[sIdx]);
        state.activeCategory = savedCategory;
        return;
      }
    }

    var items = state[entry.category] || [];
    if (entry.itemIndex !== null && items[entry.itemIndex]) {
      renderDetail(items[entry.itemIndex]);
    } else {
      renderDetail(null);
    }
  }

  function updateNavButtons() {
    navBackBtn.disabled = navIndex <= 0;
    navForwardBtn.disabled = navIndex >= navHistory.length - 1;
  }

  // --- SVG Icons (常量复用，避免重复创建字符串) ---
  var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var ICON_COPY_SM = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var ICON_FOLDER = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4v9h12V6H8L6 4H2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  var categories = {
    subroutines: { title: '子程序', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M512 64C262.4 64 64 262.4 64 512c6.4 19.2 12.8 32 32 32s32-12.8 38.4-32c0-211.2 172.8-377.6 377.6-377.6 211.2 0 377.6 172.8 377.6 377.6s-172.8 377.6-377.6 377.6c-38.4 0-76.8-6.4-115.2-19.2-25.6-6.4-44.8-19.2-70.4-32l44.8-268.8h230.4c19.2 0 38.4-19.2 38.4-38.4s-12.8-38.4-38.4-38.4H384l25.6-134.4h236.8c25.6 0 38.4-19.2 38.4-38.4 0-25.6-19.2-38.4-38.4-38.4H345.6l-108.8 595.2c38.4 32 89.6 51.2 134.4 64 44.8 12.8 89.6 19.2 134.4 19.2 249.6 0 448-198.4 448-448 6.4-249.6-192-448-441.6-448z" fill="currentColor"/></svg>' },
    dllCommands: { title: 'DLL 命令', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M940.8 499.2c0-6.4-32-115.2-102.4-332.8-6.4-19.2-25.6-38.4-51.2-38.4H256c-25.6 0-44.8 12.8-51.2 38.4L102.4 499.2v371.2c0 32 25.6 51.2 51.2 51.2h729.6c32 0 51.2-25.6 51.2-51.2l6.4-371.2zM268.8 185.6h518.4l89.6 288h-224c-6.4 0-12.8 0-19.2 6.4-6.4 6.4-6.4 12.8-6.4 19.2 0 51.2-44.8 96-96 96s-96-44.8-96-96c0-19.2-12.8-32-32-32H179.2l89.6-281.6z m128 57.6c-19.2 0-32 12.8-32 32s12.8 32 32 32h268.8c19.2 0 32-12.8 32-32s-12.8-32-32-32H396.8zM326.4 358.4c-19.2 0-32 12.8-32 32s12.8 32 32 32h403.2c19.2 0 32-12.8 32-32s-12.8-32-32-32H326.4z" fill="currentColor"/></svg>' },
    classes:     { title: '类', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M825.6 460.8c-12.8 0-32 6.4-44.8 12.8l-115.2-108.8c6.4-19.2 12.8-38.4 12.8-57.6 0-64-51.2-121.6-121.6-121.6-64 0-121.6 51.2-121.6 121.6 0 44.8 19.2 76.8 51.2 102.4L409.6 640h-6.4c-25.6 0-51.2 6.4-70.4 19.2L243.2 582.4c6.4-12.8 6.4-19.2 6.4-32 0-51.2-38.4-89.6-89.6-89.6-51.2 0-89.6 38.4-89.6 89.6 0 51.2 38.4 89.6 89.6 89.6 19.2 0 32-6.4 44.8-12.8L294.4 704c-6.4 12.8-12.8 32-12.8 51.2 0 64 51.2 121.6 121.6 121.6 64 0 121.6-51.2 121.6-121.6 0-44.8-19.2-76.8-51.2-102.4l76.8-230.4h6.4c25.6 0 44.8-6.4 64-19.2L736 512c-6.4 12.8-6.4 19.2-6.4 32 0 51.2 38.4 89.6 89.6 89.6 51.2 0 89.6-38.4 89.6-89.6s-32-83.2-83.2-83.2z m-409.6 352c-32 0-57.6-25.6-57.6-57.6s25.6-57.6 57.6-57.6 57.6 25.6 57.6 57.6-25.6 57.6-57.6 57.6z" fill="currentColor"/></svg>' },
    dataTypes:   { title: '自定义数据类型', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M384 806.4l275.2-275.2-57.6-57.6-19.2 19.2c-12.8 12.8-38.4 12.8-51.2 0-12.8-12.8-12.8-38.4 0-51.2l19.2-19.2c25.6-25.6 64-25.6 89.6 0l64 70.4c25.6 25.6 25.6 64 0 89.6l-275.2 275.2c6.4 12.8 12.8 32 12.8 44.8 0 51.2-44.8 96-96 96S256 947.2 256 896s44.8-96 96-96c12.8 0 25.6 0 32 6.4z m275.2-563.2L384 518.4l57.6 57.6 19.2-19.2c12.8-12.8 38.4-12.8 51.2 0 12.8 12.8 12.8 38.4 0 51.2l-25.6 25.6c-25.6 25.6-64 25.6-89.6 0l-64-70.4c-25.6-25.6-25.6-64 0-89.6L614.4 192c-6.4-12.8-6.4-19.2-6.4-32 0-51.2 44.8-96 96-96s96 44.8 96 96S755.2 256 704 256c-19.2 0-32-6.4-44.8-12.8z m198.4 275.2l-128-128c-12.8-12.8-12.8-38.4 0-51.2 12.8-12.8 38.4 12.8 51.2 0l128 128c12.8 12.8 19.2 32 19.2 51.2 0 19.2-6.4 38.4-19.2 51.2l-128 128c-12.8 12.8-38.4 12.8-51.2 0-12.8-12.8-12.8-38.4 0-51.2l128-128z m-691.2 0l128 128c12.8 12.8 12.8 38.4 0 51.2-12.8 12.8-38.4 12.8-51.2 0l-128-128c-12.8-12.8-19.2-32-19.2-51.2 0-19.2 6.4-38.4 19.2-51.2l128-128c12.8-12.8 38.4-12.8 51.2 0 12.8 12.8 12.8 38.4 0 51.2l-128 128z" fill="currentColor"/></svg>' },
    globalVars:  { title: '全局变量', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M187.684571 841.142857h38.144v-43.556571H208.091429c-38.802286 0-49.005714-17.042286-49.005715-64.694857 0-44.251429 4.059429-83.748571 4.059429-134.107429 0-51.712-14.262857-76.214857-49.700572-85.065143v-3.437714c35.401143-8.850286 49.737143-32.658286 49.737143-85.065143 0-50.395429-4.096-89.856-4.096-134.107429 0-47.652571 10.203429-65.353143 49.005715-65.353142h17.700571V182.857143H187.684571c-63.268571 0-91.904 23.808-91.904 104.155428 0 55.149714 6.838857 91.904 6.838858 142.957715 0 27.904-14.299429 57.197714-66.048 57.856v47.652571c51.748571 0.694857 66.048 29.988571 66.048 59.245714 0 50.358857-6.838857 87.113143-6.838858 142.262858 0 80.347429 28.598857 104.155429 91.904 104.155428z m173.202286-116.406857h77.604572v-265.508571c33.353143-33.353143 57.197714-51.053714 91.904-51.053715 44.251429 0 63.305143 25.892571 63.305142 90.550857v226.011429h78.299429v-235.52c0-95.341714-35.401143-148.406857-115.053714-148.406857-51.053714 0-89.161143 27.904-123.904 61.257143h-2.011429l-6.144-51.748572h-64v374.418286zM802.304 841.142857v-43.556571h17.700571c38.802286 0 49.005714-17.042286 49.005715-64.694857 0-44.251429-3.364571-83.748571-3.364572-134.107429 0-51.712 13.604571-76.214857 49.005715-85.065143v-3.437714c-35.401143-8.850286-49.005714-32.658286-49.005715-85.065143 0-50.395429 3.401143-89.856 3.401143-134.107429 0-47.652571-10.24-65.353143-49.005714-65.353142h-17.737143V182.857143h38.144c63.268571 0 92.562286 23.808 92.562286 104.155428 0 55.149714-6.802286 91.904-6.802286 142.957715 0 27.904 14.299429 57.197714 65.353143 57.856v47.652571c-51.053714 0.694857-65.353143 29.988571-65.353143 59.245714 0 50.358857 6.802286 87.113143 6.802286 142.262858 0 80.347429-29.257143 104.155429-92.562286 104.155428h-38.144z" fill="currentColor"/></svg>' },
    constants:   { title: '常量', icon: '<svg width="12" height="12" viewBox="0 0 1024 1024" fill="none"><path d="M832 704c38.4 0 64 25.6 64 64s-25.6 64-64 64H364.8c-19.2 38.4-64 64-108.8 64-70.4 0-128-57.6-128-128s57.6-128 128-128c44.8 0 89.6 25.6 108.8 64H832zM576 128c44.8 0 89.6 25.6 108.8 64H832c38.4 0 64 25.6 64 64s-25.6 64-64 64h-147.2c-19.2 38.4-64 64-108.8 64s-89.6-25.6-108.8-64H192c-38.4 0-64-25.6-64-64s25.6-64 64-64h275.2c19.2-38.4 64-64 108.8-64zM448 448h384c38.4 0 64 25.6 64 64s-25.6 64-64 64H448c-38.4 0-64-25.6-64-64s25.6-64 64-64zM192 448h64c38.4 0 64 25.6 64 64s-25.6 64-64 64H192c-38.4 0-64-25.6-64-64s25.6-64 64-64z m384-128c38.4 0 64-25.6 64-64s-25.6-64-64-64-64 25.6-64 64 25.6 64 64 64z m-320 512c38.4 0 64-25.6 64-64s-25.6-64-64-64-64 25.6-64 64 25.6 64 64 64z" fill="currentColor"/></svg>' }
  };

  var moduleName = document.getElementById('moduleName');
  var moduleVersion = document.getElementById('moduleVersion');
  var moduleAuthor = document.getElementById('moduleAuthor');
  var openFileBtn = document.getElementById('openFileBtn');
  var moduleInfoBtn = document.getElementById('moduleInfoBtn');
  var moduleInfoCompactBtn = document.getElementById('moduleInfoCompactBtn');
  var sidebarNav = document.getElementById('sidebarNav');
  var sidebarEl = document.getElementById('sidebar');
  var sidebarResize = document.getElementById('sidebarResize');
  var listPanelEl = document.getElementById('listPanel');
  var listResize = document.getElementById('listResize');
  var searchInput = document.getElementById('searchInput');
  var searchShortcut = document.getElementById('searchShortcut');
  var listTitle = document.getElementById('listTitle');
  var listCount = document.getElementById('listCount');
  var listItems = document.getElementById('listItems');
  var detailPanel = document.getElementById('detailPanel');
  var detailEmpty = detailPanel.querySelector('.detail-empty');
  var detailContent = document.getElementById('detailContent');
  var navBackBtn = document.getElementById('navBack');
  var navForwardBtn = document.getElementById('navForward');
  var titlebarBrand = document.getElementById('titlebarBrand');
  var sidebarCompactBtn = document.getElementById('sidebarCompactBtn');
  var titlebarSearch = document.querySelector('.titlebar-search');
  var aboutBtn = document.getElementById('aboutBtn');
  var settingsBtnEl = document.getElementById('settingsBtn');
  var exportAIBtn = document.getElementById('exportAIBtn');

  function showModuleUI(show) {
    var display = show ? '' : 'none';
    sidebarEl.style.display = display;
    sidebarResize.style.display = display;
    listPanelEl.style.display = display;
    listResize.style.display = display;
    sidebarNav.style.display = display;
    if (titlebarBrand) {
      if (show) titlebarBrand.classList.add('hidden');
      else titlebarBrand.classList.remove('hidden');
    }
    if (sidebarCompactBtn) {
      sidebarCompactBtn.style.display = show ? '' : 'none';
    }
    if (titlebarSearch) {
      titlebarSearch.style.display = show ? '' : 'none';
    }
    if (exportAIBtn) {
      exportAIBtn.style.display = show ? '' : 'none';
    }
    if (aboutBtn) {
      aboutBtn.style.display = show ? 'none' : '';
    }
    if (settingsBtnEl) {
      settingsBtnEl.style.display = show ? 'none' : '';
    }
  }

  function invoke(command, data) {
    if (typeof jade === 'undefined' || !jade.invoke) {
      return Promise.reject(new Error('JadeView API 不可用'));
    }
    return jade.invoke(command, data || '', { timeout: 20000 });
  }

  function resetState() {
    // 清除旧数据的搜索缓存，释放内存
    Object.keys(categories).forEach(function (key) {
      (state[key] || []).forEach(function (item) { delete item._searchText; });
    });
    state.moduleInfo = null;
    state.subroutines = [];
    state.dllCommands = [];
    state.classes = [];
    state.dataTypes = [];
    state.globalVars = [];
    state.constants = [];
    state.activeItem = null;
    state.searchQuery = '';
    state.loadedCategories = {};
    // 重置类型查找 Map
    classNameMap = null;
    dataTypeNameMap = null;
    typeMapsDirty = false;
    currentPositions = null;
    searchInput.value = '';
    Object.keys(categories).forEach(updateCount);
    updateNavLoadingState();
    // 重置导航历史，避免返回到旧页面
    navHistory = [];
    navIndex = -1;
    updateNavButtons();
    document.title = 'Jade EC查看器';
  }

  function checkAllLoaded() {
    // No longer needed - data loaded at once from open_module
  }

  function updateNavLoadingState() {
    Object.keys(categories).forEach(function (key) {
      var btn = navCountEls[key];
      if (!btn) return;
      if (state.loadedCategories[key]) {
        btn.classList.remove('nav-loading');
      } else if (state.moduleInfo) {
        btn.classList.add('nav-loading');
      } else {
        btn.classList.remove('nav-loading');
      }
    });
  }

  // --- Safe JSON Parse ---
  function safeJsonParse(str) {
    if (typeof str !== 'string') return str;
    var trimmed = str.trim();
    if (!trimmed) return [];
    try { return JSON.parse(trimmed); } catch (e) {}

    // 截断修复：数据被广播缓冲区截断时，找到最后一个完整对象
    var lastObj = trimmed.lastIndexOf('},');
    if (lastObj === -1) lastObj = trimmed.lastIndexOf('}');
    if (lastObj > 0) {
      var partial = trimmed.substring(0, lastObj + 1) + ']';
      try {
        var result = JSON.parse(partial);
        console.warn('JSON 截断修复: 原始 ' + str.length + ' 字符, 修复后取 ' + result.length + ' 项');
        return result;
      } catch (e2) {}
    }

    // 清洗后重试
    var cleanStr = str
      .replace(/[\x00-\x1f]/g, function (ch) {
        var esc = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
        return esc[ch] || '';
      })
      .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')
      .replace(/,\s*([}\]])/g, '$1');

    try { return JSON.parse(cleanStr); } catch (e) {}

    throw new Error('JSON 解析失败');
  }

  // Broadcast listeners removed - data now comes from open_module response

  function getRecentModules() {
    try {
      return JSON.parse(localStorage.getItem('recentModules') || '[]');
    } catch (e) { return []; }
  }

  function addRecentModule(filePath, name) {
    var list = getRecentModules().filter(function (m) { return m.path !== filePath; });
    list.unshift({ path: filePath, name: name, time: Date.now() });
    if (list.length > 10) list = list.slice(0, 10);
    localStorage.setItem('recentModules', JSON.stringify(list));
  }

  function removeRecentModule(filePath) {
    var list = getRecentModules().filter(function (m) { return m.path !== filePath; });
    localStorage.setItem('recentModules', JSON.stringify(list));
  }

  function renderWelcome() {
    var recent = getRecentModules();
    var html = '<div class="welcome">';

    html += '<div class="welcome-hero">' +
      '<img class="welcome-icon" src="logo.svg" alt="" width="48" height="48">' +
      '<h2 class="welcome-title">Jade EC查看器</h2>' +
      '<p class="welcome-desc">拖拽文件 打开 .ec 模块文件以浏览内容</p>' +
      '<button class="welcome-open-btn" id="welcomeOpenBtn">打开模块</button>' +
      '</div>';

    if (recent.length > 0) {
      html += '<div class="welcome-recent">' +
        '<div class="welcome-recent-title">最近打开</div>' +
        '<div class="welcome-recent-list">';

      recent.forEach(function (m) {
        html += '<div class="recent-item" data-path="' + escapeHtml(m.path) + '">' +
          '<svg class="recent-item-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">' +
          '<rect x="2" y="1" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.2"/>' +
          '<path d="M5 5h6M5 8h4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>' +
          '</svg>' +
          '<div class="recent-item-info">' +
          '<div class="recent-item-name">' + escapeHtml(m.name) + '</div>' +
          '<div class="recent-item-path">' + escapeHtml(m.path) + '</div>' +
          '</div>' +
          '<button class="recent-item-remove" data-remove="' + escapeHtml(m.path) + '" title="移除">&times;</button>' +
          '</div>';
      });

      html += '</div></div>';
    }

    html += '</div>';
    detailEmpty.innerHTML = html;
    detailEmpty.style.display = '';
    detailContent.style.display = 'none';

    // 绑定事件
    var openBtn = document.getElementById('welcomeOpenBtn');
    if (openBtn) openBtn.addEventListener('click', openFile);

    detailEmpty.querySelectorAll('.recent-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.recent-item-remove')) return;
        var path = el.dataset.path;
        if (path) openModuleByPath(path);
      });
    });

    detailEmpty.querySelectorAll('.recent-item-remove').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        removeRecentModule(el.dataset.remove);
        renderWelcome();
      });
    });
  }

  function tryParseJson(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  function needsPassword(info) {
    if (!info) return false;
    if (info.needPassword === true || info.needPassword === 'true') return true;
    if (info.error === 'need_password' || info.error === 'password_required' || info.error === 'invalid_password') return true;
    if (info.passwordRequired === true || info.passwordRequired === 'true') return true;
    return false;
  }

  // --- Rust Parser JSON Mapping ---
  function mapModuleInfo(data) {
    if (!data) return null;
    var info = data.module_info || {};
    return {
      name: info.name || '',
      remark: info.description || '',
      author: info.author || '',
      version: (info.major_version || info.minor_version) ? (info.major_version || 0) + '.' + (info.minor_version || 0) : '',
      email: info.email || '',
      homePage: info.homepage || '',
      address: info.address || '',
      phone: info.phone || '',
      fax: info.fax || '',
      zipCode: info.zip_code || '',
      other: info.other || '',
      supports: (info.libraries || []).map(function(lib) {
        return {
          cnName: lib.name || '',
          fileName: lib.file_name || '',
          identifier: lib.guid || '',
          version: (lib.major_version || 0) + '.' + (lib.minor_version || 0)
        };
      })
    };
  }

  function mapSubroutines(data) {
    var srcSubs = data.sub_routines || [];
    var subroutines = new Array(srcSubs.length);
    for (var si = 0; si < srcSubs.length; si++) {
      var sr = srcSubs[si];
      var srcParams = sr.parameters || [];
      var params = new Array(srcParams.length);
      for (var pi = 0; pi < srcParams.length; pi++) {
        var p = srcParams[pi];
        params[pi] = {
          name: p.name || '',
          remark: p.description || '',
          dataType: p.data_type || '',
          byRef: p.is_by_ref || false,
          nullable: p.is_optional || false,
          isArray: p.is_array || false,
          arrayDims: p.array_dims || []
        };
      }
      subroutines[si] = {
        name: sr.name || '',
        remark: sr.description || '',
        returnType: sr.return_type || '',
        params: params
      };
    }
    return subroutines;
  }

  function mapDllCommands(data) {
    var srcDlls = data.dll_commands || [];
    var dllCommands = new Array(srcDlls.length);
    for (var di = 0; di < srcDlls.length; di++) {
      var cmd = srcDlls[di];
      var srcCmdParams = cmd.parameters || [];
      var cmdParams = new Array(srcCmdParams.length);
      for (var ci = 0; ci < srcCmdParams.length; ci++) {
        var cp = srcCmdParams[ci];
        cmdParams[ci] = {
          name: cp.name || '',
          remark: cp.description || '',
          dataType: cp.data_type || '',
          byRef: cp.is_by_ref || false,
          nullable: cp.is_optional || false,
          isArray: cp.is_array || false,
          arrayDims: cp.array_dims || []
        };
      }
      dllCommands[di] = {
        name: cmd.name || '',
        remark: cmd.description || '',
        returnType: cmd.return_type || '',
        fileName: cmd.dll_name || '',
        cmdName: cmd.function_name || '',
        params: cmdParams
      };
    }
    return dllCommands;
  }

  function mapClasses(data) {
    var srcClasses = data.classes || [];
    var classes = new Array(srcClasses.length);
    for (var cli = 0; cli < srcClasses.length; cli++) {
      var cls = srcClasses[cli];
      var srcMethods = cls.sub_routines || [];
      var methods = new Array(srcMethods.length);
      for (var mi = 0; mi < srcMethods.length; mi++) {
        var msr = srcMethods[mi];
        var srcMParams = msr.parameters || [];
        var mParams = new Array(srcMParams.length);
        for (var mpi = 0; mpi < srcMParams.length; mpi++) {
          var mp = srcMParams[mpi];
          mParams[mpi] = {
            name: mp.name || '',
            remark: mp.description || '',
            dataType: mp.data_type || '',
            byRef: mp.is_by_ref || false,
            nullable: mp.is_optional || false,
            isArray: mp.is_array || false,
            arrayDims: mp.array_dims || []
          };
        }
        methods[mi] = {
          name: msr.name || '',
          remark: msr.description || '',
          returnType: msr.return_type || '',
          params: mParams
        };
      }
      classes[cli] = {
        name: cls.name || '',
        remark: cls.description || '',
        baseClass: '',
        methods: methods
      };
    }
    return classes;
  }

  function mapDataTypes(data) {
    var srcDts = data.custom_types || [];
    var dataTypes = new Array(srcDts.length);
    for (var dti = 0; dti < srcDts.length; dti++) {
      var dt = srcDts[dti];
      var srcMembers = dt.members || [];
      var members = new Array(srcMembers.length);
      for (var mei = 0; mei < srcMembers.length; mei++) {
        var m = srcMembers[mei];
        members[mei] = {
          name: m.name || '',
          remark: m.description || '',
          dataType: m.data_type || '',
          isArray: m.is_array || false,
          arrayDims: m.array_dims || [],
          byRef: m.is_by_ref || false
        };
      }
      dataTypes[dti] = {
        name: dt.name || '',
        remark: dt.description || '',
        members: members
      };
    }
    return dataTypes;
  }

  function mapGlobalVars(data) {
    var srcGvs = data.global_vars || [];
    var globalVars = new Array(srcGvs.length);
    for (var gi = 0; gi < srcGvs.length; gi++) {
      var gv = srcGvs[gi];
      globalVars[gi] = {
        name: gv.name || '',
        remark: gv.description || '',
        dataType: gv.data_type || '',
        isArray: gv.is_array || false,
        arrayDims: gv.array_dims || []
      };
    }
    return globalVars;
  }

  function mapConstants(data) {
    var srcConsts = data.constants || [];
    var constants = new Array(srcConsts.length);
    for (var coi = 0; coi < srcConsts.length; coi++) {
      var c = srcConsts[coi];
      constants[coi] = {
        name: c.name || '',
        remark: c.description || '',
        dataType: c.data_type || '',
        type: c.page_type || 1,
        value: c.value || ''
      };
    }
    return constants;
  }

  function mapSubRoutine(sr) {
    return {
      name: sr.name || '',
      remark: sr.description || '',
      returnType: sr.return_type || '',
      params: (sr.parameters || []).map(mapParam)
    };
  }

  function mapParam(p) {
    return {
      name: p.name || '',
      remark: p.description || '',
      dataType: p.data_type || '',
      byRef: p.is_by_ref || false,
      nullable: p.is_optional || false,
      isArray: p.is_array || false
    };
  }

  function mapMember(m) {
    return {
      name: m.name || '',
      remark: m.description || '',
      dataType: m.data_type || '',
      isArray: m.is_array || false,
      arrayDims: m.array_dims || [],
      byRef: m.is_by_ref || false
    };
  }

  function parseModuleResponse(value) {
    if (typeof value !== 'string') return value;
    return tryParseJson(value) || {};
  }

  function parseModuleError(err) {
    if (typeof err === 'string') return tryParseJson(err);
    if (!err || typeof err !== 'object') return null;
    if (typeof err.message === 'string') return tryParseJson(err.message) || err;
    return err;
  }

  function startModuleLoading(filePath) {
    state.loading = true;
    resetState();
    moduleName.textContent = '加载中...';
    moduleVersion.textContent = '';
    moduleAuthor.textContent = '';
    showLoadingOverlay();
    renderList();
    renderDetail(null);
  }

  function applyModuleResult(info, filePath) {
    if (!info || !info.name) {
      moduleName.textContent = '打开失败';
      removeRecentModule(filePath);
      renderWelcome();
      state.loading = false;
      hideLoadingOverlay();
      return false;
    }
    state.moduleInfo = info;
    state.moduleInfo.path = filePath;
    addRecentModule(filePath, info.name);
    showModuleUI(true);
    renderModuleInfo();
    renderDetail(null);
    return true;
  }

  function requestModulePassword(filePath, info) {
    state.loading = false;
    hideLoadingOverlay();

    var isWrongPassword = info.error === 'invalid_password';
    var msg = info.message || '此模块已加密，请输入密码以打开。';

    return showPasswordDialog(msg, filePath, isWrongPassword).then(function (result) {
      if (result === null) {
        moduleName.textContent = '';
        moduleVersion.textContent = '';
        moduleAuthor.textContent = '';
        renderWelcome();
        return;
      }
      return openModuleByPath(filePath, result.password, result.remember);
    });
  }

  function openModuleByPath(filePath, password, remember) {
    if (state.loading) return Promise.resolve();
    startModuleLoading(filePath);

    var payload = JSON.stringify({
      path: filePath,
      password: password || '',
      remember_password: remember || false
    });

    return invoke('open_module', payload).then(function (result) {
      var rawData = parseModuleResponse(result);

      // Check for error or password needed
      if (rawData.error) {
        var errInfo = { error: rawData.error, message: rawData.message };
        if (needsPassword(errInfo)) {
          return requestModulePassword(filePath, errInfo);
        }
        moduleName.textContent = '加载失败';
        moduleVersion.textContent = rawData.error;
        removeRecentModule(filePath);
        renderWelcome();
        state.loading = false;
        hideLoadingOverlay();
        return;
      }

      if (needsPassword(rawData)) {
        return requestModulePassword(filePath, rawData);
      }

      // Phase 1: Parse module info only, show UI immediately
      var moduleInfo = mapModuleInfo(rawData);
      if (!moduleInfo || !moduleInfo.name) {
        moduleName.textContent = '打开失败';
        removeRecentModule(filePath);
        renderWelcome();
        state.loading = false;
        hideLoadingOverlay();
        return;
      }

      state.moduleInfo = moduleInfo;
      state.moduleInfo.path = filePath;
      addRecentModule(filePath, moduleInfo.name);

      // Mark all categories as loading
      var catKeys = Object.keys(categories);
      catKeys.forEach(function (key) {
        var navBtn = document.querySelector('.nav-item[data-category="' + key + '"]');
        if (navBtn) navBtn.classList.add('nav-loading');
      });

      // Show UI immediately with module info
      showModuleUI(true);
      renderModuleInfo();
      state.loading = false;
      hideLoadingOverlay();
      updateNavLoadingState();

      // Phase 2: Parse categories asynchronously, yielding between each
      var catIndex = 0;
      var catFns = {
        subroutines: mapSubroutines,
        dllCommands: mapDllCommands,
        classes: mapClasses,
        dataTypes: mapDataTypes,
        globalVars: mapGlobalVars,
        constants: mapConstants
      };

      function parseNextCategory() {
        if (catIndex >= catKeys.length) {
          // All done
          typeMapsDirty = true;
          renderList();
          renderDetail(null);
          updateNavButtons();
          return;
        }

        var key = catKeys[catIndex++];
        var fn = catFns[key];
        if (fn) {
          state[key] = fn(rawData);
          state.loadedCategories[key] = true;
          updateCount(key);
        }

        // Remove loading animation
        var navBtn = document.querySelector('.nav-item[data-category="' + key + '"]');
        if (navBtn) navBtn.classList.remove('nav-loading');

        // If this is the active category, re-render the list
        if (state.activeCategory === key) {
          renderList();
        }

        // Yield to browser so it can paint the loading state change
        setTimeout(parseNextCategory, 0);
      }

      // Use setTimeout to ensure the loading overlay fade-out and nav-loading appear first
      setTimeout(parseNextCategory, 50);
    }).catch(function (err) {
      var errInfo = parseModuleError(err);
      if (needsPassword(errInfo)) {
        return requestModulePassword(filePath, errInfo);
      }

      console.error('加载模块失败:', err);
      moduleName.textContent = '加载失败';
      moduleVersion.textContent = (err && err.message) || String(err) || '';
      removeRecentModule(filePath);
      renderWelcome();
      state.loading = false;
      hideLoadingOverlay();
    });
  }

  function openFile() {
    if (state.loading) return;
    if (typeof jade === 'undefined' || !jade.dialog) {
      return;
    }
    jade.dialog.showOpenDialog({
      title: '打开易语言模块',
      properties: ['openFile'],
      filters: [
        { name: '易语言模块', extensions: ['ec'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }).then(function (result) {
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;
      openModuleByPath(result.filePaths[0]);
    });
  }

  function renderModuleInfo() {
    var info = state.moduleInfo;
    if (!info) return;
    moduleName.textContent = info.name || '未知模块';
    var ver = info.version;
    moduleVersion.textContent = ver ? 'v' + ver : '';
    moduleAuthor.textContent = info.author ? '作者：' + info.author : '';
    if (moduleInfoCompactBtn) {
      moduleInfoCompactBtn.setAttribute('title', '查看模块：' + (info.name || '未知模块'));
    }
    document.title = 'Jade EC查看器 - ' + (info.name || '未知模块');
  }

  function renderModuleInfoDetail() {
    var info = state.moduleInfo;
    if (!info) return;

    detailEmpty.style.display = 'none';
    detailContent.style.display = '';

    var html = '<div class="detail-header">' +
      '<div class="detail-title-row">' +
      '<div class="detail-title">' + escapeHtml(info.name || '') + '</div>' +
      '<button class="copy-title-btn" data-copy-text="' + escapeHtml(info.name || '') + '" title="复制标题">' +
      ICON_COPY + '</button>' +
      '</div>' +
      '<div class="detail-subtitle">模块信息</div>' +
      '</div>';

    html += '<div class="detail-section">' +
      '<div class="detail-section-title">基本信息</div>' +
      '<div class="detail-props">' +
      renderProp('版本号', info.version || '-') +
      renderProp('作者', info.author || '-') +
      renderProp('备注', info.remark || '-') +
      renderProp('电子信箱', info.email || '-') +
      renderProp('主页', info.homePage || '-') +
      renderProp('联系地址', info.address || '-') +
      renderProp('电话', info.phone || '-') +
      renderProp('传真', info.fax || '-') +
      renderProp('邮政编码', info.zipCode || '-') +
      renderProp('其他', info.other || '-') +
      '</div></div>';

    var libs = info.supports || [];
    if (libs.length > 0) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">支持库 (' + libs.length + ')</div>' +
        '<table class="detail-table"><colgroup>' +
        '<col><col><col style="width:40%"><col style="width:60px">' +
        '</colgroup><thead><tr>' +
        '<th>中文名</th><th>文件名</th><th>标识符</th><th>版本</th>' +
        '</tr></thead><tbody>';
      libs.forEach(function (lib) {
        html += '<tr>' +
          '<td class="nowrap">' + escapeHtml(lib.cnName || '-') + '</td>' +
          '<td class="param-type">' + escapeHtml(lib.fileName || '-') + '</td>' +
          '<td class="param-type">' + escapeHtml(lib.identifier || '-') + '</td>' +
          '<td>' + escapeHtml(lib.version || '-') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    detailContent.innerHTML = html;
  }

  function updateCount(key) {
    var el = document.getElementById('count' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) el.textContent = state[key].length;
  }

  var searchModes = {
    all: { prefix: '/all', label: '全部', desc: '搜索所有字段' },
    name: { prefix: '/name', label: '名称', desc: '搜索名称' },
    type: { prefix: '/type', label: '类型', desc: '搜索数据类型/返回类型' },
    remark: { prefix: '/remark', label: '备注', desc: '搜索备注' },
    method: { prefix: '/method', label: '方法', desc: '搜索类中的方法名' },
    param: { prefix: '/param', label: '参数', desc: '搜索参数名' }
  };

  function parseSearchQuery(raw) {
    var result = { mode: appSettings.defaultSearch || 'all', query: raw };
    var match = raw.match(/^\/(\w+)\s+(.+)$/);
    if (match) {
      var mode = match[1].toLowerCase();
      if (searchModes[mode]) {
        result.mode = mode;
        result.query = match[2];
      }
    }
    return result;
  }

  function searchItemText(item, category, mode) {
    if (item._searchText && item._searchText[mode]) {
      return item._searchText[mode];
    }
    if (!item._searchText) item._searchText = {};
    var text = searchItemTextCompute(item, category, mode);
    item._searchText[mode] = text;
    return text;
  }

  function showLoadingOverlay() {
    var existing = document.getElementById('loadingOverlay');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="loading-spinner"></div><div class="loading-text">加载中...</div>';
    document.querySelector('.content-split').appendChild(overlay);
  }

  function hideLoadingOverlay() {
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('loading-fade-out');
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 200);
    }
  }

  function renderList() {
    if (state.activeCategory === 'search' && state.searchQuery) {
      var parsed = parseSearchQuery(state.searchQuery);
      var q = parsed.query.toLowerCase();
      var terms = q.split(/\s+/).filter(function (t) { return t.length > 0; });
      var modeLabel = parsed.mode !== 'all' ? ' [' + searchModes[parsed.mode].label + ']' : '';
      listTitle.textContent = '搜索: ' + parsed.query + modeLabel;

      // 全局搜索所有分类
      var results = [];
      Object.keys(categories).forEach(function (catKey) {
        var items = state[catKey] || [];
        items.forEach(function (item, idx) {
          var text = searchItemText(item, catKey, parsed.mode);
          var match = terms.every(function (term) { return text.indexOf(term) !== -1; });
          if (match) {
            results.push({ category: catKey, item: item, index: idx });
          }
        });
      });

      listCount.textContent = results.length + ' 项';

      if (results.length === 0) {
        listItems.innerHTML = '<div class="list-empty"><p>无匹配结果</p></div>';
        return;
      }

      listItems.innerHTML = results.map(function (r, ri) {
        var name = getItemName(r.item);
        var desc = getItemDesc(r.item);
        var isActive = state.activeCategory === r.category && state.activeItem === r.index;
        var displayName = highlightText(name, parsed.query);
        var displayDesc = highlightText(desc, parsed.query);
        var catLabel = categories[r.category].title;

        return '<div class="list-item' + (isActive ? ' active' : '') + '" data-search-category="' + r.category + '" data-index="' + r.index + '">' +
          '<div class="item-info">' +
          '<div class="item-name">' + displayName + '</div>' +
          (appSettings.showRemark && desc ? '<div class="item-sub">' + displayDesc + '</div>' : '') +
          '</div>' +
          '<span class="item-type">' + escapeHtml(catLabel) + '</span></div>';
      }).join('');
      return;
    }

    // 搜索页面但无搜索内容
    if (state.activeCategory === 'search') {
      listTitle.textContent = '搜索';
      listCount.textContent = '';
      listItems.innerHTML = '<div class="list-empty"><p>按下 <kbd class="about-kbd">/</kbd> 输入关键词开始搜索</p></div>';
      return;
    }

    var config = categories[state.activeCategory];
    if (!config) return;

    listTitle.textContent = config.title;

    var items = state[state.activeCategory] || [];

    listCount.textContent = items.length + ' 项';

    if (items.length === 0) {
      listItems.innerHTML = '<div class="list-empty"><p>暂无数据</p></div>';
      return;
    }

    // 虚拟列表渲染：超过阈值时启用虚拟滚动（类分类始终使用树形列表）
    var VIRTUAL_THRESHOLD = 50;
    var useClassTree = state.activeCategory === 'classes';
    var useConstTree = state.activeCategory === 'constants';
    // 切换到非虚拟列表时，移除旧的 scroll 监听器
    if (items.length <= VIRTUAL_THRESHOLD || state.activeCategory === 'search' || useClassTree || useConstTree) {
      if (listItems._virtualScrollHandler) {
        listItems.removeEventListener('scroll', listItems._virtualScrollHandler);
        listItems._virtualScrollHandler = null;
      }
      currentPositions = null;
    }
    if (useClassTree) {
      renderClassTreeList(items);
    } else if (useConstTree) {
      renderConstantTreeList(items);
    } else if (items.length > VIRTUAL_THRESHOLD) {
      renderVirtualList(items, config);
    } else {
      listItems.innerHTML = items.map(function (item, index) {
        var name = getItemName(item);
        var desc = getItemDesc(item);
        var isActive = state.activeItem === index;

        return '<div class="list-item' + (isActive ? ' active' : '') + '" data-index="' + index + '">' +
          '<div class="item-info">' +
          '<div class="item-name">' + escapeHtml(name) + '</div>' +
          (appSettings.showRemark && desc ? '<div class="item-sub">' + escapeHtml(desc) + '</div>' : '') +
          '</div></div>';
      }).join('');
    }
  }

  function renderClassTreeList(items) {
    var html = '';
    items.forEach(function (item, index) {
      var isActive = state.activeItem === index;
      var methods = item.methods || [];
      html += '<div class="tree-group' + (isActive ? ' tree-group--active' : '') + '">';
      html += '<div class="tree-parent list-item' + (isActive ? ' active' : '') + '" data-index="' + index + '">' +
        '<svg class="tree-arrow' + (isActive ? ' tree-arrow--open' : '') + '" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<div class="item-info">' +
        '<div class="item-name">' + escapeHtml(item.name || '') + '</div>' +
        (appSettings.showRemark && item.remark ? '<div class="item-sub">' + escapeHtml(item.remark) + '</div>' : '') +
        '</div>' +
        '<span class="nav-count">' + methods.length + '</span>' +
        '</div>';
      html += '<div class="tree-children"' + (isActive ? '' : ' style="display:none"') + '>';
      methods.forEach(function (m, mi) {
        html += '<div class="tree-child" data-class-index="' + index + '" data-method-index="' + mi + '" data-method-name="' + escapeHtml(String(m.name || '')) + '">' +
          '<div class="item-info">' +
          '<div class="item-name">' + escapeHtml(String(m.name || '')) + '</div>' +
          (m.returnType ? '<span class="item-type">' + escapeHtml(String(m.returnType)) + '</span>' : '') +
          '</div></div>';
      });
      if (methods.length === 0) {
        html += '<div class="tree-child tree-child--empty"><div class="item-info"><div class="item-name" style="color:var(--text-tertiary)">无方法</div></div></div>';
      }
      html += '</div></div>';
    });
    listItems.innerHTML = html;
  }

  function renderConstantTreeList(items) {
    var CONST_TYPE_MAP = { 1: '普通常量', 2: '图片', 3: '声音' };
    // 按常量类型分组
    var groups = {};
    items.forEach(function (item, index) {
      var typeKey = item.type !== undefined ? item.type : 1;
      if (!groups[typeKey]) groups[typeKey] = [];
      groups[typeKey].push({ item: item, index: index });
    });

    var sortedTypes = Object.keys(groups).sort(function (a, b) { return Number(a) - Number(b); });

    var html = '';
    sortedTypes.forEach(function (typeKey) {
      var typeName = CONST_TYPE_MAP[typeKey] || ('类型' + typeKey);
      var children = groups[typeKey];
      var isActive = children.some(function (c) { return state.activeItem === c.index; });

      html += '<div class="tree-group' + (isActive ? ' tree-group--active' : '') + '">';
      html += '<div class="tree-parent list-item' + (isActive ? ' active' : '') + '" data-const-type="' + typeKey + '">' +
        '<svg class="tree-arrow' + (isActive ? ' tree-arrow--open' : '') + '" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<div class="item-info">' +
        '<div class="item-name">' + escapeHtml(typeName) + '</div>' +
        '</div>' +
        '<span class="nav-count">' + children.length + '</span>' +
        '</div>';
      html += '<div class="tree-children"' + (isActive ? '' : ' style="display:none"') + '>';
      children.forEach(function (c) {
        var itemActive = state.activeItem === c.index;
        html += '<div class="tree-child' + (itemActive ? ' active' : '') + '" data-const-index="' + c.index + '">' +
          '<div class="item-info">' +
          '<div class="item-name">' + escapeHtml(String(c.item.name || '')) + '</div>' +
          '</div></div>';
      });
      html += '</div></div>';
    });
    listItems.innerHTML = html;
  }

  // --- Virtual List ---
  var ITEM_HEIGHT_COMPACT = 36;  // 无备注时的高度
  var ITEM_HEIGHT_REMARK = 54;   // 有备注时的高度
  var BUFFER = 8;                // 上下缓冲项数
  var currentPositions = null;   // 缓存当前虚拟列表的 positions 数组

  function getItemHeight(item) {
    return (appSettings.showRemark && getItemDesc(item)) ? ITEM_HEIGHT_REMARK : ITEM_HEIGHT_COMPACT;
  }

  function buildItemPositions(items) {
    var positions = new Float64Array(items.length + 1);
    for (var i = 0; i < items.length; i++) {
      positions[i + 1] = positions[i] + getItemHeight(items[i]);
    }
    return positions;
  }

  function findStartIndex(positions, scrollTop) {
    var lo = 0, hi = positions.length - 2;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (positions[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function renderVirtualList(items, config) {
    // 清空并设置虚拟容器
    listItems.innerHTML = '';
    var positions = buildItemPositions(items);
    currentPositions = positions;
    var totalHeight = positions[items.length];

    var spacer = document.createElement('div');
    spacer.className = 'virtual-spacer';
    spacer.style.height = totalHeight + 'px';
    listItems.appendChild(spacer);

    var content = document.createElement('div');
    content.className = 'virtual-content';
    listItems.appendChild(content);

    var rafId = null;

    function updateVisibleItems() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = null;
        var scrollTop = listItems.scrollTop;
        var viewHeight = listItems.clientHeight;

        var startIdx = Math.max(0, findStartIndex(positions, scrollTop) - BUFFER);
        var endIdx = items.length;
        // 从 startIdx 向后找到超出视口底部的位置
        var bottom = scrollTop + viewHeight;
        for (var fi = startIdx + BUFFER; fi < items.length; fi++) {
          if (positions[fi] > bottom + BUFFER * ITEM_HEIGHT_COMPACT) {
            endIdx = fi + BUFFER;
            break;
          }
        }
        endIdx = Math.min(items.length, endIdx);

        content.style.transform = 'translateY(' + positions[startIdx] + 'px)';

        var html = '';
        for (var i = startIdx; i < endIdx; i++) {
          var item = items[i];
          var name = getItemName(item);
          var desc = getItemDesc(item);
          var isActive = state.activeItem === i;
          var h = getItemHeight(item);

          html += '<div class="list-item' + (isActive ? ' active' : '') + '" data-index="' + i + '">' +
            '<div class="item-info">' +
            '<div class="item-name">' + escapeHtml(name) + '</div>' +
            (appSettings.showRemark && desc ? '<div class="item-sub">' + escapeHtml(desc) + '</div>' : '') +
            '</div></div>';
        }
        content.innerHTML = html;
      });
    }

    // 移除旧监听器（如有）
    if (listItems._virtualScrollHandler) {
      listItems.removeEventListener('scroll', listItems._virtualScrollHandler);
    }
    listItems._virtualScrollHandler = updateVisibleItems;
    listItems.addEventListener('scroll', updateVisibleItems);

    updateVisibleItems();
  }

  function renderAboutPage() {
    detailContent.style.display = 'none';
    detailEmpty.style.display = '';
    var html = '<div class="about-page">' +
      '<div class="about-row">' +
      '<div class="about-card about-card--contributors">' +
      '<div class="about-contributors">' +
      '<div class="about-contributors-title">贡献者</div>' +
      '<div class="about-contributors-list">' +
      '<div class="about-contributor">' +
      '<img class="about-contributor-avatar" src="https://q1.qlogo.cn/g?b=qq&nk=1139040533&s=640" alt="面包" loading="lazy">' +
      '<div class="about-contributor-info"><div class="about-contributor-name">面包</div><div class="about-contributor-desc">提取解析模块源码的能力</div><div class="about-contributor-qq">QQ：<a href="http://wpa.qq.com/msgrd?v=3&uin=1139040533&site=qq&menu=yes" target="_blank" rel="noopener">1139040533</a></div></div>' +
      '</div>' +
      '<div class="about-contributor">' +
      '<img class="about-contributor-avatar" src="https://q1.qlogo.cn/g?b=qq&nk=350373380&s=640" alt="落雪有声" loading="lazy">' +
      '<div class="about-contributor-info"><div class="about-contributor-name">落雪有声</div><div class="about-contributor-desc">解析加密模块的能力</div><div class="about-contributor-qq">QQ：<a href="http://wpa.qq.com/msgrd?v=3&uin=350373380&site=qq&menu=yes" target="_blank" rel="noopener">350373380</a></div></div>' +
      '</div>' +
      '</div>' +
      '<div class="about-copyright">&copy; ' + new Date().getFullYear() + ' 所有贡献者 &mdash; 版权所有，保留一切权利</div>' +
      '</div>' +
      '</div>' +
      '<div class="about-card about-card--main">' +
      '<div class="about-hero">' +
      '<img class="about-logo" src="logo.svg" alt="" width="64" height="64">' +
      '<h2 class="about-title">Jade EC查看器</h2>' +
      '<p class="about-version">版本 ' + (document.getElementById('appVersion').textContent || '1.0.0') + '</p>' +
      '</div>' +
      '<div class="about-desc">' +
      '<p>一个基于 JadeView 的易语言模块查看器，用于浏览和分析 .ec 模块文件。</p>' +
      '</div>' +
      '<div class="about-card-divider"></div>' +
      '<div class="about-info">' +
      '<div class="about-info-row"><span class="about-info-label">框架</span><span class="about-info-value"><a href="https://jade.run/" target="_blank" rel="noopener">JadeView</a></span></div>' +
      '<div class="about-info-row"><span class="about-info-label">创始人</span><span class="about-info-value"><a href="https://github.com/tuyangJs/" target="_blank" rel="noopener">Tuyang</a></span></div>' +
      '<div class="about-info-row"><span class="about-info-label">项目仓库</span><span class="about-info-value"><a href="https://github.com/tuyangJs/Jade_ec" target="_blank" rel="noopener">GitHub</a></span></div>' +
      '<div class="about-info-row"><span class="about-info-label">版本更新</span><span class="about-info-value"><button class="about-check-update-btn" id="aboutCheckUpdate">检查更新</button></span></div>' +
      '<div class="about-info-row"><span class="about-info-label">交流QQ群</span><span class="about-info-value"><a href="https://qm.qq.com/q/6eV19IEyM8" target="_blank" rel="noopener">711848268</a></span></div>' +
      '<div class="about-info-row"><span class="about-info-label">字体</span><span class="about-info-value">Source Han Sans SC</span></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="about-card about-card--tips">' +
      '<div class="about-tips">' +
      '<div class="about-tips-title">使用说明</div>' +
      '<div class="about-tips-list">' +
      // 搜索相关
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">按 <kbd class="about-kbd">/</kbd> 快速聚焦搜索框，<kbd class="about-kbd">Esc</kbd> 退出搜索</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 7h6M5 9h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">搜索支持<kbd class="about-kbd">Space</kbd>分隔多个关键词，结果需同时匹配所有词</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="about-tip-text">输入 <kbd class="about-kbd">/</kbd> 开头可使用搜索指令，如 /子程序 名称</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 3L6 10l-3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="about-tip-text">搜索指令：/name 名称、/type 类型、/remark 备注、/param 参数</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3M8 10.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">搜索结果需双击才能跳转到对应分类，单击仅预览</div>' +
      '</div>' +
      // 导航相关
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 3H5a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V5a2 2 0 00-2-2z" stroke="currentColor" stroke-width="1.2"/><path d="M6 7h4M6 9h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">使用 <kbd class="about-kbd">Alt</kbd>+<kbd class="about-kbd">←</kbd> 和 <kbd class="about-kbd">Alt</kbd>+<kbd class="about-kbd">→</kbd> 前进后退导航历史</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="about-tip-text">点击详情中的类型链接可跳转到对应类型定义</div>' +
      '</div>' +
      // 复制相关
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">详情页标题旁的复制按钮可复制名称，表格内可复制参数声明和调用代码</div>' +
      '</div>' +
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 7h2M5 9h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">表格中的常量值、参数默认值等可点击复制</div>' +
      '</div>' +
      // 界面相关
      '<div class="about-tip-item">' +
      '<div class="about-tip-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>' +
      '<div class="about-tip-text">侧边栏和列表面板的分割线可拖拽调整宽度</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
    detailEmpty.innerHTML = html;

    // 检查更新按钮
    var checkBtn = document.getElementById('aboutCheckUpdate');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        checkBtn.textContent = '检查中...';
        checkBtn.disabled = true;
        if (typeof UpdateChecker !== 'undefined') {
          UpdateChecker.check(function () {
            // 无更新
            checkBtn.textContent = '已是最新';
            checkBtn.disabled = false;
            setTimeout(function () { checkBtn.textContent = '检查更新'; }, 3000);
          });
        } else {
          checkBtn.textContent = '检查更新';
          checkBtn.disabled = false;
        }
      });
    }
  }

  function renderSettingsPage() {
    detailContent.style.display = 'none';
    detailEmpty.style.display = '';
    var recentModules = getRecentModules();
    var recentDesc = recentModules.length > 0 ? ('当前 ' + recentModules.length + ' 条记录') : '当前无记录';
    var modeInfo = searchModes[appSettings.defaultSearch] || searchModes.all;
    var html = '<div class="settings-page">' +
      '<div class="settings-page-header">' +
      '<h2 class="settings-page-title">设置</h2>' +
      '</div>' +
      '<div class="settings-page-body">' +

      // 外观
      '<div class="settings-section">' +
      '<div class="settings-section-title">外观</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">主题模式</div><div class="settings-item-desc">选择界面配色主题</div></div>' +
      '<div class="settings-theme-group">' +
      '<button class="settings-theme-btn' + (currentTheme === 'System' ? ' active' : '') + '" data-theme="System">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>跟随系统</button>' +
      '<button class="settings-theme-btn' + (currentTheme === 'Light' ? ' active' : '') + '" data-theme="Light">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>浅色</button>' +
      '<button class="settings-theme-btn' + (currentTheme === 'Dark' ? ' active' : '') + '" data-theme="Dark">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5A6 6 0 016.5 2.5 6 6 0 1013.5 9.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>深色</button>' +
      '</div></div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">背景材料</div><div class="settings-item-desc">仅 Windows 11 支持云母和亚克力效果</div></div>' +
      '<div class="settings-material-group">' +
      '<button class="settings-material-btn' + (appSettings.backgroundMaterial === 'default' ? ' active' : '') + '" data-material="default">默认</button>' +
      '<button class="settings-material-btn' + (appSettings.backgroundMaterial === 'mica' ? ' active' : '') + '" data-material="mica"' + (isWindows11 ? '' : ' disabled title="需要 Windows 11"') + '>云母</button>' +
      '<button class="settings-material-btn' + (appSettings.backgroundMaterial === 'acrylic' ? ' active' : '') + '" data-material="acrylic"' + (isWindows11 ? '' : ' disabled title="需要 Windows 11"') + '>亚克力</button>' +
      '</div></div>' +
      '<div class="settings-item' + (appSettings.backgroundMaterial !== 'default' && isWindows11 ? '' : ' settings-item--disabled') + '" id="sp_detailOpacityItem">' +
      '<div class="settings-item-info"><div class="settings-item-label">详情页背景透明度</div><div class="settings-item-desc">调整详情面板的背景透明度，需启用背景材料</div></div>' +
      '<div class="settings-slider-group">' +
      '<input type="range" class="settings-slider" id="sp_detailOpacity" min="20" max="100" step="5" value="' + appSettings.detailOpacity + '"' + (appSettings.backgroundMaterial !== 'default' && isWindows11 ? '' : ' disabled') + '>' +
      '<span class="settings-slider-value" id="sp_detailOpacityValue">' + appSettings.detailOpacity + '%</span>' +
      '</div></div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">字体大小</div><div class="settings-item-desc">调整详情区域的文字大小</div></div>' +
      '<div class="settings-stepper">' +
      '<button class="stepper-btn" id="sp_fontSizeDec">−</button>' +
      '<span class="stepper-value" id="sp_fontSizeValue">' + appSettings.fontSize + '</span>' +
      '<button class="stepper-btn" id="sp_fontSizeInc">+</button>' +
      '</div></div>' +
      '</div>' +

      // 列表
      '<div class="settings-section">' +
      '<div class="settings-section-title">列表</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">显示备注预览</div><div class="settings-item-desc">在列表项下方显示备注内容</div></div>' +
      '<label class="settings-toggle"><input type="checkbox" id="sp_showRemark"' + (appSettings.showRemark ? ' checked' : '') + '><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
      '</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">列表分割线</div><div class="settings-item-desc">在列表项之间显示分割线</div></div>' +
      '<label class="settings-toggle"><input type="checkbox" id="sp_showListDivider"' + (appSettings.showListDivider ? ' checked' : '') + '><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
      '</div></div>' +

      // 详情
      '<div class="settings-section">' +
      '<div class="settings-section-title">详情</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">类型下划线</div><div class="settings-item-desc">在参数类型和返回类型下方显示下划线</div></div>' +
      '<label class="settings-toggle"><input type="checkbox" id="sp_showTypeUnderline"' + (appSettings.showTypeUnderline ? ' checked' : '') + '><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
      '</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">类型悬浮提示</div><div class="settings-item-desc">鼠标悬浮在类型上时显示详细信息</div></div>' +
      '<label class="settings-toggle"><input type="checkbox" id="sp_showTypeTooltip"' + (appSettings.showTypeTooltip ? ' checked' : '') + '><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
      '</div></div>' +

      // 搜索
      '<div class="settings-section">' +
      '<div class="settings-section-title">搜索</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">默认搜索方式</div><div class="settings-item-desc">打开搜索时的默认搜索范围</div></div>' +
      '<div class="settings-search-mode" id="sp_searchMode">' +
      '<button class="settings-search-mode-btn" id="sp_searchModeBtn">' +
      '<span class="cmd-prefix" id="sp_searchModePrefix">' + modeInfo.prefix + '</span>' +
      '<span class="cmd-desc" id="sp_searchModeDesc">' + modeInfo.desc + '</span>' +
      '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="settings-search-commands" id="sp_searchCommands" style="display:none;">' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'all' ? ' active' : '') + '" data-command="all"><span class="cmd-prefix">/all</span><span class="cmd-desc">搜索所有字段</span></div>' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'name' ? ' active' : '') + '" data-command="name"><span class="cmd-prefix">/name</span><span class="cmd-desc">搜索名称</span></div>' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'type' ? ' active' : '') + '" data-command="type"><span class="cmd-prefix">/type</span><span class="cmd-desc">搜索数据类型/返回类型</span></div>' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'remark' ? ' active' : '') + '" data-command="remark"><span class="cmd-prefix">/remark</span><span class="cmd-desc">搜索备注</span></div>' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'method' ? ' active' : '') + '" data-command="method"><span class="cmd-prefix">/method</span><span class="cmd-desc">搜索类中的方法名</span></div>' +
      '<div class="search-command-item' + (appSettings.defaultSearch === 'param' ? ' active' : '') + '" data-command="param"><span class="cmd-prefix">/param</span><span class="cmd-desc">搜索参数名</span></div>' +
      '</div></div></div></div>' +

      // 文件
      '<div class="settings-section">' +
      '<div class="settings-section-title">文件</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">文件修改时自动重载</div><div class="settings-item-desc">模块文件被外部修改时自动重新加载</div></div>' +
      '<label class="settings-toggle"><input type="checkbox" id="sp_autoReload"' + (appSettings.autoReload ? ' checked' : '') + '><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
      '</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">清除最近打开记录</div><div class="settings-item-desc" id="sp_recentCountDesc">' + recentDesc + '</div></div>' +
      '<button class="settings-action-btn" id="sp_clearRecentBtn">清除</button>' +
      '</div></div>' +

      // 默认查看器
      '<div class="settings-section">' +
      '<div class="settings-section-title">默认查看器</div>' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">易语言默认模块查看器</div><div class="settings-item-desc" id="sp_replaceViewerDesc">检查中...</div></div>' +
      '<button class="settings-action-btn" id="sp_replaceViewerBtn" disabled>检查中...</button>' +
      '</div></div>' +

      // 重置
      '<div class="settings-section">' +
      '<div class="settings-item">' +
      '<div class="settings-item-info"><div class="settings-item-label">重置所有设置</div><div class="settings-item-desc">恢复为默认设置</div></div>' +
      '<button class="settings-action-btn settings-action-btn--danger" id="sp_resetSettingsBtn">重置</button>' +
      '</div></div>' +

      '</div></div>';
    detailEmpty.innerHTML = html;
    bindSettingsPageEvents();
  }

  function renderDetail(item) {
    if (!item) {
      if (!state.moduleInfo) {
        renderWelcome();
      } else {
        detailEmpty.innerHTML = '<svg width="40" height="40" viewBox="0 0 16 16" fill="none" style="color:var(--text-secondary);opacity:0.3">' +
          '<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" />' +
          '<path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />' +
          '</svg><p>选择项目查看详情</p>';
        detailEmpty.style.display = '';
        detailContent.style.display = 'none';
      }
      return;
    }

    detailEmpty.style.display = 'none';
    detailContent.style.display = '';

    var name = getItemName(item);
    var desc = getItemDesc(item);

    var showCopyBtns = (state.activeCategory === 'subroutines' || state.activeCategory === 'dllCommands');
    var showClassBtn = (state.activeCategory === 'classes');
    var showDataTypeBtn = (state.activeCategory === 'dataTypes');
    var showGlobalDeclBtn = (state.activeCategory === 'globalVars');
    var showConstBtn = (state.activeCategory === 'constants');

    var html = '<div class="detail-header">' +
      '<div class="detail-title-row">' +
      '<div class="detail-title">' + escapeHtml(name) + '</div>' +
      '<button class="copy-title-btn" data-copy-text="' + escapeHtml(name) + '" title="复制标题">' +
      ICON_COPY + '</button>' +
      (showCopyBtns ?
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="params" title="复制参数声明">' +
        ICON_FOLDER +
        '<span>参数声明</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="call" title="复制调用代码">' +
        ICON_COPY_SM +
        '<span>复制</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" title="复制声明">' +
        ICON_FOLDER +
        '<span>复制声明</span></button>' +
        '</div>' : '') +
      (showClassBtn ?
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" title="复制签名">' +
        ICON_FOLDER +
        '<span>复制签名</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="varDecl" title="复制变量声明">' +
        ICON_FOLDER +
        '<span>变量声明</span></button>' +
        '</div>' : '') +
      (showDataTypeBtn ?
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" title="复制声明代码">' +
        ICON_FOLDER +
        '<span>声明代码</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="varDecl" title="复制变量声明">' +
        ICON_FOLDER +
        '<span>变量声明</span></button>' +
        '</div>' : '') +
      (showGlobalDeclBtn ?
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" title="复制声明代码">' +
        ICON_FOLDER +
        '<span>声明代码</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="varDecl" title="复制变量声明">' +
        ICON_FOLDER +
        '<span>复制变量</span></button>' +
        '</div>' : '') +
      (showConstBtn ?
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" title="复制声明代码">' +
        ICON_FOLDER +
        '<span>声明代码</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="constName" title="复制常量名">' +
        ICON_FOLDER +
        '<span>复制常量</span></button>' +
        '</div>' : '') +
      '</div>' +
      (desc ? '<div class="detail-subtitle">' + formatText(desc) + '</div>' : '') +
      '</div>';

    switch (state.activeCategory) {
      case 'subroutines': html += renderSubroutineDetail(item); break;
      case 'dllCommands': html += renderDllCommandDetail(item); break;
      case 'classes': html += renderClassDetail(item); break;
      case 'dataTypes': html += renderDataTypeDetail(item); break;
      case 'globalVars': html += renderGlobalVarDetail(item); break;
      case 'constants': html += renderConstantDetail(item); break;
    }

    detailContent.innerHTML = html;
    bindMethodRowToggle();
  }

  var methodRowToggleBound = false;
  function bindMethodRowToggle() {
    if (methodRowToggleBound) return;
    methodRowToggleBound = true;
    detailContent.addEventListener('click', function (e) {
      // 复制代码按钮
      var copyBtn = e.target.closest('.copy-code-btn');
      if (copyBtn) {
        var lang = copyBtn.dataset.lang;
        var type = copyBtn.dataset.type || 'call';
        var methodName = copyBtn.dataset.method || '';
        var className = copyBtn.dataset.class || '';
        var items = state[state.activeCategory] || [];
        var item = items[state.activeItem];
        if (item && window.CodeCopy) {
          var code = window.CodeCopy.generate(lang, state.activeCategory, item, type, methodName, className);
          if (code) {
            copyToClipboard(code, copyBtn);
          }
        }
        return;
      }
      // 行内复制按钮
      var inlineBtn = e.target.closest('.copy-inline-btn');
      if (inlineBtn) {
        var copyVal = inlineBtn.dataset.copy || '';
        copyToClipboard(copyVal, inlineBtn);
        return;
      }
      // 复制标题按钮
      var titleCopyBtn = e.target.closest('.copy-title-btn');
      if (titleCopyBtn) {
        var titleText = titleCopyBtn.dataset.copyText || '';
        copyTextToClipboard(titleText, titleCopyBtn);
        return;
      }
      // 类型链接跳转
      var typeLink = e.target.closest('.type-link');
      if (typeLink) {
        e.preventDefault();
        var cat = typeLink.dataset.targetCategory;
        var idx = parseInt(typeLink.dataset.targetIndex, 10);
        if (cat && !isNaN(idx)) navigateToType(cat, idx);
        return;
      }
      // 方法行展开/收起
      var row = e.target.closest('.method-row');
      if (!row) return;
      var idx = row.dataset.methodIdx;
      var paramsRow = detailContent.querySelector('.method-params-row[data-method-idx="' + idx + '"]');
      if (!paramsRow) return;
      var isHidden = paramsRow.style.display === 'none';
      paramsRow.style.display = isHidden ? '' : 'none';
    });
  }

  function copyToClipboard(text, btn) {
    var span = btn.querySelector('span');
    var originalText = span ? span.textContent : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showCopyFeedback(btn, span, originalText);
      });
    } else {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); showCopyFeedback(btn, span, originalText); }
      catch (e) {}
      document.body.removeChild(textarea);
    }
  }

  function showCopyFeedback(btn, span, originalText) {
    if (span) span.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(function () {
      if (span) span.textContent = originalText;
      btn.classList.remove('copied');
    }, 1500);
  }

  function copyTextToClipboard(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1500);
      });
    } else {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); btn.classList.add('copied'); setTimeout(function () { btn.classList.remove('copied'); }, 1500); }
      catch (e) {}
      document.body.removeChild(textarea);
    }
  }

  function renderMethodTable(nameLabel, name, returnType, remark, params, byRefLabel) {
    var hasNullable = params.some(function (p) { return p.nullable !== undefined; });
    var hasIsArray = params.some(function (p) { return p.isArray !== undefined; });
    var hasByRef = params.some(function (p) { return p.byRef !== undefined; });
    byRefLabel = byRefLabel || '参考';

    // colgroup: 名称auto 类型auto [参考46px] [可空46px] [数组46px] 备注=100%
    var colgroup = '<colgroup><col><col>' +
      (hasByRef ? '<col style="width:46px">' : '') +
      (hasNullable ? '<col style="width:46px">' : '') +
      (hasIsArray ? '<col style="width:46px">' : '') +
      '<col style="width:100%"></colgroup>';

    var remarkColspan = 1 + (hasByRef ? 1 : 0) + (hasNullable ? 1 : 0) + (hasIsArray ? 1 : 0);

    var html = '<div class="detail-section">' +
      '<table class="detail-table">' + colgroup + '<thead><tr>' +
      '<th>' + escapeHtml(nameLabel) + '</th><th>返回值类型</th>' +
      '<th colspan="' + remarkColspan + '">备注</th></tr></thead><tbody>';

    html += '<tr>' +
      '<td class="param-name">' + escapeHtml(String(name || '-')) + '</td>' +
      '<td class="param-type">' + renderType(returnType || '-') + '</td>' +
      '<td colspan="' + remarkColspan + '">' + escapeHtml(String(remark || '')) + '</td></tr>';

    if (params.length > 0) {
      var paramColgroup = '<colgroup><col><col>' +
        (hasByRef ? '<col style="width:40px">' : '') +
        (hasNullable ? '<col style="width:40px">' : '') +
        (hasIsArray ? '<col style="width:40px">' : '') +
        '<col style="width:100%"></colgroup>';

      html += '<tr class="sub-header-row"><th>参数名</th><th>类型</th>' +
        (hasByRef ? '<th>' + escapeHtml(byRefLabel) + '</th>' : '') +
        (hasNullable ? '<th>可空</th>' : '') +
        (hasIsArray ? '<th>数组</th>' : '') +
        '<th>备注</th></tr>';

      params.forEach(function (p) {
        html += '<tr>' +
          '<td class="param-name">' + escapeHtml(String(p.name || '-')) + '</td>' +
          '<td class="param-type">' + renderType(p.dataType || '-') + '</td>' +
          (hasByRef ? '<td class="check-cell">' + (p.byRef ? '✓' : '') + '</td>' : '') +
          (hasNullable ? '<td class="check-cell">' + (p.nullable ? '✓' : '') + '</td>' : '') +
          (hasIsArray ? '<td class="check-cell">' + (p.isArray ? '✓' : '') + '</td>' : '') +
          '<td>' + escapeHtml(String(p.remark || '')) + '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    return html;
  }

  function renderSubroutineDetail(item) {
    var html = renderMethodTable('子程序名', item.name, item.returnType, item.remark, item.params || [], '参考');

    var localVars = item.localVars || [];
    if (localVars.length > 0) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">局部变量 (' + localVars.length + ')</div>' +
        renderParamTable(localVars) + '</div>';
    }
    return html;
  }

  function renderDllCommandDetail(item) {
    var html = renderMethodTable('DLL 命令名', item.name, item.returnType, item.remark, item.params || [], '传址');

    if (item.fileName || item.cmdName) {
      var cmdNameVal = item.cmdName || '-';
      var cmdNameHtml = '<code>' + escapeHtml(cmdNameVal) + '</code>';
      if (item.cmdName) {
        var dllName = (item.fileName || '').replace(/\.(dll|DLL)$/i, '');
        cmdNameHtml += ' ' +
          '<a class="dll-doc-link" href="https://learn.microsoft.com/en-us/search/?terms=' + encodeURIComponent(item.cmdName) + '" target="_blank" rel="noopener" title="在 Microsoft Learn 中搜索">' +
          '<svg width="14" height="14" viewBox="0 0 25 25" fill="none"><path d="M11.5216 0.5H0V11.9067H11.5216V0.5Z" fill="#f25022"/><path d="M24.2418 0.5H12.7202V11.9067H24.2418V0.5Z" fill="#7fba00"/><path d="M11.5216 13.0933H0V24.5H11.5216V13.0933Z" fill="#00a4ef"/><path d="M24.2418 13.0933H12.7202V24.5H24.2418V13.0933Z" fill="#ffb900"/></svg>' +
          '</a>' +
          '<a class="dll-doc-link" href="https://www.pinvoke.net/default.aspx/' + encodeURIComponent(dllName) + '/' + encodeURIComponent(item.cmdName) + '" target="_blank" rel="noopener" title="在 pinvoke.net 中查看">' +
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M5 6h6M5 8h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
          '</a>';
      }
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">DLL 信息</div>' +
        '<div class="detail-props">' +
        renderProp('DLL 文件', item.fileName || '-') +
        '<div class="detail-prop-label">命令名</div>' +
        '<div class="detail-prop-value dll-cmd-value">' + cmdNameHtml + '</div>' +
        '</div></div>';
    }

    return html;
  }

  function renderClassDetail(item) {
    var html = '<div class="detail-section">' +
      '<div class="detail-section-title">类信息</div>' +
      '<div class="detail-props">' +
      renderProp('基类', item.baseClass ? renderType(item.baseClass) : '-', false, false, true) +
      renderProp('备注', item.remark || '-') +
      '</div></div>';

    var methods = item.methods || [];
    var className = item.name || '';
    methods.forEach(function (m, mi) {
      html += '<div class="method-section-header" id="method-' + mi + '">' +
        '<span class="method-section-name">' + escapeHtml(String(m.name || '')) + '</span>' +
        '<div class="detail-actions">' +
        '<button class="copy-code-btn" data-lang="e" data-type="params" data-method="' + escapeHtml(String(m.name || '')) + '" data-class="' + escapeHtml(String(className)) + '" title="复制参数声明">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
        '<path d="M2 4v9h12V6H8L6 4H2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span>参数声明</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="call" data-method="' + escapeHtml(String(m.name || '')) + '" data-class="' + escapeHtml(String(className)) + '" title="复制调用代码">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
        '<rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
        '</svg>' +
        '<span>复制</span></button>' +
        '<button class="copy-code-btn" data-lang="e" data-type="decl" data-method="' + escapeHtml(String(m.name || '')) + '" data-class="' + escapeHtml(String(className)) + '" title="复制签名">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
        '<path d="M2 4v9h12V6H8L6 4H2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span>复制签名</span></button>' +
        '</div>' +
        '</div>';
      html += renderMethodTable('子程序名', m.name, m.returnType, m.remark, m.params || [], '参考');
    });

    return html;
  }

  function renderDataTypeDetail(item) {
    var html = '<div class="detail-section">' +
      '<div class="detail-section-title">数据类型信息</div>' +
      '<div class="detail-props">' +
      renderProp('备注', item.remark || '-') +
      '</div></div>';

    var members = item.members || [];
    if (members.length > 0) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">成员 (' + members.length + ')</div>' +
        renderParamTable(members, true, false) + '</div>';
    }

    return html;
  }

  function renderGlobalVarDetail(item) {
    var html = '<div class="detail-section">' +
      '<table class="detail-table"><colgroup><col><col><col style="width:40px"><col style="width:100%"></colgroup>' +
      '<thead><tr><th>变量名</th><th>类型</th><th>数组</th><th>备注</th></tr></thead><tbody>';

    var arrayVal = item.isArray ? (item.arrayDims && item.arrayDims.length > 0 ? item.arrayDims.join(', ') : '✓') : '';

    html += '<tr>' +
      '<td class="param-name">' + escapeHtml(String(item.name || '-')) + '</td>' +
      '<td class="param-type">' + renderType(item.dataType || '-') + '</td>' +
      '<td class="check-cell">' + escapeHtml(arrayVal) + '</td>' +
      '<td>' + escapeHtml(String(item.remark || '')) + '</td></tr>';

    html += '</tbody></table></div>';

    if (item.value !== undefined) {
      html += '<div class="detail-section">' +
        '<div class="detail-section-title">默认值</div>' +
        '<div class="detail-code">' + escapeHtml(String(item.value || '')) + '</div></div>';
    }

    return html;
  }

  function renderConstantDetail(item) {
    var val = item.value !== undefined ? item.value : '-';
    var typeNum = item.type;
    var constTypeName = CONST_TYPE_MAP[typeNum] || '-';

    // 优先使用解析器提供的 data_type，否则根据值推断
    var dataType = item.dataType || '-';
    if (dataType === '-') {
      if (typeof val === 'boolean') {
        dataType = '逻辑型';
      } else if (typeof val === 'number') {
        if (Number.isInteger(val)) dataType = '整数型';
        else dataType = '小数型';
      } else if (typeof val === 'string') {
        dataType = '文本型';
      }
    }

    return '<div class="detail-section">' +
      '<div class="detail-section-title">常量信息</div>' +
      '<div class="detail-props">' +
      renderProp('常量类型', constTypeName) +
      renderProp('数据类型', dataType) +
      renderProp('值', val, true, true) +
      (item.isLongText !== undefined ? renderProp('长文本常量', item.isLongText ? '是' : '否') : '') +
      renderProp('备注', item.remark || '-') +
      '</div></div>';
  }

  function renderProp(label, value, isCode, copyable, isHtml) {
    var valueHtml;
    if (isHtml) {
      valueHtml = String(value);
    } else if (isCode) {
      valueHtml = '<code>' + escapeHtml(String(value)) + '</code>';
    } else {
      valueHtml = formatText(String(value));
    }
    if (copyable) {
      valueHtml = '<div class="copyable-value">' + valueHtml +
        '<button class="copy-inline-btn" data-copy="' + escapeHtml(String(value)) + '" title="复制值">' +
        '<svg width="10" height="10" viewBox="0 0 16 16" fill="none">' +
        '<rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
        '</svg></button></div>';
    }
    return '<div class="detail-prop-label">' + escapeHtml(label) + '</div>' +
      '<div class="detail-prop-value">' + valueHtml + '</div>';
  }

  function renderParamTable(params, isDll, forceAll) {
    var hasNullable = params.some(function (p) { return p.nullable !== undefined; });
    var hasIsArray = forceAll || params.some(function (p) { return p.isArray !== undefined; });
    var hasArrayBounds = params.some(function (p) { return p.arrayBounds !== undefined; });
    var hasByRef = forceAll || params.some(function (p) { return p.byRef !== undefined; });
    var byRefLabel = isDll ? '传址' : '参考';

    var colgroup = '<colgroup><col><col>' +
      (hasIsArray ? '<col style="width:46px">' : '') +
      (hasArrayBounds ? '<col style="width:46px">' : '') +
      (hasNullable ? '<col style="width:46px">' : '') +
      (hasByRef ? '<col style="width:46px">' : '') +
      '<col style="width:100%"></colgroup>';

    var html = '<table class="detail-table">' + colgroup + '<thead><tr>' +
      '<th>名称</th><th>数据类型</th>' +
      (hasIsArray ? '<th>数组</th>' : '') +
      (hasArrayBounds ? '<th>数组</th>' : '') +
      (hasNullable ? '<th>可空</th>' : '') +
      (hasByRef ? '<th>' + byRefLabel + '</th>' : '') +
      '<th>备注</th></tr></thead><tbody>';

    params.forEach(function (p) {
      var name = p.name || '-';
      var desc = p.remark || '';
      var isArray = p.isArray ? (p.arrayDims && p.arrayDims.length > 0 ? p.arrayDims.join(', ') : '✓') : '';
      var arrayBounds = p.arrayBounds ? '✓' : '';
      var nullable = p.nullable ? '✓' : '';
      var byRef = p.byRef ? '✓' : '';

      html += '<tr>' +
        '<td class="param-name">' + escapeHtml(String(name)) + '</td>' +
        '<td class="param-type">' + renderType(p.dataType || '-') + '</td>' +
        (hasIsArray ? '<td class="check-cell">' + isArray + '</td>' : '') +
        (hasArrayBounds ? '<td class="check-cell">' + arrayBounds + '</td>' : '') +
        (hasNullable ? '<td class="check-cell">' + nullable + '</td>' : '') +
        (hasByRef ? '<td class="check-cell">' + byRef + '</td>' : '') +
        '<td>' + escapeHtml(String(desc)) + '</td></tr>';
    });

    return html + '</tbody></table>';
  }

  function getItemName(item) {
    return item.name || '';
  }

  function getItemDesc(item) {
    return item.remark || '';
  }

  var ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) { return ESCAPE_MAP[c]; });
  }

  var BASIC_TYPES = {
    '整数型': '4 字节有符号整数，范围 -2,147,483,648 ~ 2,147,483,647',
    '小数型': '8 字节双精度浮点数',
    '逻辑型': '布尔值，真 或 假',
    '文本型': 'ANSI 文本字符串',
    '字节集': '字节数据集合，用于处理二进制数据',
    '日期时间型': '日期时间值',
    '子程序指针': '指向子程序的指针',
    '长整数型': '8 字节有符号整数',
    '短整数型': '2 字节有符号整数',
    '字节型': '1 字节无符号整数，范围 0 ~ 255',
    '变体型': '可变类型，运行时确定'
  };

  var CONST_TYPE_MAP = { 1: '普通常量', 2: '图片', 3: '声音' };

  function getTypeTooltip(typeName) {
    var name = String(typeName);
    if (BASIC_TYPES[name]) return name + '\n' + BASIC_TYPES[name];

    ensureTypeMaps();

    // 类（使用 Map O(1) 查找）
    if (classNameMap) {
      var classIdx = classNameMap.get(name);
      if (classIdx !== undefined) {
        var cls = state.classes[classIdx];
        var tip = name;
        if (cls.baseClass) tip += ' : ' + cls.baseClass;
        var methods = cls.methods || [];
        tip += '\n' + methods.length + ' 个方法';
        if (methods.length > 0) {
          var show = methods.slice(0, 5);
          tip += '\n' + show.map(function (m) { return '  ' + m.name + '(' + (m.params || []).length + ')'; }).join('\n');
          if (methods.length > 5) tip += '\n  ...';
        }
        return tip;
      }
    }

    // 自定义数据类型（使用 Map O(1) 查找）
    if (dataTypeNameMap) {
      var dtIdx = dataTypeNameMap.get(name);
      if (dtIdx !== undefined) {
        var dt = state.dataTypes[dtIdx];
        var members = dt.members || [];
        var dtip = name + '\n' + members.length + ' 个成员';
        if (members.length > 0) {
          var showM = members.slice(0, 5);
          dtip += '\n' + showM.map(function (m) { return '  ' + m.name + ': ' + (m.dataType || '-'); }).join('\n');
          if (members.length > 5) dtip += '\n  ...';
        }
        return dtip;
      }
    }

    return name;
  }

  function renderType(typeName) {
    if (!typeName || typeName === '-') return escapeHtml(typeName || '-');
    var name = String(typeName);
    var tooltip = appSettings.showTypeTooltip ? getTypeTooltip(name) : '';
    var titleAttr = tooltip ? ' title="' + escapeHtml(tooltip) + '"' : '';
    ensureTypeMaps();
    // 使用 Map O(1) 查找类和自定义数据类型
    var classIdx = classNameMap ? classNameMap.get(name) : undefined;
    if (classIdx !== undefined) {
      return '<a class="type-link" data-target-category="classes" data-target-index="' + classIdx + '"' + titleAttr + '>' + escapeHtml(name) + '</a>';
    }
    var dtIdx = dataTypeNameMap ? dataTypeNameMap.get(name) : undefined;
    if (dtIdx !== undefined) {
      return '<a class="type-link" data-target-category="dataTypes" data-target-index="' + dtIdx + '"' + titleAttr + '>' + escapeHtml(name) + '</a>';
    }
    return '<span class="type-hint"' + titleAttr + '>' + escapeHtml(name) + '</span>';
  }

  function navigateToType(category, index) {
    pushNav(category, index, state.searchQuery);
    // 切换分类
    state.activeCategory = category;
    state.activeItem = index;
    state.searchQuery = '';
    searchInput.value = '';
    // 更新侧边栏
    setActiveNav(category);
    renderList();
    var items = state[category] || [];
    if (items[index]) renderDetail(items[index]);
    // 滚动二级侧边栏到激活项
    var activeItem = listPanelEl.querySelector('.list-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (items.length > 50) {
      // 虚拟列表：使用缓存的 positions 数组或估算滚动位置
      if (currentPositions && currentPositions.length > index) {
        listItems.scrollTop = currentPositions[index] - listItems.clientHeight / 2 + getItemHeight(items[index]) / 2;
      } else {
        var estPos = 0;
        for (var pi = 0; pi < index; pi++) estPos += getItemHeight(items[pi]);
        listItems.scrollTop = estPos - listItems.clientHeight / 2 + getItemHeight(items[index]) / 2;
      }
    }
  }

  function formatText(str) {
    if (!str) return '-';
    var html = escapeHtml(str);
    // 合并字面量和实际换行符/制表符的替换
    html = html.replace(/\\r\\n|\\n|\\r|\r\n|\n|\r/g, '<br>');
    html = html.replace(/\\t|\t/g, '&emsp;');
    return html;
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    var escaped = escapeHtml(text);
    var terms = query.split(/\s+/).filter(function (t) { return t.length > 0; });
    if (terms.length === 0) return escaped;
    var pattern = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    return escaped.replace(new RegExp('(' + pattern + ')', 'gi'), '<span class="highlight">$1</span>');
  }

  // --- Event Handlers ---
  var sidebarNavBottom = document.getElementById('sidebarNavBottom');
  var sidebarNavItems = sidebarNav.querySelectorAll('.nav-item');
  var sidebarNavBottomItems = sidebarNavBottom.querySelectorAll('.nav-item');
  var searchNavItem = sidebarNav.querySelector('[data-category="search"]');
  var navCountEls = {};
  Object.keys(categories).forEach(function (key) {
    var btn = sidebarNav.querySelector('[data-category="' + key + '"]');
    if (btn) navCountEls[key] = btn;
  });

  function setActiveNav(category) {
    sidebarNavItems.forEach(function (el) {
      el.classList.toggle('active', el.dataset.category === category);
    });
    sidebarNavBottomItems.forEach(function (el) { el.classList.remove('active'); });
  }

  function setActiveNavBottom(page) {
    sidebarNavItems.forEach(function (el) { el.classList.remove('active'); });
    sidebarNavBottomItems.forEach(function (el) {
      el.classList.toggle('active', el.dataset.page === page);
    });
  }

  function clearActiveNav() {
    sidebarNavItems.forEach(function (el) { el.classList.remove('active'); });
    sidebarNavBottomItems.forEach(function (el) { el.classList.remove('active'); });
  }

  function activateSearchNav() {
    clearActiveNav();
    if (searchNavItem) searchNavItem.classList.add('active');
    state.activeCategory = 'search';
    listPanelEl.style.display = '';
    listResize.style.display = '';
  }

  sidebarNav.addEventListener('click', function (e) {
    var navItem = e.target.closest('.nav-item');
    if (!navItem) return;
    var category = navItem.dataset.category;
    if (!category || category === state.activeCategory) return;

    setActiveNav(category);

    pushNav(category, null, category === 'search' ? (state.searchQuery || '') : '');
    state.activeCategory = category;
    state.activeItem = null;
    // 切回搜索时恢复搜索框内容
    if (category === 'search' && state.searchQuery) {
      searchInput.value = state.searchQuery;
      var parsed = parseSearchQuery(state.searchQuery);
      if (parsed.mode && parsed.mode !== 'all') {
        setSearchModeTag(parsed.mode);
      }
    }
    // 显示列表面板
    listPanelEl.style.display = '';
    listResize.style.display = '';
    renderList();
    renderDetail(null);
  });

  sidebarNavBottom.addEventListener('click', function (e) {
    var navItem = e.target.closest('.nav-item');
    if (!navItem) return;
    var page = navItem.dataset.page;
    if (!page) return;

    setActiveNavBottom(page);

    state.activeCategory = page;
    state.activeItem = null;
    state.searchQuery = '';
    searchInput.value = '';
    if (currentSearchMode) setSearchModeTag(null);
    // 记录导航
    pushNav(page, null, '');
    // 隐藏列表面板
    listPanelEl.style.display = 'none';
    listResize.style.display = 'none';

    if (page === 'about') renderAboutPage();
    else if (page === 'settings') renderSettingsPage();
  });

  // 搜索结果：单击选中预览，双击跳转
  listItems.addEventListener('click', function (e) {
    // 类树形列表：点击方法子项
    var treeChild = e.target.closest('.tree-child');
    if (treeChild && !treeChild.classList.contains('tree-child--empty')) {
      // 常量树形子项
      var constIdx = treeChild.dataset.constIndex;
      if (constIdx !== undefined) {
        var cIdx = parseInt(constIdx, 10);
        state.activeItem = cIdx;
        var prevActiveConst = listItems.querySelector('.tree-child.active');
        if (prevActiveConst) prevActiveConst.classList.remove('active');
        treeChild.classList.add('active');
        var constItems = state.constants || [];
        if (constItems[cIdx]) renderDetail(constItems[cIdx]);
        return;
      }

      var classIdx = parseInt(treeChild.dataset.classIndex, 10);
      var methodIdx = parseInt(treeChild.dataset.methodIndex, 10);

      // 如果当前未选中该类，先选中
      if (state.activeItem !== classIdx) {
        state.activeItem = classIdx;
        var prevActive = listItems.querySelector('.list-item.active');
        if (prevActive) prevActive.classList.remove('active');
        var treeParent = treeChild.closest('.tree-group').querySelector('.tree-parent');
        treeParent.classList.add('active');
        treeParent.closest('.tree-group').classList.add('tree-group--active');

        var items = state.classes || [];
        if (items[classIdx]) renderDetail(items[classIdx]);
      }

      // 滚动到对应方法并闪烁
      setTimeout(function () {
        var methodEl = document.getElementById('method-' + methodIdx);
        if (methodEl) {
          var container = document.querySelector('.detail-content');
          if (container && methodEl) {
            var offset = methodEl.offsetTop - container.offsetTop - 18;
            container.scrollTo({ top: offset, behavior: 'smooth' });
          }
          methodEl.classList.remove('method-flash');
          // 强制 reflow 以重新触发动画
          void methodEl.offsetWidth;
          methodEl.classList.add('method-flash');
        }
      }, 50);
      return;
    }

    var listItem = e.target.closest('.list-item');
    if (!listItem) return;
    var index = parseInt(listItem.dataset.index, 10);
    var searchCat = listItem.dataset.searchCategory;

    // 搜索结果单击：只预览，不跳转
    if (searchCat) {
      var prevActive = listItems.querySelector('.list-item.active');
      if (prevActive) prevActive.classList.remove('active');
      listItem.classList.add('active');
      var savedCategory = state.activeCategory;
      state.activeCategory = searchCat;
      var items = state[searchCat] || [];
      if (items[index]) renderDetail(items[index]);
      state.activeCategory = savedCategory;
      return;
    }

    // 类树形列表：点击类名展开/折叠
    if (listItem.classList.contains('tree-parent')) {
      var treeGroup = listItem.closest('.tree-group');
      var treeChildren = treeGroup.querySelector('.tree-children');
      var treeArrow = listItem.querySelector('.tree-arrow');

      if (treeChildren.style.display === 'none') {
        treeChildren.style.display = '';
        treeArrow.classList.add('tree-arrow--open');
      } else {
        treeChildren.style.display = 'none';
        treeArrow.classList.remove('tree-arrow--open');
      }
    }

    // 非搜索结果：单击直接跳转
    state.activeItem = index;
    pushNav(state.activeCategory, index, '');

    var prevActive = listItems.querySelector('.list-item.active');
    if (prevActive) prevActive.classList.remove('active');
    listItem.classList.add('active');

    var items = state[state.activeCategory] || [];
    if (items[index]) renderDetail(items[index]);
  });

  listItems.addEventListener('dblclick', function (e) {
    var listItem = e.target.closest('.list-item');
    if (!listItem) return;
    var index = parseInt(listItem.dataset.index, 10);
    var searchCat = listItem.dataset.searchCategory;

    // 搜索结果双击：跳转到对应分类
    if (searchCat) {
      var savedSearchQuery = state.searchQuery;

      // 记录搜索状态（含选中的搜索结果）到导航历史
      if (savedSearchQuery) {
        pushNav('search', null, savedSearchQuery);
        navHistory[navHistory.length - 1].searchActiveCat = searchCat;
        navHistory[navHistory.length - 1].searchActiveIdx = index;
      }

      state.searchQuery = '';
      searchInput.value = '';
      if (currentSearchMode) setSearchModeTag(null);
      state.activeCategory = searchCat;
      state.activeItem = index;
      setActiveNav(searchCat);

      pushNav(state.activeCategory, index, '');
      renderList();

      var activeEl = listPanelEl.querySelector('.list-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        var catItems = state[state.activeCategory] || [];
        if (catItems.length > 50) {
          var estPos = 0;
          for (var pi = 0; pi < index; pi++) estPos += getItemHeight(catItems[pi]);
          listItems.scrollTop = estPos - listItems.clientHeight / 2 + getItemHeight(catItems[index]) / 2;
        }
      }

      var items = state[state.activeCategory] || [];
      if (items[index]) renderDetail(items[index]);
    }
  });

  var searchCommands = document.getElementById('searchCommands');
  var searchModeTag = document.getElementById('searchModeTag');
  var commandActiveIdx = -1;
  var currentSearchMode = null;

  function setSearchModeTag(mode) {
    if (!mode) {
      searchModeTag.style.display = 'none';
      currentSearchMode = null;
      searchInput.placeholder = '搜索... 输入 / 选择搜索方式';
      return;
    }
    currentSearchMode = mode;
    searchModeTag.querySelector('.tag-label').textContent = searchModes[mode].label;
    searchModeTag.style.display = '';
    searchInput.placeholder = '输入搜索内容...';
  }

  function clearSearchMode() {
    setSearchModeTag(null);
    searchInput.value = '';
    state.searchQuery = '';
    state.activeItem = null;
    if (state.activeCategory === 'search') {
      state.activeCategory = 'subroutines';
      setActiveNav('subroutines');
    }
    renderList();
    renderDetail(null);
  }

  searchModeTag.querySelector('.tag-close').addEventListener('click', function (e) {
    e.stopPropagation();
    clearSearchMode();
    searchInput.focus();
  });

  function showSearchCommands(filter) {
    var items = searchCommands.querySelectorAll('.search-command-item');
    var visible = 0;
    items.forEach(function (el) {
      var prefix = el.querySelector('.cmd-prefix').textContent;
      if (!filter || prefix.indexOf(filter) !== -1) {
        el.style.display = '';
        visible++;
      } else {
        el.style.display = 'none';
      }
    });
    commandActiveIdx = -1;
    searchCommands.style.display = visible > 0 ? '' : 'none';
  }

  function hideSearchCommands() {
    searchCommands.style.display = 'none';
    commandActiveIdx = -1;
  }

  var debouncedSearch = debounce(function () {
    var val = searchInput.value;

    // 指令模式：以 / 开头且没有空格，不执行搜索
    if (val === '/' || (val.length > 1 && val.charAt(0) === '/' && val.indexOf(' ') === -1)) {
      return;
    }

    // 检测输入 /xxx 空格，自动识别为搜索指令
    var cmdMatch = val.match(/^\/(\w+)\s+(.*)$/);
    if (cmdMatch && searchModes[cmdMatch[1]]) {
      setSearchModeTag(cmdMatch[1]);
      searchInput.value = cmdMatch[2];
      val = cmdMatch[2];
    }

    hideSearchCommands();

    // 搜索时激活搜索导航项
    clearActiveNav();
    if (searchNavItem) searchNavItem.classList.add('active');
    state.activeCategory = 'search';
    listPanelEl.style.display = '';
    listResize.style.display = '';

    // 如果已有搜索模式标签，输入值就是搜索内容
    if (currentSearchMode) {
      state.searchQuery = '/' + currentSearchMode + ' ' + val.trim();
    } else {
      state.searchQuery = val.trim();
    }

    // 搜索为空时恢复到子程序分类
    if (!state.searchQuery && state.activeCategory === 'search') {
      state.activeCategory = 'subroutines';
      setActiveNav('subroutines');
    }

    state.activeItem = null;
    renderList();
    renderDetail(null);
  }, 150);

  searchInput.addEventListener('input', function (e) {
    var val = e.target.value;

    // 指令模式：以 / 开头且没有空格，显示指令菜单，不执行搜索
    if (val === '/' || (val.length > 1 && val.charAt(0) === '/' && val.indexOf(' ') === -1)) {
      showSearchCommands(val.substring(1));
      state.searchQuery = '';
      return;
    }

    hideSearchCommands();
    debouncedSearch();
  });

  searchInput.addEventListener('keydown', function (e) {
    var visibleItems = searchCommands.querySelectorAll('.search-command-item:not([style*="display: none"])');
    if (searchCommands.style.display !== 'none' && visibleItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        commandActiveIdx = Math.min(commandActiveIdx + 1, visibleItems.length - 1);
        visibleItems.forEach(function (el, i) { el.classList.toggle('active', i === commandActiveIdx); });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commandActiveIdx = Math.max(commandActiveIdx - 1, 0);
        visibleItems.forEach(function (el, i) { el.classList.toggle('active', i === commandActiveIdx); });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var idx = commandActiveIdx >= 0 ? commandActiveIdx : 0;
        if (visibleItems[idx]) {
          var cmd = visibleItems[idx].dataset.command;
          var cmdMatch = cmd.match(/^\/(\w+)\s*$/);
          if (cmdMatch && searchModes[cmdMatch[1]]) {
            setSearchModeTag(cmdMatch[1]);
            searchInput.value = '';
          }
        }
        hideSearchCommands();
        searchInput.focus();
        return;
      }
      if (e.key === 'Escape') {
        hideSearchCommands();
        return;
      }
    }
    // 退格清空输入时，如果有模式标签则也清除
    if (e.key === 'Backspace' && currentSearchMode && searchInput.value === '') {
      clearSearchMode();
    }
  });

  searchCommands.addEventListener('click', function (e) {
    var item = e.target.closest('.search-command-item');
    if (!item) return;
    var cmd = item.dataset.command;
    var cmdMatch = cmd.match(/^\/(\w+)\s*$/);
    if (cmdMatch && searchModes[cmdMatch[1]]) {
      setSearchModeTag(cmdMatch[1]);
      searchInput.value = '';
    }
    hideSearchCommands();
    searchInput.focus();
  });

  document.addEventListener('keydown', function (e) {
    // 禁用刷新快捷键
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.shiftKey && e.key === 'R') || (e.ctrlKey && e.key === 'R')) {
      e.preventDefault();
      return;
    }
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      clearSearchMode();
      searchInput.blur();
    }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
  });

  searchInput.addEventListener('focus', function () { searchShortcut.style.display = 'none'; });
  searchInput.addEventListener('blur', function () {
    searchShortcut.style.display = '';
    setTimeout(hideSearchCommands, 150);
  });

  openFileBtn.addEventListener('click', openFile);
  navBackBtn.addEventListener('click', goBack);
  navForwardBtn.addEventListener('click', goForward);

  // --- AI知识库导出 ---
  function exportAIKnowledgeBase() {
    if (!state.moduleInfo) return;

    var info = state.moduleInfo;

    // 字段说明映射
    var fieldDescriptions = {
      module: {
        name: '模块名称',
        remark: '模块备注/描述',
        author: '模块作者',
        version: '模块版本号',
        email: '作者电子信箱',
        homePage: '作者主页',
        address: '联系地址',
        phone: '联系电话',
        fax: '传真',
        zipCode: '邮政编码',
        other: '其他信息',
        supports: '依赖的支持库列表 [{cnName: 中文名, fileName: 文件名, identifier: 标识符/GUID, version: 版本}]'
      },
      subroutine: {
        name: '子程序名称',
        remark: '子程序备注/功能描述',
        returnType: '返回值数据类型',
        params: '参数列表 [{name: 参数名, remark: 参数说明, dataType: 数据类型, byRef: 是否传引用, nullable: 是否可空, isArray: 是否数组, arrayDims: 数组维度值列表}]'
      },
      dllCommand: {
        name: 'DLL命令名称',
        remark: '命令备注/描述',
        returnType: '返回值数据类型',
        fileName: 'DLL文件名',
        cmdName: 'DLL中的导出函数名',
        params: '参数列表 [{name: 参数名, remark: 参数说明, dataType: 数据类型, byRef: 是否传引用, nullable: 是否可空, isArray: 是否数组, arrayDims: 数组维度值列表}]'
      },
      class: {
        name: '类名称',
        remark: '类备注/描述',
        baseClass: '基类名称',
        methods: '方法列表 [{name: 方法名, remark: 方法说明, returnType: 返回值类型, params: 参数列表}]'
      },
      dataType: {
        name: '自定义数据类型名称',
        remark: '备注/描述',
        members: '成员列表 [{name: 成员名, remark: 成员说明, dataType: 数据类型, isArray: 是否数组, arrayDims: 数组维度值列表, byRef: 是否传址}]'
      },
      globalVar: {
        name: '全局变量名称',
        remark: '变量备注/描述',
        dataType: '数据类型',
        isArray: '是否数组',
        arrayDims: '数组维度值列表'
      },
      constant: {
        name: '常量名称',
        remark: '常量备注/描述',
        type: '常量类型(1=普通常量, 2=图片, 3=声音)',
        value: '常量值'
      }
    };

    // 构建干净的导出数据，剥离内部字段
    function cleanSubroutine(item) {
      var obj = { name: item.name, remark: item.remark, returnType: item.returnType };
      if (item.params && item.params.length > 0) {
        obj.params = item.params.map(function(p) {
          var param = { name: p.name, remark: p.remark, dataType: p.dataType, byRef: !!p.byRef };
          if (p.nullable !== undefined) param.nullable = !!p.nullable;
          param.isArray = !!p.isArray;
          if (p.isArray && p.arrayDims && p.arrayDims.length > 0) param.arrayDims = p.arrayDims;
          return param;
        });
      } else {
        obj.params = [];
      }
      return obj;
    }

    function cleanDllCommand(item) {
      var obj = { name: item.name, remark: item.remark, returnType: item.returnType, fileName: item.fileName, cmdName: item.cmdName };
      if (item.params && item.params.length > 0) {
        obj.params = item.params.map(function(p) {
          var param = { name: p.name, remark: p.remark, dataType: p.dataType, byRef: !!p.byRef };
          if (p.nullable !== undefined) param.nullable = !!p.nullable;
          param.isArray = !!p.isArray;
          if (p.isArray && p.arrayDims && p.arrayDims.length > 0) param.arrayDims = p.arrayDims;
          return param;
        });
      } else {
        obj.params = [];
      }
      return obj;
    }

    function cleanClass(item) {
      var obj = { name: item.name, remark: item.remark, baseClass: item.baseClass || '' };
      if (item.methods && item.methods.length > 0) {
        obj.methods = item.methods.map(cleanSubroutine);
      } else {
        obj.methods = [];
      }
      return obj;
    }

    function cleanDataType(item) {
      var obj = { name: item.name, remark: item.remark };
      if (item.members && item.members.length > 0) {
        obj.members = item.members.map(function(m) {
          var member = { name: m.name, remark: m.remark, dataType: m.dataType };
          member.isArray = !!m.isArray;
          if (m.isArray && m.arrayDims && m.arrayDims.length > 0) member.arrayDims = m.arrayDims;
          if (m.byRef !== undefined) member.byRef = !!m.byRef;
          return member;
        });
      } else {
        obj.members = [];
      }
      return obj;
    }

    function cleanGlobalVar(item) {
      var obj = { name: item.name, remark: item.remark, dataType: item.dataType, isArray: !!item.isArray };
      if (item.isArray && item.arrayDims && item.arrayDims.length > 0) obj.arrayDims = item.arrayDims;
      return obj;
    }

    function cleanConstant(item) {
      var obj = { name: item.name, remark: item.remark, dataType: item.dataType, value: item.value };
      if (item.type !== undefined) obj.type = item.type;
      return obj;
    }

    var cleanModule = {
      name: info.name,
      remark: info.remark,
      author: info.author,
      version: info.version,
      email: info.email,
      homePage: info.homePage,
      address: info.address,
      phone: info.phone,
      fax: info.fax,
      zipCode: info.zipCode,
      other: info.other,
      path: info.path,
      supports: info.supports
    };

    var kb = {
      _meta: {
        type: 'ai-knowledge-base',
        version: '1.1',
        description: '易语言模块知识库，包含模块的完整接口信息，供AI理解模块功能和使用方式',
        exportedAt: new Date().toISOString()
      },
      _fieldDescriptions: fieldDescriptions,
      module: cleanModule,
      subroutines: state.subroutines.map(cleanSubroutine),
      dllCommands: state.dllCommands.map(cleanDllCommand),
      classes: state.classes.map(cleanClass),
      dataTypes: state.dataTypes.map(cleanDataType),
      globalVars: state.globalVars.map(cleanGlobalVar),
      constants: state.constants.map(cleanConstant)
    };

    // 先弹出保存对话框让用户选择路径（前端对话框API）
    if (typeof jade === 'undefined' || !jade.dialog || !jade.dialog.showSaveDialog) {
      if (window.Modal) Modal.alert('无法导出', '当前环境不支持保存对话框', 'error');
      return;
    }

    var defaultName = (info.name || 'module') + '_ai_knowledge_base.json';
    jade.dialog.showSaveDialog({
      title: '导出AI知识库',
      defaultPath: defaultName,
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }).then(function (result) {
      if (result.canceled || !result.filePath) return;

      // 通过 jade.invoke 把数据和路径发给宿主端
      var payload = {
        api: 'https://jade.run/v2api/dialog-frontend-api',
        path: result.filePath,
        data: kb
      };

      invoke('save_ai_file', JSON.stringify(payload)).then(function () {
        if (window.Modal) {
          Modal.alert('AI知识库已导出', '已保存到：' + result.filePath, 'success');
        }
      }).catch(function (err) {
        console.error('导出AI知识库失败:', err);
        if (window.Modal) {
          Modal.alert('导出失败', err.message || '未知错误', 'error');
        }
      });
    }).catch(function (err) {
      console.error('保存对话框错误:', err);
    });
  }

  if (exportAIBtn) {
    exportAIBtn.addEventListener('click', exportAIKnowledgeBase);
  }

  moduleInfoBtn.addEventListener('click', function () {
    if (!state.moduleInfo) return;
    var prevActive = listItems.querySelector('.list-item.active');
    if (prevActive) prevActive.classList.remove('active');
    state.activeItem = null;
    renderModuleInfoDetail();
  });
  if (moduleInfoCompactBtn) {
    moduleInfoCompactBtn.addEventListener('click', function () {
      if (!state.moduleInfo) return;
      var prevActive = listItems.querySelector('.list-item.active');
      if (prevActive) prevActive.classList.remove('active');
      state.activeItem = null;
      renderModuleInfoDetail();
    });
  }

  // --- Resize Logic ---
  function initResize(handleId, panelId, direction, defaultWidth) {
    var handle = document.getElementById(handleId);
    var panel = document.getElementById(panelId);
    var startX, startWidth;

    // 恢复持久化宽度，无记录时使用默认宽度
    var savedWidth = localStorage.getItem('resize_' + panelId);
    var targetWidth = savedWidth ? parseInt(savedWidth, 10) : (defaultWidth || 0);
    if (targetWidth) {
      var minW = parseInt(getComputedStyle(panel).minWidth, 10) || 160;
      var maxW = parseInt(getComputedStyle(panel).maxWidth, 10) || 500;
      panel.style.width = Math.max(minW, Math.min(maxW, targetWidth)) + 'px';
    }

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      // mousedown 时缓存 min/max，避免 mousemove 中重复 getComputedStyle
      var minW = parseInt(getComputedStyle(panel).minWidth, 10) || 160;
      var maxW = parseInt(getComputedStyle(panel).maxWidth, 10) || 500;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      function onMouseMove(e) {
        var diff = e.clientX - startX;
        var newWidth = direction === 'left' ? startWidth + diff : startWidth - diff;
        panel.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
      }

      function onMouseUp() {
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        localStorage.setItem('resize_' + panelId, panel.offsetWidth);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  initResize('sidebarResize', 'sidebar', 'left', 186);
  initResize('listResize', 'listPanel', 'left', 200);

  // --- Theme ---
  var currentTheme = appSettings.theme || 'System';
  invoke('setTheme', currentTheme);

  // --- Windows 11 Detection ---
  invoke('is_windows_11', '').then(function (res) {
    isWindows11 = (res === 1 || res === '1');
    applyBackgroundMaterial();
    applySettings();
  }).catch(function () {
    isWindows11 = false;
  });

  // --- Settings Panel ---
  var settingsBtn = document.getElementById('settingsBtn');

  function applySettings() {
    document.documentElement.style.setProperty('--detail-font-size', appSettings.fontSize + 'px');
    document.body.classList.toggle('hide-type-underline', !appSettings.showTypeUnderline);
    document.body.classList.toggle('show-list-divider', appSettings.showListDivider);
    // 详情页背景透明度：仅在背景材料非默认且 Windows 11 时生效
    var bgOpacity = (appSettings.backgroundMaterial !== 'default' && isWindows11) ? appSettings.detailOpacity : 100;
    document.documentElement.style.setProperty('--detail-bg-opacity', bgOpacity / 100);
  }

  function applyBackgroundMaterial() {
    var material = appSettings.backgroundMaterial || 'default';

    document.body.classList.remove('material-mica', 'material-acrylic');

    if (material === 'mica' && isWindows11) {
      document.body.classList.add('material-mica');
    } else if (material === 'acrylic' && isWindows11) {
      document.body.classList.add('material-acrylic');
    }

    invoke('setBackgroundMaterial', material);
  }

  function bindSettingsPageEvents() {
    // 主题切换
    var page = document.querySelector('.settings-page');
    if (!page) return;
    page.querySelectorAll('.settings-theme-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var theme = btn.dataset.theme;
        if (theme === currentTheme) return;
        currentTheme = theme;
        appSettings.theme = theme;
        saveSettings(appSettings);
        page.querySelectorAll('.settings-theme-btn').forEach(function (el) {
          el.classList.toggle('active', el.dataset.theme === theme);
        });
        invoke('setTheme', theme);
      });
    });

    // 背景材料切换
    page.querySelectorAll('.settings-material-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var material = btn.dataset.material;
        appSettings.backgroundMaterial = material;
        saveSettings(appSettings);
        applyBackgroundMaterial();
        applySettings();
        page.querySelectorAll('.settings-material-btn').forEach(function (el) {
          el.classList.toggle('active', el.dataset.material === material);
        });
        // 联动透明度滑块启用/禁用
        var opacityItem = document.getElementById('sp_detailOpacityItem');
        var opacitySlider = document.getElementById('sp_detailOpacity');
        var enabled = material !== 'default' && isWindows11;
        if (opacityItem) opacityItem.classList.toggle('settings-item--disabled', !enabled);
        if (opacitySlider) opacitySlider.disabled = !enabled;
      });
    });

    // 详情页透明度
    var opacitySlider = document.getElementById('sp_detailOpacity');
    var opacityValue = document.getElementById('sp_detailOpacityValue');
    if (opacitySlider) opacitySlider.addEventListener('input', function () {
      var val = parseInt(this.value, 10);
      appSettings.detailOpacity = val;
      if (opacityValue) opacityValue.textContent = val + '%';
      saveSettings(appSettings);
      applySettings();
    });

    // 字体大小步进
    var decBtn = document.getElementById('sp_fontSizeDec');
    var incBtn = document.getElementById('sp_fontSizeInc');
    var fontVal = document.getElementById('sp_fontSizeValue');
    if (decBtn) decBtn.addEventListener('click', function () {
      if (appSettings.fontSize > 11) {
        appSettings.fontSize--;
        if (fontVal) fontVal.textContent = appSettings.fontSize;
        saveSettings(appSettings);
        applySettings();
      }
    });
    if (incBtn) incBtn.addEventListener('click', function () {
      if (appSettings.fontSize < 20) {
        appSettings.fontSize++;
        if (fontVal) fontVal.textContent = appSettings.fontSize;
        saveSettings(appSettings);
        applySettings();
      }
    });

    // 显示备注预览
    var showRemarkEl = document.getElementById('sp_showRemark');
    if (showRemarkEl) showRemarkEl.addEventListener('change', function () {
      appSettings.showRemark = this.checked;
      saveSettings(appSettings);
      renderList();
    });

    // 列表分割线
    var showListDividerEl = document.getElementById('sp_showListDivider');
    if (showListDividerEl) showListDividerEl.addEventListener('change', function () {
      appSettings.showListDivider = this.checked;
      saveSettings(appSettings);
      document.body.classList.toggle('show-list-divider', this.checked);
    });

    // 自动重载
    var autoReloadEl = document.getElementById('sp_autoReload');
    if (autoReloadEl) autoReloadEl.addEventListener('change', function () {
      appSettings.autoReload = this.checked;
      saveSettings(appSettings);
    });

    // 类型下划线
    var typeUnderlineEl = document.getElementById('sp_showTypeUnderline');
    if (typeUnderlineEl) typeUnderlineEl.addEventListener('change', function () {
      appSettings.showTypeUnderline = this.checked;
      saveSettings(appSettings);
      applySettings();
    });

    // 类型悬浮提示
    var typeTooltipEl = document.getElementById('sp_showTypeTooltip');
    if (typeTooltipEl) typeTooltipEl.addEventListener('change', function () {
      appSettings.showTypeTooltip = this.checked;
      saveSettings(appSettings);
      // 重新渲染当前详情以更新 title 属性
      var items = state[state.activeCategory] || [];
      if (state.activeItem !== null && items[state.activeItem]) {
        renderDetail(items[state.activeItem]);
      }
    });

    // 默认搜索方式
    var searchModeBtn = document.getElementById('sp_searchModeBtn');
    var searchCommands = document.getElementById('sp_searchCommands');
    if (searchModeBtn && searchCommands) {
      searchModeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isVisible = searchCommands.style.display !== 'none';
        searchCommands.style.display = isVisible ? 'none' : '';
      });
      searchCommands.querySelectorAll('.search-command-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var mode = item.dataset.command;
          if (searchModes[mode]) {
            appSettings.defaultSearch = mode;
            saveSettings(appSettings);
            var prefixEl = document.getElementById('sp_searchModePrefix');
            var descEl = document.getElementById('sp_searchModeDesc');
            if (prefixEl) prefixEl.textContent = searchModes[mode].prefix;
            if (descEl) descEl.textContent = searchModes[mode].desc;
            searchCommands.querySelectorAll('.search-command-item').forEach(function (el) {
              el.classList.toggle('active', el.dataset.command === mode);
            });
          }
          searchCommands.style.display = 'none';
        });
      });
      // 只绑定一次 document click 监听器
      if (!document._settingsSearchCmdListener) {
        document._settingsSearchCmdListener = true;
        document.addEventListener('click', function (e) {
          var spSearchMode = document.getElementById('sp_searchMode');
          var spSearchCommands = document.getElementById('sp_searchCommands');
          if (spSearchMode && spSearchCommands && !e.target.closest('#sp_searchMode')) {
            spSearchCommands.style.display = 'none';
          }
        });
      }
    }

    // 清除最近记录
    var clearBtn = document.getElementById('sp_clearRecentBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      localStorage.removeItem('recentModules');
      var descEl = document.getElementById('sp_recentCountDesc');
      if (descEl) descEl.textContent = '当前无记录';
      if (typeof renderWelcome === 'function') renderWelcome();
    });

    // 默认模块查看器：检查状态
    var replaceBtn = document.getElementById('sp_replaceViewerBtn');
    var replaceDesc = document.getElementById('sp_replaceViewerDesc');
    var viewerReplaced = false;

    function updateViewerUI(replaced) {
      viewerReplaced = replaced;
      if (!replaceBtn) return;
      replaceBtn.classList.remove('settings-action-btn--danger', 'settings-action-btn--success', 'settings-action-btn--loading');
      replaceBtn.disabled = false;
      if (replaced) {
        replaceBtn.textContent = '恢复';
        replaceBtn.classList.add('settings-action-btn--danger');
        if (replaceDesc) replaceDesc.textContent = '当前已替换默认模块查看器，可恢复为原始查看器';
      } else {
        replaceBtn.textContent = '替换';
        if (replaceDesc) replaceDesc.textContent = '将本程序设为 .ec 文件默认打开方式，需安装精易易语言助手';
      }
    }

    invoke('check_viewer_replaced', '').then(function (res) {
      updateViewerUI(res === 1 || res === '1');
    }).catch(function () {
      updateViewerUI(false);
    });

    // 默认模块查看器：点击替换/恢复
    if (replaceBtn) replaceBtn.addEventListener('click', function () {
      var isRestore = replaceBtn.classList.contains('settings-action-btn--danger');
      replaceBtn.disabled = true;
      replaceBtn.classList.add('settings-action-btn--loading');

      if (isRestore) {
        // 恢复操作
        replaceBtn.textContent = '恢复中...';
        if (replaceDesc) replaceDesc.textContent = '正在恢复原始模块查看器...';
        invoke('restore_default_viewer', '').catch(function (err) {
          replaceBtn.disabled = false;
          replaceBtn.classList.remove('settings-action-btn--loading');
          replaceBtn.textContent = '恢复';
          replaceBtn.classList.add('settings-action-btn--danger');
          showAlert('恢复失败', err.message || '未知错误', 'error');
        });
      } else {
        // 替换操作
        replaceBtn.textContent = '检查中...';
        invoke('check_jade_assistant', '').then(function (res) {
          var installed = (res === 1 || res === '1');
          if (!installed) {
            replaceBtn.disabled = false;
            replaceBtn.classList.remove('settings-action-btn--loading');
            replaceBtn.textContent = '替换';
            showAlert('无法替换', '需要安装精易易语言助手，并在设置中启用（模块查看器）', 'error');
            return;
          }
          replaceBtn.textContent = '替换中...';
          if (replaceDesc) replaceDesc.textContent = '正在替换默认模块查看器...';
          invoke('replace_default_viewer', '').catch(function (err) {
            replaceBtn.disabled = false;
            replaceBtn.classList.remove('settings-action-btn--loading');
            replaceBtn.textContent = '替换';
            showAlert('替换失败', err.message || '未知错误', 'error');
          });
        }).catch(function (err) {
          replaceBtn.disabled = false;
          replaceBtn.classList.remove('settings-action-btn--loading');
          replaceBtn.textContent = '替换';
          showAlert('检查失败', err.message || '未知错误', 'error');
        });
      }
    });

    // 重置设置
    var resetBtn = document.getElementById('sp_resetSettingsBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      appSettings = Object.assign({}, DEFAULT_SETTINGS);
      saveSettings(appSettings);
      applySettings();
      applyBackgroundMaterial();
      renderSettingsPage();
      renderList();
    });
  }

  settingsBtnEl.addEventListener('click', function () {
    var settingsNavItem = document.querySelector('[data-page="settings"]');
    if (settingsNavItem && settingsNavItem.offsetParent !== null) {
      settingsNavItem.click();
    } else {
      // 侧边栏隐藏时直接渲染设置页面
      setActiveNavBottom('settings');
      listPanelEl.style.display = 'none';
      listResize.style.display = 'none';
      pushNav('settings', null, '');
      renderSettingsPage();
    }
  });
  aboutBtn.addEventListener('click', function () {
    var aboutNavItem = document.querySelector('[data-page="about"]');
    if (aboutNavItem && aboutNavItem.offsetParent !== null) {
      aboutNavItem.click();
    } else {
      setActiveNavBottom('about');
      listPanelEl.style.display = 'none';
      listResize.style.display = 'none';
      pushNav('about', null, '');
      renderAboutPage();
    }
  });

  // 初始化应用设置
  applySettings();
  applyBackgroundMaterial();

  // --- Sidebar Compact Mode ---
  var compactBtn = document.getElementById('sidebarCompactBtn');
  var isCompact = localStorage.getItem('sidebarCompact') === 'true';
  var savedSidebarWidth = '';

  // 恢复极窄模式
  if (isCompact && compactBtn) {
    compactBtn.classList.add('active');
    sidebarEl.classList.add('sidebar-compact');
    compactBtn.setAttribute('title', '展开侧边栏');
    var iconCollapse = compactBtn.querySelector('.compact-icon-collapse');
    var iconExpand = compactBtn.querySelector('.compact-icon-expand');
    if (iconCollapse) iconCollapse.style.display = 'none';
    if (iconExpand) iconExpand.style.display = '';
    sidebarResize.style.display = 'none';
    sidebarEl.querySelectorAll('.nav-item').forEach(function (item) {
      var label = item.querySelector('span:first-of-type');
      if (label && !item.getAttribute('title')) {
        item.setAttribute('title', label.textContent);
      }
    });
    var openBtn = document.getElementById('openFileBtn');
    if (openBtn && !openBtn.getAttribute('title')) {
      openBtn.setAttribute('title', '打开模块');
    }
  }

  if (compactBtn) {
    compactBtn.addEventListener('click', function () {
      isCompact = !isCompact;
      localStorage.setItem('sidebarCompact', isCompact);
      compactBtn.classList.toggle('active', isCompact);
      sidebarEl.classList.toggle('sidebar-compact', isCompact);
      compactBtn.setAttribute('title', isCompact ? '展开侧边栏' : '极窄模式');
      // 隐藏 tooltip
      if (window.Tooltip && Tooltip.hide) Tooltip.hide();
      // 切换图标
      var iconCollapse = compactBtn.querySelector('.compact-icon-collapse');
      var iconExpand = compactBtn.querySelector('.compact-icon-expand');
      if (iconCollapse) iconCollapse.style.display = isCompact ? 'none' : '';
      if (iconExpand) iconExpand.style.display = isCompact ? '' : 'none';
      if (isCompact) {
        savedSidebarWidth = sidebarEl.style.width || '';
        sidebarResize.style.display = 'none';
        // 为导航项添加 title 用于 tooltip
        sidebarEl.querySelectorAll('.nav-item').forEach(function (item) {
          var label = item.querySelector('span:first-of-type');
          if (label && !item.getAttribute('title')) {
            item.setAttribute('title', label.textContent);
          }
        });
        // 打开文件按钮也加 title
        var openBtn = document.getElementById('openFileBtn');
        if (openBtn && !openBtn.getAttribute('title')) {
          openBtn.setAttribute('title', '打开模块');
        }
      } else {
        sidebarResize.style.display = '';
        if (savedSidebarWidth) {
          sidebarEl.style.width = savedSidebarWidth;
        }
        // 移除自动添加的 title
        sidebarEl.querySelectorAll('.nav-item').forEach(function (item) {
          if (item.getAttribute('title') && item.getAttribute('data-tooltip-title')) {
            item.removeAttribute('title');
            item.removeAttribute('data-tooltip-title');
          }
        });
      }
    });
  }

  // --- Init: 优先渲染欢迎页 ---
  showModuleUI(false);
  renderWelcome();
  pushNav('welcome', null, '');

  function showAlert(title, message, type) {
    if (window.Modal) Modal.alert(title, message, type);
  }

  function showUpdateDialog(info) {
    if (window.Modal) Modal.update(info);
  }

  function showFileModifiedModal(filePath) {
    var msg = filePath
      ? '文件 ' + filePath + ' 已被外部程序修改，是否重新加载？'
      : '当前打开的模块文件已被外部程序修改，是否重新加载？';
    if (window.Modal) {
      Modal.confirm('文件已被修改', msg, function () {
        if (state.moduleInfo && state.moduleInfo.path) openModuleByPath(state.moduleInfo.path);
      }, null, { confirmText: '重新加载', dismissText: '忽略', type: 'warning' });
    }
  }

  function showPasswordDialog(message, filePath, isWrongPassword) {
    var msg = message || '此模块已加密，请输入密码以打开。';
    if (window.Modal) return Modal.password(msg, isWrongPassword);
    return Promise.resolve(null);
  }

  // 延迟初始化：欢迎页已渲染后，再执行非关键初始化
  requestAnimationFrame(function () {
    // Broadcast listeners removed

    // 批量请求初始化数据
    if (typeof jade !== 'undefined' && jade.invokeBatch) {
      jade.invokeBatch([
        { command: 'get_version' },
        { command: 'get_init_path' }
      ]).then(function (results) {
        var version = results[0];
        var initPath = results[1];
        var el = document.getElementById('appVersion');
        if (el) el.textContent = version ? 'v' + version : '';
        if (initPath && typeof initPath === 'string' && initPath.toLowerCase().endsWith('.ec')) {
          openModuleByPath(initPath);
        }
        // 版本更新检查
        if (version && typeof UpdateChecker !== 'undefined') {
          UpdateChecker.start(version, showUpdateDialog);
        }
      }).catch(function () {
        var el = document.getElementById('appVersion');
        if (el) el.textContent = '';
      });
    }

    if (typeof initDragDrop === 'function') {
      initDragDrop({ onDrop: openModuleByPath, jade: typeof jade !== 'undefined' ? jade : null });
    }

    // 监听后端通知打开文件事件
    if (typeof jade !== 'undefined' && jade.on) {
      jade.on('open_file', function (filePath) {
        if (filePath) {
          openModuleByPath(filePath);
        }
      });

      jade.on('file_modified', function (data) {
        if (appSettings.autoReload && state.moduleInfo && state.moduleInfo.path) {
          openModuleByPath(state.moduleInfo.path);
        } else {
          showFileModifiedModal(data || '');
        }
      });

      // 监听替换/恢复默认模块查看器结果
      jade.on('replace_viewer_result', function (data) {
        var btn = document.getElementById('sp_replaceViewerBtn');
        var desc = document.getElementById('sp_replaceViewerDesc');
        if (!btn) return;
        btn.classList.remove('settings-action-btn--loading');
        if (data && (data.success === true || data.success === 'true' || data === 'success')) {
          btn.textContent = '已替换';
          btn.classList.add('settings-action-btn--success');
          btn.disabled = true;
          showAlert('替换成功', '已将本程序设为默认模块查看器', 'success');
          setTimeout(function () {
            btn.classList.remove('settings-action-btn--success');
            btn.textContent = '恢复';
            btn.classList.add('settings-action-btn--danger');
            btn.disabled = false;
            if (desc) desc.textContent = '当前已替换默认模块查看器，可恢复为原始查看器';
          }, 3000);
        } else {
          btn.classList.remove('settings-action-btn--danger');
          btn.textContent = '替换';
          btn.disabled = false;
          if (desc) desc.textContent = '将本程序设为 .ec 文件默认打开方式，需安装精易易语言助手';
          var errMsg = (data && data.error) ? data.error : (typeof data === 'string' ? data : '未知错误');
          showAlert('替换失败', errMsg, 'error');
        }
      });

      jade.on('restore_viewer_result', function (data) {
        var btn = document.getElementById('sp_replaceViewerBtn');
        var desc = document.getElementById('sp_replaceViewerDesc');
        if (!btn) return;
        btn.classList.remove('settings-action-btn--loading');
        if (data && (data.success === true || data.success === 'true' || data === 'success')) {
          btn.classList.remove('settings-action-btn--danger');
          btn.textContent = '替换';
          btn.disabled = false;
          if (desc) desc.textContent = '将本程序设为 .ec 文件默认打开方式，需安装精易易语言助手';
          showAlert('恢复成功', '已恢复为原始模块查看器', 'success');
        } else {
          btn.textContent = '恢复';
          btn.classList.add('settings-action-btn--danger');
          btn.disabled = false;
          var errMsg = (data && data.error) ? data.error : (typeof data === 'string' ? data : '未知错误');
          showAlert('恢复失败', errMsg, 'error');
        }
      });
    }

    if (window.Tooltip) {
      Tooltip.init(document.getElementById('detailContent'));
      Tooltip.init(document.getElementById('sidebar'));
      Tooltip.init(document.querySelector('.titlebar'));
    }
  });
})();
