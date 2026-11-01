// Aurora: soft bands of color drifting across the layer.
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 colorA; // @input #0B1026 Sky
uniform vec3 colorB; // @input #2DE2A6 Glow
uniform vec3 colorC; // @input #7B5CFF Haze
uniform float speed; // @input 0.15 0..1 Speed

float wave(vec2 p, float k, float t) {
  return sin(p.x * k + t) * 0.5 + sin(p.x * k * 0.37 - t * 1.3 + p.y * 2.0) * 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * speed * 6.2831;
  float a = smoothstep(0.35, 0.0, abs(uv.y - 0.55 - 0.12 * wave(uv, 3.0, t)));
  float b = smoothstep(0.30, 0.0, abs(uv.y - 0.35 - 0.10 * wave(uv + 3.1, 4.0, t * 0.8)));
  vec3 c = mix(colorA, colorB, a * 0.85);
  c = mix(c, colorC, b * 0.6);
  gl_FragColor = vec4(c, 1.0);
}
