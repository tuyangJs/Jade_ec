/* 光线（Side Rays）背景：原生 WebGL，从左上角射出的体积光线。
   移植自 reactbits.dev「LightRays」(raysOrigin: top-left) 的片元着色器，
   去掉鼠标/脉动/噪声等交互项，并改为双色（rayColor1 / rayColor2）由配色方案推导，
   透明输出（直通 alpha）叠加在页面底色之上，跟随配色方案、深浅与背景色循环。 */
(function () {
  'use strict';

  var canvas = null, gl = null, program = null, raf = null;
  var startTime = 0, timeAddition = Math.random() * 1000, lastDraw = 0;
  var uResolution, uTime, uRayPos, uRayDir, uColor1, uColor2, uSpeed, uIntensity;
  // 兜底双色（蓝系），正常会被配色方案推导值覆盖
  var color1 = [0.20, 0.55, 1.0], color2 = [0.45, 0.75, 1.0];
  var speed = 0.6;
  var intensity = 0.9;

  var VERT =
    'attribute vec2 position;\n' +
    'void main(){ gl_Position = vec4(position, 0.0, 1.0); }';

  var FRAG = [
    'precision highp float;',
    'uniform vec2  iResolution;',
    'uniform float iTime;',
    'uniform vec2  rayPos;',
    'uniform vec2  rayDir;',
    'uniform vec3  rayColor1;',
    'uniform vec3  rayColor2;',
    'uniform float raysSpeed;',
    'uniform float intensity;',
    // 单条光线强度（保留 reactbits 的角度展开 + 距离衰减 + 时间脉络）
    'float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,',
    '                  float seedA, float seedB, float speed){',
    '  vec2 sourceToCoord = coord - raySource;',
    '  vec2 dirNorm = normalize(sourceToCoord);',
    '  float cosAngle = dot(dirNorm, rayRefDirection);',
    '  float lightSpread = 1.0;',
    '  float spreadFactor = pow(max(cosAngle, 0.0), 1.0 / max(lightSpread, 0.001));',
    '  float dist = length(sourceToCoord);',
    '  float maxDistance = iResolution.x * 2.0;',
    '  float lengthFalloff = clamp((maxDistance - dist) / maxDistance, 0.0, 1.0);',
    '  float fadeDistance = 1.2;',
    '  float fadeFalloff = clamp((iResolution.x * fadeDistance - dist) / (iResolution.x * fadeDistance), 0.5, 1.0);',
    '  float baseStrength = clamp(',
    '    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +',
    '    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),',
    '    0.0, 1.0);',
    '  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor;',
    '}',
    'void main(){',
    '  vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);',
    '  float s1 = rayStrength(rayPos, rayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);',
    '  float s2 = rayStrength(rayPos, rayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);',
    '  float strength = s1 * 0.5 + s2 * 0.4;',
    // 双色按各自贡献加权混合，得到饱和的光线颜色；alpha 承载强度，透出页面底色
    '  vec3 col = (rayColor1 * s1 * 0.5 + rayColor2 * s2 * 0.4) / max(strength, 0.0001);',
    '  float brightness = 1.0 - (coord.y / iResolution.y);', // 顶部更亮（光源在上方）
    '  float a = clamp(strength * intensity * (0.4 + brightness * 0.6), 0.0, 1.0);',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[SideRays] shader compile error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function ensureCanvas() {
    if (canvas) return true;
    var c = document.createElement('canvas');
    c.id = 'siderays-canvas';
    document.body.appendChild(c);
    // 透明、直通 alpha：让光线叠加在页面底色之上
    var opts = { alpha: true, premultipliedAlpha: false, antialias: true, depth: false };
    gl = c.getContext('webgl', opts) || c.getContext('experimental-webgl', opts);
    if (!gl) { c.remove(); gl = null; return false; }
    canvas = c;

    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { stop(); return false; }
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[SideRays] program link error:', gl.getProgramInfoLog(program));
      stop();
      return false;
    }
    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    uResolution = gl.getUniformLocation(program, 'iResolution');
    uTime = gl.getUniformLocation(program, 'iTime');
    uRayPos = gl.getUniformLocation(program, 'rayPos');
    uRayDir = gl.getUniformLocation(program, 'rayDir');
    uColor1 = gl.getUniformLocation(program, 'rayColor1');
    uColor2 = gl.getUniformLocation(program, 'rayColor2');
    uSpeed = gl.getUniformLocation(program, 'raysSpeed');
    uIntensity = gl.getUniformLocation(program, 'intensity');
    return true;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function resize() {
    if (!canvas || !gl) return;
    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    if (canvas.width === w && canvas.height === h) return; // 尺寸未变不重设缓冲，避免无谓清屏
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    drawNow(nowMs()); // 立即补绘，消除缩放窗口时的闪烁
  }

  function applyUniforms() {
    if (!gl || !program) return;
    gl.useProgram(program);
    gl.uniform3fv(uColor1, color1);
    gl.uniform3fv(uColor2, color2);
    gl.uniform1f(uSpeed, speed);
    gl.uniform1f(uIntensity, intensity);
    // 光源在左上角外侧，方向朝下（raysOrigin: top-left）
    gl.uniform2f(uRayDir, 0.0, 1.0);
  }

  function drawNow(now) {
    if (!gl || !program || !canvas) return;
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform2f(uRayPos, 0.0, -0.2 * canvas.height);
    gl.uniform1f(uTime, (now - startTime) / 1000 + timeAddition);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - lastDraw < 33) return; // ~30fps，省电
    lastDraw = now;
    drawNow(now);
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    window.removeEventListener('resize', resize);
    if (canvas) { canvas.remove(); }
    canvas = null; gl = null; program = null;
  }

  window.SideRays = {
    start: function (cols) {
      if (cols && cols.length === 2) { color1 = cols[0]; color2 = cols[1]; }
      if (!ensureCanvas()) return false;
      resize();
      applyUniforms();
      startTime = nowMs();
      lastDraw = 0;
      window.addEventListener('resize', resize);
      if (!raf) raf = requestAnimationFrame(frame);
      return true;
    },
    stop: stop,
    setColors: function (cols) {
      if (cols && cols.length === 2) { color1 = cols[0]; color2 = cols[1]; }
      applyUniforms();
    },
    setIntensity: function (v) {
      intensity = v;
      applyUniforms();
    },
    isActive: function () { return !!raf; }
  };
})();
