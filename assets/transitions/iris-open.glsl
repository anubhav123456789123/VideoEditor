// Iris open: a circle grows from the centre to reveal the incoming clip.
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
in vec2 v_texCoord;
out vec4 fragColor;
uniform float u_feather;
void main() {
  vec2 p = v_texCoord - 0.5;
  p.x *= u_aspect;
  float radius = u_progress * length(vec2(0.5 * u_aspect, 0.5)) * 1.02;
  float f = max(u_feather, 0.001);
  float m = 1.0 - smoothstep(radius - f, radius + f, length(p));
  if (u_progress <= 0.0) m = 0.0;
  if (u_progress >= 1.0) m = 1.0;
  fragColor = mix(texture(u_outgoing, v_texCoord), texture(u_incoming, v_texCoord), m);
}
