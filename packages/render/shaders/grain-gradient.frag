// A two-color gradient with fine film grain, at an angle.
precision mediump float;
uniform vec2 u_resolution;
uniform vec3 from; // @input #FF7A59 From
uniform vec3 to; // @input #6A5CFF To
uniform float angle; // @input 135 0..360 Angle
uniform float grain; // @input 0.08 0..0.3 Grain

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float r = radians(angle);
  vec2 d = vec2(sin(r), -cos(r));
  float t = clamp(dot(uv - 0.5, d) + 0.5, 0.0, 1.0);
  vec3 c = mix(from, to, t);
  c += (hash(gl_FragCoord.xy) - 0.5) * grain;
  gl_FragColor = vec4(c, 1.0);
}
