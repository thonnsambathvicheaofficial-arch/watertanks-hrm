// Reads only the NEWEST attendance records from a ZKTeco device, so a poll that sees "3 more scans" fetches
// about 120 bytes instead of re-reading the whole log (B3-C holds 9,000+ records and a full read takes many
// seconds). The device's data command answers with the size of the whole log and then streams whatever byte
// ranges are requested, so only the last range is asked for.
//
// READ-ONLY toward the device: it sends the same "prepare attendance data" and "read chunk" requests a full
// read does, for a smaller range, then frees the data buffer. Nothing is written or cleared.
//
// A tail read never advances the completeness baseline (devices.last_log_count). Only a full read proves the
// whole log was ingested, so the scheduled full sync stays as the safety net behind this fast path.
require('./zk-readfix')   // the runtime fix for the multi-chunk read, loaded the same way lib/zkpull.js loads it
const { COMMANDS, REQUEST_DATA } = require('node-zklib/constants')
const { createTCPHeader, decodeTCPHeader, decodeRecordData40, checkNotEventTCP } = require('node-zklib/utils')

const RECORD = 40          // bytes per attendance record on the TCP protocol
const HEADER = 4           // the log is prefixed with a 4-byte size field

// zk: a connected ZKLib instance (createSocket done). Returns { total, records } with up to `count` newest
// records in the order the device stores them (oldest first among the tail).
async function readTail(zk, count, { timeoutMs = 8000, startAdjust = 0 } = {}) {
  const tcp = zk.zklibTcp
  if (!tcp || !tcp.socket) throw new Error('Not connected over TCP')
  try { await tcp.freeData() } catch { /* nothing buffered */ }

  tcp.replyId++
  const reply = await tcp.requestData(createTCPHeader(COMMANDS.CMD_DATA_WRRQ, tcp.sessionId, tcp.replyId, REQUEST_DATA.GET_ATTENDANCE_LOGS))
  const head = decodeTCPHeader(reply.subarray(0, 16))

  let body
  if (head.commandId === COMMANDS.CMD_DATA) {
    body = reply.subarray(16)                     // a small log comes back in one reply
  } else if (head.commandId === COMMANDS.CMD_ACK_OK || head.commandId === COMMANDS.CMD_PREPARE_DATA) {
    const size = reply.subarray(16).readUIntLE(1, 4)
    const n = Math.max(0, Math.floor((size - HEADER) / RECORD))
    if (n === 0) { try { await tcp.freeData() } catch {} return { total: 0, records: [] } }
    const k = Math.min(count, n)
    // Byte ranges are counted from the first record, not from the 4-byte size field (checked against the K40: a range that
    // starts 4 bytes into a record is rounded up to the next one, so counting the header lost a record and returned junk).
    const start = (n - k) * RECORD + startAdjust, len = k * RECORD
    body = Buffer.concat([Buffer.alloc(HEADER), await readRange(tcp, start, len, timeoutMs)])
    try { await tcp.freeData() } catch { /* best effort */ }
    return { total: n, records: parse(body.subarray(HEADER)) }
  } else {
    throw new Error('Unexpected reply to the attendance request: ' + head.commandId)
  }
  // The small-log branch: take the last `count` records of what came back.
  const all = parse(body.subarray(HEADER))
  try { await tcp.freeData() } catch {}
  return { total: all.length, records: all.slice(-count) }
}

// Requests one byte range and collects it. Replies arrive as TCP-framed packets whose data starts with 8 bytes of
// chunk header, exactly as in lib/zk-readfix.js, and the range can arrive split over several packets.
function readRange(tcp, start, len, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stream = Buffer.alloc(0), data = Buffer.alloc(0)
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading the newest records')) }, timeoutMs)
    const onData = (chunk) => {
      if (checkNotEventTCP(chunk)) return
      stream = Buffer.concat([stream, chunk])
      while (stream.length >= 8) {
        const packetLength = stream.readUIntLE(4, 2)
        if (stream.length < 8 + packetLength) break
        data = Buffer.concat([data, stream.subarray(16, 8 + packetLength)])
        stream = stream.subarray(8 + packetLength)
      }
      if (data.length >= len + 8) { cleanup(); resolve(data.subarray(8, 8 + len)) }
    }
    const onClose = () => { cleanup(); reject(new Error('The device closed the connection')) }
    const cleanup = () => { clearTimeout(timer); tcp.socket.removeListener('data', onData); tcp.socket.removeListener('close', onClose) }
    tcp.socket.on('data', onData)
    tcp.socket.once('close', onClose)
    tcp.sendChunkRequest(start, len)
  })
}

function parse(buf) {
  const out = []
  for (let i = 0; i + RECORD <= buf.length; i += RECORD) out.push(decodeRecordData40(buf.subarray(i, i + RECORD)))
  return out
}

module.exports = { readTail }
