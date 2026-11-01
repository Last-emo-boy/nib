// A soft inner glow along the layer's outline, any shape.
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D shape; // @sdf
uniform vec3 fill; // @input #10131A Fill
uniform vec3 glow; // @input #36E0FF Glow
uniform float width; // @input 18 1..80 Width

void main() {
  float d = texture2D(shape, gl_FragCoord.xy / u_resolution).r;
  float g = exp(d / width * 2.5);
  gl_FragColor = vec4(mix(fill, glow, clamp(g, 0.0, 1.0)), 1.0);
}
