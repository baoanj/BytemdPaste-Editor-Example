var fileHandle

onmessage = e => {
  console.log(e)
  if (e.data?.type === 'init') {
    // readData(e.data.key)
  }
  if (e.data?.type === 'fileHandle') {
    fileHandle = e.data.fileHandle
  }
  if (e.data?.type === 'save') {
    writeData(e.data.value)
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
