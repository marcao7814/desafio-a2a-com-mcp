import { reservasSeed } from "./dados.js";

export interface Reserva {
  id: string;
  sala: string;
  inicio: string;
  fim: string;
  responsavel: string;
}

class ReservaStore {
  private reservas: Reserva[] = reservasSeed.map((r) => ({ ...r }));
  private proximoNumero = this.calcularProximoNumero();

  private calcularProximoNumero(): number {
    let maior = 0;
    for (const r of this.reservas) {
      const m = r.id.match(/^res-(\d+)$/);
      if (m) maior = Math.max(maior, parseInt(m[1], 10));
    }
    return maior + 1;
  }

  listarPorSala(sala: string): Reserva[] {
    return this.reservas.filter((r) => r.sala === sala);
  }

  /** Reservas da sala que se sobrepoe ao intervalo [inicio, fim). */
  conflitos(sala: string, inicio: string, fim: string): Reserva[] {
    const ini = Date.parse(inicio);
    const f = Date.parse(fim);
    return this.listarPorSala(sala).filter((r) => {
      const rIni = Date.parse(r.inicio);
      const rFim = Date.parse(r.fim);
      return ini < rFim && rIni < f;
    });
  }

  livre(sala: string, inicio: string, fim: string): boolean {
    return this.conflitos(sala, inicio, fim).length === 0;
  }

  criar(sala: string, inicio: string, fim: string, responsavel: string): Reserva {
    const id = `res-${String(this.proximoNumero).padStart(4, "0")}`;
    this.proximoNumero += 1;
    const reserva: Reserva = { id, sala, inicio, fim, responsavel };
    this.reservas.push(reserva);
    return reserva;
  }
}

export const reservaStore = new ReservaStore();
