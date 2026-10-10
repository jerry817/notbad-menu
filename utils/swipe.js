// utils/swipe.js —— 内容区左右滑动切换手势（分类页 / 列表页菜系切换公用）
// 两个页面原先各自实现了一份完全相同的阈值判定逻辑，这里抽成公共模块。
// 横向位移需超过阈值，且明显大于纵向位移才判定为滑动，避免和上下滚动、
// 或横滑条自身的横向滚动互相误判。
const SWIPE_DISTANCE = 60

// 记录滑动起点。若起点落在需要独立横向滚动的元素上（如横滑条本身，带
// data-swipe-ignore），本次触摸只让该元素自己滚动，不触发页面切换。
function start(e) {
  const touch = e.touches[0]
  return {
    x: touch.clientX,
    y: touch.clientY,
    ignored: !!(e.target && e.target.dataset && e.target.dataset.swipeIgnore)
  }
}

// 根据起点与结束事件判断滑动方向：'left'（切下一个）/ 'right'（切上一个）/
// null（未达到阈值，或起点被忽略/缺失，不触发切换）。
function direction(startPoint, e) {
  if (!startPoint || startPoint.ignored) return null
  const touch = e.changedTouches[0]
  const dx = touch.clientX - startPoint.x
  const dy = touch.clientY - startPoint.y
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'left' : 'right'
}

module.exports = { start, direction }
