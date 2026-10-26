const TitleCardClean = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const props = item.props || {};
  const title = props.title ?? 'Think different.';
  const subtitle = props.subtitle ?? 'A short film';
  const background = props.background ?? '#000000';
  const color = props.color ?? '#f5f5f7';
  const scale = Math.min((item.width || 1920) / 1920, (item.height || 1080) / 1080);

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const rise = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const outStart = Math.max(21, durationInFrames - 20);
  const fadeOut = interpolate(frame, [outStart, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const subIn = interpolate(frame, [18, 38], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: background, opacity: fadeIn * fadeOut }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <div style={{ fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif', fontWeight: 700, fontSize: 132, letterSpacing: -4, color, transform: `translateY(${(1 - rise) * 30}px)` }}>{title}</div>
        <div style={{ fontFamily: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif', fontWeight: 400, fontSize: 36, color, opacity: 0.6 * subIn }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  );
};
