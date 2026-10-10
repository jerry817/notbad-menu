// 云开发配置。
// 在微信开发者工具创建环境后，只需替换 CLOUD_ENV_ID 的占位值。
const CLOUD_ENV_ID = 'XXX'
const RECIPE_COLLECTION = 'recipes'
const BANNER_COLLECTION = 'banners'
// 菜谱评论集合：需在云开发控制台手动创建，权限设为“所有用户可读，仅创建者可写”，
// 详见 docs 目录下的云开发迁移指南。
const COMMENT_COLLECTION = 'comments'
// 意见反馈集合：权限设为“仅创建者可读写”——用户只能看到自己提交的记录，
// 开发者通过云开发控制台的数据库管理界面查看全部反馈（不受该权限限制）。
const FEEDBACK_COLLECTION = 'feedback'
// 助手对话记录集合：权限设为“仅创建者可读写”——每个用户只能读写自己的
// 对话记录，符合“聊天记录仅本人可见”的预期；开发者可在控制台查看全部记录。
const AI_CHAT_COLLECTION = 'ai_conversations'
// 用户收藏集合：权限设为“仅创建者可读写”——收藏随账号走、跨设备同步，
// 清除小程序本地缓存不会丢失。登录云函数会自动创建该集合（见 cloudfunctions/login）。
const FAVORITE_COLLECTION = 'favorites'
const CLOUD_ENV_PLACEHOLDER = 'YOUR_CLOUD_ENV_ID'

module.exports = {
  CLOUD_ENV_ID,
  RECIPE_COLLECTION,
  BANNER_COLLECTION,
  COMMENT_COLLECTION,
  FEEDBACK_COLLECTION,
  AI_CHAT_COLLECTION,
  FAVORITE_COLLECTION,
  isConfigured: CLOUD_ENV_ID !== CLOUD_ENV_PLACEHOLDER
}
