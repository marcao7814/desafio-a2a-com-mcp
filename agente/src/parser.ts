export interface PedidoReserva {
  sala: string;
  inicio: string;
  fim: string;
  responsavel: string;
}

const RE_PEDIDO = /^reservar sala=(\S+) inicio=(\S+) fim=(\S+) responsavel=(.+)$/;
const RE_ESCOLHA = /^escolha=(.+)$/;

export function parsearPedido(texto: string): PedidoReserva | null {
  const m = RE_PEDIDO.exec(texto.trim());
  if (!m) return null;
  const [, sala, inicio, fim, responsavel] = m;
  return { sala, inicio, fim, responsavel };
}

export function parsearEscolha(texto: string): string | null {
  const m = RE_ESCOLHA.exec(texto.trim());
  return m ? m[1] : null;
}
