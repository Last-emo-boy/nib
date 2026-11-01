// Stripes that ripple, slowly moving.
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 ink; // @input #1C1C28 Lines
uniform vec3 paper; // @input #F4EFE6 Background
uniform float count; // @input 14 2..60 Lines
uniform float amount; // @input 0.04 0..0.2 Waviness
uniform float speed; // @input 0.2 0..2 Speed

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float y = uv.y + amount * sin(uv.x * 9.0 + u_time * speed * 6.2831);
  float s = abs(fract(y * count) - 0.5);
  float line = smoothstep(0.18, 0.12, s);
  gl_FragColor = vec4(mix(paper, ink, line), 1.0);
}
