// Soft directional wipe: the incoming clip sweeps in from the right with a feathered edge.
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
in vec2 v_texCoord;
out vec4 fragColor;
uniform float u_softness;
void main() {
  float s = max(u_softness, 0.001);
  float edge = mix(-s, 1.0 + s, u_progress);
  float m = smoothstep(edge - s, edge + s, 1.0 - v_texCoord.x);
  fragColor = mix(texture(u_outgoing, v_texCoord), texture(u_incoming, v_texCoord), 1.0 - m);
  if (u_progress <= 0.0) fragColor = texture(u_outgoing, v_texCoord);
  if (u_progress >= 1.0) fragColor = texture(u_incoming, v_texCoord);
}
