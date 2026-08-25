const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const estado = {
  usuario: null,
  categorias: [],
  turmas: [],
  atividades: [],
  resumo: null,
  alunos: [],
  convites: [],
  turmaFiltro: '',
  papelCadastro: 'aluno',
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
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (tipo === 'ok') setTimeout(() => el.classList.add('oculto'), 4000);
}

const falhar = (err) => avisar(err.message);

// ---------------------------------------------------------------- entrada

function mostrarEntrada() {
  $('#tela-app').classList.add('oculto');
  $('#tela-entrada').classList.remove('oculto');
}

const trocarFormulario = (mostrarCadastro) => {
  $('#form-login').classList.toggle('oculto', mostrarCadastro);
  $('#form-cadastro').classList.toggle('oculto', !mostrarCadastro);
  $('#aviso-entrada').classList.add('oculto');
};

$('#ir-cadastro').onclick = () => trocarFormulario(true);
$('#ir-login').onclick = () => trocarFormulario(false);

$$('.escolha button').forEach((botao) => {
  botao.onclick = () => {
    estado.papelCadastro = botao.dataset.papel;
    $$('.escolha button').forEach((b) => b.classList.toggle('ativa', b === botao));
    const aluno = estado.papelCadastro === 'aluno';
    $('#campos-aluno').classList.toggle('oculto', !aluno);
    $$('.campo-aluno').forEach((c) => c.classList.toggle('oculto', !aluno));
    $$('.campo-professor').forEach((c) => c.classList.toggle('oculto', aluno));
    if (!aluno && !$('#campo-convite').dataset.obrigatorio) {
      $('#campo-convite').classList.add('oculto'); // primeira conta da instalação
    }
    $('#btn-criar-conta').textContent = aluno ? 'Entrar na turma' : 'Criar minha conta';
  };
});

// Confere o código enquanto o aluno digita: ele vê em qual turma vai entrar.
let conferindo;
$('#cad-codigo-turma').addEventListener('input', (e) => {
  const codigo = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const caixa = $('#confirmacao-turma');
  clearTimeout(conferindo);
  if (codigo.length < 6) return caixa.classList.add('oculto');
  conferindo = setTimeout(async () => {
    try {
      const { turma } = await api('/api/turmas/localizar', { metodo: 'POST', corpo: { codigo } });
      caixa.innerHTML = `Turma <strong>${escapar(turma.nome)}</strong>${
        turma.professor_nome ? ' · Prof(a). ' + escapar(turma.professor_nome) : ''
      }`;
      caixa.classList.remove('oculto');
    } catch {
      caixa.classList.add('oculto');
    }
  }, 400);
});

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
        papel: estado.papelCadastro,
        nome: $('#cad-nome').value,
        email: $('#cad-email').value,
        senha: $('#cad-senha').value,
        codigo_turma: $('#cad-codigo-turma').value,
        codigo_convite: $('#cad-convite').value,
        matricula: $('#cad-matricula').value,
        instituicao: $('#cad-instituicao').value,
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

const exportar = () => {
  const filtro = estado.usuario?.papel === 'professor' && estado.turmaFiltro
    ? `?turma_id=${estado.turmaFiltro}`
    : '';
  window.location.href = `/api/exportar.csv${filtro}`;
};
$('#btn-exportar-aluno').onclick = exportar;
$('#btn-exportar-prof').onclick = exportar;

// ---------------------------------------------------------------- aluno

function desenharResumo() {
  const r = estado.resumo;
  if (!r) return;
  $('#n-validado').textContent = horas(r.validado);
  $('#n-declarado').textContent = horas(r.declarado);
  $('#n-meta').textContent = horas(r.meta);
  $('#n-registros').textContent = r.registros;

  const pct = (v) => Math.min(100, (v / Math.max(r.meta, 1)) * 100);
  const validado = pct(r.validado);
  $('#barra-validado').style.width = `${validado}%`;
  $('#barra-pendente').style.width = `${Math.max(0, pct(r.declarado) - validado)}%`;

  const falta = Math.max(0, r.meta - r.validado);
  $('#falta-meta').textContent = falta > 0
    ? `Faltam ${horas(falta)} validadas para fechar a meta.`
    : 'Meta de horas validadas atingida.';
}

function cartaoAtividade(a, { comAluno = false, comValidacao = false, comEdicao = false } = {}) {
  const selo = a.validado
    ? `<span class="selo ok">validada${a.validado_por_nome ? ' · ' + escapar(a.validado_por_nome) : ''}</span>`
    : '<span class="selo esperando">aguardando</span>';

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

  const analise = a.texto
    ? `<details><summary>Ver análise (${a.texto.length.toLocaleString('pt-BR')} caracteres)</summary><pre>${escapar(a.texto)}</pre></details>`
    : '<p class="vazio">Sem texto de análise.</p>';

  return `
    <article class="atividade">
      <div class="cabecalho">
        <span class="titulo">${escapar(a.titulo)}</span>
        ${selo}
        <span class="horas">${horas(a.horas)}</span>
      </div>
      <div class="ficha">${itens
        .map(([r, v]) => `<div><div class="rotulo">${r}</div>${escapar(v)}</div>`)
        .join('')}</div>
      ${a.observacao ? `<div class="observacao"><strong>Professor:</strong> ${escapar(a.observacao)}</div>` : ''}
      ${analise}
      ${comEdicao
        ? `<div class="acoes" style="margin-top:16px">
             <button class="secundario mini" data-editar="${a.id}">Editar</button>
             <button class="perigo mini" data-excluir="${a.id}">Excluir</button>
           </div>`
        : ''}
      ${comValidacao
        ? `<div style="margin-top:16px">
             <input placeholder="Observação para o aluno (opcional)" data-obs="${a.id}"
                    value="${escapar(a.observacao || '')}" style="margin-bottom:10px">
             ${a.validado
               ? `<button class="secundario mini" data-validar="${a.id}" data-valor="0">Remover validação</button>`
               : `<button data-validar="${a.id}" data-valor="1">Validar ${horas(a.horas)}</button>`}
           </div>`
        : ''}
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
    : '<p class="vazio">Nenhuma atividade ainda. Toque em “Lançar nova atividade”.</p>';
}

// ---- formulário ----

const formulario = { arquivoNome: null };

function abrirFormulario(abrir = true) {
  $('#cartao-formulario').classList.toggle('oculto', !abrir);
  $('#btn-abrir-form').classList.toggle('oculto', abrir);
  if (abrir) $('#cartao-formulario').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function limparFormulario() {
  $('#form-atividade').reset();
  $('#ativ-id').value = '';
  $('#ativ-data').value = new Date().toISOString().slice(0, 10);
  $('#titulo-formulario').textContent = 'Nova atividade';
  $('#btn-salvar').textContent = 'Salvar atividade';
  formulario.arquivoNome = null;
  atualizarContador();
}

function atualizarContador() {
  const n = $('#ativ-texto').value.length;
  $('#contador-texto').textContent =
    `${n.toLocaleString('pt-BR')} caracteres${formulario.arquivoNome ? ' · ' + formulario.arquivoNome : ''}`;
}

$('#ativ-texto').addEventListener('input', atualizarContador);
$('#btn-abrir-form').onclick = () => { limparFormulario(); abrirFormulario(true); };
$('#btn-cancelar').onclick = () => { limparFormulario(); abrirFormulario(false); };

$('#form-atividade').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('#ativ-id').value;
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
  try {
    await api(id ? `/api/atividades/${id}` : '/api/atividades', { metodo: id ? 'PUT' : 'POST', corpo });
    limparFormulario();
    abrirFormulario(false);
    await carregarAtividades();
    avisar(id ? 'Atividade atualizada — volta para a fila de validação.' : 'Atividade lançada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-aluno').addEventListener('click', async (e) => {
  const idEditar = e.target.dataset.editar;
  const idExcluir = e.target.dataset.excluir;

  if (idEditar) {
    const a = estado.atividades.find((x) => String(x.id) === idEditar);
    if (!a) return;
    abrirFormulario(true);
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
      corpo: {
        nome: $('#meus-nome').value,
        matricula: $('#meus-matricula').value,
        codigo_turma: $('#meus-codigo').value,
      },
    });
    $('#meus-codigo').value = '';
    avisar('Dados salvos.', 'ok');
    await iniciar();
  } catch (err) {
    falhar(err);
  }
};

// ---- arquivo de texto ----

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
  if (arquivo.size > 2 * 1024 * 1024) return avisar('Arquivo grande demais (limite de 2 MB).');
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
    for (const aba of ['turma', 'registros', 'turmas', 'convites', 'ajustes']) {
      $(`#aba-${aba}`).classList.toggle('oculto', aba !== botao.dataset.aba);
    }
    $('#filtro-turma-cartao').classList.toggle(
      'oculto',
      !['turma', 'registros'].includes(botao.dataset.aba) || estado.turmas.length < 2,
    );
  };
});

$('#filtro-turma').addEventListener('change', async (e) => {
  estado.turmaFiltro = e.target.value;
  await carregarProfessor();
});

function desenharAlunos() {
  $('#lista-alunos').innerHTML = estado.alunos.length
    ? estado.alunos.map((a) => {
        const meta = Math.max(a.meta, 1);
        const pct = Math.min(100, (a.validado / meta) * 100);
        const pendente = Math.max(0, Math.min(100, (a.declarado / meta) * 100) - pct);
        return `<div class="item">
          <div class="nome">${escapar(a.nome)}</div>
          <div class="sub">${escapar(a.turma_nome || 'sem turma')}${a.matricula ? ' · ' + escapar(a.matricula) : ''}</div>
          <div class="barra" style="margin-top:12px;height:12px">
            <i class="validado" style="width:${pct}%"></i><i class="pendente" style="width:${pendente}%"></i>
          </div>
          <div class="numeros-linha">
            <span><b>${horas(a.validado)}</b> validadas</span>
            <span><b>${horas(a.declarado)}</b> lançadas</span>
            <span>meta ${horas(meta)}</span>
            ${a.pendentes > 0 ? `<span class="selo esperando">${a.pendentes} a validar</span>` : ''}
          </div>
        </div>`;
      }).join('')
    : '<p class="vazio">Nenhum aluno entrou nas suas turmas ainda. Passe o código da turma para eles.</p>';
}

function desenharListaProfessor() {
  const lista = filtrar(estado.atividades, $('#busca-prof').value, $('#filtro-status-prof').value);
  $('#lista-prof').innerHTML = lista.length
    ? lista.map((a) => cartaoAtividade(a, { comAluno: true, comValidacao: true })).join('')
    : '<p class="vazio">Nada para mostrar com esses filtros.</p>';

  const pendentes = estado.atividades.filter((a) => !a.validado).length;
  $('#contador-pendentes').textContent = pendentes ? `(${pendentes})` : '';
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
    avisar(validando ? 'Horas validadas.' : 'Validação removida.', 'ok');
  } catch (err) {
    falhar(err);
  }
});

$('#busca-prof').addEventListener('input', desenharListaProfessor);
$('#filtro-status-prof').addEventListener('change', desenharListaProfessor);

// ---- turmas ----

function desenharTurmas() {
  $('#lista-turmas').innerHTML = estado.turmas.length
    ? estado.turmas.map((t) => `<div class="item">
        <div class="nome">${escapar(t.nome)}</div>
        <div class="sub">${escapar(t.periodo || 'sem período')} · ${t.alunos} aluno(s)</div>
        <div class="codigo-turma">
          <span class="valor">${escapar(t.codigo || '——')}</span>
          <button class="secundario mini" data-copiar="${escapar(t.codigo || '')}">Copiar convite</button>
        </div>
        <div class="linha">
          <div class="campo"><label>Nome</label><input data-turma-nome="${t.id}" value="${escapar(t.nome)}"></div>
          <div class="campo"><label>Período</label><input data-turma-periodo="${t.id}" value="${escapar(t.periodo || '')}"></div>
          <div class="campo"><label>Meta (h)</label><input data-turma-meta="${t.id}" type="number" min="1" inputmode="numeric" value="${t.meta_horas}"></div>
        </div>
        <div class="acoes">
          <button class="secundario mini" data-salvar-turma="${t.id}">Salvar</button>
          <button class="perigo mini" data-excluir-turma="${t.id}">Excluir</button>
        </div>
      </div>`).join('')
    : '<p class="vazio">Você ainda não tem turmas. Crie a primeira acima.</p>';
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
    avisar('Turma criada. Passe o código para os alunos.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-turmas').addEventListener('click', async (e) => {
  const { salvarTurma, excluirTurma, copiar } = e.target.dataset;
  try {
    if (copiar !== undefined) {
      const convite = `Entre no controle de horas complementares: ${location.origin} — código da turma: ${copiar}`;
      await navigator.clipboard.writeText(convite);
      avisar('Convite copiado — cole no grupo da turma.', 'ok');
    }
    if (salvarTurma) {
      await api(`/api/turmas/${salvarTurma}`, {
        metodo: 'PUT',
        corpo: {
          nome: $(`[data-turma-nome="${salvarTurma}"]`).value,
          periodo: $(`[data-turma-periodo="${salvarTurma}"]`).value,
          meta_horas: $(`[data-turma-meta="${salvarTurma}"]`).value,
        },
      });
      await carregarProfessor();
      avisar('Turma atualizada.', 'ok');
    }
    if (excluirTurma) {
      if (!confirm('Excluir esta turma?')) return;
      await api(`/api/turmas/${excluirTurma}`, { metodo: 'DELETE' });
      await carregarProfessor();
      avisar('Turma excluída.', 'ok');
    }
  } catch (err) {
    falhar(err);
  }
});

function desenharConvites() {
  $('#lista-convites').innerHTML = estado.convites.length
    ? estado.convites.map((c) => `<div class="item">
        <div class="sub">${escapar(c.observacao || 'sem anotação')}</div>
        <div class="codigo-turma">
          <span class="valor" style="font-size:18px">${escapar(c.codigo)}</span>
          ${c.usado_em ? '' : `<button class="secundario mini" data-copiar-convite="${escapar(c.codigo)}">Copiar</button>`}
        </div>
        ${c.usado_em
          ? `<div class="sub">Usado por ${escapar(c.usado_por_nome || 'alguém')} em ${dataBr(c.usado_em)}</div>`
          : `<div class="acoes"><button class="perigo mini" data-revogar="${c.id}">Revogar</button></div>`}
      </div>`).join('')
    : '<p class="vazio">Nenhum convite gerado ainda.</p>';
}

$('#btn-criar-convite').onclick = async () => {
  try {
    await api('/api/convites', { metodo: 'POST', corpo: { observacao: $('#novo-convite-obs').value } });
    $('#novo-convite-obs').value = '';
    await carregarConvites();
    avisar('Convite gerado. Copie e envie para o professor.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-convites').addEventListener('click', async (e) => {
  const { copiarConvite, revogar } = e.target.dataset;
  try {
    if (copiarConvite !== undefined) {
      const texto = `Você foi convidado para o controle de horas complementares: ${location.origin}\n` +
        `Crie a conta escolhendo "Sou professor(a)" e use o convite: ${copiarConvite}`;
      await navigator.clipboard.writeText(texto);
      avisar('Convite copiado.', 'ok');
    }
    if (revogar) {
      if (!confirm('Revogar este convite?')) return;
      await api(`/api/convites/${revogar}`, { metodo: 'DELETE' });
      await carregarConvites();
      avisar('Convite revogado.', 'ok');
    }
  } catch (err) {
    falhar(err);
  }
});

async function carregarConvites() {
  const { convites } = await api('/api/convites');
  estado.convites = convites;
  desenharConvites();
}

$('#btn-salvar-perfil').onclick = async () => {
  try {
    await api('/api/eu', {
      metodo: 'PUT',
      corpo: { nome: $('#cfg-nome').value, instituicao: $('#cfg-instituicao').value },
    });
    avisar('Dados salvos.', 'ok');
    await iniciar();
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

  $('#filtro-turma').innerHTML = [
    '<option value="">Todas as turmas</option>',
    ...estado.turmas.map((t) => {
      const rotulo = t.periodo ? `${t.nome} — ${t.periodo}` : t.nome;
      return `<option value="${t.id}" ${String(t.id) === String(estado.turmaFiltro) ? 'selected' : ''}>${escapar(rotulo)}</option>`;
    }),
  ].join('');
  const abaAtiva = document.querySelector('.abas button.ativa')?.dataset.aba;
  $('#filtro-turma-cartao').classList.toggle(
    'oculto',
    estado.turmas.length < 2 || !['turma', 'registros'].includes(abaAtiva),
  );

  desenharAlunos();
  desenharListaProfessor();
  desenharTurmas();
}

async function iniciar() {
  const dados = await api('/api/eu');
  estado.usuario = dados.usuario;
  estado.categorias = dados.categorias;

  if (!estado.usuario) {
    $('#campo-convite').dataset.obrigatorio = dados.convite_obrigatorio ? '1' : '';
    return mostrarEntrada();
  }

  $('#tela-entrada').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');

  const u = estado.usuario;
  if (u.papel === 'professor') {
    $('#identificacao').textContent = [u.nome, u.instituicao].filter(Boolean).join(' · ');
    $('#painel-professor').classList.remove('oculto');
    $('#painel-aluno').classList.add('oculto');
    $('#cfg-nome').value = u.nome;
    $('#cfg-instituicao').value = u.instituicao || '';
    estado.turmas = dados.turmas || [];
    $('#aba-botao-convites').classList.toggle('oculto', !u.pode_convidar);
    await carregarProfessor();
    if (u.pode_convidar) await carregarConvites();
  } else {
    const prof = dados.professor;
    $('#identificacao').textContent = [u.nome, u.turma_nome].filter(Boolean).join(' · ');
    $('#explicacao-progresso').textContent = u.turma_nome
      ? `Turma ${u.turma_nome}${prof?.nome ? ' · Prof(a). ' + prof.nome : ''}`
      : 'Você ainda não está em uma turma — informe o código em “Seus dados”.';
    $('#painel-aluno').classList.remove('oculto');
    $('#painel-professor').classList.add('oculto');
    $('#ativ-categoria').innerHTML = estado.categorias
      .map((c) => `<option value="${escapar(c)}">${escapar(c)}</option>`)
      .join('');
    $('#meus-nome').value = u.nome;
    $('#meus-matricula').value = u.matricula || '';
    estado.resumo = dados.resumo;
    limparFormulario();
    abrirFormulario(false);
    await carregarAtividades();
  }
}

iniciar().catch((err) => {
  mostrarEntrada();
  console.error(err);
});
