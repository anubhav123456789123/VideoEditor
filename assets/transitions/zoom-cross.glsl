// Zoom cross: the outgoing clip pushes in while the incoming clip settles from a slight zoom.
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
in vec2 v_texCoord;
out vec4 fragColor;
uniform float u_strength;
void main() {
  float t = u_progress;
  float e = t * t * (3.0 - 2.0 * t);
  vec2 c = v_texCoord - 0.5;
  vec2 outUv = 0.5 + c / (1.0 + u_strength * e);
  vec2 inUv = 0.5 + c / (1.0 + u_strength * (1.0 - e));
  vec4 a = texture(u_outgoing, outUv);
  vec4 b = texture(u_incoming, inUv);
  fragColor = mix(a, b, e);
  if (t <= 0.0) fragColor = texture(u_outgoing, v_texCoord);
  if (t >= 1.0) fragColor = texture(u_incoming, v_texCoord);
}
