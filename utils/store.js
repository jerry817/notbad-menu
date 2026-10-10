// utils/store.js —— 本地存储封装（浏览历史 / 登录态）
// 统一 key 前缀，便于管理。
//
// 注意：自创菜谱、评论、 对话记录与收藏均已写入云数据库（见 utils/data.js），
// 不再属于“本地状态”，因此不在本文件维护；清除小程序缓存不会造成这些数据丢失。

const KEYS = {
  HIST: 'jiawei_history',         // 浏览历史 id 数组（最近优先）
  SESSION: 'jiawei_session'       // 登录会话
}

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.error('storage write failed', e)
  }
}

// ---------- 登录会话 ----------
// 注意：这里只做登录态的本地持久化，真正的身份凭证（openid）来自云函数
// login 的返回值，云函数内部通过 cloud.getWXContext() 在服务端获取，不经过
// 客户端传参，避免被伪造。
function getSession() {
  return read(KEYS.SESSION, null)
}

function isLoggedIn() {
  return !!getSession()
}

function setSession(session) {
  write(KEYS.SESSION, { ...session, loginAt: Date.now() })
}

function clearSession() {
  try {
    wx.removeStorageSync(KEYS.SESSION)
  } catch (e) { /* ignore */ }
}

// 需要登录的操作调用此方法：未登录时弹出提示并引导跳转登录页，
// 登录成功后自动帮用户执行原本想做的操作（onSuccess）。content 可选，
// 不传则用发布/评论场景的默认文案。
function requireLogin(onSuccess, content) {
  if (isLoggedIn()) {
    onSuccess && onSuccess()
    return true
  }
  wx.showModal({
    title: '请先登录',
    content: content || '登录后即可继续操作。',
    confirmText: '去登录',
    confirmColor: '#e8552f',
    success(res) {
      if (res.confirm) {
        wx.navigateTo({
          url: '/pages/login/login',
          events: {
            loginSuccess() { onSuccess && onSuccess() }
          }
        })
      }
    }
  })
  return false
}

// ---------- 浏览历史 ----------
function getHistory() {
  return read(KEYS.HIST, [])
}

function pushHistory(id) {
  let hist = getHistory().filter(x => String(x) !== String(id))
  hist.unshift(String(id))
  if (hist.length > 50) hist = hist.slice(0, 50)
  write(KEYS.HIST, hist)
}

function clearHistory() {
  try {
    wx.removeStorageSync(KEYS.HIST)
  } catch (e) { /* ignore */ }
}

module.exports = {
  getSession, isLoggedIn, setSession, clearSession, requireLogin,
  getHistory, pushHistory, clearHistory
}
