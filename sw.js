/*
 * production-ready Service Worker
 * - 强制更新（skipWaiting + clients.claim）
 * - 版本化 Cache + Stale-While-Revalidate（普通资源）
 * - 图片走本地 File System Access：缓存优先，未命中时等待页面提供目录句柄后落盘读取
 * - 句柄获取：超时 + 重试，页面句柄就绪后立即唤醒所有等待中的图片请求
 * - 按错误类型区分 404 / 503，路径安全校验
 */

/* ================= 配置区 ================= */

// ⚠️ 每次发布必须修改版本号
const SW_VERSION = 'v7'

const CACHE_PREFIX = 'm2-cache'
const CACHE_NAME = `${CACHE_PREFIX}-${SW_VERSION}`

// 需要预缓存的核心资源（尽量少）
const PRECACHE_URLS = ['/']

// 图片请求路径前缀与本地目录名
const IMAGE_PREFIX = '/images/'
const IMAGES_DIR = 'images'

// 向页面请求 dirHandle：单次等待时长 / 最大重试次数
const HANDLE_TIMEOUT = 1500
const HANDLE_RETRIES = 3

/* ================= 客户端目录句柄管理 ================= */

// clientId -> { dirHandle, waiting, resolve, asking }
const handleMap = new Map()

function getCtx(clientId) {
  let ctx = handleMap.get(clientId)
  if (!ctx) {
    ctx = { dirHandle: null, waiting: null, resolve: null, asking: false }
    handleMap.set(clientId, ctx)
  }
  return ctx
}

// 向页面索要 dirHandle；页面句柄就绪后通过 message 立即唤醒等待者
function waitForHandle(clientId) {
  const ctx = getCtx(clientId)
  if (ctx.dirHandle) return Promise.resolve(ctx.dirHandle)

  if (!ctx.waiting) {
    ctx.waiting = new Promise(resolve => {
      ctx.resolve = resolve
    }).then(handle => {
      ctx.waiting = null
      ctx.resolve = null
      return handle
    })

    requestHandleWithRetry(clientId)
  }
  return ctx.waiting
}

async function requestHandleWithRetry(clientId) {
  const ctx = getCtx(clientId)
  if (ctx.asking) return
  ctx.asking = true

  try {
    for (let i = 0; i < HANDLE_RETRIES && !ctx.dirHandle; i++) {
      const client = await self.clients.get(clientId)
      if (!client) break // 页面已关闭，无法提供句柄
      client.postMessage({ type: 'dirHandle' })
      await new Promise(r => setTimeout(r, HANDLE_TIMEOUT))
    }
  } finally {
    ctx.asking = false
    // 重试耗尽仍无句柄（页面未选目录 / 无权限），释放等待者
    ctx.resolve?.(ctx.dirHandle)
  }
}

/* ================= install ================= */

// 非必须，可在首次访问时缓存指定资源，但仍需监听 fetch 事件来响应缓存
self.addEventListener('install', event => {
  console.log('[SW] install', SW_VERSION)

  // 强制跳过 waiting
  self.skipWaiting()

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS)
    })
  )
})

/* ================= activate ================= */

self.addEventListener('activate', event => {
  console.log('[SW] activate', SW_VERSION)

  event.waitUntil(
    Promise.all([
      // 清理旧缓存
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
              .map(key => caches.delete(key))
          )
        ),

      // 立即接管页面
      self.clients.claim()
    ])
  )
})

/* ================= fetch ================= */

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)

  // 非 GET 或跨域请求：不接管，直接走网络
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // 图片请求：本地文件系统（缓存优先）
  if (url.pathname.startsWith(IMAGE_PREFIX)) {
    event.respondWith(handleImageRequest(url.pathname, event.clientId))
    return
  }

  // 其他资源：Stale-While-Revalidate
  event.respondWith(handleRequest(req, event))
})

/* ================= error safety ================= */

self.addEventListener('error', event => {
  console.log('[SW] error', event.error)
})

self.addEventListener('unhandledrejection', event => {
  console.log('[SW] unhandledrejection', event.reason)
})

async function handleRequest(request, event) {
  const cache = await caches.open(CACHE_NAME)

  // 1. 先查缓存
  const matchCache = await cache.match(request, { ignoreSearch: true })

  // 2. 后台更新
  const fetchPromise = fetch(new Request(request, { cache: 'no-store' }))
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })

  // 关键：后台更新挂在事件生命周期上，避免 Worker 提前终止
  event.waitUntil(fetchPromise.catch(() => {}))

  // 3. 优先返回缓存，没有则等网络
  return matchCache || fetchPromise
}

/* ================= 图片请求：本地文件系统（缓存优先） ================= */

// 供页面判断"稍后重试"的响应头
const FS_RETRY_HEADERS = { 'X-FS-Retry': 'true' }

async function handleImageRequest(pathname, clientId) {
  const cache = await caches.open(CACHE_NAME)

  // 1. 缓存命中：句柄丢失/未就绪也不影响已读过的图片
  const cached = await cache.match(pathname)
  if (cached) return cached

  // 2. 等待页面提供目录句柄（带超时重试，页面就绪后立即唤醒）
  const dirHandle = clientId ? await waitForHandle(clientId) : null
  if (!dirHandle) {
    return new Response('FS handle not ready', {
      status: 503,
      headers: FS_RETRY_HEADERS
    })
  }

  // 3. 文件名解码 + 安全校验（防目录穿越）
  let filename = ''
  try {
    filename = decodeURIComponent(pathname.slice(IMAGE_PREFIX.length)).trim()
  } catch (_) {
    return new Response('Invalid image path', { status: 400 })
  }
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return new Response('Invalid image path', { status: 400 })
  }

  try {
    // 4. images 目录 -> 文件句柄 -> File
    const imagesDir = await dirHandle.getDirectoryHandle(IMAGES_DIR)
    const fileHandle = await imagesDir.getFileHandle(filename)
    const file = await fileHandle.getFile()

    const response = new Response(file, {
      headers: {
        'Content-Type': file.type || 'image/png',
        'Content-Length': String(file.size)
      }
    })

    // 5. 写入版本化 Cache：文件名含时间戳、内容不可变，后续请求不再依赖句柄
    cache.put(pathname, response.clone()).catch(err => {
      console.warn('[SW] cache image failed', filename, err)
    })

    return response
  } catch (err) {
    // NotFoundError: 文件不存在 -> 404；NotAllowedError 等权限问题 -> 503
    const notFound = err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')
    const status = notFound ? 404 : 503
    console.warn(`[SW] image ${status}`, filename, err && err.name, err && err.message)
    return new Response(notFound ? 'Image not found' : 'FS access failed', {
      status,
      headers: notFound ? {} : FS_RETRY_HEADERS
    })
  }
}

/* ================= message：接收页面提供的目录句柄 ================= */

self.addEventListener('message', event => {
  const data = event.data
  // 页面回复时 clientId 即发起请求的页面；页面主动推送时用 source.id
  const clientId = event.clientId || (event.source && event.source.id)
  console.log('[SW] message', clientId, data && data.type)

  if (data && data.type === 'dirHandle' && clientId) {
    const ctx = getCtx(clientId)
    ctx.dirHandle = data.dirHandle || null
    // 句柄就绪，立即唤醒所有等待中的图片请求
    if (ctx.resolve) ctx.resolve(ctx.dirHandle)
  }
})
