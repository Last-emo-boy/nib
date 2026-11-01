// A grid of dots that grow toward one corner; the pointer brightens them nearby.
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 dots; // @input #2F6FEB Dots
uniform vec3 background; // @input #FFFFFF Background
uniform float spacing; // @input 14 4..60 Spacing

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 cell = floor(p / spacing) * spacing + spacing * 0.5;
  float grow = (cell.x / u_resolution.x + cell.y / u_resolution.y) * 0.5;
  float near = 1.0 - smoothstep(0.0, u_resolution.x * 0.35, distance(cell, u_mouse));
  float r = spacing * 0.5 * clamp(0.15 + 0.75 * grow + 0.3 * near, 0.0, 1.0);
  float inside = smoothstep(r + 0.75, r - 0.75, distance(p, cell));
  gl_FragColor = vec4(mix(background, dots, inside), 1.0);
}
