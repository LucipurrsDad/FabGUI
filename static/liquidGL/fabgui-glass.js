// Optical profile and dispersion adapted from liquidGL by NaughtyDuk (MIT).
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 aRect;
layout(location=1) in float aRadius;
uniform vec2 uSize;
out vec2 screen;
out vec2 point;
flat out vec2 halfBox;
flat out float radius;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  screen = aRect.xy + corner * aRect.zw;
  halfBox = aRect.zw * .5;
  point = (corner - .5) * aRect.zw;
  radius = aRadius;
  gl_Position = vec4(screen / uSize * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
}`;

const BACKDROP = `#version 300 es
precision highp float;
in vec2 screen;
uniform vec2 uSize;
uniform sampler2D uMedia;
uniform vec2 uCover;
uniform float uParallax;
uniform bool uHasMedia;
uniform float uTime;
uniform float uDim;
uniform float uBloom;
uniform float uParticles;
uniform float uAurora;
uniform float uGrain;
uniform float uVignette;
out vec4 color;

float hash(vec2 cell) {
  return fract(52.9829189 * fract(dot(cell, vec2(.06711056, .00583715))));
}

vec3 media(vec2 uv) {
  if (!uHasMedia) return vec3(.115, .13, .16);
  return texture(uMedia, uv).rgb;
}

void main() {
  vec2 viewportUV = screen / uSize;
  vec2 uv = .5 + (viewportUV - .5) * uCover * (1. - abs(uParallax)) + vec2(0., uParallax * .47);
  vec3 col = media(uv);
  if (uBloom > 0.) {
    vec2 d = 20. * uCover / uSize;
    vec3 halo = (media(uv + d) + media(uv - d) +
      media(uv + d * vec2(1., -1.)) + media(uv + d * vec2(-1., 1.))) * .25;
    col += uBloom * .45 * max(halo - .34, vec3(0.));
  }
  if (uAurora > 0.) {
    float fold = sin(viewportUV.x * 5.5 + uTime * .24) * .12
      + sin(viewportUV.x * 12. - uTime * .31) * .055;
    float y = viewportUV.y - fold;
    float green = exp(-pow(abs(y - .31) * 9., 2.));
    float purple = exp(-pow(abs(y - .45) * 11., 2.));
    col += uAurora * (green * vec3(.035, .31, .21) + purple * vec3(.23, .05, .30));
  }
  if (uParticles > 0.) {
    vec2 field = (screen + vec2(-uTime * 5., uTime * 9.)) / 84.;
    vec2 cell = floor(field);
    vec2 star = vec2(hash(cell), hash(cell.yx + 71.)) * .76 + .12;
    float dust = 1. - smoothstep(.008, .035, distance(fract(field), star));
    col += dust * uParticles * vec3(.39, .61, .74);
  }
  col *= 1. - uVignette * .72 * smoothstep(.18, .70, length(viewportUV - .5));
  if (uGrain > 0.) col += (hash(floor(screen)) - .5) * .18 * uGrain;
  color = vec4(mix(col, vec3(12., 14., 18.) / 255., uDim), 1.);
}`;

const GLASS = `#version 300 es
precision highp float;
in vec2 screen;
in vec2 point;
flat in vec2 halfBox;
flat in float radius;
uniform vec2 uSize;
uniform sampler2D uBackdrop;
uniform float uBevel;
uniform float uCurvature;
uniform float uIOR;
uniform float uThickness;
uniform float uStrength;
uniform float uDispersion;
uniform float uFrost;
uniform float uTint;
uniform float uSpecular;
uniform float uCaustic;
uniform float uBleed;
uniform float uTime;
out vec4 color;

vec3 sampleBackdrop(vec2 pixels) {
  vec2 uv = pixels / uSize;
  return texture(uBackdrop, vec2(uv.x, 1. - uv.y)).rgb;
}

float rayOffset(float incidence, float ior) {
  // Snell's law at the curved air/glass interface.
  float transmitted = asin(sin(incidence) / max(ior, 1.));
  return tan(incidence - transmitted) * uThickness * uStrength;
}

vec2 refractedPoint(vec2 normal, float incidence, float ior) {
  vec2 displaced = screen + normal * rayOffset(incidence, ior);
  vec2 outside = max(-displaced, displaced - uSize);
  // Blend back to the unrefracted scene at the edge of the captured viewport.
  return mix(displaced, screen, smoothstep(0., 8., max(outside.x, outside.y)));
}

void main() {
  vec2 q = abs(point) - halfBox + radius;
  vec2 corner = max(q, 0.);
  float distanceToEdge = length(corner) + min(max(q.x, q.y), 0.) - radius;
  float aa = max(fwidth(distanceToEdge) * .5, .15);
  float mask = 1. - smoothstep(-aa, aa, distanceToEdge);
  if (mask <= 0.) discard;

  // Rounded-box distance and its normal are in CSS pixels. Both the bevel
  // and ray travel stay isotropic on wide panes, at any canvas resolution.
  vec2 normal = dot(corner, corner) > .00001
    ? normalize(corner) : (q.x > q.y ? vec2(1., 0.) : vec2(0., 1.));
  normal *= mix(vec2(-1.), vec2(1.), step(vec2(0.), point));
  float bevel = min(uBevel, min(halfBox.x, halfBox.y) - .5);
  float edge = 1. - smoothstep(0., max(bevel, .5), -distanceToEdge);
  // liquidGL's smooth bevel and steep outer rim, expressed as a normal angle.
  float profile = mix(edge, pow(edge, 10.), .30);
  float incidence = profile * mix(.38, 1.43, uCurvature);
  vec2 samplePoint = refractedPoint(normal, incidence, uIOR);
  vec3 col = sampleBackdrop(samplePoint);

  if (uFrost > 0.) {
    vec2 d = vec2(.67, .30) * uFrost;
    col = .28 * col + .18 * (sampleBackdrop(samplePoint + d) + sampleBackdrop(samplePoint - d)
      + sampleBackdrop(samplePoint + vec2(-d.y, d.x)) + sampleBackdrop(samplePoint + vec2(d.y, -d.x)));
  }
  if (uDispersion > 0. && edge > 0. && uIOR > 1.) {
    float spread = (uIOR - 1.) * uDispersion * .27;
    vec3 shifted = col;
    shifted.r = sampleBackdrop(refractedPoint(normal, incidence, uIOR - spread)).r;
    shifted.b = sampleBackdrop(refractedPoint(normal, incidence, uIOR + spread)).b;
    col = mix(col, shifted, 1. - .065 * uFrost);
  }
  col = mix(col, col * (56. / 255.), uTint);
  if (uBleed > 0.) {
    vec3 ambient = sampleBackdrop(screen - normal * 20.);
    col += uBleed * (.035 + .14 * edge) * max(ambient - min(ambient.r, min(ambient.g, ambient.b)), 0.);
  }
  if (uSpecular > 0.) {
    float reflectance = pow((uIOR - 1.) / (uIOR + 1.), 2.);
    float fresnel = mix(reflectance, 1., pow(1. - cos(incidence), 5.));
    float key = .24 + .76 * max(0., dot(normal, vec2(-.53, -.85)));
    col += uSpecular * key * (fresnel * edge + .10 * pow(edge, 6.));
  }
  if (uCaustic > 0.) {
    float wave = .5 + .5 * sin(dot(screen, vec2(.062, .043)) - uTime * 2.6);
    col += uCaustic * pow(edge, 3.) * pow(wave, 6.) * vec3(.18, .24, .30);
  }
  color = vec4(col, mask);
}`;

const COPY = `#version 300 es
precision highp float;
in vec2 screen;
uniform vec2 uSize;
uniform sampler2D uBackdrop;
out vec4 color;
void main() {
  vec2 uv = screen / uSize;
  color = texture(uBackdrop, vec2(uv.x, 1. - uv.y));
}`;

function program(gl, fragment, uniforms) {
  const stages = [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const handle = gl.createProgram();
  for (const shader of stages) gl.attachShader(handle, shader);
  gl.linkProgram(handle);
  for (const shader of stages) gl.deleteShader(shader);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle));
  return {
    handle,
    uniforms: Object.fromEntries(uniforms.split(" ").map((name) => [name, gl.getUniformLocation(handle, `u${name}`)])),
  };
}

function texture(gl) {
  const id = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, id);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return id;
}

const GLASS_UNIFORMS = {
  Curvature: "curvature", IOR: "refractionIndex", Thickness: "thickness",
  Strength: "refractionStrength", Dispersion: "dispersion", Frost: "glassFrost",
  Specular: "specular", Caustic: "caustics", Bleed: "colorBleed",
};

export class LiquidGlass {
  constructor(canvas, output) {
    this.canvas = canvas;
    this.output = output;
    const gl = canvas.getContext("webgl2", {
      alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL 2 is unavailable");
    this.gl = gl;
    this.backdrop = program(gl, BACKDROP, "Size Media Cover Parallax HasMedia Time Dim Bloom Particles Aurora Grain Vignette");
    this.glass = program(gl, GLASS, `Size Backdrop Bevel Tint Time ${Object.keys(GLASS_UNIFORMS).join(" ")}`);
    this.copy = program(gl, COPY, "Size Backdrop");
    this.mediaTexture = texture(gl);
    this.backdropTexture = texture(gl);
    this.framebuffer = gl.createFramebuffer();
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(0, 1);
    gl.vertexAttribDivisor(1, 1);
  }

  resize(width, height, dpr) {
    const { gl, output } = this;
    // Bound framebuffer area on high-DPI/ultrawide displays. Shader units
    // and viewport mapping use CSS pixels, independent of this render scale.
    const scale = Math.min(dpr, 2, Math.sqrt(3_500_000 / (width * height)),
      this.maxTexture / width, this.maxTexture / height);
    const pixelWidth = Math.max(1, Math.floor(width * scale));
    const pixelHeight = Math.max(1, Math.floor(height * scale));
    const resized = width !== this.width || height !== this.height
      || pixelWidth !== output.canvas.width || pixelHeight !== output.canvas.height;
    if (!resized) return false;
    this.width = width;
    this.height = height;
    this.scaleX = pixelWidth / width;
    this.scaleY = pixelHeight / height;
    output.canvas.width = pixelWidth;
    output.canvas.height = pixelHeight;
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.backdropTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Backdrop framebuffer incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  upload(source, width, height) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTexture);
    if (width === this.mediaWidth && height === this.mediaHeight) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.mediaWidth = width;
      this.mediaHeight = height;
    }
  }

  use({ handle, uniforms }) {
    this.gl.useProgram(handle);
    this.gl.uniform2f(uniforms.Size, this.width, this.height);
    return uniforms;
  }

  draw(boxes) {
    if (!boxes.length) return;
    const { gl } = this;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boxes.flat()), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, boxes.length);
  }

  compose(settings, source, time, parallax) {
    const { gl, width, height, output } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, output.canvas.width, output.canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTexture);
    const u = this.use(this.backdrop);
    const aspect = source ? (width / height) / (this.mediaWidth / this.mediaHeight) : 1;
    gl.uniform2f(u.Cover, Math.min(1, aspect), Math.min(1, 1 / aspect));
    gl.uniform1i(u.HasMedia, Number(source));
    gl.uniform1f(u.Parallax, parallax);
    gl.uniform1f(u.Time, time);
    gl.uniform1f(u.Dim, settings.dim / 100);
    gl.uniform1f(u.Bloom, settings.bloom);
    gl.uniform1f(u.Particles, settings.particles);
    gl.uniform1f(u.Aurora, settings.aurora);
    gl.uniform1f(u.Grain, settings.grain);
    gl.uniform1f(u.Vignette, settings.vignette);
    this.draw([[0, 0, width, height, 0]]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  paint(settings, boxes, overlays, time) {
    const { gl, canvas, output, width, height } = this;
    const w = output.canvas.width;
    const h = output.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
    const u = this.use(this.glass);
    for (const [uniform, key] of Object.entries(GLASS_UNIFORMS)) gl.uniform1f(u[uniform], settings[key]);
    // Legacy bevelWidth was a fraction. Its reference is now a fixed 80px
    // rather than each lens height, so saved values retain their ordering.
    gl.uniform1f(u.Bevel, settings.bevelWidth * 80);
    gl.uniform1f(u.Tint, settings.tint / 100);
    gl.uniform1f(u.Time, time);
    for (const { box, context, crop } of overlays) {
      const [x, y, cropWidth, cropHeight] = crop;
      // Shift the viewport into a tightly sized output. Transfer ownership
      // of its GPU bitmap to the DOM without reading the canvas back to JS.
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      gl.viewport(-x, y + cropHeight - h, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.draw([box]);
      context.transferFromImageBitmap(canvas.transferToImageBitmap());
    }
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    gl.viewport(0, 0, w, h);
    this.use(this.copy);
    this.draw([[0, 0, width, height, 0]]);
    gl.useProgram(this.glass.handle);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.draw(boxes);
    gl.disable(gl.BLEND);
    output.transferFromImageBitmap(canvas.transferToImageBitmap());
  }
}
