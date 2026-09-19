(() => {
  'use strict';
  if (window.__uncapGpu) return;

  const vertexSource = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const lumaSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D src;

void main() {
  vec3 c = texture(src, uv).rgb;
  frag = vec4(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), 1.0);
}`;

  const restSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D lumaPast;
uniform sampler2D lumaNow;

void main() {
  frag = vec4(vec3(abs(texture(lumaNow, uv).r - texture(lumaPast, uv).r)), 1.0);
}`;

  const packing = `
vec4 packFlow(vec2 f, float span) {
  vec2 unit = clamp(f / span, -1.0, 1.0) * 0.5 + 0.5;
  vec2 scaled = floor(unit * 65535.0 + 0.5);
  vec2 hi = floor(scaled / 256.0);
  vec2 lo = scaled - hi * 256.0;
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}

vec2 unpackFlow(vec4 texel, float span) {
  vec2 hi = vec2(texel.r, texel.b) * 255.0;
  vec2 lo = vec2(texel.g, texel.a) * 255.0;
  vec2 unit = floor(hi + 0.5) * 256.0 + floor(lo + 0.5);
  return ((unit / 65535.0) * 2.0 - 1.0) * span;
}`;

  const searchSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D lumaPast;
uniform sampler2D lumaNow;
uniform sampler2D coarse;
uniform vec2 stride;
uniform float level;
uniform float span;
uniform float reach;
uniform float steps;
uniform float seeded;
${packing}

const vec2 dirs[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.7071, 0.7071), vec2(0.7071, -0.7071), vec2(-0.7071, 0.7071), vec2(-0.7071, -0.7071)
);

float at(sampler2D tex, vec2 p) { return textureLod(tex, p, level).r; }

float cost(vec2 shift) {
  vec2 across = vec2(stride.x, -stride.y);
  return abs(at(lumaNow, uv) - at(lumaPast, uv + shift))
    + abs(at(lumaNow, uv + stride) - at(lumaPast, uv + stride + shift))
    + abs(at(lumaNow, uv - stride) - at(lumaPast, uv - stride + shift))
    + abs(at(lumaNow, uv + across) - at(lumaPast, uv + across + shift))
    + abs(at(lumaNow, uv - across) - at(lumaPast, uv - across + shift));
}

void main() {
  vec2 seed = seeded > 0.5 ? unpackFlow(texture(coarse, uv), span) : vec2(0.0);
  float seeded_cost = cost(seed);
  float idle = cost(vec2(0.0));
  vec2 best = seeded_cost <= idle ? seed : vec2(0.0);
  float lowest = min(seeded_cost, idle);

  for (int s = 0; s < 4; s++) {
    if (float(s) >= steps) break;
    float radius = reach / exp2(float(s));
    for (int k = 0; k < 8; k++) {
      vec2 candidate = best + dirs[k] * radius * stride;
      float score = cost(candidate);
      if (score < lowest * 0.99) {
        lowest = score;
        best = candidate;
      }
    }
  }

  frag = packFlow(best, span);
}`;

  const blendSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D past;
uniform sampler2D now;
uniform sampler2D flowBack;
uniform sampler2D flowForth;
uniform sampler2D rest;
uniform vec2 fine;
uniform float span;
uniform float phase;
uniform float trust;
uniform float still;
${packing}

vec2 fieldAt(sampler2D tex, vec2 p) { return unpackFlow(texture(tex, p), span); }

vec2 eased(sampler2D tex, vec2 p) {
  return (fieldAt(tex, p) * 8.0
    + fieldAt(tex, p + vec2(fine.x, 0.0))
    + fieldAt(tex, p - vec2(fine.x, 0.0))
    + fieldAt(tex, p + vec2(0.0, fine.y))
    + fieldAt(tex, p - vec2(0.0, fine.y))) / 12.0;
}

void main() {
  vec3 held = texture(past, uv).rgb;
  vec3 fresh = texture(now, uv).rgb;

  float motionless = 1.0 - smoothstep(still, still * 4.0, dot(abs(held - fresh), vec3(0.3333333)));
  vec3 plain = mix(held, fresh, phase);
  vec3 nearest = phase < 0.5 ? held : fresh;

  vec2 back = eased(flowBack, uv);
  vec2 forth = eased(flowForth, uv + back);
  float drift = length(back + forth) / max(length(back), 1e-4);
  float mutual = 1.0 - smoothstep(0.35, 0.95, drift);

  vec3 a = texture(past, uv + back * phase).rgb;
  vec3 b = texture(now, uv - back * (1.0 - phase)).rgb;

  float upheaval = textureLod(rest, vec2(0.5), 16.0).r;
  float scene = 1.0 - smoothstep(0.20, 0.32, upheaval);
  float disagree = dot(abs(a - b), vec3(0.3333333));
  float photo = 1.0 - smoothstep(trust * 0.4, trust, disagree);

  float faith = scene * mutual * photo * (1.0 - motionless);
  frag = vec4(mix(mix(nearest, plain, motionless), mix(a, b, phase), faith), 1.0);
}`;

  const upscaleSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D src;
uniform vec2 size;
uniform vec2 spread;
uniform float taps;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec4 shrink(vec2 base) {
  int n = int(taps);
  float span = 1.0 / taps;
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= n) break;
    for (int i = 0; i < 4; i++) {
      if (i >= n) break;
      vec2 off = ((vec2(float(i), float(j)) + 0.5) * span - 0.5) * spread;
      sum += texture(src, base + off).rgb;
    }
  }
  return vec4(sum / (taps * taps), 1.0);
}

void quadrant(inout vec2 dir, inout float len, float weight,
              float a, float b, float c, float d, float e) {
  float reachX = 1.0 / max(max(abs(d - c), abs(c - b)), 1e-5);
  float dirX = d - b;
  dir.x += dirX * weight;
  float lenX = clamp(abs(dirX) * reachX, 0.0, 1.0);
  len += lenX * lenX * weight;

  float reachY = 1.0 / max(max(abs(e - c), abs(c - a)), 1e-5);
  float dirY = e - a;
  dir.y += dirY * weight;
  float lenY = clamp(abs(dirY) * reachY, 0.0, 1.0);
  len += lenY * lenY * weight;
}

void tap(inout vec3 acc, inout float total, vec2 off, vec2 dir, vec2 len,
         float lob, float clp, vec3 colour) {
  vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 2.0 / 5.0 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 25.0 / 16.0 * wB - 9.0 / 16.0;
  float w = wB * wA;
  acc += colour * w;
  total += w;
}

vec4 stretch(vec2 base) {
  vec2 texel = 1.0 / size;
  vec2 pp = base * size - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  vec2 anchor = (fp + 0.5) * texel;

  vec3 b = texture(src, anchor + vec2( 0.0, -1.0) * texel).rgb;
  vec3 c = texture(src, anchor + vec2( 1.0, -1.0) * texel).rgb;
  vec3 e = texture(src, anchor + vec2(-1.0,  0.0) * texel).rgb;
  vec3 f = texture(src, anchor + vec2( 0.0,  0.0) * texel).rgb;
  vec3 g = texture(src, anchor + vec2( 1.0,  0.0) * texel).rgb;
  vec3 h = texture(src, anchor + vec2( 2.0,  0.0) * texel).rgb;
  vec3 i = texture(src, anchor + vec2(-1.0,  1.0) * texel).rgb;
  vec3 j = texture(src, anchor + vec2( 0.0,  1.0) * texel).rgb;
  vec3 k = texture(src, anchor + vec2( 1.0,  1.0) * texel).rgb;
  vec3 l = texture(src, anchor + vec2( 2.0,  1.0) * texel).rgb;
  vec3 m = texture(src, anchor + vec2( 0.0,  2.0) * texel).rgb;
  vec3 o = texture(src, anchor + vec2( 1.0,  2.0) * texel).rgb;

  vec2 dir = vec2(0.0);
  float len = 0.0;
  quadrant(dir, len, (1.0 - pp.x) * (1.0 - pp.y), luma(b), luma(e), luma(f), luma(g), luma(j));
  quadrant(dir, len, pp.x * (1.0 - pp.y),         luma(c), luma(f), luma(g), luma(h), luma(k));
  quadrant(dir, len, (1.0 - pp.x) * pp.y,         luma(f), luma(i), luma(j), luma(k), luma(m));
  quadrant(dir, len, pp.x * pp.y,                 luma(g), luma(j), luma(k), luma(l), luma(o));

  float pull = dot(dir, dir);
  dir = pull < 1.0 / 32768.0 ? vec2(1.0, 0.0) : dir * inversesqrt(max(pull, 1e-8));

  len = len * 0.5;
  len *= len;
  float widen = 1.0 / max(max(abs(dir.x), abs(dir.y)), 1e-5);
  vec2 reach = vec2(1.0 + (widen - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 - 0.29 * len;
  float clp = 1.0 / lob;

  vec3 lo = min(min(f, g), min(j, k));
  vec3 hi = max(max(f, g), max(j, k));

  vec3 acc = vec3(0.0);
  float total = 0.0;
  tap(acc, total, vec2( 0.0, -1.0) - pp, dir, reach, lob, clp, b);
  tap(acc, total, vec2( 1.0, -1.0) - pp, dir, reach, lob, clp, c);
  tap(acc, total, vec2(-1.0,  1.0) - pp, dir, reach, lob, clp, i);
  tap(acc, total, vec2( 0.0,  1.0) - pp, dir, reach, lob, clp, j);
  tap(acc, total, vec2( 0.0,  0.0) - pp, dir, reach, lob, clp, f);
  tap(acc, total, vec2(-1.0,  0.0) - pp, dir, reach, lob, clp, e);
  tap(acc, total, vec2( 1.0,  1.0) - pp, dir, reach, lob, clp, k);
  tap(acc, total, vec2( 2.0,  1.0) - pp, dir, reach, lob, clp, l);
  tap(acc, total, vec2( 2.0,  0.0) - pp, dir, reach, lob, clp, h);
  tap(acc, total, vec2( 1.0,  0.0) - pp, dir, reach, lob, clp, g);
  tap(acc, total, vec2( 1.0,  2.0) - pp, dir, reach, lob, clp, o);
  tap(acc, total, vec2( 0.0,  2.0) - pp, dir, reach, lob, clp, m);

  return vec4(min(hi, max(lo, acc / max(total, 1e-5))), 1.0);
}

void main() {
  vec2 base = vec2(uv.x, 1.0 - uv.y);
  frag = taps > 1.5 ? shrink(base) : stretch(base);
}`;

  const restoreSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D src;
uniform vec2 texel;
uniform float denoise;
uniform float thin;
uniform float deblur;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(vec2 base, float x, float y) { return texture(src, base + vec2(x, y) * texel).rgb; }

void main() {
  vec2 base = uv;

  if (thin > 0.001) {
    float centre = luma(at(base, 0.0, 0.0));
    vec2 grad = vec2(
      luma(at(base, 1.0, 0.0)) - luma(at(base, -1.0, 0.0)),
      luma(at(base, 0.0, 1.0)) - luma(at(base, 0.0, -1.0))
    );
    if (length(grad) > 0.004) {
      float dark = 1.0 - smoothstep(0.1, 0.65, centre);
      base += normalize(grad) * texel * thin * 0.75 * dark;
    }
  }

  vec3 middle = texture(src, base).rgb;
  vec3 lo = middle;
  vec3 hi = middle;
  vec3 blur = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 other = at(base, float(i), float(j));
      lo = min(lo, other);
      hi = max(hi, other);
      blur += other * ((i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0));
    }
  }
  blur /= 16.0;

  if (deblur > 0.001) {
    float onLine = smoothstep(0.02, 0.16, dot(hi - lo, vec3(0.3333333)));
    middle = clamp(middle + (middle - blur) * deblur * 2.2 * onLine, lo, hi);
  }

  if (denoise > 0.001) {
    float reach = 0.08 + denoise * 0.14;
    vec3 sum = middle;
    float weight = 1.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec3 other = at(base, float(i), float(j));
        float close = exp(-dot(abs(other - middle), vec3(0.3333333)) / reach);
        sum += other * close;
        weight += close;
      }
    }
    middle = mix(middle, sum / weight, denoise);
  }

  frag = vec4(middle, 1.0);
}`;

  const finishSource = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 frag;
uniform sampler2D src;
uniform vec2 texel;
uniform float amount;
uniform float darken;
uniform float deband;
uniform float split;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(float x, float y) { return texture(src, uv + vec2(x, y) * texel).rgb; }

void main() {
  float edge = (uv.x - split) / texel.x;
  if (split > 0.0 && edge >= 0.0 && edge < 4.0) {
    frag = vec4(vec3(edge < 1.0 ? 0.06 : 0.97), 1.0);
    return;
  }

  vec3 e = at(0.0, 0.0);
  vec3 b = at(0.0, -1.0);
  vec3 d = at(-1.0, 0.0);
  vec3 f = at(1.0, 0.0);
  vec3 h = at(0.0, 1.0);

  vec3 result = e;

  if (deband > 0.001) {
    float reach = 1.0 + deband * 7.0;
    vec3 n0 = at(reach, 0.0);
    vec3 n1 = at(-reach, 0.0);
    vec3 n2 = at(0.0, reach);
    vec3 n3 = at(0.0, -reach);
    vec3 average = (n0 + n1 + n2 + n3) * 0.25;
    vec3 lo = min(min(n0, n1), min(n2, n3));
    vec3 hi = max(max(n0, n1), max(n2, n3));
    float plateau = 1.0 - smoothstep(0.004, 0.02 + deband * 0.02, dot(hi - lo, vec3(0.3333333)));
    float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    result = mix(result, average + grain * 0.0035, plateau * deband);
  }

  if (amount > 0.001) {
    float bL = luma(b), dL = luma(d), eL = luma(result), fL = luma(f), hL = luma(h);
    float lowest = min(min(bL, dL), min(min(eL, fL), hL));
    float highest = max(max(bL, dL), max(max(eL, fL), hL));
    float noise = clamp(abs(0.25 * (bL + dL + fL + hL) - eL) / max(highest - lowest, 1e-4), 0.0, 1.0);
    noise = 1.0 - 0.5 * noise;

    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));
    vec3 hitMin = mn4 / (4.0 * mx4 + 1e-4);
    vec3 hitMax = (1.0 - mx4) / (4.0 * mn4 - 4.0 - 1e-4);
    vec3 lobes = max(-hitMin, hitMax);
    float lobe = max(-0.1875, min(max(max(lobes.r, lobes.g), lobes.b), 0.0)) * amount * noise;
    result = (lobe * (b + d + f + h) + result) / (4.0 * lobe + 1.0);
  }

  if (darken > 0.001) {
    float lc = luma(result);
    float lo = min(min(luma(b), luma(d)), min(luma(f), luma(h)));
    float hi = max(max(luma(b), luma(d)), max(luma(f), luma(h)));
    float contrast = hi - lo;
    float onLine = smoothstep(0.05, 0.22, contrast)
      * (1.0 - smoothstep(0.0, 0.55, (lc - lo) / max(contrast, 1e-4)));
    result *= mix(1.0, clamp(lo / max(lc, 1e-4), 0.55, 1.0), darken * onLine);
  }

  frag = vec4(clamp(result, 0.0, 1.0), 1.0);
}`;

  const ceiling = { width: 3840, height: 2160 };
  const lockedHeights = { 1080: 1080, 1440: 1440, 2160: 2160 };

  const measure = (element, target) => {
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return null;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = Math.round(box.width * ratio);
    let height = Math.round(box.height * ratio);

    if (target === 'native' && element.videoWidth) {
      width = element.videoWidth;
      height = element.videoHeight;
    } else if (lockedHeights[target] && element.videoWidth) {
      const aspect = element.videoWidth / element.videoHeight;
      height = lockedHeights[target];
      width = Math.round(height * aspect);
    }

    return {
      box,
      width: Math.max(2, Math.min(width, ceiling.width)),
      height: Math.max(2, Math.min(height, ceiling.height))
    };
  };

  const parentFor = (element) => (document.fullscreenElement?.contains(element)
    ? document.fullscreenElement
    : element.parentElement);

  const open = (canvas) => {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('webgl2 unavailable');

    try { gl.unpackColorSpace = 'display-p3'; } catch { }
    try { gl.drawingBufferColorSpace = 'display-p3'; } catch { }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const compile = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(reason || 'shader');
      }
      return shader;
    };

    const link = (fragment, names) => {
      const program = gl.createProgram();
      const vs = compile(gl.VERTEX_SHADER, vertexSource);
      const fs = compile(gl.FRAGMENT_SHADER, fragment);
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const reason = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(reason || 'link');
      }
      const at = {};
      for (const name of names) at[name] = gl.getUniformLocation(program, name);
      return { program, at };
    };

    const texture = (mode) => {
      const made = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, made);
      const smooth = mode !== 'nearest';
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
        mode === 'mip' ? gl.LINEAR_MIPMAP_LINEAR : smooth ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return made;
    };

    const bind = (unit, made) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, made);
    };

    const sized = (made, width, height) => {
      bind(0, made);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    };

    const mipmap = (made) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      bind(0, made);
      gl.generateMipmap(gl.TEXTURE_2D);
    };

    const buffer = gl.createFramebuffer();

    const target = (made, width, height) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, made, 0);
      gl.viewport(0, 0, width, height);
    };

    const screen = (width, height) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
    };

    const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(gl.createVertexArray());

    return { gl, link, texture, bind, sized, mipmap, target, screen, draw };
  };

  const surface = (floor, onLost) => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1;display:block';
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      onLost();
    });

    const kit = open(canvas);
    let geometry = '';

    kit.canvas = canvas;
    kit.measure = measure;

    kit.place = (element, target) => {
      const parent = parentFor(element);
      if (!parent) return null;

      if (canvas.parentElement !== parent) {
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        parent.appendChild(canvas);
      }

      const size = measure(element, target);
      if (!size) return null;
      if (size.width < element.videoWidth * floor) return 'tiny';

      const { box, width, height } = size;
      const frame = parent.getBoundingClientRect();
      const left = box.left - frame.left - parent.clientLeft + parent.scrollLeft;
      const top = box.top - frame.top - parent.clientTop + parent.scrollTop;
      const shape = `${left}|${top}|${box.width}|${box.height}`;
      if (shape !== geometry) {
        geometry = shape;
        canvas.style.left = `${left}px`;
        canvas.style.top = `${top}px`;
        canvas.style.width = `${box.width}px`;
        canvas.style.height = `${box.height}px`;
      }

      const resized = canvas.width !== width || canvas.height !== height;
      if (resized) {
        canvas.width = width;
        canvas.height = height;
      }

      const factor = element.videoWidth ? width / element.videoWidth : 0;
      return {
        resized,
        width,
        height,
        from: `${element.videoWidth} × ${element.videoHeight}`,
        to: `${width} × ${height}`,
        factor: Number(factor.toFixed(2)),
        taps: factor >= 0.98 ? 0 : Math.min(4, Math.max(2, Math.ceil(0.5 / factor)))
      };
    };

    return kit;
  };

  window.__uncapGpu = {
    surface,
    measure,
    lumaSource,
    restSource,
    searchSource,
    blendSource,
    upscaleSource,
    restoreSource,
    finishSource
  };
})();
