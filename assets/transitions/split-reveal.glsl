// Split reveal: the outgoing clip parts horizontally like doors to reveal the incoming clip.
#version 300 es
precision highp float;
uniform sampler2D u_outgoing;
uniform sampler2D u_incoming;
uniform float u_progress;
uniform float u_aspect;
in vec2 v_texCoord;
out vec4 fragColor;
void main() {
  float t = u_progress;
  float e = t * t * (3.0 - 2.0 * t);
  float half_gap = 0.5 * e;
  vec2 uv = v_texCoord;
  if (abs(uv.x - 0.5) < half_gap) {
    fragColor = texture(u_incoming, uv);
  } else {
    vec2 src = uv;
    src.x = uv.x < 0.5 ? uv.x + half_gap : uv.x - half_gap;
    fragColor = texture(u_outgoing, src);
  }
  if (t <= 0.0) fragColor = texture(u_outgoing, v_texCoord);
  if (t >= 1.0) fragColor = texture(u_incoming, v_texCoord);
}
