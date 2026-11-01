// Slow liquid marbling of three colors.
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 a; // @input #FFB703 First
uniform vec3 b; // @input #FB5607 Second
uniform vec3 c; // @input #8338EC Third
uniform float scale; // @input 2.5 0.5..8 Scale
uniform float speed; // @input 0.1 0..1 Speed

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, k = 0.5;
  for (int i = 0; i < 5; i++) { v += k * noise(p); p *= 2.0; k *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.y * scale;
  float t = u_time * speed;
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) - t));
  float v = fbm(uv + 3.0 * q);
  vec3 col = mix(a, b, smoothstep(0.2, 0.6, v));
  col = mix(col, c, smoothstep(0.55, 0.85, v));
  gl_FragColor = vec4(col, 1.0);
}
