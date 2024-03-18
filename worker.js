onmessage = e => {
  console.log(e)
  if (e.data?.type === 'init') {
    readData(e.data.key)
  }
  if (e.data?.type === 'save') {
    writeData(e.data.key, e.data.value)
  }
}

async function writeData(key, data) {
  const opfsRoot = await navigator.storage.getDirectory()
  const fileHandle = await opfsRoot.getFileHandle('bytemd-paste-' + key, {
    create: true
  })
  const accessHandle = await fileHandle.createSyncAccessHandle()

  // 清空
  accessHandle.truncate(0)

  const textEncoder = new TextEncoder()

  // 编码要写入文件的内容。
  const content = textEncoder.encode(data)
  // 在文件的开头写入内容。
  accessHandle.write(content, { at: 0 })
  // 将更改持久化至磁盘
  accessHandle.flush()
  // 用完 FileSystemSyncAccessHandle 后记得把它关闭
  accessHandle.close()

}

async function readData(key) {
  const opfsRoot = await navigator.storage.getDirectory()
  const fileHandle = await opfsRoot.getFileHandle('bytemd-paste-' + key, {
    create: true
  })
  const accessHandle = await fileHandle.createSyncAccessHandle()

  const textDecoder = new TextDecoder()

  // 将这个变量初始化为文件的大小。
  const size = accessHandle.getSize()
  console.log('size:', size)

  // 准备一个长度与文件相同的数据视图。
  const dataView = new DataView(new ArrayBuffer(size))

  // 将整个文件读取到数据视图。
  accessHandle.read(dataView, { at: 0 })
  // 解码
  const content = textDecoder.decode(dataView)
  postMessage(content)

  // 用完 FileSystemSyncAccessHandle 后记得把它关闭
  accessHandle.close()
}
