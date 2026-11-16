// iPhone and some Android cameras save HEIC/HEIF pictures, which most browsers cannot show. They are turned into ordinary JPEGs here,
// on the person's own computer, before anything else happens: the readers, the photo editor and the server only ever see JPEG.
// The converter (a few MB) is fetched only when a HEIC file is actually chosen.
const HEIC_NAME = /\.(heic|heif)$/i

export const looksHeic = (f: File) => /^image\/hei[cf]/i.test(f.type) || HEIC_NAME.test(f.name)

export async function toJpegIfHeic(file: File): Promise<File> {
  if (!looksHeic(file)) return file
  try {
    const { heicTo } = await import('heic-to/next')
    const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
    return new File([blob], file.name.replace(HEIC_NAME, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    throw new Error('That HEIC picture could not be converted. Open it on the phone or computer and share or export it as JPG, then choose that.')
  }
}
