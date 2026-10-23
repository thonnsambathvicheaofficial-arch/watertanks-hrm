// Does a roster correction's note record leave? HR's usual way of recording leave on the roster is a correction marked Excused with a
// Khmer note such as "ច្បាប់ 0,5 ថ្ងៃ 21/10/26" ("leave 0.5 day"). The notifier reads that as leave, the same as an approved leave request.
//
// Returns null when the note is not about leave, or { days, period }:
//   days    how long, from "N ថ្ងៃ" / "N day(s)" / "half day"; null when the note gives no length (it covers the day)
//   period  'morning' (ព្រឹក) or 'afternoon' (រសៀល, ល្ងាច) when the note says which half, otherwise null
//
// "ឈប់អត់ច្បាប់" (absent WITHOUT leave) is the opposite of leave and is never read as leave.

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'

function tidy(note) {
  return String(note || '')
    .replace(/[​-‍﻿]/g, '')                                   // zero-width characters Excel and Khmer keyboards leave behind
    .replace(/[០-៩]/g, d => String(KHMER_DIGITS.indexOf(d)))               // Khmer numerals to 0-9
    .replace(/\s+/g, ' ')
    .trim()
}

const NOT_LEAVE = /អត់\s*ច្បាប់|មិន\s*មាន\s*ច្បាប់|គ្មាន\s*ច្បាប់|without\s+(?:any\s+)?(?:leave|permission)|no\s+leave|absent\s+without/i
const IS_LEAVE = /ច្បាប់|\b(?:annual|sick|special|unpaid|half[- ]?day)?\s*leave\b/i

function parseLeaveNote(note) {
  const t = tidy(note)
  if (!t || NOT_LEAVE.test(t) || !IS_LEAVE.test(t)) return null
  let days = null
  const n = /(\d+(?:[.,]\d+)?)\s*(?:ថ្ងៃ|ថ្ថៃ|days?\b)/i.exec(t)
  if (n) days = Number(n[1].replace(',', '.'))
  else if (/កន្លះ|ពាក់កណ្ដាល|ពាក់កណ្តាល|half[- ]?day/i.test(t)) days = 0.5
  if (days !== null && !(days > 0)) days = null
  const period = /ព្រឹក|morning/i.test(t) ? 'morning' : /រសៀល|ល្ងាច|afternoon/i.test(t) ? 'afternoon' : null
  return { days, period }
}

module.exports = { parseLeaveNote }
