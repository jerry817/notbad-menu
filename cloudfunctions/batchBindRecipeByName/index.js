const cloud = require('wx-server-sdk')
cloud.init({ env: "cloud1-d7gcm9x5d812e70c4" })
const db = cloud.database()

exports.main = async (event, context) => {
  // ========== 只改这里：手动配置对应关系 ==========
  // 格式：{ id: "菜谱的_id", imgName: "图片文件名（不带后缀）" }
  const list = [
      { id: "recipe-3", imgName: "番茄炒蛋" },
  { id: "recipe-6", imgName: "白切鸡" },
  { id: "recipe-8", imgName: "剁椒鱼头" },
  { id: "recipe-13", imgName: "韩式部队锅" },
  { id: "recipe-18", imgName: "家常豚骨拉面" },
  { id: "recipe-5", imgName: "清蒸鲈鱼" },
  { id: "recipe-17", imgName: "日式厚蛋烧" },
  { id: "recipe-9", imgName: "松鼠桂鱼" },
  { id: "recipe-25", imgName: "杨枝甘露" }
  ]
  
  // ==============================================

  const folder = "recipe-covers/"
  const filePrefix = "cloud://cloud1-d7gcm9x5d812e70c4.636c-cloud1-d7gcm9x5d812e70c4-1491123181/"
  const suffix = ".png"  //注意格式

  let success = 0
  let fail = 0

  for (const item of list) {
    try {
      const fileID = `${filePrefix}${folder}${item.imgName}${suffix}`
      await db.collection('recipes').doc(item.id).update({
        data: { coverImageUrl: fileID }
      })
      success++
      console.log(`✅已更新：${item.id} → ${item.imgName}`)
    } catch (e) {
      fail++
      console.log(`❌失败：${item.id}`, e.errMsg)
    }
  }

  return { total: list.length, success, fail }
}
