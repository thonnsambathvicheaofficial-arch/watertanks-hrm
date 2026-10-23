// Reading a roster correction's note as leave. The notes below are the real patterns HR uses (from the October roster).
const { parseLeaveNote } = require('../lib/leave-note.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }
const P = (n) => JSON.stringify(parseLeaveNote(n))

console.log('real notes that record leave')
ok(P('ច្បាប់0,5ថ្ងៃ 07/10/26') === '{"days":0.5,"period":null}', '"leave 0.5 day": a half day (comma as the decimal mark, no spaces)')
ok(P('ច្បាប់ 0,5 ថ្ងៃ 21/10/26') === '{"days":0.5,"period":null}' && P('ច្បាប់ 0.5 ថ្ងៃ 21/10/26') === '{"days":0.5,"period":null}', 'with spaces, comma or dot')
ok(P('ច្បាប់1ថ្ងៃ 15/10/26') === '{"days":1,"period":null}' && P('ច្បាប់ 2 ថ្ងៃ 20-21/10/26') === '{"days":2,"period":null}', 'whole days')
ok(P('សុំច្បាប់ 0,5 ថ្ងៃ 09/10/26') === '{"days":0.5,"period":null}', '"asked for leave 0.5 day"')
ok(P('ច្បាប់0,5ថ្ងៃ 21/10/26 និងភ្លេចស្គេនចេញ ប្រាប់រដ្ឋបាល') === '{"days":0.5,"period":null}', 'leave plus a forgotten scan: still leave')
ok(P('ចូលវិញ 8:00am និងច្បាប់ពិសេស0.5ថ្ងៃ 12/10') === '{"days":0.5,"period":null}' && !P('ចូលវិញ 8:00am និងច្បាប់ពិសេស0.5ថ្ងៃ 12/10').includes('morning'), '"back in 8:00am and special leave 0.5 day": a half day; "am" is a time, not a period')
ok(P('ច្បាប់ ថ្ងៃ 21/10/26') === '{"days":null,"period":null}' && P('ច្បាប់') === '{"days":null,"period":null}', 'leave with no length covers the day')
ok(P('​ច្បាប់0,5ថ្ងៃ') === '{"days":0.5,"period":null}', 'an invisible zero-width character at the front does not matter')
ok(P('ច្បាប់ ០,៥ ថ្ងៃ') === '{"days":0.5,"period":null}', 'Khmer numerals')

console.log('which half')
ok(P('ច្បាប់ព្រឹក 0,5 ថ្ងៃ') === '{"days":0.5,"period":"morning"}' && P('ច្បាប់ 0,5 ថ្ងៃ ព្រឹក') === '{"days":0.5,"period":"morning"}', 'morning (ព្រឹក)')
ok(P('ច្បាប់រសៀល 0,5 ថ្ងៃ') === '{"days":0.5,"period":"afternoon"}' && P('ច្បាប់ 0,5 ថ្ងៃ ល្ងាច') === '{"days":0.5,"period":"afternoon"}', 'afternoon (រសៀល, ល្ងាច)')
ok(P('half day leave in the morning') === '{"days":0.5,"period":"morning"}' && P('Annual leave 1 day') === '{"days":1,"period":null}', 'English works too')
ok(P('ច្បាប់កន្លះថ្ងៃ') === '{"days":0.5,"period":null}', '"half a day" in words')

console.log('notes that are NOT leave')
ok(P('ឈប់អត់ច្បាប់ 21/10/26') === 'null' && P('ឈប់អត់ច្បាប់') === 'null', '"absent without leave" is the opposite of leave')
ok(P('ឈប់អត់ច្បាប់ 07/10/26 (កាត់តាមគោលការណ៍ 5$/ថ្ងៃ)') === 'null' && P('ឈប់អត់ច្បាប់1ថ្ងៃ 5-6/10/26') === 'null', 'even with a day count or a deduction in the note')
ok(P('ភ្លេចស្គេនចូល ប្រាប់រដ្ឋបាល') === 'null' && P('សុំចេញមុន 1ម៉ោង មានធុរៈ') === 'null' && P('Dayoff 11/10 សម្រាកជំនួសថ្ងៃទី5 មិនបានឈប់ មកធ្វើការ') === 'null', 'a forgotten scan, leaving an hour early and a swapped day off are not leave')
ok(P('') === 'null' && P(null) === 'null' && P(undefined) === 'null' && P('   ') === 'null', 'empty')
ok(P('without leave') === 'null' && P('absent without permission') === 'null' && P('no leave') === 'null', 'English "without leave" / "no leave"')
ok(P('មិនមានច្បាប់') === 'null' && P('គ្មានច្បាប់') === 'null', '"has no leave" in Khmer')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
