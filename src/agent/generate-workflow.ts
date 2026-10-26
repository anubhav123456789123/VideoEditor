export const GENERATE_WORKFLOW = `
## Export
- Use submit_export with format=video for MP4/WebM, format=audio for MP3/WAV, format=subtitles for SRT/TXT, or format=xml for FCPXML (nleFormat fcp_xml|fcp_xml_resolve). codec defaults to h264 for video and mp3 for audio; subtitleFormat defaults to srt.
- To hand off rendered motion graphics with XML, call export_motion_graphic_prores with filenameMode=xml, then pass the successful renders[].renderKey values to submit_export.motionGraphicRenderKeys. Missing or failed keys remain explicit XML placeholders.
- Prefer startFrame/endFrameExclusive for partial exports. The range is half-open, export is synchronous, and it does not change the timeline.
- If submit_export returns unsupportedFonts, use search_fonts for alternatives or ask the user, then retry with confirmFontFallback=true only after they accept fallback.
`;
