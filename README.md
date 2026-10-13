## ⚠️ 说明
本仓库仅用于代码展示学习。
1. 项目缺少私有环境配置文件，直接编译会报错。
2. 本源码仅供学习参考，未经许可不得直接用于商业项目。
# 开发者说明

这是美食类微信小程序的完整源码：

1. 中式菜肴新增「八大菜系」分类
2. 轮播图与菜品封面统一切换为实拍图风格
3. 界面精简：去除冗余文案与装饰性副标题，信息尽量由真实数据渲染
4. 菜谱库扩充到 **xxx 道**（≥ 500 的目标），做法步骤全部配图，图文对照
5. 通过微信云开发·云函数预留 AI 接口，API Key 只存在于云端环境变量中
6. 「我的」页新增登录（发布菜谱 / 发表评论需登录）、版本更新日志等模块

---

## 目录结构

```
miniprogram-1/             
├── app.js / app.json / app.wxss
├── data/
│   ├── meta.js              分类、八大菜系、版本号与更新日志
│   ├── recipes.featured.js  
│   └── recipes.generated.js  
├── utils/
│   ├── data.js               菜谱查询 API（按分类/菜系/关键词查询等）
│   ├── store.js               本地存储：收藏 / 自创菜谱 / 浏览历史 / 登录态
│   └── image.wxs              图片地址统一生成（WXS 模块，任意 wxml 可直接调用）
├── pages/                     11 个页面（首页/分类/列表/详情/搜索/发布/我的/
│                               收藏/登录/AI助手/版本更新日志）
├── cloudfunctions/
│   ├── login/                 云函数：安全解析用户 openid
│   └── aiAssistant/           云函数：安全代理 AI API 调用（预留接入位）
└── assets/tabbar/              自绘极简线性 tabBar 图标

tools/                         开发者工具脚本（不随小程序包上传）
├── generate_recipes.py        批量生成 data/recipes.generated.js
└── make_tabbar_icons.py       生成 assets/tabbar 下的图标
```

---

## 快速开始

1. 用微信开发者工具导入项目，选择 `miniprogram-1` 目录，AppID 使用你自己的测试号或正式 AppID。
2.  AI 助手 / 登录能力，需要在微信公众平台开通「云开发」，并在开发者工具的
   「云开发」控制台里创建一个环境。
3.  `cloudfunctions/login`、`cloudfunctions/aiAssistant` → 上传并部署。
4. 在云开发控制台 → 云函数 → `aiAssistant` → 配置 → 环境变量，添加：
   - `AI_API_KEY`：你的大模型服务商 API Key
5. （可选）在云开发数据库中新建集合 `ai_usage`，权限设为「仅创建者可读写」，用于按用户做每日调用次数限制；不建集合也不影响功能，只是不做限流。

---


---

## 图片：

1. 把实拍图上传到「微信云开发 · 云存储」，用返回的 `cloud://` fileID 或临时链接替换
   `utils/image.wxs` 里三个函数的实现——云存储链接不需要再做下方的域名校验。
2. 换成自建 CDN/图床，并在小程序管理后台「开发设置 → 服务器域名 → downloadFile合法域名」
   中添加对应域名，否则真机环境会加载失败。


---

## 登录与鉴权

- `cloudfunctions/login`：调用后由 `cloud.getWXContext()` 在**服务端**解析出 `openid`，
  客户端拿不到、也无法伪造这个值。
- `utils/store.js` 里的 `requireLogin(onSuccess)` 是统一的登录拦截入口：未登录时弹出提示
  并跳转登录页，登录成功后自动继续执行原本的操作。目前接在两处：
  - `pages/publish/publish.js` 的提交发布
  - `pages/detail/detail.js` 的发表评论
  如果还有其它需要登录的操作，直接用 `store.requireLogin(() => { ... })` 包一层即可。
- 本地会话（昵称、头像、openid）保存在 `wx.storage`，仅作为演示态的登录态持久化；
  正式项目建议在云数据库里维护一张 `users` 表，以 `openid` 为主键存储用户资料。

---

## AI 接口：安全性怎么保证

- API Key **只出现在云函数运行环境的环境变量里**（`cloudfunctions/aiAssistant/index.js`
  通过 `process.env.AI_API_KEY` 读取），代码仓库里不包含任何明文密钥，日志和返回值也
  都不会回传密钥。
- 小程序端 `pages/ai/ai.js` 只通过 `wx.cloud.callFunction` 传一段用户输入的文本，
  真正发起外部 HTTP 请求、持有密钥的是云函数——即使小程序包被反编译，也拿不到密钥。
- 云函数内做了输入长度校验、超时控制，以及按 `openid` 的每日调用次数限制（见上文
  `ai_usage` 集合说明），避免被刷量导致 API 费用失控。
- 想换成别的模型服务商：只需要改 `cloudfunctions/aiAssistant/index.js` 里 `requestAI()`
  函数的请求组装逻辑（URL、Header、请求体格式），客户端页面代码不用动。

---

## 版本号与更新日志

`data/meta.js` 的 `APP_META.version` 和 `CHANGELOG` 数组是唯一数据源，「我的 → 关于·版本
更新」页面直接读取展示。发新版本时，在 `CHANGELOG` 数组最前面插入一条新记录即可。

`app.json` 里 `window.navigationBarTitleText`（以及 tabBar 文案）是小程序静态配置，
无法在编译期读取 JS 变量，如果修改了 `APP_META.name`，记得同步改一下 `app.json` 里的
标题文案，保持两处一致。

---

