// Adapta o binding D1 do Cloudflare para a mesma interface do banco local.

export function adaptarD1(binding) {
  const preparar = (sql, parametros) => {
    const consulta = binding.prepare(sql);
    return parametros.length ? consulta.bind(...parametros) : consulta;
  };

  return {
    async get(sql, ...parametros) {
      return (await preparar(sql, parametros).first()) ?? null;
    },
    async all(sql, ...parametros) {
      const { results } = await preparar(sql, parametros).all();
      return results ?? [];
    },
    async run(sql, ...parametros) {
      const { meta } = await preparar(sql, parametros).run();
      return { mudancas: meta.changes, ultimoId: meta.last_row_id };
    },
  };
}
