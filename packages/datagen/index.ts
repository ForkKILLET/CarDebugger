import { Canvas, Image } from 'skia-canvas'
import { Bar } from 'cli-progress'

import fs from 'node:fs/promises'
import path from 'node:path'

const W = 188, H = 120

const load_image = (filepath: string) => new Promise<Image>((resolve, reject) => {
    const img = new Image()
    img.src = filepath
    img.onload = resolve
    img.onerror = reject
})

const convert = async (input_path: string) => {
    const input_dir = path.dirname(input_path)
    const input_ext = path.extname(input_path)
    const input_base = path.basename(input_path, input_ext)
    const output_path = path.join(input_dir, `../Array/${input_base}.dat`)

    const canvas = new Canvas(W, H)
    const ctx = canvas.getContext('2d')
    const img = await load_image(input_path)

    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(img, 0, 0)

    const imageData = ctx.getImageData(0, 0, W, H).data
    const array = Array
        .from({ length: W * H })
        .map((_, i) => imageData[i * 4])
    await fs.writeFile(output_path, array.join(' '), 'utf-8')
}

const input_paths = process.argv.slice(2)
const count = input_paths.length

const bar = new Bar({
    format: ' Converting |' + '{bar}' + '| {percentage}% | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    stopOnComplete: true,
})

bar.start(count, 0)

await Promise.all(
    input_paths.map(path => convert(path).then(() => bar.increment(1)))
)

bar.stop()