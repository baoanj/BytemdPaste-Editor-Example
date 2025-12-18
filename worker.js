var fileHandle
var dirHandle

onmessage = e => {
  console.log('[Worker] message', e)

  if (e.data?.type === 'init') {
    // readData(e.data.key)
  }
  if (e.data?.type === 'fileHandle') {
    fileHandle = e.data.fileHandle
  }
  if (e.data?.type === 'dirHandle') {
    dirHandle = e.data.dirHandle
  }
  if (e.data?.type === 'save') {
    writeData(e.data.value)
  }
  if (e.data?.type === 'saveImage') {
    saveImageToImagesDir(e.data.value)
  }
}

async function writeData(data) {
  if (fileHandle) {
    const writable = await fileHandle.createWritable()
    // Write the contents of the file to the stream.
    await writable.write(data)
    // Close the file and write the contents to disk.
    await writable.close()

    const file = await fileHandle.getFile()
    const contents = await file.text()
    if (data !== contents) {
      postMessage({ type: 'error', message: '保存失败' })
    }
  }
}

/**
 * 将图片 File 保存到指定目录下的 images 子目录
 * @param {File} file 图片 File 对象
 */
async function saveImageToImagesDir(file) {
  console.log('[Worker] saveImageToImagesDir', dirHandle, file)

  if (
    !dirHandle ||
    !(file instanceof File) ||
    !file.type.startsWith('image/')
  ) {
    return
  }

  // 1. 获取 / 创建 images 目录
  const imagesDirHandle = await dirHandle.getDirectoryHandle('images', {
    create: true
  })

  const permission2 = await imagesDirHandle.queryPermission({
    mode: 'readwrite'
  })
  console.log('[Worker] permission2', permission2)

  // 2. 获取 / 创建目标文件
  const filename = Date.now() + '-' + file.name
  const fileHandle = await imagesDirHandle.getFileHandle(filename, {
    create: true
  })

  // 3. 写入文件
  const writable = await fileHandle.createWritable()
  await writable.write(file)
  await writable.close()
  postMessage({ type: 'image', filename })
}
