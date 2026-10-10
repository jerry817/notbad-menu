// cloudfunctions/resolveImage/index.js —— 图片地址中转云函数
// 作用：把 cloud:// fileID 换成可访问的临时 HTTPS 地址。
//
// 为什么需要这个云函数：小程序客户端直接调用 wx.cloud.getTempFileURL 时，
// 是否能读到"别人上传的文件"受云存储的读权限控制；而云函数属于"管理端"，
// 官方文档明确说明管理端（云函数 + 控制台）拥有云存储/数据库的完全读写权限，
// 不受安全规则/权限预设的限制——这些权限设置只对小程序客户端发起的请求生效。
// 因此把换地址这一步放到云函数里，就能在不依赖"所有用户可读"这个云存储权限
// 的情况下，让所有用户都能看到别人上传的封面图。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 单次最多处理 50 个 fileID，与 wx.cloud.getTempFileURL 的官方限制保持一致，
// 调用方（utils/data.js 的 resolveFileUrls）已经按 50 个一批分批调用。
// maxAge：显式声明临时地址的有效期（秒）。客户端会按同样的时长在本地缓存，
// 只要两边保持一致，缓存就不会在地址还没过期时被误判为“需要重新换取”。
exports.main = async (event) => {
  const fileList = Array.isArray(event.fileList) ? event.fileList.slice(0, 50) : []
  if (!fileList.length) return { success: true, fileList: [] }
  const maxAge = Number(event.maxAge) || undefined

  const result = await cloud.getTempFileURL({
    fileList: maxAge ? fileList.map(fileID => ({ fileID, maxAge })) : fileList
  })
  return { success: true, fileList: result.fileList || [] }
}
