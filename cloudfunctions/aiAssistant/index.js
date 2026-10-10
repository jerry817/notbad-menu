// cloudfunctions/aiAssistant/index.js —— AI 美食助手云函数（已接入 DeepSeek API）
//
// 安全设计要点：
//   1. API Key 只存在于云函数的环境变量 AI_API_KEY 中（云开发控制台 → 云函数 →
//      aiAssistant → 配置 → 环境变量），代码里不出现任何明文密钥，也不会在
//      任何返回值 / 日志里回传给客户端。
//   2. 小程序前端只通过 wx.cloud.callFunction 传入用户输入的文本，云函数才是
//      真正持有密钥、发起外部请求的一方——即使小程序包被反编译，也拿不到密钥。
//   3. 输入做长度与空值校验，避免异常请求被转发到上游 API 浪费额度。
//   4. 按 openid 做每日调用次数限制（存于云数据库 ai_usage 集合），防止被刷。
//      若数据库集合尚未创建/无权限，会自动跳过限流而不影响正常使用。开发者需在
//      云开发控制台新建 ai_usage 集合，权限设为"仅管理端可读写"（不是"仅创建者
//      可读写"——这张表只应该被云函数自己读写，允许客户端直接读写等于让用户能
//      自己改自己的配额），并可选给 expireAt 字段建一条 TTL 索引以自动清理过期
//      记录，详见 checkAndConsumeQuota 函数的注释。
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_PROMPT_LENGTH = 300
const DAILY_LIMIT = 20   // 每个用户每天 允许调用20 次


// AI_API_URL / AI_MODEL 可在环境变量中覆盖，默认对接 DeepSeek（OpenAI 兼容格式）。
// 如需切换到其他模型服务商，只需改这里的请求组装逻辑（payload / headers / 响应解析），
// 客户端代码（pages/ai/ai.js）无需任何改动。
const API_URL = process.env.AI_API_URL || 'https://api.deepseek.com/chat/completions'
const API_KEY = process.env.AI_API_KEY
const MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'

const SYSTEM_PROMPT =
  '你是「味不孬」小程序内的吃货顾问，只回答与做菜、食材替换、厨房技巧相关的问题。' +
  '回答控制在 200 字以内，语气亲切，分点作答时使用「1. 2. 3.」的简单列表。'

function requestAI(prompt) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 500,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]
  })

  const url = new URL(API_URL)
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${API_KEY}`
    },
    timeout: 15000
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          // 上游的错误结构不一定长得像 { error: { message } }，只把状态码和原始
          // 响应体（截断）打进日志，才能在云开发控制台的调用日志里看清楚到底是
          // 密钥无效、余额不足，还是别的原因——这个原始信息不会返回给小程序端，
          // 用户看到的始终是下面 exports.main 里那句友好的兜底提示。
          console.error(`aiAssistant 上游返回非 200：status=${res.statusCode} body=${raw.slice(0, 300)}`)
          let message = `上游服务返回 ${res.statusCode}`
          try {
            const parsed = JSON.parse(raw)
            message = (parsed && parsed.error && parsed.error.message) || message
          } catch (e) { /* 原始内容本来就不是 JSON，上面已经打印过了 */ }
          return reject(new Error(message))
        }
        try {
          const data = JSON.parse(raw)
          const text = ((data.choices || [])[0] && data.choices[0].message && data.choices[0].message.content || '').trim()
          resolve(text || '暂时没有想到好的建议，换个问题再试试吧～')
        } catch (e) {
          console.error('aiAssistant 响应解析失败，原始内容:', raw.slice(0, 300))
          reject(new Error('服务响应解析失败'))
        }
      })
    })
    req.on('error', (err) => {
      // 常见原因是云函数所在环境访问不了外网——需要在云开发控制台确认该环境
      // 已开启公网访问；err.code 通常会是 ENOTFOUND/ECONNREFUSED/ETIMEDOUT。
      console.error('aiAssistant 请求上游失败:', err.code || err.message)
      reject(err)
    })
    req.on('timeout', () => req.destroy(new Error('服务请求超时')))
    req.write(payload)
    req.end()
  })
}

// 每日调用次数限制：写入 ai_usage 集合，文档 _id 直接用 "openid_日期" 拼出来，
// 按 _id 精确查文档、不走条件查询，因此不需要建索引。
// 集合权限建议设为"仅管理端可读写"（即所有客户端都不可读写）——这张表只应该被
// 云函数自己读写，任何允许小程序端直接读写的权限都等于让用户能自己改配额。
// 文档里的 expireAt 是给集合开 TTL 索引用的（控制台：数据库 -> ai_usage ->
// 索引管理 -> 新建 -> TTL 索引 -> 字段选 expireAt），到期自动清掉，避免这张表
// 随用户数和天数无限增长。
// 用事务把"读取次数-判断-写入"这三步合成一次原子操作：如果分开写（先 get 再按
// 条件 update），两个几乎同时打进来的请求可能都读到"还没超限"，都各自把请求
// 转发给上游 API，实际消耗会多算一次；数据库不存在/无权限等异常时静默放行，
// 不影响主流程。
async function checkAndConsumeQuota(openid) {
  const today = new Date().toISOString().slice(0, 10)
  const docId = `${openid}_${today}`
  const expireAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 天后过期，配合 TTL 索引自动清理

  try {
    return await db.runTransaction(async transaction => {
      let count = 0
      try {
        const doc = await transaction.collection('ai_usage').doc(docId).get()
        count = (doc.data && doc.data.count) || 0
      } catch (e) {
        count = 0 // 文档不存在，说明用户今天还没问过
      }
      if (count >= DAILY_LIMIT) return false
      if (count > 0) {
        await transaction.collection('ai_usage').doc(docId).update({ data: { count: count + 1 } })
      } else {
        await transaction.collection('ai_usage').doc(docId)
          .set({ data: { openid, date: today, count: 1, expireAt } })
      }
      return true
    })
  } catch (e) {
    console.warn('ai_usage 集合不可用，跳过限流:', e.message)
    return true
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const prompt = (event && event.prompt || '').trim()

  if (!prompt) {
    return { success: false, error: '请输入你想问的问题' }
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { success: false, error: `问题太长啦，请精简到 ${MAX_PROMPT_LENGTH} 字以内` }
  }
  if (!API_KEY) {
    return { success: false, error: '服务未配置，请管理员在云函数环境变量中设置 AI_API_KEY' }
  }

  const allowed = await checkAndConsumeQuota(OPENID)
  if (!allowed) {
    return { success: false, error: `今日问答次数已用完（${DAILY_LIMIT} 次/天），明天再来吧` }
  }

  try {
    const answer = await requestAI(prompt)
    return { success: true, answer }
  } catch (err) {
    console.error('aiAssistant call failed:', err)
    return { success: false, error: '去问豆书记' }
  }
}
