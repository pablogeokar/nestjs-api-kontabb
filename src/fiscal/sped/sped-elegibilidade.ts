export interface SpedElegibilidadeCliente {
  regimeTributario: string | null;
  apuraIcms?: boolean | null;
  obrigadoEfdIcmsIpi?: boolean | null;
}

export function isSpedElegivel(cliente: SpedElegibilidadeCliente): boolean {
  if (
    cliente.regimeTributario === 'LUCRO_PRESUMIDO' ||
    cliente.regimeTributario === 'LUCRO_REAL'
  ) {
    return true;
  }
  if (cliente.regimeTributario === 'SIMPLES_NACIONAL') {
    return Boolean(cliente.obrigadoEfdIcmsIpi || cliente.apuraIcms);
  }
  return false;
}
