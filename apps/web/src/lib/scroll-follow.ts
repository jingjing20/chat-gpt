const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const SHOW_SCROLL_TO_BOTTOM_THRESHOLD_PX = 120;

function distanceFromViewportBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isViewportNearBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  return (
    distanceFromViewportBottom({ clientHeight, scrollHeight, scrollTop }) <=
    AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

export function shouldShowScrollToBottom(viewport: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  return (
    distanceFromViewportBottom(viewport) > SHOW_SCROLL_TO_BOTTOM_THRESHOLD_PX
  );
}
