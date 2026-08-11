/** Pure geometry + labelling for the camera detection overlay.
 *
 *  Split from detect.ts so it carries no TensorFlow import: the test bundle (and
 *  anything that only needs to map a box) pays nothing for the GPU model, and
 *  these functions — the only decisions worth testing — run in plain node. */

export interface Detection {
  class: string;
  score: number;
  /** [x, y, width, height] in the video's intrinsic pixels. */
  bbox: [number, number, number, number];
}

export interface Box { x: number; y: number; w: number; h: number; }

/** Map one detection box from the video's intrinsic pixel space onto the
 *  preview element, which is `object-fit: cover`: the frame is scaled up until
 *  it covers the box and the overflow is cropped evenly on both axes. Getting
 *  this wrong is what makes boxes drift toward the edges, so it is the one piece
 *  under test.
 *
 *  `cover` scales by the LARGER ratio (fill, then crop); `contain` would use the
 *  smaller. The crop is centred, so half the overflow is subtracted as an
 *  offset. The result is in the preview's own CSS pixels. */
export function coverBox(
  bbox: [number, number, number, number],
  videoW: number, videoH: number,
  viewW: number, viewH: number,
): Box {
  if (videoW <= 0 || videoH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const offsetX = (videoW * scale - viewW) / 2;
  const offsetY = (videoH * scale - viewH) / 2;
  return {
    x: bbox[0] * scale - offsetX,
    y: bbox[1] * scale - offsetY,
    w: bbox[2] * scale,
    h: bbox[3] * scale,
  };
}

/** The overlay caption for a detection: class plus confidence as a percent. */
export function label(d: Detection): string {
  return `${d.class} ${Math.round(d.score * 100)}%`;
}
