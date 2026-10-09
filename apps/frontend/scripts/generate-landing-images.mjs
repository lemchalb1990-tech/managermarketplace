// Genera las ilustraciones de la landing con OpenAI (gpt-image-1).
//
// Uso (desde apps/frontend):
//   1. Agrega tu clave en .env.local (no se sube a git):  OPENAI_API_KEY=sk-...
//   2. node scripts/generate-landing-images.mjs            → genera las que falten
//      node scripts/generate-landing-images.mjs --force    → vuelve a generar todas
//
// Las imágenes quedan en public/landing/*.png con fondo transparente.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "landing");
const force = process.argv.includes("--force");

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const envFile = join(root, ".env.local");
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="));
    if (line) return line.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

// Estilo común: ilustración plana tipo marca de personaje, trazo negro, sin texto.
const STYLE =
  "Flat hand-drawn illustration, thick confident black ink outlines, minimal flat fills, " +
  "limited palette of warm off-white, black, marigold yellow #ffb110, coral #f64932 and sky blue #62aef0. " +
  "Playful, friendly, notebook doodle feel. No text, no letters, no logos. Transparent background, centered.";

const CHARACTER = (who) =>
  `Round avatar of ${who}, head and shoulders, simple friendly face, inside a circle. ${STYLE}`;

const IMAGES = [
  ["mark-vendedora.png", "1024x1024", CHARACTER("a young Chilean online seller woman holding a smartphone")],
  ["mark-bodeguero.png", "1024x1024", CHARACTER("a warehouse worker man with a cap holding a cardboard box")],
  ["mark-repartidor.png", "1024x1024", CHARACTER("a delivery rider with a helmet")],
  ["mark-cajera.png", "1024x1024", CHARACTER("a shop cashier woman with an apron")],
  ["mark-contadora.png", "1024x1024", CHARACTER("an accountant woman with glasses holding a receipt")],
  ["mark-duenio.png", "1024x1024", CHARACTER("a small business owner man smiling with a coffee mug")],
  ["mark-cliente.png", "1024x1024", CHARACTER("a happy customer opening a package")],
  ["hero-paquetes.png", "1536x1024",
    `A small stack of cardboard parcels with a smartphone showing a checkmark, a shopping bag and a receipt, ` +
    `connected by playful dotted arrows and little sparkles. ${STYLE}`],
  ["movil-repartidor.png", "1024x1024",
    `A delivery rider on a scooter looking at a phone map route with pins, motion lines and sparkles. ${STYLE}`],
];

async function generate(key, [file, size, prompt]) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size, background: "transparent", quality: "medium", n: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  writeFileSync(join(outDir, file), Buffer.from(data.data[0].b64_json, "base64"));
}

const key = readKey();
if (!key) {
  console.error("Falta OPENAI_API_KEY (en .env.local o como variable de entorno).");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
let failed = 0;
for (const img of IMAGES) {
  const target = join(outDir, img[0]);
  if (!force && existsSync(target)) { console.log(`- ${img[0]} ya existe`); continue; }
  process.stdout.write(`Generando ${img[0]}… `);
  try {
    await generate(key, img);
    console.log("listo");
  } catch (e) {
    failed++;
    console.log(`error: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
