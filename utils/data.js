// 菜谱数据访问层：菜谱、轮播图、评论均从云数据库读取，分类元数据仍保留在本地。
// 用户自创菜谱与官方菜谱共用同一个 recipes 集合（写入时打上 source: 'user' 标记），
// 因此天然会出现在首页、分类、搜索等所有查询结果里，对全体用户可见，无需额外的
// 本地合并逻辑。
const meta = require('../data/meta.js')
const cloudConfig = require('../config/cloud.js')

const { CATEGORIES: categories, CUISINES: cuisines } = meta
const CACHE_TTL = 60 * 1000
const CATEGORY_CACHE_TTL = 5 * 60 * 1000
const HOT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 热门菜谱每 7 天轮换一次，减少数据库读取次数
const HOT_STORAGE_KEY = 'jiawei_hot_recipes_cache'
const TODAY_STORAGE_KEY = 'jiawei_daily_featured_cache' // 今日推荐每天固定一次，跨冷启动依然有效
// 图片临时地址走 resolveImage 云函数中转（见该函数注释），每次调用都有网络往返
// 加上云函数冷启动的开销。云函数请求临时地址时会显式声明 2 小时有效期
// （IMAGE_URL_MAX_AGE），本地缓存只要不超过这个时长就必定有效，因此给足 30 分钟，
// 让同一批封面图在这段时间内的重复浏览完全不用再调云函数。
const IMAGE_URL_CACHE_TTL = 30 * 60 * 1000
const IMAGE_URL_MAX_AGE = 2 * 60 * 60 // 单位秒，需要和云函数里请求的 maxAge 保持一致
const PAGE_SIZE = 12

const LIST_FIELDS = {
  id: true,
  title: true,
  category: true,
  cuisine: true,
  difficulty: true,
  time: true,
  servings: true,
  desc: true,
  tags: true,
  views: true,
  likes: true,
  featured: true,
  createdAt: true,
  coverImageFileId: true,
  coverImageUrl: true
}

// 搜索需要额外匹配食材，但完全不需要做法步骤/步骤图（体积最大的字段）。
// 仅用于 getAllRecipes（搜索专用），避免把 600+ 篇菜谱的完整图文正文都下载下来。
const SEARCH_FIELDS = { ...LIST_FIELDS, ingredients: true }

// 列表页排序选项 -> 数据库排序字段。取值并列的情况很常见（比如 likes 都是 0），
// getRecipesPage 会再加一个 id 做第二排序键兜底，保证分页时顺序稳定。
const SORT_OPTIONS = {
  hot: { field: 'likes', order: 'desc' },
  new: { field: 'createdAt', order: 'desc' },
  fast: { field: 'time', order: 'asc' }
}

// 中式菜「其他」分组的虚拟菜系：cuisine 字段缺失、为空或不属于八大菜系的 cn
// 菜谱（如用户发布未选菜系）统一归入该分组。仅用于前端导航与查询，不会写入文档。
const OTHER_CUISINE = { key: 'other', name: '其他', desc: '八大菜系以外的中式菜' }

let allRecipeCache = null
let allRecipeCacheAt = 0
let bannerCache = null
let bannerCacheAt = 0
let cuisineCountsCache = null
let cuisineCountsCacheAt = 0
const categoryOverviewCache = {}
let featuredCache = null
let featuredCacheAt = 0
const hotRecipeCache = {}
let totalCountCache = null
let totalCountCacheAt = 0
let todayFeaturedCache = null // { dayKey, recipeId }，同一天内固定不变
const fileUrlCache = {}

function getDatabase() {
  if (!wx.cloud || !cloudConfig.isConfigured) {
    throw new Error('云开发环境未配置，请检查 config/cloud.js')
  }
  return wx.cloud.database()
}

// 云数据库报“集合不存在”（errCode -502005）时，读取类操作等价于“没有数据”。
// 新环境若还没按 docs 迁移指南创建 ai_conversations / favorites 等个人集合，
// 对应功能应安静降级为空状态，而不是让整个页面弹出“数据加载失败”。
// 注意：新版基础库 reject 出来的是 Error 实例，完整信息（含 errCode）都拼在
// message 里，err.errCode / err.errMsg 反而可能取不到，因此三处都要判断。
function isCollectionMissingError(err) {
  if (!err) return false
  if (err.errCode === -502005 || err.errCode === '-502005') return true
  return /-502005|collection not exists|Db or Table not exist/.test(err.errMsg || err.message || '')
}

// 个人数据集合（ai_conversations / favorites / feedback）由 login 云函数以管理端
// 身份幂等创建，客户端 SDK 没有建集合权限。首次写入发现集合缺失时，调一次 login
// 完成补建后重试；结果在本次运行期内缓存，避免重复调用。
let ensureCollectionsPromise = null
function ensurePersonalCollections() {
  if (!wx.cloud || !cloudConfig.isConfigured) {
    return Promise.reject(new Error('云开发环境未配置，请检查 config/cloud.js'))
  }
  if (!ensureCollectionsPromise) {
    ensureCollectionsPromise = wx.cloud.callFunction({ name: 'login' })
      .catch(err => {
        ensureCollectionsPromise = null // 补建失败时允许后续操作再次尝试
        throw err
      })
  }
  return ensureCollectionsPromise
}

// promise 必须是“返回小程序云数据库结果对象”的读取请求，失败且原因是集合缺失时，
// 以 fallback 结果对象顶替；其他错误照常抛出。
async function resultIfCollectionMissing(promise, fallback) {
  try {
    return await promise
  } catch (err) {
    if (isCollectionMissingError(err)) return fallback
    throw err
  }
}

function getCategory(key) {
  return categories.find(item => item.key === key) || categories[0]
}

function getCuisine(key) {
  return cuisines.find(item => item.key === key)
}

function isCacheFresh(timestamp, ttl) {
  return timestamp && Date.now() - timestamp < ttl
}

// 通用本地存储缓存读写（带保护，失败时静默返回/放弃，不影响主流程）。
function readStorageCache(key) {
  try {
    return wx.getStorageSync(key) || null
  } catch (err) {
    return null
  }
}

function writeStorageCache(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (err) {
    console.warn('本地缓存写入失败:', err)
  }
}

// 热门菜谱的 7 天缓存需要跨冷启动保留，因此落地到本地存储，
// 而不是像其余缓存那样只存于内存（小程序被完全关闭后内存缓存会丢失）。
function readHotStorageCache(limit) {
  const all = readStorageCache(HOT_STORAGE_KEY) || {}
  return all[limit] || null
}

function writeHotStorageCache(limit, cached) {
  const all = readStorageCache(HOT_STORAGE_KEY) || {}
  all[limit] = cached
  writeStorageCache(HOT_STORAGE_KEY, all)
}

// 云存储只保存 fileID，渲染前统一换取可用的临时 HTTPS 地址。
// 改由云函数 resolveImage 中转（而不是直接调用 wx.cloud.getTempFileURL）：
// 云函数属于管理端，拥有云存储的完全读权限，不受“仅创建者可读”等权限预设的
// 限制，因此不管文件是官方录入的还是用户上传的，所有用户都能正常看到。
async function resolveFileUrls(fileIds) {
  const ids = [...new Set((fileIds || []).filter(Boolean))]
  const urlMap = {}
  const pending = []

  ids.forEach(id => {
    const cached = fileUrlCache[id]
    if (cached && isCacheFresh(cached.at, IMAGE_URL_CACHE_TTL)) urlMap[id] = cached.url
    else pending.push(id)
  })
  if (!pending.length) return urlMap

  const batches = []
  for (let index = 0; index < pending.length; index += 50) {
    batches.push(pending.slice(index, index + 50))
  }

  // 各分片互不依赖，并发请求而不是逐批 await：像“中式菜系”这种一次要展示
  // 几百张封面图的场景，此前串行请求会把每批云函数调用（含冷启动开销）依次
  // 叠加，是分类页加载缓慢的主因；并发后总耗时约等于一批的耗时。
  await Promise.all(batches.map(async batch => {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'resolveImage',
        data: { fileList: batch, maxAge: IMAGE_URL_MAX_AGE }
      })
      ;(result.fileList || []).forEach(item => {
        const url = item.tempFileURL || ''
        urlMap[item.fileID] = url
        if (url) fileUrlCache[item.fileID] = { url, at: Date.now() }
      })
    } catch (err) {
      console.warn('云存储图片地址获取失败:', err)
    }
  }))
  return urlMap
}

function isCloudFileId(source) {
  return typeof source === 'string' && source.indexOf('cloud://') === 0
}

function isHttpsImageUrl(source) {
  return typeof source === 'string' && source.indexOf('https://') === 0
}

// 仅接受可长期重新解析的 cloud:// fileID 或 HTTPS 图床地址。
// 旧数据中的 wxfile:// 等本地临时路径会自动跳过，并继续使用后续的 fileID。
function pickImageSource(...sources) {
  return sources.find(source => isCloudFileId(source) || isHttpsImageUrl(source)) || ''
}

// 云存储 fileID 使用临时地址；图床链接必须为可直接访问的 HTTPS 图片地址。
function getDisplayImageUrl(source, urlMap) {
  if (isCloudFileId(source)) return urlMap[source] || ''
  return isHttpsImageUrl(source) ? source : ''
}

async function attachCoverImageUrls(recipes) {
  const sources = (recipes || []).map(recipe =>
    pickImageSource(recipe.coverImageUrl, recipe.coverImageFileId))
  const urlMap = await resolveFileUrls(sources.filter(isCloudFileId))
  return (recipes || []).map(recipe => ({
    ...recipe,
    coverImageUrl: getDisplayImageUrl(pickImageSource(recipe.coverImageUrl, recipe.coverImageFileId), urlMap)
  }))
}

async function attachDetailImageUrls(recipe) {
  if (!recipe) return recipe
  const stepImageFileIds = recipe.stepImageFileIds || []
  const stepImageUrls = recipe.stepImageUrls || []
  const coverSource = pickImageSource(recipe.coverImageUrl, recipe.coverImageFileId)
  const stepSources = (recipe.steps || []).map((step, index) =>
    pickImageSource(step.imageUrl, stepImageUrls[index], stepImageFileIds[index])
  )
  const sources = [coverSource, ...stepSources]
  const urlMap = await resolveFileUrls(sources.filter(isCloudFileId))
  return {
    ...recipe,
    coverImageUrl: getDisplayImageUrl(coverSource, urlMap),
    steps: (recipe.steps || []).map((step, index) => ({
      ...step,
      imageUrl: getDisplayImageUrl(stepSources[index], urlMap)
    }))
  }
}

async function fetchAll(query) {
  const first = await query.skip(0).limit(PAGE_SIZE).get()
  const list = first.data || []
  if (list.length < PAGE_SIZE) return list // 绝大多数分类/菜系的数据量都在一页以内，一次请求即可

  // 数据量较大时（如“全部”分类、搜索用的全量数据），用 count() 算出总页数，
  // 一次性并发取回剩余分页，避免逐页 await 造成的串行网络往返、拖慢加载速度。
  const countResult = await query.count()
  const total = countResult.total || list.length
  const pending = []
  for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE) {
    pending.push(query.skip(skip).limit(PAGE_SIZE).get())
  }
  const rest = await Promise.all(pending)
  rest.forEach(result => list.push(...(result.data || [])))
  return list
}

async function getAllRecipes(forceRefresh) {
  if (!forceRefresh && allRecipeCache && Date.now() - allRecipeCacheAt < CACHE_TTL) {
    return allRecipeCache
  }
  // 目前仅供 searchRecipes 使用：只取搜索/展示需要的字段，
  // 不下载做法步骤与步骤图（这是单篇菜谱里最大的部分）。
  const recipes = await fetchAll(getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .field(SEARCH_FIELDS))
  allRecipeCache = recipes
  allRecipeCacheAt = Date.now()
  return recipes
}

// 分类/菜系列表页用：真正分页，而不是把整个分类（多则几百条）一次性取回来。
// 难度筛选和排序都放进数据库查询（where/orderBy）里做，而不是像以前那样先
// fetchAll 整类目、再在客户端 filter/sort——那样不管筛选排序逻辑多简单，光是
// "取全量数据"这一步，就会把"中式菜系"这种大类目的加载拖到 5-8 秒，且用户
// 每次点开都要为可能根本不会翻到的后面几百条数据付出等待代价。
// skip 传当前已加载条数即可实现"翻下一页"；withTotal 只在筛选条件变化、重新从
// 第一页加载时传 true，翻页请求不必每次都重新数一遍总数。
async function getRecipesPage(categoryKey, cuisineKey, options) {
  const { difficulty, sort, skip = 0, limit = PAGE_SIZE, withTotal = false } = options || {}
  const db = getDatabase()
  const condition = { category: categoryKey }
  if (cuisineKey === OTHER_CUISINE.key) {
    // 八大菜系以外：cuisine 字段缺失，或值不在八大菜系 key 中（空串/其他任意值）。
    const knownKeys = cuisines.map(cuisine => cuisine.key)
    condition.cuisine = db.command.exists(false).or(db.command.nin(knownKeys))
  } else if (cuisineKey) {
    condition.cuisine = cuisineKey
  }
  if (difficulty && difficulty !== '全部') condition.difficulty = difficulty

  const collection = db.collection(cloudConfig.RECIPE_COLLECTION).where(condition)
  const { field, order } = SORT_OPTIONS[sort] || SORT_OPTIONS.hot

  const [pageResult, countResult] = await Promise.all([
    collection.field(LIST_FIELDS).orderBy(field, order).orderBy('id', 'desc').skip(skip).limit(limit).get(),
    withTotal ? collection.count() : Promise.resolve(null)
  ])

  const list = await attachCoverImageUrls(pageResult.data || [])
  return {
    list,
    hasMore: (pageResult.data || []).length === limit,
    total: countResult ? countResult.total : undefined
  }
}

async function getRecipeById(id) {
  const result = await getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .where({ id: Number(id) })
    .limit(1)
    .get()
  return (result.data || [])[0] || null
}

// 封面图/步骤图的临时地址解析单独暴露出来（而不是揉进 getRecipeById 里），
// 让详情页可以先用查到的文字内容渲染首屏，图片解析（走 resolveImage 云函数，
// 有额外的网络往返和冷启动开销）不阻塞这一步，解析完成后再补丁式更新。
async function resolveRecipeImages(recipe) {
  return attachDetailImageUrls(recipe)
}

// 按传入 ID 的顺序返回菜谱；maxResults 用于“最近浏览”等场景，
// 当前面的历史记录已删除时，会继续从较早的有效记录中补足展示数量。
async function getRecipesByIds(ids, maxResults) {
  const wanted = [...new Set((ids || []).map(Number).filter(Number.isFinite))]
  if (!wanted.length) return []

  const db = getDatabase()
  const recordMap = {}
  const batchSize = maxResults ? Math.min(maxResults, PAGE_SIZE) : PAGE_SIZE
  const batches = []
  for (let index = 0; index < wanted.length; index += batchSize) {
    batches.push(wanted.slice(index, index + batchSize))
  }

  const runBatch = async batch => {
    const result = await db.collection(cloudConfig.RECIPE_COLLECTION)
      .where({ id: db.command.in(batch) })
      .get()
    ;(result.data || []).forEach(recipe => { recordMap[String(recipe.id)] = recipe })
  }

  if (maxResults) {
    // 需要提前停止（够 maxResults 条就不再查后面的分片），只有串行才能提前知道
    // “够不够”，因此这条路径保留逐批 await。
    for (const batch of batches) {
      await runBatch(batch)
      const foundCount = wanted.filter(id => recordMap[String(id)]).length
      if (foundCount >= maxResults) break
    }
  } else {
    // 要返回全部匹配项（完整浏览历史/收藏夹），分片之间互不依赖，并发请求
    // 把原本 N 次串行网络往返压缩成一轮，这是「我的」页浏览历史加载慢的主因之一。
    await Promise.all(batches.map(runBatch))
  }

  const records = wanted.map(id => recordMap[String(id)]).filter(Boolean)
  return attachCoverImageUrls(maxResults ? records.slice(0, maxResults) : records)
}

async function getFeaturedRecipes() {
  if (featuredCache && isCacheFresh(featuredCacheAt, CACHE_TTL)) {
    return featuredCache
  }
  // 此方法目前用于搜索页热门关键词，只需要标签，不解析封面临时链接。
  const list = await fetchAll(getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .where({ featured: true })
    .field(LIST_FIELDS))
  featuredCache = list
  featuredCacheAt = Date.now()
  return list
}

// 以本地时区的年月日作为随机种子，保证同一天内多次进入结果一致，
// 且在本地零点（而非 UTC 换日）切换到新的推荐，而不是固定的服务器时间点。
function getLocalDayKey(date) {
  const d = date || new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

// 轻量整数哈希（xorshift 变体），把种子打散映射到 [0, total) 区间，
// 呈现“随机挑选”的效果，且不依赖任何存储状态即可稳定复现。
function hashToIndex(seed, total) {
  if (total <= 0) return 0
  let h = seed ^ 0x9e3779b9
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h = (h ^ (h >>> 16)) >>> 0
  return h % total
}

// 按 id 精确取一条菜谱（.field 只取列表需要的字段，避免过量拉取），并解析封面图地址。
// 今日推荐的两条路径（命中当天缓存 / 重新挑选）都要做这件事，这里只写一次。
async function fetchOneFeatured(query) {
  const result = await query.field(LIST_FIELDS).limit(1).get()
  const recipe = (result.data || [])[0]
  return recipe ? (await attachCoverImageUrls([recipe]))[0] : null
}

// 今日推荐：从全部菜谱中按日期随机挑选一道，每天本地零点自动更新。
// 选中后把 recipeId 缓存到本地存储，当天内固定返回同一道菜——
// 菜谱总数会随发布/删除随时变化，所以只在当天第一次挑选时算一次下标，
// 此后一直按缓存的 id 查询，不再受总数变化影响。
// 若缓存的菜谱被删除，当天内直接返回 null（不重新随机选），
// 等第二天零点跨天后才重新挑选，保证"每日一道"的稳定性。
async function getDailyFeatured() {
  const collection = getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
  const dayKey = getLocalDayKey()

  const cached = (todayFeaturedCache && todayFeaturedCache.dayKey === dayKey)
    ? todayFeaturedCache
    : readStorageCache(TODAY_STORAGE_KEY)
  if (cached && cached.dayKey === dayKey) {
    todayFeaturedCache = cached
    const recipe = await fetchOneFeatured(collection.where({ id: cached.recipeId }))
    return recipe // 存在则返回；被删了就返回 null，当天不再重新挑选
  }

  // 当天首次：从全部菜谱中按日期种子随机选一道
  const total = (await collection.count()).total || 0
  if (!total) return null

  const index = hashToIndex(dayKey, total)
  const recipe = await fetchOneFeatured(collection.skip(index))
  if (!recipe) return null

  todayFeaturedCache = { dayKey, recipeId: recipe.id }
  writeStorageCache(TODAY_STORAGE_KEY, todayFeaturedCache)
  return recipe
}

// 热门菜谱：按点赞数取前 N 名，结果缓存 7 天（跨冷启动持久化），到期才重新查询排序。
async function getHotRecipes(limit) {
  const actualLimit = limit || 6
  let cached = hotRecipeCache[actualLimit]
  if (!cached || !isCacheFresh(cached.at, HOT_CACHE_TTL)) {
    cached = readHotStorageCache(actualLimit)
  }

  if (cached && isCacheFresh(cached.at, HOT_CACHE_TTL)) {
    hotRecipeCache[actualLimit] = cached
    return attachCoverImageUrls(cached.records)
  }

  const result = await getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .orderBy('likes', 'desc')
    .field(LIST_FIELDS)
    .limit(actualLimit)
    .get()
  const records = result.data || []
  const fresh = { records, at: Date.now() }
  hotRecipeCache[actualLimit] = fresh
  writeHotStorageCache(actualLimit, fresh)
  return attachCoverImageUrls(records)
}

async function getCuisineCounts() {
  if (cuisineCountsCache && isCacheFresh(cuisineCountsCacheAt, CATEGORY_CACHE_TTL)) {
    return cuisines.map(cuisine => ({ ...cuisine, count: cuisineCountsCache[cuisine.key] || 0 }))
  }

  const db = getDatabase()
  let cloudCounts
  try {
    const $ = db.command.aggregate
    const result = await db.collection(cloudConfig.RECIPE_COLLECTION)
      .aggregate()
      .match({ category: 'cn' })
      .group({ _id: '$cuisine', count: $.sum(1) })
      .end()
    cloudCounts = (result.list || []).reduce((map, item) => {
      map[item._id] = item.count || 0
      return map
    }, {})
  } catch (err) {
    // 旧版基础库不支持聚合时，退回并行计数，保证页面可用。
    console.warn('菜系统计聚合失败，已降级为计数查询:', err)
    const counts = await Promise.all(cuisines.map(async cuisine => {
      const result = await db.collection(cloudConfig.RECIPE_COLLECTION)
        .where({ category: 'cn', cuisine: cuisine.key })
        .count()
      return { key: cuisine.key, count: result.total || 0 }
    }))
    cloudCounts = counts.reduce((map, item) => {
      map[item.key] = item.count
      return map
    }, {})
  }
  cuisineCountsCache = cloudCounts
  cuisineCountsCacheAt = Date.now()

  return cuisines.map(cuisine => ({ ...cuisine, count: cloudCounts[cuisine.key] || 0 }))
}

// 某一分类下的菜谱真实总数（与列表页 where({ category }).count() 完全同口径）。
// 不能用八大菜系计数相加代替：category 为 cn 但 cuisine 字段为空的菜谱
// （如用户发布、未选菜系的菜谱）不属于任何菜系分组，相加会漏掉这部分。
async function getCategoryTotal(categoryKey) {
  const result = await getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .where({ category: categoryKey })
    .count()
  return result.total || 0
}

async function getCategoryOverview(categoryKey) {
  let cached = categoryOverviewCache[categoryKey]
  if (!cached || !isCacheFresh(cached.at, CATEGORY_CACHE_TTL)) {
    const db = getDatabase()
    const collection = db.collection(cloudConfig.RECIPE_COLLECTION)
    const getPreview = async () => {
      try {
        return await collection.where({ category: categoryKey })
          .orderBy('likes', 'desc')
          .field(LIST_FIELDS)
          .limit(8)
          .get()
      } catch (err) {
        // 索引尚未创建时仍显示前八条，避免分类页因排序查询失败而白屏。
        console.warn('分类热门索引未命中，已降级为普通查询:', err)
        return collection.where({ category: categoryKey })
          .field(LIST_FIELDS)
          .limit(8)
          .get()
      }
    }
    const [previewResult, countResult] = await Promise.all([
      getPreview(),
      collection.where({ category: categoryKey }).count()
    ])
    cached = {
      preview: previewResult.data || [],
      total: countResult.total || 0,
      at: Date.now()
    }
    categoryOverviewCache[categoryKey] = cached
  }

  return {
    preview: await attachCoverImageUrls(cached.preview),
    total: cached.total
  }
}

async function searchRecipes(keyword) {
  const kw = (keyword || '').trim().toLowerCase()
  if (!kw) return []
  const list = await getAllRecipes()
  const results = list.filter(recipe =>
    recipe.title.toLowerCase().includes(kw) ||
    (recipe.desc || '').toLowerCase().includes(kw) ||
    (recipe.tags || []).some(tag => tag.toLowerCase().includes(kw)) ||
    (recipe.ingredients || []).some(item => item.name.toLowerCase().includes(kw))
  )
  return attachCoverImageUrls(results)
}

async function getHotKeywords() {
  const featured = await getFeaturedRecipes()
  const words = []
  featured.forEach(recipe => words.push(...(recipe.tags || [])))
  return [...new Set(words)].slice(0, 12)
}

async function getTotalCount() {
  if (!isCacheFresh(totalCountCacheAt, CACHE_TTL)) {
    const result = await getDatabase().collection(cloudConfig.RECIPE_COLLECTION).count()
    totalCountCache = result.total || 0
    totalCountCacheAt = Date.now()
  }
  return totalCountCache || 0
}

async function getBanners(forceRefresh) {
  if (!forceRefresh && bannerCache && Date.now() - bannerCacheAt < CACHE_TTL) return bannerCache
  // 不依赖数据库索引或 enabled 字段类型；缺省 enabled 时默认展示。
  const records = await fetchAll(getDatabase().collection(cloudConfig.BANNER_COLLECTION))
  const banners = records
    .filter(banner => banner.enabled !== false)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))

  // 标准字段为 imageFileId，同时兼容手工录入时常见的 fileID / fileId / imageUrl。
  const getImageSource = banner =>
    banner.imageFileId || banner.fileID || banner.fileId || banner.imageUrl || ''
  const imageSources = banners.map(getImageSource)
  const urlMap = await resolveFileUrls(imageSources.filter(source => source.indexOf('cloud://') === 0))

  bannerCache = banners.map(banner => {
    const source = getImageSource(banner)
    return {
      ...banner,
      imageUrl: getDisplayImageUrl(source, urlMap)
    }
  })
  bannerCacheAt = Date.now()
  return bannerCache
}

// ---------- 用户自创菜谱（写入 recipes 集合，对所有用户可见） ----------

// 发布成功后写入云数据库，所有已加载缓存均失效，保证首页/分类/搜索立即可见。
async function addRecipe(recipe) {
  if (recipe.coverImageFileId && !isCloudFileId(recipe.coverImageFileId)) {
    throw new Error('封面图必须使用云存储 fileID，不能保存本地临时路径')
  }
  const doc = {
    ...recipe,
    id: Date.now(),
    source: 'user',
    createdAt: Date.now(),
    views: 0,
    likes: 0
  }
  if (doc.coverImageUrl && !isHttpsImageUrl(doc.coverImageUrl)) delete doc.coverImageUrl
  await getDatabase().collection(cloudConfig.RECIPE_COLLECTION).add({ data: doc })
  clearCache()
  return doc
}

// 仅能删除自己发布的菜谱：数据库权限要求“仅创建者可写”，越权删除会被服务端拒绝。
async function removeRecipe(id) {
  const db = getDatabase()
  const result = await db.collection(cloudConfig.RECIPE_COLLECTION).where({ id: Number(id) }).get()
  const target = (result.data || [])[0]
  if (target && target._id) {
    await db.collection(cloudConfig.RECIPE_COLLECTION).doc(target._id).remove()
  }
  clearCache()
}

// 当前用户发布过的菜谱：按写入时自动记录的 _openid 过滤，用于“我的”页面展示。
async function getMyRecipes(openid) {
  if (!openid) return []
  const list = await fetchAll(getDatabase().collection(cloudConfig.RECIPE_COLLECTION)
    .where({ _openid: openid })
    .field(LIST_FIELDS))
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return attachCoverImageUrls(list)
}

// ---------- 评论（独立的 comments 集合，对所有用户可见） ----------

async function getComments(recipeId) {
  const result = await getDatabase().collection(cloudConfig.COMMENT_COLLECTION)
    .where({ recipeId: String(recipeId) })
    .orderBy('createdAt', 'desc')
    .get()
  return result.data || []
}

// author 为发表者的 { nickname }，写入后重新拉取该菜谱的完整评论列表。
// 注：不保存头像——chooseAvatar 拿到的多是本机临时文件路径，写入数据库后
// 对其他用户/其他设备都是失效链接，因此评论区只展示昵称。
async function addComment(recipeId, content, author) {
  const comment = {
    recipeId: String(recipeId),
    content,
    author: (author && author.nickname) || '匿名食客',
    createdAt: Date.now()
  }
  await getDatabase().collection(cloudConfig.COMMENT_COLLECTION).add({ data: comment })
  return getComments(recipeId)
}

// 仅能删除自己发表的评论：数据库权限要求“仅创建者可写”，越权删除会被服务端拒绝。
async function removeComment(id, recipeId) {
  await getDatabase().collection(cloudConfig.COMMENT_COLLECTION).doc(id).remove()
  return getComments(recipeId)
}

// ---------- 意见反馈（写入 feedback 集合，开发者通过云开发控制台查看） ----------

async function submitFeedback(content) {
  await getDatabase().collection(cloudConfig.FEEDBACK_COLLECTION).add({
    data: { content, createdAt: Date.now() }
  })
}

// ----------  助手对话记录（写入 ai_conversations 集合） ----------
// 一次打开 助手页面到离开算一段对话：第一条消息发出时才建云端记录（避免只是
// 点进页面看看、什么都没问也留一条空记录），之后同一段对话里的每条新消息都
// push 进这条记录，离开页面再进入则视为新的一段对话。

async function addAiConversationDoc() {
  const { _id } = await getDatabase().collection(cloudConfig.AI_CHAT_COLLECTION).add({
    data: { messages: [], startedAt: Date.now(), updatedAt: Date.now() }
  })
  return _id
}

async function startAiConversation() {
  try {
    return await addAiConversationDoc()
  } catch (err) {
    // 集合尚未创建（老版本地会话 / login 云函数未重新部署）：补建后重试一次，
    // 避免整段对话静默丢失、不同步到云端。
    if (!isCollectionMissingError(err)) throw err
    await ensurePersonalCollections()
    return addAiConversationDoc()
  }
}

async function appendAiMessage(conversationId, message) {
  if (!conversationId) return
  const db = getDatabase()
  try {
    await db.collection(cloudConfig.AI_CHAT_COLLECTION).doc(conversationId).update({
      data: { messages: db.command.push(message), updatedAt: Date.now() }
    })
  } catch (err) {
    console.warn('对话记录保存失败:', err)
  }
}

// 「我的-聊天记录」用：按最近更新时间取用户自己的对话，每条只需要预览信息。
// 集合尚未创建时返回空数组（登录云函数会自动创建，手动建集合前也不应报错）。
async function getAiConversations(limit) {
  const result = await resultIfCollectionMissing(
    getDatabase().collection(cloudConfig.AI_CHAT_COLLECTION)
      .orderBy('updatedAt', 'desc')
      .limit(limit || 20)
      .get(),
    { data: [] }
  )
  return result.data || []
}

async function getAiConversationById(id) {
  const result = await resultIfCollectionMissing(
    getDatabase().collection(cloudConfig.AI_CHAT_COLLECTION).doc(id).get(),
    { data: null }
  )
  return result.data || null
}

async function removeAiConversation(id) {
  try {
    await getDatabase().collection(cloudConfig.AI_CHAT_COLLECTION).doc(id).remove()
  } catch (err) {
    if (isCollectionMissingError(err)) return
    throw err
  }
}

// ---------- 收藏（favorites 集合，仅创建者可读写；登录后启用） ----------
// 每个文档只记录 { recipeId, createdAt }，_openid 由数据库自动写入，
// 配合“仅创建者可读写”权限，用户只能读到自己的收藏，天然按人隔离。
// 收藏 id 列表在本次运行期内缓存，详情页、收藏夹、“我的”统计共用同一份结果，
// 发生增删后立即失效，下次读取重新拉取。

let favoriteIdsPromise = null
// 收藏夹页/我的页都需要展示完整的收藏菜谱信息（标题、封面图等），若各自独立
// 请求，会在来回切换 tab 或从我的页跳收藏夹时重复发起相同的网络请求（含图片
// 临时地址解析），造成收藏数显示延迟、收藏夹每次进入都要重新等待加载。这里把
// “收藏 id -> 完整菜谱”这一步的结果也缓存到运行期内存中，跨页面实例共用同一份
// 结果；只有真正发生收藏/取消收藏时才失效重取，纯粹切换页面/tab 不再重新请求。
let favoriteRecordsPromise = null

function getFavoriteIds() {
  if (!favoriteIdsPromise) {
    favoriteIdsPromise = resultIfCollectionMissing(
      fetchAll(getDatabase().collection(cloudConfig.FAVORITE_COLLECTION)
        .field({ recipeId: true, createdAt: true })
        .orderBy('createdAt', 'desc')),
      []
    )
      .then(list => list.map(item => item.recipeId).filter(id => id !== undefined && id !== null))
      .catch(err => {
        favoriteIdsPromise = null // 查询失败不缓存错误，允许下次进入页面重试
        throw err
      })
  }
  return favoriteIdsPromise
}

// 收藏夹页专用：完整菜谱信息（含封面图），带运行期缓存，见上方注释。
function getFavoriteRecipes() {
  if (!favoriteRecordsPromise) {
    favoriteRecordsPromise = getFavoriteIds()
      .then(ids => getRecipesByIds(ids))
      .catch(err => {
        favoriteRecordsPromise = null // 查询失败不缓存错误，允许下次进入页面重试
        throw err
      })
  }
  return favoriteRecordsPromise
}

function invalidateFavoriteCache() {
  favoriteIdsPromise = null
  favoriteRecordsPromise = null
}

async function addFavoriteDoc(recipeId) {
  const collection = getDatabase().collection(cloudConfig.FAVORITE_COLLECTION)
  // 防重复：历史本地收藏迁移或快速连点时，可能已存在同一条记录。
  const existed = await collection.where({ recipeId }).count()
  if (existed.total > 0) return
  await collection.add({ data: { recipeId, createdAt: Date.now() } })
}

async function addFavorite(id) {
  const recipeId = Number(id)
  if (!Number.isFinite(recipeId)) return
  try {
    await addFavoriteDoc(recipeId)
  } catch (err) {
    if (!isCollectionMissingError(err)) throw err
    await ensurePersonalCollections()
    await addFavoriteDoc(recipeId)
  }
  invalidateFavoriteCache()
}

async function removeFavorite(id) {
  const recipeId = Number(id)
  if (!Number.isFinite(recipeId)) return
  try {
    const db = getDatabase()
    const result = await db.collection(cloudConfig.FAVORITE_COLLECTION)
      .where({ recipeId }).get()
    const target = (result.data || [])[0]
    if (target && target._id) {
      await db.collection(cloudConfig.FAVORITE_COLLECTION).doc(target._id).remove()
    }
  } catch (err) {
    // 集合都不存在说明云端本就没有这条收藏，按“已取消”处理即可。
    if (!isCollectionMissingError(err)) throw err
  }
  invalidateFavoriteCache()
}

// 登录成功后把旧版本地收藏（jiawei_favorites）一次性搬到云端，
// 已存在的记录由 addFavoriteDoc 的查重逻辑自动跳过。
async function migrateLocalFavorites(ids) {
  const valid = [...new Set((ids || []).map(Number).filter(Number.isFinite))]
  if (!valid.length) return
  await Promise.all(valid.map(id => addFavorite(id).catch(() => null)))
  invalidateFavoriteCache()
}

// 发布/删除菜谱后清空的缓存：只清会因为“菜谱多了/少了一条”而需要刷新的列表类
// 缓存。今日推荐、热门菜谱两个“按周期固定”的缓存故意不在这里清——它们的设计
// 目的就是不受发布/删除影响，否则又会退回本节开头修复的那个跳变问题。
function clearCache() {
  allRecipeCache = null
  bannerCache = null
  allRecipeCacheAt = 0
  bannerCacheAt = 0
  cuisineCountsCache = null
  cuisineCountsCacheAt = 0
  featuredCache = null
  featuredCacheAt = 0
  totalCountCache = null
  totalCountCacheAt = 0
  Object.keys(categoryOverviewCache).forEach(key => delete categoryOverviewCache[key])
  Object.keys(fileUrlCache).forEach(key => delete fileUrlCache[key])
}

module.exports = {
  categories, cuisines, OTHER_CUISINE,
  getCategory, getCuisine, getRecipesPage, getRecipeById,
  getRecipesByIds, resolveRecipeImages, getDailyFeatured, getHotRecipes, getCuisineCounts,
  getCategoryTotal, getCategoryOverview, searchRecipes, getHotKeywords, getTotalCount, getBanners,
  addRecipe, removeRecipe, getMyRecipes,
  getComments, addComment, removeComment,
  submitFeedback,
  startAiConversation, appendAiMessage, getAiConversations, getAiConversationById, removeAiConversation,
  getFavoriteIds, getFavoriteRecipes, addFavorite, removeFavorite, migrateLocalFavorites
}
