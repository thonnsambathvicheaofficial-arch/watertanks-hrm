// Staff photos: the server-side gate decides by the file's own bytes and size, and the echo of a rejected form never carries a file.
const { sniff, problem, MAX_BYTES } = require('../lib/staff-photo.js')
let fails = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FAIL', m); if (!c) fails++ }

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64)])
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)])
const html = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40))
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' + ' '.repeat(40))

ok(sniff(jpeg)?.type === 'image/jpeg' && sniff(jpeg).ext === 'jpg', 'a JPEG is recognised by its bytes')
ok(sniff(png)?.type === 'image/png' && sniff(png).ext === 'png', 'a PNG is recognised')
ok(sniff(webp)?.type === 'image/webp' && sniff(webp).ext === 'webp', 'a WebP is recognised')
ok(sniff(gif) === null, 'a GIF is not accepted')
ok(sniff(html) === null && sniff(svg) === null, 'HTML and SVG (script carriers) are not accepted, whatever the file is called')
ok(sniff(Buffer.alloc(0)) === null && sniff(null) === null && sniff(Buffer.from([0xff, 0xd8])) === null, 'empty, missing and truncated input is not accepted')

ok(problem(jpeg) === null && problem(png) === null && problem(webp) === null, 'a normal picture passes')
ok(/empty/i.test(problem(Buffer.alloc(0))), 'an empty file is rejected with a plain message')
ok(/JPG, PNG or WebP/.test(problem(html)), 'a non-picture is rejected with a plain message')
const big = Buffer.concat([jpeg, Buffer.alloc(MAX_BYTES)])
ok(/2 MB/.test(problem(big)), `a picture over 2 MB is rejected (${(big.length / 1048576).toFixed(1)} MB)`)
ok(problem(Buffer.concat([jpeg, Buffer.alloc(MAX_BYTES - jpeg.length)])) === null, 'a picture of exactly 2 MB is accepted')

// The original ID card PDF kept beside the cropped picture.
const { originalProblem, ORIGINAL_MAX_BYTES } = require('../lib/staff-photo.js')
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200)])
ok(sniff(pdf) === null, 'a PDF is NOT accepted as a picture (profile photos and cropped cards stay pictures only)')
ok(sniff(pdf, true)?.type === 'application/pdf' && sniff(pdf, true).ext === 'pdf', 'a PDF is recognised by its first bytes when PDFs are allowed')
ok(sniff(jpeg, true)?.type === 'image/jpeg', 'allowing PDFs does not change how pictures are recognised')
ok(originalProblem(pdf) === null, 'a normal PDF is accepted as the original')
ok(/must be a PDF/.test(originalProblem(png)) && /must be a PDF/.test(originalProblem(html)), 'a picture or a web page is not accepted as the original PDF')
ok(/empty/i.test(originalProblem(Buffer.alloc(0))), 'an empty file is refused with a plain message')
ok(/3\.5 MB/.test(originalProblem(Buffer.concat([pdf, Buffer.alloc(ORIGINAL_MAX_BYTES)]))), 'a PDF over 3.5 MB is refused with the limit in the message')
ok(originalProblem(Buffer.concat([pdf, Buffer.alloc(ORIGINAL_MAX_BYTES - pdf.length)])) === null, 'a PDF of exactly 3.5 MB is accepted')

// A rejected form comes back filled in from its echo; an uploaded file must not end up in it.
const { encodeEcho, decodeEcho, echoOne } = (() => {
  // echo.ts is TypeScript: compile it with the project's own compiler.
  const ts = require('typescript')
  const src = ts.transpileModule(require('fs').readFileSync(require('path').join(__dirname, '../lib/echo.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', 'Buffer', src)(m, m.exports, Buffer)
  return m.exports
})()
const form = new FormData()
form.append('name', 'Sok')
form.append('photo', new File([jpeg], 'me.jpg', { type: 'image/jpeg' }))
form.append('offDays', '0'); form.append('offDays', '6')
const back = decodeEcho(encodeEcho(form))
ok(echoOne(back, 'name') === 'Sok', 'text fields still come back')
ok(!('photo' in back), 'the uploaded file is left out of the echo (no "[object File]" in the address)')
ok(Array.isArray(back.offDays) && back.offDays.length === 2, 'repeated fields still come back as a list')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
