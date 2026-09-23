import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ_DADOS = resolve(__dirname, "../../dados");

export interface Sala {
  id: string;
  nome: string;
  capacidade: number;
  recursos: string[];
}

export interface ReservaSeed {
  id: string;
  sala: string;
  inicio: string;
  fim: string;
  responsavel: string;
}

export const salas: Sala[] = JSON.parse(readFileSync(resolve(RAIZ_DADOS, "salas.json"), "utf-8"));

export const reservasSeed: ReservaSeed[] = JSON.parse(
  readFileSync(resolve(RAIZ_DADOS, "reservas.json"), "utf-8"),
);

export const politicaTexto: string = readFileSync(resolve(RAIZ_DADOS, "politica-de-uso.md"), "utf-8");

function extrairVersaoPolitica(texto: string): string {
  const primeiraLinha = texto.split("\n", 1)[0] ?? "";
  const match = primeiraLinha.match(/^versao:\s*(\S+)/);
  if (!match) {
    throw new Error("Nao foi possivel extrair a versao da politica de uso");
  }
  return match[1];
}

export const politicaVersao: string = extrairVersaoPolitica(politicaTexto);

export function salaPorId(id: string): Sala | undefined {
  return salas.find((s) => s.id === id);
}
