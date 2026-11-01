// Effect: red and blue shifted apart, as from a cheap lens.
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D layer; // @source
uniform float shift; // @input 3 0..20 Shift

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 o = vec2(shift, 0.0) / u_resolution;
  vec4 g = texture2D(layer, uv);
  float r = texture2D(layer, uv + o).r;
  float b = texture2D(layer, uv - o).b;
  gl_FragColor = vec4(r, g.g, b, g.a);
}
