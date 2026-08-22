const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const estado = {
  usuario: null,
  categorias: [],
  meta: 200,
  tituloTurma: '',
  atividades: [],
  resumo: null,
  alunos: [],
};

// ---------------------------------------------------------------- utilidades

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : {},
    method: opcoes.metodo || 'GET',
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível completar a ação.');
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
  if (tipo === 'ok') setTimeout(() => el.classList.add('oculto'), 3500);
}

const limparAviso = (alvo = '#aviso-app') => $(alvo).classList.add('oculto');

// ---------------------------------------------------------------- entrada

function mostrarEntrada() {
  $('#tela-app').classList.add('oculto');
  $('#tela-entrada').classList.remove('oculto');
}

$('#ir-cadastro').onclick = () => {
  $('#form-login').classList.add('oculto');
  $('#form-cadastro').classList.remove('oculto');
  limparAviso('#aviso-entrada');
};
$('#ir-login').onclick = () => {
  $('#form-cadastro').classList.add('oculto');
  $('#form-login').classList.remove('oculto');
  limparAviso('#aviso-entrada');
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

$('#btn-exportar').onclick = () => { window.location.href = '/api/exportar.csv'; };

// ---------------------------------------------------------------- aluno

function preencherCategorias() {
  $('#ativ-categoria').innerHTML = estado.categorias
    .map((c) => `<option value="${escapar(c)}">${escapar(c)}</option>`)
    .join('');
}

function desenharResumo() {
  const r = estado.resumo;
  if (!r) return;
  $('#n-validado').textContent = horas(r.validado);
  $('#n-declarado').textContent = horas(r.declarado);
  $('#n-meta').textContent = horas(r.meta);
  $('#n-registros').textContent = r.registros;

  const pct = (v) => Math.min(100, (v / Math.max(r.meta, 1)) * 100);
  const larguraValidado = pct(r.validado);
  const larguraPendente = Math.max(0, pct(r.declarado) - larguraValidado);
  $('#barra-validado').style.width = `${larguraValidado}%`;
  $('#barra-pendente').style.width = `${larguraPendente}%`;

  const falta = Math.max(0, r.meta - r.validado);
  $('#falta-meta').textContent = falta > 0
    ? `faltam ${horas(falta)} de horas validadas para a meta`
    : 'meta de horas validadas atingida';
}

function cartaoAtividade(a, { comAluno = false, comValidacao = false, comEdicao = false } = {}) {
  const selo = a.validado
    ? `<span class="selo ok">validado${a.validado_por_nome ? ' por ' + escapar(a.validado_por_nome) : ''}</span>`
    : '<span class="selo esperando">aguardando validação</span>';

  const observacao = a.observacao
    ? `<div class="observacao"><strong>Professor:</strong> ${escapar(a.observacao)}</div>`
    : '';

  const analise = a.texto
    ? `<details><summary class="meta" style="cursor:pointer;margin-top:8px">
         Ver análise (${a.texto.length.toLocaleString('pt-BR')} caracteres${a.arquivo_nome ? ' · ' + escapar(a.arquivo_nome) : ''})
       </summary><pre>${escapar(a.texto)}</pre></details>`
    : '<div class="dica">Sem texto de análise anexado.</div>';

  const botoesEdicao = comEdicao
    ? `<div class="acoes" style="margin-top:12px">
         <button class="secundario mini" data-editar="${a.id}">Editar</button>
         <button class="perigo mini" data-excluir="${a.id}">Excluir</button>
       </div>`
    : '';

  const botoesValidacao = comValidacao
    ? `<div class="acoes" style="margin-top:12px">
         <input style="flex:2 1 240px" placeholder="Observação para o aluno (opcional)"
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
        <span class="espaco" style="flex:1"></span>
        <span class="horas">${horas(a.horas)}</span>
      </div>
      <div class="meta">
        ${comAluno ? escapar(a.aluno_nome) + ' · ' : ''}${dataBr(a.data_atividade)} · ${escapar(a.categoria)}
      </div>
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
    return [a.titulo, a.categoria, a.texto, a.aluno_nome]
      .some((campo) => String(campo || '').toLowerCase().includes(t));
  });
}

function desenharListaAluno() {
  const lista = filtrar(estado.atividades, $('#busca-aluno').value, $('#filtro-status-aluno').value);
  $('#lista-aluno').innerHTML = lista.length
    ? lista.map((a) => cartaoAtividade(a, { comEdicao: true })).join('')
    : '<p class="vazio">Nenhuma atividade por aqui ainda.</p>';
}

// ---- formulário de atividade ----

function limparFormulario() {
  $('#form-atividade').reset();
  $('#ativ-id').value = '';
  $('#ativ-data').value = new Date().toISOString().slice(0, 10);
  $('#titulo-formulario').textContent = 'Nova atividade';
  $('#btn-salvar').textContent = 'Salvar atividade';
  $('#btn-cancelar').classList.add('oculto');
  formulario.arquivoNome = null;
  atualizarContador();
}

const formulario = { arquivoNome: null };

function atualizarContador() {
  const n = $('#ativ-texto').value.length;
  $('#contador-texto').textContent =
    `${n.toLocaleString('pt-BR')} caracteres${formulario.arquivoNome ? ' · de ' + formulario.arquivoNome : ''}`;
}

$('#ativ-texto').addEventListener('input', () => atualizarContador());

$('#form-atividade').onsubmit = async (e) => {
  e.preventDefault();
  const corpo = {
    titulo: $('#ativ-titulo').value,
    categoria: $('#ativ-categoria').value,
    data_atividade: $('#ativ-data').value,
    horas: $('#ativ-horas').value,
    texto: $('#ativ-texto').value,
    arquivo_nome: formulario.arquivoNome,
  };
  const id = $('#ativ-id').value;
  try {
    await api(id ? `/api/atividades/${id}` : '/api/atividades', {
      metodo: id ? 'PUT' : 'POST',
      corpo,
    });
    limparFormulario();
    await carregarAtividades();
    avisar(id ? 'Atividade atualizada — ela volta para a fila de validação.' : 'Atividade registrada.', 'ok');
    $('#aviso-app').classList.remove('oculto');
  } catch (err) {
    avisar(err.message);
    $('#aviso-app').classList.remove('oculto');
  }
};

$('#btn-cancelar').onclick = () => limparFormulario();

$('#lista-aluno').addEventListener('click', async (e) => {
  const idEditar = e.target.dataset.editar;
  const idExcluir = e.target.dataset.excluir;

  if (idEditar) {
    const a = estado.atividades.find((x) => String(x.id) === idEditar);
    if (!a) return;
    $('#ativ-id').value = a.id;
    $('#ativ-titulo').value = a.titulo;
    $('#ativ-categoria').value = a.categoria;
    $('#ativ-data').value = a.data_atividade;
    $('#ativ-horas').value = a.horas;
    $('#ativ-texto').value = a.texto;
    formulario.arquivoNome = a.arquivo_nome;
    atualizarContador();
    $('#titulo-formulario').textContent = 'Editando atividade';
    $('#btn-salvar').textContent = 'Salvar alterações';
    $('#btn-cancelar').classList.remove('oculto');
    $('#form-atividade').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (idExcluir) {
    if (!confirm('Excluir esta atividade? A ação não pode ser desfeita.')) return;
    try {
      await api(`/api/atividades/${idExcluir}`, { metodo: 'DELETE' });
      await carregarAtividades();
    } catch (err) {
      avisar(err.message);
      $('#aviso-app').classList.remove('oculto');
    }
  }
});

$('#busca-aluno').addEventListener('input', desenharListaAluno);
$('#filtro-status-aluno').addEventListener('change', desenharListaAluno);

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
    avisar('Arquivo grande demais (limite de 2 MB de texto).');
    $('#aviso-app').classList.remove('oculto');
    return;
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
    for (const aba of ['turma', 'registros', 'ajustes']) {
      $(`#aba-${aba}`).classList.toggle('oculto', aba !== botao.dataset.aba);
    }
  };
});

function desenharTurma() {
  const meta = estado.meta;
  const linhas = estado.alunos.map((a) => {
    const pct = Math.min(100, (a.validado / Math.max(meta, 1)) * 100);
    const pctDeclarado = Math.max(0, Math.min(100, (a.declarado / Math.max(meta, 1)) * 100) - pct);
    return `<tr>
      <td>${escapar(a.nome)}<div class="meta">${escapar(a.email)}</div></td>
      <td style="min-width:160px">
        <div class="barra" style="margin-top:0">
          <i class="validado" style="width:${pct}%"></i><i class="pendente" style="width:${pctDeclarado}%"></i>
        </div>
      </td>
      <td class="num">${horas(a.validado)}</td>
      <td class="num">${horas(a.declarado)}</td>
      <td class="num">${a.pendentes}</td>
      <td class="num">${a.registros}</td>
    </tr>`;
  });

  $('#tabela-turma').innerHTML = `
    <thead><tr>
      <th>Aluno</th><th>Progresso (meta ${horas(meta)})</th>
      <th class="num">Validadas</th><th class="num">Declaradas</th>
      <th class="num">A validar</th><th class="num">Registros</th>
    </tr></thead>
    <tbody>${linhas.join('') || '<tr><td colspan="6" class="vazio">Nenhum aluno cadastrado ainda.</td></tr>'}</tbody>`;
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
  const observacao = $(`[data-obs="${id}"]`)?.value || '';
  try {
    const validando = e.target.dataset.valor === '1';
    await api(`/api/atividades/${id}/validacao`, {
      metodo: 'POST',
      corpo: { validado: validando, observacao },
    });
    await carregarProfessor();
    avisar(
      validando
        ? 'Horas validadas — o registro sai da fila de pendentes.'
        : 'Validação removida.',
      'ok',
    );
    $('#aviso-app').classList.remove('oculto');
  } catch (err) {
    avisar(err.message);
    $('#aviso-app').classList.remove('oculto');
  }
});

$('#busca-prof').addEventListener('input', desenharListaProfessor);
$('#filtro-status-prof').addEventListener('change', desenharListaProfessor);

$('#btn-salvar-config').onclick = async () => {
  try {
    const dados = await api('/api/config', {
      metodo: 'PUT',
      corpo: { meta_horas: $('#cfg-meta').value, titulo_turma: $('#cfg-titulo').value },
    });
    estado.meta = dados.meta_horas;
    estado.tituloTurma = dados.titulo_turma;
    $('#titulo-turma').textContent = dados.titulo_turma;
    desenharTurma();
    avisar('Ajustes salvos.', 'ok');
    $('#aviso-app').classList.remove('oculto');
  } catch (err) {
    avisar(err.message);
    $('#aviso-app').classList.remove('oculto');
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
  const [registros, turma] = await Promise.all([api('/api/atividades'), api('/api/turma')]);
  estado.atividades = registros.atividades;
  estado.alunos = turma.alunos;
  estado.meta = turma.meta_horas;
  desenharTurma();
  desenharListaProfessor();
}

async function iniciar() {
  const dados = await api('/api/eu');
  estado.usuario = dados.usuario;
  estado.categorias = dados.categorias;
  estado.meta = dados.meta_horas;
  estado.tituloTurma = dados.titulo_turma;

  if (!estado.usuario) return mostrarEntrada();

  $('#tela-entrada').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');
  $('#titulo-turma').textContent = estado.tituloTurma;
  $('#identificacao').textContent =
    `${estado.usuario.nome} · ${estado.usuario.papel === 'professor' ? 'professor(a)' : 'aluno(a)'}`;

  if (estado.usuario.papel === 'professor') {
    $('#painel-professor').classList.remove('oculto');
    $('#cfg-meta').value = estado.meta;
    $('#cfg-titulo').value = estado.tituloTurma;
    await carregarProfessor();
  } else {
    $('#painel-aluno').classList.remove('oculto');
    preencherCategorias();
    limparFormulario();
    await carregarAtividades();
  }
}

iniciar().catch((err) => {
  mostrarEntrada();
  console.error(err);
});
