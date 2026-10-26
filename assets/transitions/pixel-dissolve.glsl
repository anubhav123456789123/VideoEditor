// Pixel dissolve: the image breaks into blocks that cross-fade, then sharpens again.
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
in vec2 v_texCoord;
out vec4 fragColor;
uniform float u_blocks;
void main() {
  float t = u_progress;
  float peak = 1.0 - abs(t * 2.0 - 1.0);
  float n = mix(400.0, max(u_blocks, 4.0), peak);
  vec2 cells = vec2(n * u_aspect, n);
  vec2 uv = peak > 0.001 ? (floor(v_texCoord * cells) + 0.5) / cells : v_texCoord;
  vec4 a = texture(u_outgoing, uv);
  vec4 b = texture(u_incoming, uv);
  fragColor = mix(a, b, smoothstep(0.35, 0.65, t));
  if (t <= 0.0) fragColor = texture(u_outgoing, v_texCoord);
  if (t >= 1.0) fragColor = texture(u_incoming, v_texCoord);
}
