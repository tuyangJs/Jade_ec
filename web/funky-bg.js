/* 流光（Funky）背景：原生 WebGL，单块全屏 canvas 同时绘制
   「跟随配色方案的渐变」+「3D simplex 噪声驱动的缓慢流动暗色等高线」。
   颜色由外部经 setColors / start 传入（三个 [r,g,b] 0..1），自动跟随配色方案与深浅。
   参考自 CodePen「Funky Header」(Jack Rugile) 的片元着色器。 */
(function () {
  'use strict';

  var canvas = null, gl = null, program = null, raf = null;
  var startTime = 0, timeAddition = Math.random() * 1000, lastDraw = 0;
  var uResolution, uTime, uColor1, uColor2, uColor3, uIntensity, uSpeed;
  // 兜底色（参考页橙→红→紫），正常情况下会被配色方案推导值覆盖
  var colors = [[0.988, 0.690, 0.271], [0.992, 0.114, 0.114], [0.514, 0.227, 0.706]];
  var intensity = 0.9;
  var speed = 2.0; // 流动速度（越小越慢）

  var VERT =
    'attribute vec2 position;\n' +
    'void main(){ gl_Position = vec4(position, 0.0, 1.0); }';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 resolution;',
    'uniform float time;',
    'uniform vec3 color1; uniform vec3 color2; uniform vec3 color3;',
    'uniform float intensity;',
    'uniform float uSpeed;',
    // --- Ashima simplex noise 3D ---
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    '  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    '  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);',
    '  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;',
    '  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);',
    '  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;',
    '  i=mod289(i);',
    '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    '  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;',
    '  vec4 j=p-49.0*floor(p*ns.z*ns.z);',
    '  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);',
    '  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);',
    '  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);',
    '  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));',
    '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    '  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);',
    '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    '  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
    '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;',
    '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}',
    // 等高线带：靠近 start 处返回大值，远处快速衰减
    'float band(float noise,float start,float len){',
    '  float d=start-noise; float fade=1.0; if(d<0.0)d*=-1.0;',
    '  if(d<len/2.0){ return 1.0; }',
    '  else if(d<len/2.0+fade){ return (fade/(d+len/2.0))*0.05; }',
    '  else { return 0.0; }',
    '}',
    'void main(){',
    // 斜向三段渐变（跟随配色方案的三色）
    '  float t = gl_FragCoord.x/resolution.x*0.7 + gl_FragCoord.y/resolution.y*0.3;',
    '  vec3 grad = t<0.5 ? mix(color1,color2,t*2.0) : mix(color2,color3,(t-0.5)*2.0);',
    // 流动暗纹
    '  float scale=0.6;',
    '  vec2 st=gl_FragCoord.xy/resolution.xy; st.x*=resolution.x/resolution.y; st*=scale;',
    '  float noise=snoise(vec3(st.x, st.y, time*uSpeed*0.01));',
    '  float dark=0.0;',
    '  dark+=band(noise,0.0,0.02); dark+=band(noise,0.3,0.02); dark+=band(noise,0.6,0.02);',
    '  dark=clamp(dark,0.0,1.0);',
    // 暗纹处变暗（等高线核心保持渐变原色，呈亮脉络）
    '  float shade=(1.0-dark)*intensity;',
    '  gl_FragColor=vec4(grad*(1.0-shade), 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[FunkyBG] shader compile error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function ensureCanvas() {
    if (canvas) return true;
    var c = document.createElement('canvas');
    c.id = 'funky-canvas';
    document.body.appendChild(c);
    gl = c.getContext('webgl', { alpha: false, antialias: false, depth: false })
      || c.getContext('experimental-webgl');
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
      console.error('[FunkyBG] program link error:', gl.getProgramInfoLog(program));
      stop();
      return false;
    }
    gl.useProgram(program);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    uResolution = gl.getUniformLocation(program, 'resolution');
    uTime = gl.getUniformLocation(program, 'time');
    uColor1 = gl.getUniformLocation(program, 'color1');
    uColor2 = gl.getUniformLocation(program, 'color2');
    uColor3 = gl.getUniformLocation(program, 'color3');
    uIntensity = gl.getUniformLocation(program, 'intensity');
    uSpeed = gl.getUniformLocation(program, 'uSpeed');
    return true;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function resize() {
    if (!canvas || !gl) return;
    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    if (canvas.width === w && canvas.height === h) return; // 尺寸未变则不重设缓冲，避免无谓清屏
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    // 改变 canvas 尺寸会清空绘制缓冲（变黑），而绘制循环被节流到 ~30fps，
    // 期间窗口会闪一下黑。这里立即补绘一帧，消除缩放时的闪烁。
    drawNow(nowMs());
  }

  function applyUniforms() {
    if (!gl || !program) return;
    gl.useProgram(program);
    gl.uniform3fv(uColor1, colors[0]);
    gl.uniform3fv(uColor2, colors[1]);
    gl.uniform3fv(uColor3, colors[2]);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uSpeed, speed);
  }

  function drawNow(now) {
    if (!gl || !program || !canvas) return;
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - startTime) / 1000 + timeAddition);
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

  window.FunkyBG = {
    start: function (cols) {
      if (cols && cols.length === 3) colors = cols;
      if (!ensureCanvas()) return false;
      resize();
      applyUniforms();
      startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      lastDraw = 0;
      window.addEventListener('resize', resize);
      if (!raf) raf = requestAnimationFrame(frame);
      return true;
    },
    stop: stop,
    setColors: function (cols) {
      if (cols && cols.length === 3) colors = cols;
      applyUniforms();
    },
    setIntensity: function (v) {
      intensity = v;
      applyUniforms();
    },
    setSpeed: function (v) {
      speed = v;
      applyUniforms();
    },
    isActive: function () { return !!raf; }
  };
})();
