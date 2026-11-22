// The Velvet Vault — make.fun bundle entry point.
// Copies the static game and its screenshots into the output directory
// and writes the competition dossier for this entry.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here);
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

mkdirSync(outputDir, { recursive: true });

const gameDir = join(repoDir, "game");
const shotsDir = join(repoDir, "screenshots");

if (existsSync(gameDir)) {
  cpSync(gameDir, join(outputDir, "game"), { recursive: true });
}
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outputDir, "screenshots"), { recursive: true });
}

// Caps from the competition gates: 160 KiB of dossier text, at most 4
// screenshots of at most 256 KiB each, game/ at most 993 entries / 48 MiB.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// buildDossier reads the copied game/ and screenshots/ from the output
// directory and returns the canonical dossier bytes.
const dossier = buildDossier(outputDir, caps);
writeFileSync(join(outputDir, "dossier.json"), dossier);
console.log(`Velvet Vault bundle written to ${outputDir}`);
