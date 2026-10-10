// cloudfunctions/login/index.js —— 登录云函数
// 作用：在服务端通过 cloud.getWXContext() 获取用户的 openid / appid / unionid。
// 客户端永远拿不到、也不需要拿到能够伪造身份的凭证——openid 由微信在云函数
// 调用链路中自动注入，前端只管把这个函数的返回值当作"我是谁"的凭证使用。
//
// 同时负责幂等创建个人数据集合（ai_conversations / favorites / feedback）：
// 小程序客户端 SDK 没有创建集合的权限，集合缺失时首次写入会直接报
// errCode -502005（collection not exists）；云函数属于管理端，可以创建集合，
// 新建集合的默认权限即“仅创建者可读写”，正好满足这三类数据按人隔离的要求。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PERSONAL_COLLECTIONS = ['ai_conversations', 'favorites', 'feedback']

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    // 集合已存在时云函数会抛 ResourceAlreadyExists（-502001），属预期情况；
    // 其他异常也不阻塞登录主流程，相关功能在读写处另有降级与重试。
  }
}

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()
  await Promise.all(PERSONAL_COLLECTIONS.map(ensureCollection))
  return {
    success: true,
    openid: OPENID,
    appid: APPID,
    unionid: UNIONID || null
  }
}
