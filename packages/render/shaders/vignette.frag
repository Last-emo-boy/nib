// Effect: corners darkened, the middle left alone.
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D layer; // @source
uniform float strength; // @input 0.45 0..1 Strength

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 c = texture2D(layer, uv);
  float v = 1.0 - strength * smoothstep(0.35, 0.95, length(uv - 0.5) * 1.414);
  gl_FragColor = vec4(c.rgb * v, c.a);
}
