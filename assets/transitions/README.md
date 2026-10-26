# Transitions

Two-input WebGL2 fragment shaders (`.glsl` / `.frag`). The runtime provides:

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;  // clip leaving
uniform sampler2D u_incoming;  // clip entering
uniform float u_progress;      // 0 → 1
uniform vec2  u_resolution;
uniform float u_aspect;        // width / height
in vec2 v_texCoord;
out vec4 fragColor;
```

At `u_progress = 0` output the outgoing frame, at `1` the incoming frame.
Adjustable uniforms are declared in a `<name>.json` sidecar:

```json
{ "name": "Iris open", "props": [{ "key": "feather", "label": "Feather", "default": 0.02, "min": 0, "max": 0.2 }] }
```

Each prop becomes `uniform float u_<key>;`. Drag a transition onto the later of two
adjacent clips on the same track.
