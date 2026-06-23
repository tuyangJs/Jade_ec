(function () {
  'use strict';

  /**
   * Tooltip 组件
   * 当元素内容被截断（ellipsis）时，悬浮显示完整内容
   * 多个 Tooltip 间切换时使用非线性平移动画
   */

  var tooltipEl = null;
  var isVisible = false;
  var hideTimer = null;
  var currentTarget = null;

  var SELECTOR = 'td, th, .item-name, .item-sub, .recent-item-name, .recent-item-path, [title], [data-tooltip-title]';
  var SKIP_SELECTOR = 'td:last-child, .check-cell, .action-cell';

  function escapeHtmlSimple(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createTooltip() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);
  }

  function isTruncated(el) {
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  }

  function shouldSkip(el) {
    return el.matches(SKIP_SELECTOR) || el.closest(SKIP_SELECTOR);
  }

  function findTarget(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.matches && node.matches(SELECTOR) && !shouldSkip(node)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function restoreTitle(target) {
    if (target && target.getAttribute('data-tooltip-title')) {
      target.setAttribute('title', target.getAttribute('data-tooltip-title'));
      target.removeAttribute('data-tooltip-title');
    }
  }

  function show(target) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
      // 恢复上一个目标的 title
      restoreTitle(currentTarget);
    }

    // 显示时启用 pointer-events，允许鼠标移入 tooltip
    tooltipEl.style.pointerEvents = 'auto';

    var titleText = target.getAttribute('title') || target.getAttribute('data-tooltip-title');
    var text = titleText || (target.textContent || '');

    if (isVisible && currentTarget === target) return;

    // 抑制原生 title tooltip
    if (target.getAttribute('title')) {
      target.setAttribute('data-tooltip-title', target.getAttribute('title'));
      target.removeAttribute('title');
    }

    // 支持多行文本
    if (text.indexOf('\n') !== -1) {
      tooltipEl.innerHTML = text.split('\n').map(function (line) {
        return escapeHtmlSimple(line);
      }).join('<br>');
      tooltipEl.style.whiteSpace = 'normal';
      tooltipEl.style.maxWidth = '320px';
    } else {
      tooltipEl.textContent = text;
      tooltipEl.style.whiteSpace = 'nowrap';
      tooltipEl.style.maxWidth = '';
    }

    var wasVisible = isVisible;
    currentTarget = target;

    var geo = computeGeometry(target);
    var left = geo.left, top = geo.top;

    if (wasVisible) {
      // 已显示 → 平移动画
      tooltipEl.style.transition = 'left 0.2s cubic-bezier(0.16, 1, 0.3, 1), top 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease';
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = top + 'px';
      tooltipEl.classList.add('tooltip-visible');
    } else {
      // 首次显示 → 淡入
      tooltipEl.style.transition = 'opacity 0.15s ease';
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = top + 'px';
      tooltipEl.style.opacity = '0';
      tooltipEl.classList.add('tooltip-visible');

      // 强制重排后淡入
      void tooltipEl.offsetHeight;
      tooltipEl.style.opacity = '1';
    }

    isVisible = true;
  }

  // 计算 tooltip 相对当前视口的位置（依据目标元素的实时 rect），返回 {left, top}
  function computeGeometry(target) {
    var rect = target.getBoundingClientRect();

    // 判断是否在侧边栏内，显示在右侧
    var inSidebar = target.closest('.sidebar') !== null;
    var placement = target.getAttribute('data-tooltip-placement') || (inSidebar ? 'right' : 'bottom');

    var vh = window.innerHeight;
    var vw = window.innerWidth;

    // 先设置为 nowrap 让浏览器计算实际尺寸
    tooltipEl.style.whiteSpace = 'nowrap';
    tooltipEl.style.maxWidth = '';

    var tw = tooltipEl.offsetWidth;
    var th = tooltipEl.offsetHeight;
    var left, top;

    if (placement === 'right') {
      left = rect.right + 8;
      top = rect.top + rect.height / 2 - th / 2;
      // 右侧空间不足则显示在左侧
      if (left + tw > vw - 8) {
        left = rect.left - tw - 8;
        tooltipEl.classList.add('tooltip-left');
        tooltipEl.classList.remove('tooltip-right');
        tooltipEl.classList.remove('tooltip-above');
      } else {
        tooltipEl.classList.add('tooltip-right');
        tooltipEl.classList.remove('tooltip-left');
        tooltipEl.classList.remove('tooltip-above');
      }
      // 垂直边界修正
      if (top < 8) top = 8;
      if (top + th > vh - 8) top = vh - 8 - th;
      // 箭头垂直居中于目标（减去箭头半高 5px）
      var arrowTop = rect.top + rect.height / 2 - top - 5;
      if (arrowTop < 4) arrowTop = 4;
      if (arrowTop > th - 14) arrowTop = th - 14;
      tooltipEl.style.setProperty('--arrow-top', arrowTop + 'px');
      tooltipEl.style.removeProperty('--arrow-left');
    } else {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.bottom + 6;
      // 水平边界修正
      if (left < 8) left = 8;
      if (left + tw > vw - 8) left = vw - 8 - tw;
      // 计算箭头位置：基于目标元素中心
      var arrowLeft = rect.left + rect.width / 2 - left;
      if (arrowLeft < 8) arrowLeft = 8;
      if (arrowLeft > tw - 8) arrowLeft = tw - 8;
      tooltipEl.style.setProperty('--arrow-left', arrowLeft + 'px');
      tooltipEl.style.removeProperty('--arrow-top');
      // 下方空间不足时显示在上方
      if (top + 40 > vh) {
        tooltipEl.style.visibility = 'hidden';
        tooltipEl.style.opacity = '0';
        tooltipEl.classList.add('tooltip-visible');
        th = tooltipEl.offsetHeight;
        tooltipEl.classList.remove('tooltip-visible');
        tooltipEl.style.visibility = '';
        tooltipEl.style.opacity = '';
        top = rect.top - th - 6;
        tooltipEl.classList.add('tooltip-above');
      } else {
        tooltipEl.classList.remove('tooltip-above');
      }
      tooltipEl.classList.remove('tooltip-left');
      tooltipEl.classList.remove('tooltip-right');
    }

    return { left: left, top: top };
  }

  // 立即隐藏（目标已滚出视口或从 DOM 移除时使用，不走延时）
  function hideNow() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    tooltipEl.style.transition = 'none';
    tooltipEl.style.opacity = '0';
    tooltipEl.style.pointerEvents = 'none';
    tooltipEl.classList.remove('tooltip-visible');
    isVisible = false;
    restoreTitle(currentTarget);
    currentTarget = null;
  }

  // 滚动时让 tooltip 跟随目标元素（rAF 节流）
  var repositionRaf = null;
  function onViewportChange() {
    if (!isVisible || !currentTarget || repositionRaf) return;
    repositionRaf = requestAnimationFrame(function () {
      repositionRaf = null;
      if (!isVisible || !currentTarget) return;
      // 目标已从 DOM 移除（如列表重渲染）→ 隐藏
      if (!currentTarget.isConnected) { hideNow(); return; }
      var rect = currentTarget.getBoundingClientRect();
      // 目标完全移出视口 → 隐藏
      if (rect.bottom <= 0 || rect.top >= window.innerHeight ||
          rect.right <= 0 || rect.left >= window.innerWidth) {
        hideNow();
        return;
      }
      var geo = computeGeometry(currentTarget);
      // 跟随时不要动画，直接贴合
      tooltipEl.style.transition = 'none';
      tooltipEl.style.left = geo.left + 'px';
      tooltipEl.style.top = geo.top + 'px';
      // computeGeometry 的测高分支可能临时移除可见性，这里确保仍可见
      tooltipEl.classList.add('tooltip-visible');
      tooltipEl.style.opacity = '1';
    });
  }

  function hide() {
    if (!isVisible) return;
    hideTimer = setTimeout(function () {
      tooltipEl.style.transition = 'opacity 0.12s ease';
      tooltipEl.style.opacity = '0';
      tooltipEl.style.pointerEvents = 'none';
      isVisible = false;
      // 恢复 title 属性
      restoreTitle(currentTarget);
      currentTarget = null;
      setTimeout(function () {
        if (!isVisible) {
          tooltipEl.classList.remove('tooltip-visible');
        }
      }, 120);
    }, 200);
  }

  function handleMouseEnter(e) {
    var target = findTarget(e.target);
    if (!target) return;
    // 展开侧边栏的导航项和打开模块按钮不显示 tooltip
    if (target.closest('.sidebar') && !target.closest('.sidebar-compact') && (target.matches('.nav-item') || target.matches('#openFileBtn') || target.closest('#openFileBtn'))) return;
    var hasTitle = target.getAttribute('title') || target.getAttribute('data-tooltip-title');
    if (!hasTitle && !isTruncated(target)) return;
    show(target);
  }

  function handleMouseLeave(e) {
    var target = findTarget(e.target);
    if (!target) return;
    hide();
  }

  // 鼠标移入 tooltip 时取消隐藏，移出时隐藏
  function handleTooltipEnter() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function handleTooltipLeave() {
    hide();
  }

  /**
   * 在指定根元素上启用 Tooltip 事件委托
   * @param {HTMLElement} rootEl - 根元素
   */
  var nativeIntercepted = false;

  function init(rootEl) {
    if (!tooltipEl) createTooltip();
    rootEl.addEventListener('mouseover', handleMouseEnter);
    rootEl.addEventListener('mouseout', handleMouseLeave);
    tooltipEl.addEventListener('mouseenter', handleTooltipEnter);
    tooltipEl.addEventListener('mouseleave', handleTooltipLeave);
    // 全局拦截：主动移除所有 title 属性，阻止原生 tooltip
    if (!nativeIntercepted) {
      nativeIntercepted = true;
      // 滚动/缩放时让 tooltip 跟随目标（capture=true 以捕获内部滚动容器的滚动）
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);
      // 立即移除页面中已有的 title
      document.querySelectorAll('[title]').forEach(function (el) {
        el.setAttribute('data-tooltip-title', el.getAttribute('title'));
        el.removeAttribute('title');
      });
      // 监控后续动态添加的 title
      var titleObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.attributeName === 'title') {
            var el = m.target;
            if (el.getAttribute('title')) {
              el.setAttribute('data-tooltip-title', el.getAttribute('title'));
              el.removeAttribute('title');
            }
          }
        }
      });
      titleObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['title'] });
    }
  }

  window.Tooltip = { init: init, hide: hide };
})();
