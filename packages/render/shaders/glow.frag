// Effect: a colored glow around what the layer draws.
// @margin 32
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D layer; // @source
uniform vec3 color; // @input #FF4FD8 Glow
uniform float radius; // @input 12 1..32 Radius

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 c = texture2D(layer, uv);
  float a = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = float(i) / 16.0 * 6.2831;
    for (int k = 1; k <= 3; k++) {
      vec2 o = vec2(cos(t), sin(t)) * radius * float(k) / 3.0 / u_resolution;
      a += texture2D(layer, uv + o).a;
    }
  }
  a = clamp(a / 48.0 * 1.6, 0.0, 1.0);
  vec3 rgb = c.rgb * c.a + color * a * (1.0 - c.a);
  float alpha = c.a + a * (1.0 - c.a);
  gl_FragColor = vec4(alpha > 0.0 ? rgb / alpha : rgb, alpha);
}
