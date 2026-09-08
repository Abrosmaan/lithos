// Фикстура: синтетический «камень» для интеграционных прогонов и unit-теста pHash (T2.1, T4.1): тёмно-серый окатанный овал с зернистостью и тенью
// на песчаном фоне, 800×600, детерминированный PRNG. Gate (Haiku) его честно отсеивает — для S2–S4 gate пред-записывают.
import sharp from 'sharp';

const W = 800;
const H = 600;

export async function rockImage(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const dx = (x - 400) / 230;
      const dy = (y - 310) / 160;
      const r = dx * dx + dy * dy;
      let R: number;
      let G: number;
      let B: number;
      if (r < 1) {
        const shade = 0.75 + 0.35 * (1 - r) * (0.6 - dx * 0.5 - dy * 0.6);
        const grain = (rnd() - 0.5) * 70;
        const vein = Math.abs(Math.sin((x + y * 0.4) / 9)) > 0.985 ? 60 : 0;
        R = 95 * shade + grain + vein;
        G = 92 * shade + grain + vein;
        B = 88 * shade + grain + vein;
      } else {
        const shadow = r < 1.25 && dy > 0 ? 0.7 : 1;
        const g = (rnd() - 0.5) * 30;
        R = 205 * shadow + g;
        G = 190 * shadow + g;
        B = 160 * shadow + g;
      }
      raw[i] = Math.max(0, Math.min(255, R));
      raw[i + 1] = Math.max(0, Math.min(255, G));
      raw[i + 2] = Math.max(0, Math.min(255, B));
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

/**
 * «Пересъёмка» того же камня (T4.1, ai-pipeline §11 п.5): та же сцена на 5 % светлее и с кропом 1 % по краям,
 * пережатая JPEG q=85. pHash к оригиналу — Хэмминг 4 ≤ PIPELINE.phashMaxDistance (6). Кроп ≥ 2 % или пережатие q=60
 * на этой синтетике дают 8 — blockhash чувствителен к сдвигу сетки на однородном зернистом фоне.
 */
export async function rockImageRetake(): Promise<Buffer> {
  const dx = Math.round(W * 0.005);
  const dy = Math.round(H * 0.005);
  return sharp(await rockImage())
    .extract({ left: dx, top: dy, width: W - 2 * dx, height: H - 2 * dy })
    .modulate({ brightness: 1.05 })
    .jpeg({ quality: 85 })
    .toBuffer();
}
