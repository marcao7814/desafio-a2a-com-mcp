import { salaPorId, salas } from "./dados.js";
import { reservaStore } from "./reservas.js";

export const ERRO_SALA_INEXISTENTE = (id: string) => `Sala inexistente: ${id}`;
export const ERRO_JANELA = "Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00";
export const ERRO_DURACAO = "Duracao acima do limite: a politica permite no maximo 2 horas";
export const ERRO_INTERVALO = "Intervalo invalido: fim deve ser posterior a inicio";
export const ERRO_SEM_ALTERNATIVA = "Sem alternativas disponiveis no intervalo";

const FUSO_SALAS = "America/Sao_Paulo";
const JANELA_INICIO_MIN = 8 * 60;
const JANELA_FIM_MIN = 20 * 60;
const DURACAO_MAX_MS = 2 * 60 * 60 * 1000;

function minutosLocais(isoDate: string): number {
  const data = new Date(isoDate);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_SALAS,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? "0");
  return hora * 60 + minuto;
}

/**
 * Mesmas validacoes de sala e politica usadas por consultar_disponibilidade e reservar_sala.
 * Retorna a mensagem de erro exata, ou null se o pedido e valido.
 */
export function validarPedido(sala: string, inicio: string, fim: string): string | null {
  if (!salaPorId(sala)) return ERRO_SALA_INEXISTENTE(sala);

  const inicioMs = Date.parse(inicio);
  const fimMs = Date.parse(fim);
  if (!(fimMs > inicioMs)) return ERRO_INTERVALO;

  const inicioMin = minutosLocais(inicio);
  const fimMin = minutosLocais(fim);
  if (inicioMin < JANELA_INICIO_MIN || fimMin > JANELA_FIM_MIN) return ERRO_JANELA;

  if (fimMs - inicioMs > DURACAO_MAX_MS) return ERRO_DURACAO;

  return null;
}

/**
 * Salas livres no intervalo com capacidade >= a da sala pedida, no maximo 3,
 * ordenadas por capacidade crescente e, em empate, por id em ordem alfabetica.
 */
export function calcularAlternativas(salaPedidaId: string, inicio: string, fim: string): string[] {
  const salaPedida = salaPorId(salaPedidaId);
  if (!salaPedida) return [];
  return salas
    .filter((s) => s.id !== salaPedidaId)
    .filter((s) => s.capacidade >= salaPedida.capacidade)
    .filter((s) => reservaStore.livre(s.id, inicio, fim))
    .sort((a, b) => a.capacidade - b.capacidade || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((s) => s.id);
}
