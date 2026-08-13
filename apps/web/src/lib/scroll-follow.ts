const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;

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
    scrollHeight - clientHeight - scrollTop <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}
