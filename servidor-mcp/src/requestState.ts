import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 15 * 60 * 1000; // 15 minutos: dentro da janela de 5-30 min exigida.
const PREFIXO = "v1";

export interface EstadoReserva {
  chave: string;
  sala: string;
  inicio: string;
  fim: string;
  responsavel: string;
  alternativas: string[];
  exp: number;
}

function segredo(): string {
  const s = process.env.REQUEST_STATE_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "REQUEST_STATE_SECRET ausente ou com menos de 32 caracteres. Gere com: python3 -c \"import secrets; print(secrets.token_hex(32))\"",
    );
  }
  return s;
}

function assinar(payloadB64: string): string {
  return createHmac("sha256", segredo()).update(payloadB64).digest("base64url");
}

export function selarEstado(dados: Omit<EstadoReserva, "exp">): string {
  const payload: EstadoReserva = { ...dados, exp: Date.now() + TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const assinatura = assinar(payloadB64);
  return `${PREFIXO}.${payloadB64}.${assinatura}`;
}

/** Retorna o estado reconstruido, ou null se o token for invalido, adulterado ou expirado. */
export function abrirEstado(token: string): EstadoReserva | null {
  if (typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== PREFIXO) return null;
  const [, payloadB64, assinaturaRecebida] = partes;

  const assinaturaEsperada = assinar(payloadB64);
  const a = Buffer.from(assinaturaRecebida);
  const b = Buffer.from(assinaturaEsperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: EstadoReserva;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}
