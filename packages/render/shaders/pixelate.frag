// Effect: the layer as big square pixels.
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D layer; // @source
uniform float size; // @input 8 1..64 Pixel size

void main() {
  vec2 p = (floor(gl_FragCoord.xy / size) + 0.5) * size;
  gl_FragColor = texture2D(layer, p / u_resolution);
}
