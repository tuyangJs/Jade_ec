(function () {
  'use strict';

  function initDragDrop(options) {
    var onDrop = options.onDrop;
    var jadeApi = options.jade;

    if (!jadeApi || !jadeApi.on) return;

    var overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.id = 'dropOverlay';
    overlay.innerHTML = '<div class="drop-overlay-content">' +
      '<svg width="48" height="48" viewBox="0 0 16 16" fill="none">' +
      '<path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M2 11v2h12v-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<p>释放以打开模块</p></div>';
    document.querySelector('.app').appendChild(overlay);

    var content = overlay.querySelector('.drop-overlay-content');
    var svgEl = overlay.querySelector('svg');

    jadeApi.on('drag-drop', function (data) {
      var evt = typeof data === 'string' ? JSON.parse(data) : data;
      switch (evt.type) {
        case 'enter':
          if (evt.paths && evt.paths.some(function (p) { return /\.ec$/i.test(p); })) {
            overlay.classList.add('active');
            svgEl.style.transform = 'translate(0, 0)';
          }
          break;
        case 'over':
          if (typeof evt.x === 'number' && typeof evt.y === 'number') {
            var rect = overlay.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var dx = (evt.x - cx) / (rect.width / 2);
            var dy = (evt.y - cy) / (rect.height / 2);
            var maxShift = 12;
            svgEl.style.transform = 'translate(' + (dx * maxShift).toFixed(1) + 'px, ' + (dy * maxShift).toFixed(1) + 'px)';
          }
          break;
        case 'drop':
          overlay.classList.remove('active');
          svgEl.style.transform = 'translate(0, 0)';
          if (evt.paths && evt.paths.length > 0) {
            var ecFile = evt.paths.find(function (p) { return /\.ec$/i.test(p); });
            if (ecFile && typeof onDrop === 'function') onDrop(ecFile);
          }
          break;
        case 'leave':
          overlay.classList.remove('active');
          svgEl.style.transform = 'translate(0, 0)';
          break;
      }
    });
  }

  window.initDragDrop = initDragDrop;
})();
