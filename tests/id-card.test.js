// Reading a Cambodian national ID card from OCR text (lib/id-card.ts). All people and numbers here are INVENTED:
// no real card's details belong in the repository.
const ts = require('typescript')
const fs = require('fs')
const path = require('path')
const src = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/id-card.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('module', 'exports', src)(mod, mod.exports)
const { checkDigit, parseMrz, bestMrz, parseFront, cardFields, khmerDigits } = mod.exports

let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const NOW = new Date('2026-11-14T00:00:00Z')

// ICAO 9303 published examples for the check digit.
ok(checkDigit('520727') === '3', 'check digit: the ICAO date example 520727 -> 3')
ok(checkDigit('L898902C3') === '6', 'check digit: the ICAO document-number example L898902C3 -> 6')
ok(checkDigit('<<<<<<') === '0', 'check digit: filler only -> 0')

// Build a valid TD1 zone for an invented person, the way a card prints it.
function zone({ doc = '100200300', dob = '900515', sex = 'M', exp = '300119', name = 'SOK<<VISAL<MAKARA' } = {}) {
  const dc = checkDigit(doc), bc = checkDigit(dob), ec = checkDigit(exp)
  const l1 = ('IDKHM' + doc + dc).padEnd(30, '<')
  const body2 = dob + bc + sex + exp + ec + 'KHM' + '<'.repeat(11)
  const comp = checkDigit(doc + dc + '<'.repeat(15) + dob + bc + exp + ec + '<'.repeat(11))
  return [l1, body2 + comp, name.padEnd(30, '<')].join('\n')
}

const clean = parseMrz(zone(), NOW)
ok(clean && clean.idNumber === '100200300' && clean.surname === 'SOK' && clean.given === 'VISAL MAKARA', 'a clean zone gives the ID number and the name split into surname and given names')
ok(clean.sex === 'M' && clean.dob === '1990-05-15' && clean.expiry === '2030-01-19', 'sex, date of birth and expiry are read and turned into dates')
ok(clean.checks.doc && clean.checks.dob && clean.checks.expiry && clean.checks.composite === true && clean.nameClean, 'every check digit passes, including the whole-zone one')

// OCR noise: fillers read as K and L, and the double filler between surname and given names damaged.
const noisy = 'IDKHM1002003004<<<<<<<<K<LKLKLLKKL\n9005156M3001194KHM<K<KLLKLLLKLKL' + checkDigit('1002003004'.slice(0, 9) + '4' + '<'.repeat(15) + '9005156' + '3001194' + '<'.repeat(11)) + '\nSOK<K<VISALLMAKARA<<L<K<KLLKLLLL'
const nz = parseMrz(zone().split('\n').slice(0, 2).join('\n') + '\nSOK<K<VISALLMAKARA<<L<K<KLLKLLLL', NOW)
ok(nz && nz.idNumber === '100200300' && nz.checks.doc && nz.checks.dob, 'noise in the filler does not disturb the numbers, which still pass their check digits')
ok(nz && !nz.nameClean, 'a name line with misread fillers is reported as not clean')
const picked = bestMrz([zone().split('\n').slice(0, 2).join('\n') + '\nSOK<K<VISALLMAKARA<<L<K<KLLKLLLL', zone() + 'LLK'], NOW)
ok(picked && picked.nameClean && picked.given === 'VISAL MAKARA', 'of several reads of the same zone the cleanest one is kept')

// The numbers can come from one read and the name from another: a treatment that reads the name cleanly may garble a digit.
const goodDigitsNoisyName = zone().split('\n').slice(0, 2).join('\n') + '\nSOK<K<VISALLMAKARA<<L<K<KLLKLLLL'
const cleanNameBadDigit = zone().replace('IDKHM100200300' + checkDigit('100200300'), 'IDKHM1002003001' + checkDigit('100200300'))
const mixed = bestMrz([goodDigitsNoisyName, cleanNameBadDigit], NOW)
ok(mixed && mixed.idNumber === '100200300' && mixed.checks.doc, 'mixed reads: the numbers come from the read whose check digits pass')
ok(mixed && mixed.nameClean && mixed.surname === 'SOK' && mixed.given === 'VISAL MAKARA', 'mixed reads: the name comes from the read whose name line was clean')
ok(bestMrz([]) === null && bestMrz(['no zone here']) === null, 'no usable read gives null')

// Names are chosen by vote: the stray letters differ from read to read, the real name does not.
const lines12 = zone().split('\n').slice(0, 2).join('\n')
const reads = [
  lines12 + '\nSOKL<<VISAL<MAKARA<<LLLLLLLLLLCLLLLK',      // a stray L after the surname, and a tail of noise
  lines12 + '\nSOK<<VISAL<MAKARA<LKLLLLLLLKLLLKLLKKLKLKKLK',
  lines12 + '\nSOK<<VISAL<MAKARA<<<<<<<<<<<<<<<',
  lines12 + '\nSOK<K<VISALLMAKARA<<L<K<KLLKLLLL',
]
const voted = bestMrz(reads, NOW)
ok(voted && voted.surname === 'SOK' && voted.given === 'VISAL MAKARA', 'the spelling most reads agree on wins over a read with a stray letter')
ok(voted && voted.nameVotes >= 2, 'and the vote strength is reported')
const noisyTail = parseMrz(lines12 + '\nSOK<<VISAL<MAKARA<<LLLLLLLLLLCLLLLK', NOW)
ok(noisyTail && noisyTail.given === 'VISAL MAKARA', 'a long tail that is mostly K and L (with a stray other letter in it) is noise, not part of the name')
ok(parseMrz(lines12 + '\nKIM<<KALLA<LOKLAK', NOW).surname === 'KIM', 'real names with K and L in them are not mistaken for noise')

// Look-alike characters in number positions.
const confused = parseMrz(zone({}).replace('100200300', '1OO2OO3OO').replace('IDKHM1OO2OO3OO0', 'IDKHM1OO2OO3OO0'), NOW)
ok(confused && confused.idNumber === '100200300' && confused.checks.doc, 'letter O read in place of a zero is put back, and then passes its check digit')

// A wrong digit is caught, not trusted.
const wrong = String((Number(checkDigit('100200300')) + 1) % 10)
const bad = parseMrz(zone().replace('IDKHM100200300' + checkDigit('100200300'), 'IDKHM100200300' + wrong), NOW)
ok(bad && bad.checks.doc === false, 'a wrong ID number digit fails its check digit')
const fields = cardFields(bad, null)
ok(fields.idCardNo && fields.idCardNo.verified === false, 'and the form field is then marked as not proven')

// A birth year ahead of today belongs to the last century.
ok(parseMrz(zone({ dob: '051201' }), NOW).dob === '2005-12-01', 'a birth year of 05 is 2005')
ok(parseMrz(zone({ dob: '991201' }), NOW).dob === '1999-12-01', 'a birth year of 99 is 1999')
ok(parseMrz(zone({ dob: '900231' }), NOW).dob === '', 'an impossible date (31 February) is not turned into a date')
ok(parseMrz(zone({ sex: 'F' }), NOW).sex === 'F', 'female is read')
ok(parseMrz('nothing here\nat all', NOW) === null && parseMrz('', NOW) === null, 'text with no zone gives null, not a guess')

// ── the Khmer text ──────────────────────────────────────────────────────────
ok(khmerDigits('២០.០១.២០៣០') === '20.01.2030', 'Khmer numerals are turned into ordinary digits')

const khmerText = [
  'គោត្តនាមនិងនាម: សុខ វិសាល',
  'ថ្ងៃខែឆ្នាំកំណើត: ១៥.០៥.១៩៩០ ភេទ: ប្រុស កម្ពស់: ១៧០ ស.ម',
  'ទីកន្លែងកំណើត: ខេត្តកណ្ដាល',
  'អាសយដ្ឋាន: ភូមិព្រែកអំបិល',
  'សង្កាត់ចាក់អង្រែ រាជធានីភ្នំពេញ',
  'សុពលភាព: ២០.០១.២០២០ ដល់ថ្ងៃ ១៩.០១.២០៣០',
].join('\n')
const fr = parseFront(khmerText)
ok(fr.nameKh === 'សុខ វិសាល', 'the Khmer name is taken from after its label')
ok(fr.birthplace === 'ខេត្តកណ្ដាល', 'the place of birth is taken from after its label')
ok(fr.address === 'ភូមិព្រែកអំបិល សង្កាត់ចាក់អង្រែ រាជធានីភ្នំពេញ', 'an address wrapped over two lines is joined')
ok(fr.dob === '1990-05-15' && fr.sex === 'M', 'birth date (Khmer numerals) and sex are read from the Khmer line')
ok(fr.validFrom === '2020-01-20' && fr.validTo === '2030-01-19', 'the validity dates are read')

// A reader that garbles the labels and adds debris still finds the values.
const garbled = [
  'គៅដ្គនាធនិឯនាម: សុខ វិសាល - : “: “ “8',
  'ស 710 ខុស់អខសារ 1 ន',
  'ទីកន្លែងកំណើគៈ ខេត្តកណ្ដាល',
  'អាសយផ្វាន៍ៈ ភូមិព្រែកអំបិល.  *',
  'សង្កាត់ចាក់អង្រែ រាជធានីភ្នំពេញ',
  'សពលនាពុ: ២០.០១.២០២០ ដល់ថ្ងៃ ១៩.០១.២០៣០',
].join('\n')
const g = parseFront(garbled)
ok(g.nameKh === 'សុខ វិសាល', 'stray punctuation after the name is dropped')
ok(g.birthplace === 'ខេត្តកណ្ដាល' && g.address === 'ភូមិព្រែកអំបិល សង្កាត់ចាក់អង្រែ រាជធានីភ្នំពេញ', 'garbled labels are still matched by similarity')
ok(g.validTo === '2030-01-19', 'a garbled validity label still finds its dates')
const empty = parseFront('')
ok(!empty.nameKh && !empty.address && !empty.birthplace, 'empty text gives empty fields')

// ── what goes into the form ─────────────────────────────────────────────────
const all = cardFields(clean, fr)
ok(all.idCardNo.value === '100200300' && all.idCardNo.verified && all.idCardNo.source === 'mrz', 'ID number: from the zone, proven by its check digit')
ok(all.name.value === 'Sok Visal Makara' && all.name.verified === false, 'name: in capitals-then-lowercase form, never marked proven (no check digit covers it)')
ok(all.gender.value === 'M' && all.gender.verified && all.dateOfBirth.value === '1990-05-15' && all.dateOfBirth.verified, 'gender and birth date: proven by the zone')
ok(all.nameKh.verified === false && all.address.verified === false && all.address.source === 'ocr', 'Khmer name and address: read from the picture, never marked proven')
ok(all.expiry.value === '2030-01-19', 'expiry date is kept for information')
const noZone = cardFields(null, fr)
ok(!noZone.idCardNo && noZone.dateOfBirth.value === '1990-05-15' && noZone.dateOfBirth.verified === false && noZone.gender.value === 'M', 'with no readable zone, birth date and sex fall back to the Khmer text and are not marked proven')
ok(Object.keys(cardFields(null, null)).length === 0, 'nothing read gives no fields')

// ── cases found on a real scanned PDF ───────────────────────────────────────
const { printedNames } = mod.exports

// A zero read as the letter O in the number positions and the closing digit.
const zO = zone().replace(/0/g, 'O').replace(/^(.{30})\n/, '$1\n')
const pO = parseMrz(zO, NOW)
ok(pO && pO.idNumber === '100200300' && pO.checks.doc && pO.checks.dob, 'zeros read as the letter O are put back, and the numbers still pass their check digits')
const zC = zone().split('\n'); zC[1] = zC[1].slice(0, -1) + (zC[1].slice(-1) === '0' ? 'O' : zC[1].slice(-1))
const pC = parseMrz(zC.join('\n'), NOW)
ok(pC && (zone().split('\n')[1].slice(-1) !== '0' || pC.checks.composite === true), 'a closing check digit 0 read as O still verifies the whole zone')

// Noise made of K and L after the name is cut off.
const tail = parseMrz(zone().split('\n').slice(0, 2).join('\n') + '\nSOK<<VISAL<MAKARA<LKLLLLLLLKLLLKLLKKLKLKKLK', NOW)
ok(tail && tail.surname === 'SOK' && tail.given === 'VISAL MAKARA', 'a tail of misread fillers (K and L) is not part of the name')

// The printed Latin name cleans stray letters out of the zone's name.
ok(JSON.stringify(printedNames('some Khmer text\nSOK VISAL MAKARA\n051595896\nlowercase words')) === JSON.stringify(['SOK VISAL MAKARA']), 'the printed name is picked out of the card text: capitals only, two or more words')
const stray = parseMrz(zone().split('\n').slice(0, 2).join('\n') + '\nSOK<<KVISAL<MAKARA<<<<<<<<<<<<<<<', NOW)
ok(stray.given === 'KVISAL MAKARA', 'the zone alone keeps a stray K it cannot tell from a real letter')
ok(cardFields(stray, null, ['SOK VISAL MAKARA']).name.value === 'Sok Visal Makara', 'the printed name wins when it agrees with the zone apart from K and L')
ok(cardFields(stray, null, ['SOK DIFFERENT PERSON']).name.value === 'Sok Kvisal Makara', 'a printed name that does not agree is ignored')
ok(cardFields(clean, null, []).name.value === 'Sok Visal Makara', 'no printed name: the zone name is used')

// Cell snapping: the zone has 30 equal cells per line, so a letter the reader invented beside a filler is dropped.
const { snapMrz } = mod.exports
function symbolsOf(line, { x0 = 90, pitch = 47, extra = [] } = {}) {
  const syms = Array.from(line).map((ch, i) => ({ text: ch, confidence: 96, bbox: { x0: x0 + i * pitch, x1: x0 + i * pitch + 36 } }))
  for (const e of extra) syms.push({ text: e.text, confidence: e.confidence, bbox: { x0: x0 + e.cell * pitch + e.shift, x1: x0 + e.cell * pitch + e.shift + 26 } })
  return { words: [{ symbols: syms.sort((a, b) => a.bbox.x0 - b.bbox.x0) }] }
}
const z = zone().split('\n')
const stray2 = snapMrz([symbolsOf(z[0]), symbolsOf(z[1]), symbolsOf(z[2], { extra: [{ text: 'K', cell: 4, shift: 10, confidence: 80 }] })])
ok(stray2 && stray2.split('\n')[2] === z[2], 'a stray K sharing a cell with a filler (lower confidence) is dropped: the name line comes out exactly as printed')
ok(stray2.split('\n')[0] === z[0] && stray2.split('\n')[1] === z[1], 'lines without invented letters come out unchanged')
// A filler read as K right after the name (the K is not much surer than the filler) must not fuse with the name.
const fuse = snapMrz([symbolsOf(z[0]), symbolsOf(z[1]), symbolsOf(z[2], { extra: [{ text: 'K', cell: 17, shift: 4, confidence: 90 }] })])
ok(fuse && fuse.split('\n')[2] === z[2], 'a filler beats a K that is not clearly surer than it')
const real = symbolsOf(z[2].replace('SOK<<', 'SOL<<'), { extra: [{ text: '<', cell: 2, shift: 6, confidence: 84 }] })
ok(snapMrz([symbolsOf(z[0]), symbolsOf(z[1]), real]).split('\n')[2].startsWith('SOL<<'), 'a real letter much surer than a stray filler mark on it is kept')
const hole = z[2].slice(0, 20) + '<' + z[2].slice(21)
const gap = snapMrz([symbolsOf(z[0]), symbolsOf(z[1]), symbolsOf(z[2]).words[0].symbols.filter((_, i) => i !== 20) && { words: [{ symbols: symbolsOf(z[2]).words[0].symbols.filter((_, i) => i !== 20) }] }])
ok(gap && gap.split('\n')[2].length === 30, 'a filler the reader missed leaves an empty cell, which is filled as a filler: every line is exactly 30 characters')
ok(snapMrz([symbolsOf('IDKHM'), symbolsOf('1234'), symbolsOf('ABC')]) === null, 'too little text to be a zone: no snapping')
const squeezed = snapMrz([symbolsOf(z[0], { pitch: 12 }), symbolsOf(z[1], { pitch: 12 }), symbolsOf(z[2], { pitch: 12 })])
ok(squeezed === null, 'letters much wider than a cell (not the 30-cell layout): no snapping')
const fixed = parseMrz(stray2, NOW)
ok(fixed && fixed.surname === 'SOK' && fixed.given === 'VISAL MAKARA' && fixed.nameClean, 'a snapped zone reads as the correct name')

// The validity line is found by "until day" even when its label is garbled, and is not swallowed into the address.
const garbledValidity = [
  'គោត្តនាមនិងនាម: សុខ វិសាល',
  'ទីកន្លែងកំណើត: ខេត្តកណ្ដាល',
  'អាសយដ្ឋាន: ផ្ទះ៣៩ ផ្លូវលំ ភូមិព្រែកអំបិល',
  'ឃុំចាក់អង្រែ ស្រុកកណ្ដាល ខេត្តកណ្ដាល',
  '“កុង ១៤.១០.២០១៨ ដល់ថ្ងៃ ១៩.១០.២០២៨',
  'និនទាគ: ប្រជ្រុយចំ ៤ស.ម',
].join('\n')
const gv = parseFront(garbledValidity)
ok(gv.address === 'ផ្ទះ៣៩ ផ្លូវលំ ភូមិព្រែកអំបិល ឃុំចាក់អង្រែ ស្រុកកណ្ដាល ខេត្តកណ្ដាល', 'a two-line address stops before the validity line even when that line\'s label is garbled')
ok(gv.validFrom === '2018-10-14' && gv.validTo === '2028-10-19', 'the validity dates are read from the line holding "until day"')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
