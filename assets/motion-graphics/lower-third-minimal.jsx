const LowerThirdMinimal = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const props = item.props || {};
  const name = props.name ?? 'Alex Morgan';
  const role = props.role ?? 'Product Designer';
  const accent = props.accent ?? '#ffffff';
  const scale = Math.min((item.width || 1920) / 1920, (item.height || 1080) / 1080);

  const enter = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const exitStart = Math.max(1, durationInFrames - 18);
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const reveal = enter * (1 - exit);
  const bar = interpolate(reveal, [0, 1], [0, 280]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', left: 120, bottom: 150, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ width: bar, height: 3, background: accent, borderRadius: 2 }} />
          <div style={{ overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${(1 - reveal) * 100}%)`, fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif', fontWeight: 700, fontSize: 64, letterSpacing: -1, color: '#ffffff', textShadow: '0 2px 24px rgba(0,0,0,0.35)' }}>{name}</div>
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${(1 - reveal) * 110}%)`, fontFamily: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif', fontWeight: 500, fontSize: 32, color: 'rgba(255,255,255,0.8)', textShadow: '0 2px 16px rgba(0,0,0,0.35)' }}>{role}</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
