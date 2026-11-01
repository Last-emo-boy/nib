# Shaders

A shader fill paints a layer with a fragment shader: `fill: {type: "shader", url: "shaders/aurora.frag", uniforms: {speed: 0.3}}`. A shader effect changes how a layer looks after it is drawn: `effect: {type: "shader", url: "shaders/glow.frag", uniforms: {...}}`. The file is GLSL ES 1.0, as for WebGL 1. nib draws it with Skia, which runs it in the editor (animated) and in exports (at time 0).

## Getting a shader file

`Shader(name)` copies one of nib's shaders into the document's `shaders` folder and returns its url. `Shader(name, source)` saves your own GLSL as `shaders/<name>.frag` after checking that it compiles (a compile error fails the call and says why).

nib's shaders: fills `aurora` (drifting bands of color), `grain-gradient` (two colors with film grain, at an angle), `waves` (rippling stripes), `halftone` (a dot grid that grows toward a corner, brighter near the pointer), `liquid` (slow marbling of three colors), `edge-glow` (a glow along the layer's outline, any shape); effects `pixelate`, `chromatic` (color fringes), `vignette`, `glow` (a colored halo around what the layer draws).

```js
hero = Insert(page, {type: "frame", name: "Hero", width: "fill_container", height: 420, fill: {type: "shader", url: Shader("aurora"), uniforms: {colorB: "#FF6B3D", speed: 0.1}}})
```

## Writing one

Read `gl_FragCoord.xy` (pixels, origin at the bottom left) and write `gl_FragColor` (straight alpha). A comment on a uniform's line says what nib puts in it:

```glsl
precision mediump float;
uniform vec2 u_resolution;     // @resolution  the layer's size in pixels
uniform float u_time;          // @time        seconds; 0 in exports
uniform vec2 u_mouse;          // @mouse       the pointer over the layer (its center otherwise)
uniform sampler2D shape;       // @sdf         .r: distance to the layer's outline in pixels, negative inside
uniform sampler2D layer;       // @source      effects: the layer as drawn
uniform vec3 tint;             // @input #FF6B3D Tint
uniform float speed;           // @input 0.5 0..2 Speed
uniform bool dots;             // @input true Dots
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(tint * uv.y, 1.0);
}
```

- `u_resolution`, `u_time` and `u_mouse` (or `iResolution`, `iTime`, `iMouse`) work without the comment.
- `@input default [min..max] label` makes a control people can change in the properties panel; the value lives in the fill's or effect's `uniforms` under the uniform's name. Colors are `#RRGGBB` for vec3 and vec4 inputs.
- Read textures with `texture2D(sampler, uv)`, uv from 0 to 1, bottom-up.
- `// @margin 24` lets an effect draw that far outside the layer (for glows and shadows).
- Uniform types: float, int, bool, vec2, vec3, vec4, sampler2D. There is no `@backdrop`: a shader cannot read what is behind its layer.
- A layer's own shape still clips a shader fill (corner radius, ellipse), so the shader can fill its whole box.
