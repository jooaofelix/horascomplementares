const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const estado = {
  usuario: null,
  categorias: [],
  turmas: [],
  meta: 200,
  tituloTurma: '',
  atividades: [],
  resumo: null,
  alunos: [],
  turmaFiltro: '',
};

// ---------------------------------------------------------------- utilidades

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : {},
    method: opcoes.metodo || 'GET',
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados) {
    // Sem JSON na resposta o servidor caiu antes de responder (limite de CPU,
    // erro da plataforma): mostrar o código HTTP ajuda a achar a causa.
    throw new Error(dados?.erro || `Falha na comunicação com o servidor (HTTP ${resposta.status}).`);
  }
  return dados;
}

const escapar = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const horas = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;

const dataBr = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

function avisar(mensagem, tipo = 'erro', alvo = '#aviso-app') {
  const el = $(alvo);
  el.textContent = mensagem;
  el.className = `aviso ${tipo}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (tipo === 'ok') setTimeout(() => el.classList.add('oculto'), 4000);
}

const falhar = (err) => avisar(err.message);

const opcoesTurma = (turmas, selecionada, primeira) =>
  [primeira, ...turmas.map((t) => {
    const rotulo = t.periodo ? `${t.nome} — ${t.periodo}` : t.nome;
    return `<option value="${t.id}" ${String(t.id) === String(selecionada) ? 'selected' : ''}>${escapar(rotulo)}</option>`;
  })].filter(Boolean).join('');

// ---------------------------------------------------------------- entrada

function mostrarEntrada() {
  $('#tela-app').classList.add('oculto');
  $('#tela-entrada').classList.remove('oculto');
}

$('#ir-cadastro').onclick = () => {
  $('#form-login').classList.add('oculto');
  $('#form-cadastro').classList.remove('oculto');
  $('#aviso-entrada').classList.add('oculto');
};
$('#ir-login').onclick = () => {
  $('#form-cadastro').classList.add('oculto');
  $('#form-login').classList.remove('oculto');
  $('#aviso-entrada').classList.add('oculto');
};

$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', {
      metodo: 'POST',
      corpo: { email: $('#login-email').value, senha: $('#login-senha').value },
    });
    await iniciar();
  } catch (err) {
    avisar(err.message, 'erro', '#aviso-entrada');
    $('#aviso-entrada').classList.remove('oculto');
  }
};

$('#form-cadastro').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/cadastro', {
      metodo: 'POST',
      corpo: {
        nome: $('#cad-nome').value,
        email: $('#cad-email').value,
        senha: $('#cad-senha').value,
        turma_id: $('#cad-turma').value || null,
        matricula: $('#cad-matricula').value,
        codigo_professor: $('#cad-codigo').value,
      },
    });
    await iniciar();
  } catch (err) {
    avisar(err.message, 'erro', '#aviso-entrada');
    $('#aviso-entrada').classList.remove('oculto');
  }
};

$('#btn-sair').onclick = async () => {
  await api('/api/logout', { metodo: 'POST' });
  location.reload();
};

$('#btn-exportar').onclick = () => {
  const filtro = estado.usuario?.papel === 'professor' && estado.turmaFiltro
    ? `?turma_id=${estado.turmaFiltro}`
    : '';
  window.location.href = `/api/exportar.csv${filtro}`;
};

// ---------------------------------------------------------------- aluno

function desenharResumo() {
  const r = estado.resumo;
  if (!r) return;
  $('#n-validado').textContent = horas(r.validado);
  $('#n-declarado').textContent = horas(r.declarado);
  $('#n-meta').textContent = horas(r.meta);
  $('#n-registros').textContent = r.registros;

  const pct = (v) => Math.min(100, (v / Math.max(r.meta, 1)) * 100);
  const larguraValidado = pct(r.validado);
  $('#barra-validado').style.width = `${larguraValidado}%`;
  $('#barra-pendente').style.width = `${Math.max(0, pct(r.declarado) - larguraValidado)}%`;

  const falta = Math.max(0, r.meta - r.validado);
  $('#falta-meta').textContent = falta > 0
    ? `Faltam ${horas(falta)} validadas para você fechar a meta.`
    : 'Você já atingiu a meta de horas validadas.';

  const turma = estado.usuario?.turma_nome;
  $('#explicacao-progresso').textContent = turma
    ? `Turma: ${turma}`
    : 'Você ainda não escolheu uma turma — ajuste em "Seus dados", no fim da página.';
}

function cartaoAtividade(a, { comAluno = false, comValidacao = false, comEdicao = false } = {}) {
  const selo = a.validado
    ? `<span class="selo ok">validada${a.validado_por_nome ? ' por ' + escapar(a.validado_por_nome) : ''}</span>`
    : '<span class="selo esperando">aguardando validação</span>';

  const periodo = a.data_fim && a.data_fim !== a.data_atividade
    ? `${dataBr(a.data_atividade)} a ${dataBr(a.data_fim)}`
    : dataBr(a.data_atividade);

  const itens = [
    ['Data', periodo],
    ['Tipo', a.categoria],
    comAluno ? ['Aluno', a.aluno_nome + (a.aluno_matricula ? ` (${a.aluno_matricula})` : '')] : null,
    comAluno ? ['Turma', a.turma_nome || 'sem turma'] : null,
    a.local ? ['Local', a.local] : null,
    a.responsavel ? ['Responsável', a.responsavel] : null,
    a.comprovante ? ['Comprovante', a.comprovante] : null,
  ].filter(Boolean);

  const ficha = `<div class="ficha">${itens
    .map(([r, v]) => `<div><div class="rotulo">${r}</div>${escapar(v)}</div>`)
    .join('')}</div>`;

  const observacao = a.observacao
    ? `<div class="observacao"><strong>Professor:</strong> ${escapar(a.observacao)}</div>`
    : '';

  const analise = a.texto
    ? `<details><summary>Ver análise (${a.texto.length.toLocaleString('pt-BR')} caracteres${
        a.arquivo_nome ? ' · ' + escapar(a.arquivo_nome) : ''
      })</summary><pre>${escapar(a.texto)}</pre></details>`
    : '<p class="vazio">Sem texto de análise anexado.</p>';

  const botoesEdicao = comEdicao
    ? `<div class="acoes" style="margin-top:16px">
         <button class="secundario mini" data-editar="${a.id}">Editar</button>
         <button class="perigo mini" data-excluir="${a.id}">Excluir</button>
       </div>`
    : '';

  const botoesValidacao = comValidacao
    ? `<div class="acoes" style="margin-top:16px">
         <input style="flex:2 1 260px" placeholder="Observação para o aluno (opcional)"
                data-obs="${a.id}" value="${escapar(a.observacao || '')}">
         ${a.validado
           ? `<button class="secundario mini" data-validar="${a.id}" data-valor="0">Remover validação</button>`
           : `<button class="mini" data-validar="${a.id}" data-valor="1">Validar horas</button>`}
       </div>`
    : '';

  return `
    <article class="atividade">
      <div class="cabecalho">
        <span class="titulo">${escapar(a.titulo)}</span>
        ${selo}
        <span class="horas">${horas(a.horas)}</span>
      </div>
      ${ficha}
      ${observacao}
      ${analise}
      ${botoesEdicao}
      ${botoesValidacao}
    </article>`;
}

function filtrar(lista, termo, status) {
  const t = termo.trim().toLowerCase();
  return lista.filter((a) => {
    if (status !== '' && String(a.validado) !== status) return false;
    if (!t) return true;
    return [a.titulo, a.categoria, a.local, a.responsavel, a.texto, a.aluno_nome]
      .some((campo) => String(campo || '').toLowerCase().includes(t));
  });
}

function desenharListaAluno() {
  const lista = filtrar(estado.atividades, $('#busca-aluno').value, $('#filtro-status-aluno').value);
  $('#lista-aluno').innerHTML = lista.length
    ? lista.map((a) => cartaoAtividade(a, { comEdicao: true })).join('')
    : '<p class="vazio">Nenhuma atividade lançada ainda.</p>';
}

// ---- formulário de atividade ----

const formulario = { arquivoNome: null };

function limparFormulario() {
  $('#form-atividade').reset();
  $('#ativ-id').value = '';
  $('#ativ-data').value = new Date().toISOString().slice(0, 10);
  $('#titulo-formulario').textContent = 'Lançar uma atividade';
  $('#btn-salvar').textContent = 'Salvar atividade';
  $('#btn-cancelar').classList.add('oculto');
  formulario.arquivoNome = null;
  atualizarContador();
}

function atualizarContador() {
  const n = $('#ativ-texto').value.length;
  $('#contador-texto').textContent =
    `${n.toLocaleString('pt-BR')} caracteres${formulario.arquivoNome ? ' · de ' + formulario.arquivoNome : ''}`;
}

$('#ativ-texto').addEventListener('input', atualizarContador);

$('#form-atividade').onsubmit = async (e) => {
  e.preventDefault();
  const corpo = {
    titulo: $('#ativ-titulo').value,
    categoria: $('#ativ-categoria').value,
    local: $('#ativ-local').value,
    responsavel: $('#ativ-responsavel').value,
    data_atividade: $('#ativ-data').value,
    data_fim: $('#ativ-data-fim').value,
    horas: $('#ativ-horas').value,
    comprovante: $('#ativ-comprovante').value,
    texto: $('#ativ-texto').value,
    arquivo_nome: formulario.arquivoNome,
  };
  const id = $('#ativ-id').value;
  try {
    await api(id ? `/api/atividades/${id}` : '/api/atividades', { metodo: id ? 'PUT' : 'POST', corpo });
    limparFormulario();
    await carregarAtividades();
    avisar(
      id ? 'Atividade atualizada — ela volta para a fila de validação.' : 'Atividade lançada.',
      'ok',
    );
  } catch (err) {
    falhar(err);
  }
};

$('#btn-cancelar').onclick = limparFormulario;

$('#lista-aluno').addEventListener('click', async (e) => {
  const idEditar = e.target.dataset.editar;
  const idExcluir = e.target.dataset.excluir;

  if (idEditar) {
    const a = estado.atividades.find((x) => String(x.id) === idEditar);
    if (!a) return;
    $('#ativ-id').value = a.id;
    $('#ativ-titulo').value = a.titulo;
    $('#ativ-categoria').value = a.categoria;
    $('#ativ-local').value = a.local || '';
    $('#ativ-responsavel').value = a.responsavel || '';
    $('#ativ-data').value = a.data_atividade;
    $('#ativ-data-fim').value = a.data_fim || '';
    $('#ativ-horas').value = a.horas;
    $('#ativ-comprovante').value = a.comprovante || '';
    $('#ativ-texto').value = a.texto;
    formulario.arquivoNome = a.arquivo_nome;
    atualizarContador();
    $('#titulo-formulario').textContent = 'Editando atividade';
    $('#btn-salvar').textContent = 'Salvar alterações';
    $('#btn-cancelar').classList.remove('oculto');
    $('#form-atividade').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (idExcluir) {
    if (!confirm('Excluir esta atividade? Não dá para desfazer.')) return;
    try {
      await api(`/api/atividades/${idExcluir}`, { metodo: 'DELETE' });
      await carregarAtividades();
    } catch (err) {
      falhar(err);
    }
  }
});

$('#busca-aluno').addEventListener('input', desenharListaAluno);
$('#filtro-status-aluno').addEventListener('change', desenharListaAluno);

$('#btn-salvar-meus').onclick = async () => {
  try {
    await api('/api/eu', {
      metodo: 'PUT',
      corpo: { turma_id: $('#meus-turma').value || null, matricula: $('#meus-matricula').value },
    });
    avisar('Dados salvos.', 'ok');
    await iniciar();
  } catch (err) {
    falhar(err);
  }
};

// ---- leitura de arquivo de texto ----

const zona = $('#zona-arquivo');
const entradaArquivo = $('#entrada-arquivo');

zona.onclick = () => entradaArquivo.click();
zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('ativa'); };
zona.ondragleave = () => zona.classList.remove('ativa');
zona.ondrop = (e) => {
  e.preventDefault();
  zona.classList.remove('ativa');
  if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
};
entradaArquivo.onchange = () => {
  if (entradaArquivo.files[0]) lerArquivo(entradaArquivo.files[0]);
  entradaArquivo.value = '';
};

async function lerArquivo(arquivo) {
  if (arquivo.size > 2 * 1024 * 1024) {
    return avisar('Arquivo grande demais (limite de 2 MB de texto).');
  }
  const conteudo = await arquivo.text();
  const atual = $('#ativ-texto').value.trim();
  $('#ativ-texto').value = atual ? `${atual}\n\n${conteudo}` : conteudo;
  formulario.arquivoNome = arquivo.name;
  if (!$('#ativ-titulo').value.trim()) {
    $('#ativ-titulo').value = arquivo.name.replace(/\.(txt|md|markdown)$/i, '');
  }
  atualizarContador();
}

// ---------------------------------------------------------------- professor

$$('.abas button').forEach((botao) => {
  botao.onclick = () => {
    $$('.abas button').forEach((b) => b.classList.toggle('ativa', b === botao));
    for (const aba of ['turma', 'registros', 'turmas', 'ajustes']) {
      $(`#aba-${aba}`).classList.toggle('oculto', aba !== botao.dataset.aba);
    }
    const comFiltro = ['turma', 'registros'].includes(botao.dataset.aba);
    $('#filtro-turma-cartao').classList.toggle('oculto', !comFiltro);
  };
});

$('#filtro-turma').addEventListener('change', async (e) => {
  estado.turmaFiltro = e.target.value;
  await carregarProfessor();
});

function desenharTurma() {
  const linhas = estado.alunos.map((a) => {
    const meta = Math.max(a.meta || estado.meta, 1);
    const pct = Math.min(100, (a.validado / meta) * 100);
    const pctDeclarado = Math.max(0, Math.min(100, (a.declarado / meta) * 100) - pct);
    return `<tr>
      <td>
        ${escapar(a.nome)}
        <div class="sub">${escapar(a.turma_nome || 'sem turma')}${a.matricula ? ' · ' + escapar(a.matricula) : ''}</div>
      </td>
      <td style="min-width:170px">
        <div class="barra" style="margin-top:0;height:12px">
          <i class="validado" style="width:${pct}%"></i><i class="pendente" style="width:${pctDeclarado}%"></i>
        </div>
        <div class="sub">meta ${horas(meta)}</div>
      </td>
      <td class="num">${horas(a.validado)}</td>
      <td class="num">${horas(a.declarado)}</td>
      <td class="num">${a.pendentes}</td>
    </tr>`;
  });

  $('#tabela-turma').innerHTML = `
    <thead><tr>
      <th>Aluno</th><th>Progresso</th>
      <th class="num">Validadas</th><th class="num">Lançadas</th><th class="num">A validar</th>
    </tr></thead>
    <tbody>${linhas.join('') || '<tr><td colspan="5" class="vazio">Nenhum aluno nesta seleção ainda.</td></tr>'}</tbody>`;
}

function desenharListaProfessor() {
  const lista = filtrar(estado.atividades, $('#busca-prof').value, $('#filtro-status-prof').value);
  $('#lista-prof').innerHTML = lista.length
    ? lista.map((a) => cartaoAtividade(a, { comAluno: true, comValidacao: true })).join('')
    : '<p class="vazio">Nada para mostrar com esses filtros.</p>';
}

$('#lista-prof').addEventListener('click', async (e) => {
  const id = e.target.dataset.validar;
  if (!id) return;
  const validando = e.target.dataset.valor === '1';
  try {
    await api(`/api/atividades/${id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: validando, observacao: $(`[data-obs="${id}"]`)?.value || '' },
    });
    await carregarProfessor();
    avisar(
      validando ? 'Horas validadas — o registro sai da fila de pendentes.' : 'Validação removida.',
      'ok',
    );
  } catch (err) {
    falhar(err);
  }
});

$('#busca-prof').addEventListener('input', desenharListaProfessor);
$('#filtro-status-prof').addEventListener('change', desenharListaProfessor);

// ---- turmas ----

function desenharTurmas() {
  const linhas = estado.turmas.map((t) => `<tr>
    <td><input data-turma-nome="${t.id}" value="${escapar(t.nome)}"></td>
    <td><input data-turma-periodo="${t.id}" value="${escapar(t.periodo || '')}" placeholder="opcional"></td>
    <td style="width:120px"><input data-turma-meta="${t.id}" type="number" min="1" step="1" value="${t.meta_horas}"></td>
    <td class="num">${t.alunos}</td>
    <td class="acoes">
      <button class="secundario mini" data-salvar-turma="${t.id}">Salvar</button>
      <button class="perigo mini" data-excluir-turma="${t.id}">Excluir</button>
    </td>
  </tr>`);

  $('#tabela-turmas').innerHTML = `
    <thead><tr><th>Turma</th><th>Período</th><th>Meta (h)</th><th class="num">Alunos</th><th></th></tr></thead>
    <tbody>${linhas.join('') || '<tr><td colspan="5" class="vazio">Nenhuma turma criada ainda. Crie a primeira abaixo.</td></tr>'}</tbody>`;
}

$('#btn-criar-turma').onclick = async () => {
  try {
    await api('/api/turmas', {
      metodo: 'POST',
      corpo: {
        nome: $('#nova-turma-nome').value,
        periodo: $('#nova-turma-periodo').value,
        meta_horas: $('#nova-turma-meta').value,
      },
    });
    $('#nova-turma-nome').value = '';
    $('#nova-turma-periodo').value = '';
    await carregarProfessor();
    avisar('Turma criada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#tabela-turmas').addEventListener('click', async (e) => {
  const idSalvar = e.target.dataset.salvarTurma;
  const idExcluir = e.target.dataset.excluirTurma;
  try {
    if (idSalvar) {
      await api(`/api/turmas/${idSalvar}`, {
        metodo: 'PUT',
        corpo: {
          nome: $(`[data-turma-nome="${idSalvar}"]`).value,
          periodo: $(`[data-turma-periodo="${idSalvar}"]`).value,
          meta_horas: $(`[data-turma-meta="${idSalvar}"]`).value,
        },
      });
      await carregarProfessor();
      avisar('Turma atualizada.', 'ok');
    }
    if (idExcluir) {
      if (!confirm('Excluir esta turma?')) return;
      await api(`/api/turmas/${idExcluir}`, { metodo: 'DELETE' });
      await carregarProfessor();
      avisar('Turma excluída.', 'ok');
    }
  } catch (err) {
    falhar(err);
  }
});

$('#btn-salvar-config').onclick = async () => {
  try {
    const dados = await api('/api/config', {
      metodo: 'PUT',
      corpo: { meta_horas: $('#cfg-meta').value, titulo_turma: $('#cfg-titulo').value },
    });
    estado.meta = dados.meta_horas;
    $('#titulo-turma').textContent = dados.titulo_turma;
    avisar('Ajustes salvos.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

// ---------------------------------------------------------------- carga

async function carregarAtividades() {
  const dados = await api('/api/atividades');
  estado.atividades = dados.atividades;
  estado.resumo = dados.resumo;
  desenharResumo();
  desenharListaAluno();
}

async function carregarProfessor() {
  const filtro = estado.turmaFiltro ? `?turma_id=${estado.turmaFiltro}` : '';
  const [registros, turma] = await Promise.all([
    api(`/api/atividades${filtro}`),
    api(`/api/turma${filtro}`),
  ]);
  estado.atividades = registros.atividades;
  estado.alunos = turma.alunos;
  estado.turmas = turma.turmas;
  estado.meta = turma.meta_horas;

  $('#filtro-turma').innerHTML = opcoesTurma(
    estado.turmas,
    estado.turmaFiltro,
    '<option value="">Todas as turmas</option>',
  );
  desenharTurma();
  desenharListaProfessor();
  desenharTurmas();
}

async function iniciar() {
  const dados = await api('/api/eu');
  Object.assign(estado, {
    usuario: dados.usuario,
    categorias: dados.categorias,
    turmas: dados.turmas,
    meta: dados.meta_horas,
    tituloTurma: dados.titulo_turma,
  });

  if (!estado.usuario) {
    $('#cad-turma').innerHTML = opcoesTurma(
      estado.turmas,
      '',
      '<option value="">Escolha a sua turma</option>',
    );
    $('#campo-turma-cadastro').classList.toggle('oculto', estado.turmas.length === 0);
    return mostrarEntrada();
  }

  $('#tela-entrada').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');
  $('#titulo-turma').textContent = estado.tituloTurma;
  $('#identificacao').textContent =
    `${estado.usuario.nome} · ${estado.usuario.papel === 'professor' ? 'professor(a)' : 'aluno(a)'}`;

  if (estado.usuario.papel === 'professor') {
    $('#painel-professor').classList.remove('oculto');
    $('#painel-aluno').classList.add('oculto');
    $('#cfg-meta').value = estado.meta;
    $('#cfg-titulo').value = estado.tituloTurma;
    await carregarProfessor();
  } else {
    $('#painel-aluno').classList.remove('oculto');
    $('#painel-professor').classList.add('oculto');
    $('#ativ-categoria').innerHTML = estado.categorias
      .map((c) => `<option value="${escapar(c)}">${escapar(c)}</option>`)
      .join('');
    $('#meus-turma').innerHTML = opcoesTurma(
      estado.turmas,
      estado.usuario.turma_id,
      '<option value="">Sem turma</option>',
    );
    $('#meus-matricula').value = estado.usuario.matricula || '';
    limparFormulario();
    await carregarAtividades();
  }
}

iniciar().catch((err) => {
  mostrarEntrada();
  console.error(err);
});
