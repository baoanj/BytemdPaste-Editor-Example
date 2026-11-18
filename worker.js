/* ================= 状态 ================= */

let fileHandle = null
let dirHandle = null
// images 子目录句柄缓存，目录句柄变更时重置
let imagesDirHandle = null

/* ================= 消息分发 ================= */

onmessage = e => {
  const data = e.data || {}
  switch (data.type) {
    case 'fileHandle':
      fileHandle = data.fileHandle
      break
    case 'dirHandle':
      dirHandle = data.dirHandle
      imagesDirHandle = null
      break
    case 'save':
      queueSave(data.value)
      break
    case 'saveImage':
      saveImage(data.value)
      break
  }
}

function postError(message) {
  postMessage({ type: 'error', message })
}

/* ================= 文本保存：串行队列 + 最新值合并 ================= */
// 保证同一文件写入串行（createWritable 不支持并发），
// 且排队期间连续多次修改只落盘最新内容

let saveChain = Promise.resolve()
let pendingValue = null

function queueSave(value) {
  pendingValue = value
  saveChain = saveChain
    .then(async () => {
      if (pendingValue === null || !fileHandle) return
      const v = pendingValue
      pendingValue = null
      await writeData(v)
    })
    .catch(err => postError('保存失败：' + (err && err.message ? err.message : err)))
}

async function writeData(data) {
  if (!fileHandle) {
    postError('文件句柄未就绪，内容未保存')
    return
  }

  const writable = await fileHandle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (err) {
    // 写入失败时中止，避免留下半截临时文件
    try {
      await writable.abort()
    } catch (_) { /* 已关闭或不可中止，忽略 */ }
    throw err
  }
}

/* ================= 图片保存 ================= */
// 文件名由页面统一生成并下发，保证 md 中的 URL 与落盘文件名一致

async function saveImage({ file, filename }) {
  try {
    if (!dirHandle) {
      postError('目录句柄未就绪，图片未保存')
      return
    }
    if (!(file instanceof File) || !file.type.startsWith('image/')) {
      return
    }
    if (!filename || /[\\/]|\.\./.test(filename)) {
      postError('非法图片文件名：' + filename)
      return
    }

    // 1. 获取 / 创建 images 目录（句柄已缓存则直接复用）
    if (!imagesDirHandle) {
      imagesDirHandle = await dirHandle.getDirectoryHandle('images', {
        create: true
      })
    }

    // 2. 获取 / 创建目标文件
    const targetHandle = await imagesDirHandle.getFileHandle(filename, {
      create: true
    })

    // 3. 写入文件
    const writable = await targetHandle.createWritable()
    try {
      await writable.write(file)
      await writable.close()
    } catch (err) {
      try {
        await writable.abort()
      } catch (_) { /* 已关闭或不可中止，忽略 */ }
      throw err
    }

    postMessage({ type: 'image', filename })
  } catch (err) {
    postError('图片保存失败：' + (err && err.message ? err.message : err))
  }
}
