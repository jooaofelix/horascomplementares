const $ = (sel) => document.querySelector(sel);

// Professor, coordenação e administração compartilham o mesmo painel; o que
// muda é o alcance de cada um, decidido no servidor.
const EQUIPE = ['professor', 'coordenador', 'admin'];
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const estado = {
  usuario: null,
  categorias: [],
  turmas: [],
  atividades: [],
  resumo: null,
  alunos: [],
  convites: [],
  chaves: [],
  mural: null,
  cursos: [],
  usuarios: [],
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
  const filtro = EQUIPE.includes(estado.usuario?.papel) && estado.turmaFiltro
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

function desenharCategorias() {
  const linhas = estado.resumo?.categorias ?? [];
  $('#cartao-categorias').classList.toggle('oculto', linhas.length === 0);
  if (!linhas.length) return;

  $('#lista-categorias').innerHTML = linhas.map((c) => {
    const teto = c.limite ?? null;
    const pct = teto ? Math.min(100, (c.validado / teto) * 100) : 0;
    const pendente = teto ? Math.max(0, Math.min(100, (c.declarado / teto) * 100) - pct) : 0;
    const estourou = teto !== null && c.declarado > teto;
    return `<div class="item" style="margin-bottom:10px">
      <div class="nome">${escapar(c.nome)}</div>
      ${teto
        ? `<div class="barra" style="margin-top:10px;height:10px">
             <i class="validado" style="width:${pct}%"></i><i class="pendente" style="width:${pendente}%"></i>
           </div>`
        : ''}
      <div class="numeros-linha">
        <span><b>${horas(c.validado)}</b> validadas</span>
        <span><b>${horas(c.declarado)}</b> lançadas</span>
        <span>${teto ? 'limite ' + horas(teto) : 'sem limite'}</span>
        ${estourou ? '<span class="selo esperando">passou do limite do curso</span>' : ''}
      </div>
    </div>`;
  }).join('');
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
    categoria_id: $('#ativ-categoria').value,
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
    $('#ativ-categoria').value = a.categoria_id ?? '';
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
    for (const aba of ['turma', 'registros', 'aulas', 'turmas', 'convites', 'integracao', 'cursos', 'usuarios', 'ajustes']) {
      $(`#aba-${aba}`).classList.toggle('oculto', aba !== botao.dataset.aba);
    }
    $('#filtro-turma-cartao').classList.toggle(
      'oculto',
      !['turma', 'registros', 'aulas'].includes(botao.dataset.aba) || estado.turmas.length < 2,
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
        curso_id: $('#nova-turma-curso').value || null,
        meta_horas: $('#nova-turma-meta').value || undefined,
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

function desenharChaves() {
  $('#lista-chaves').innerHTML = estado.chaves.length
    ? estado.chaves.map((c) => `<div class="item">
        <div class="nome">${escapar(c.nome)}</div>
        <div class="sub">
          prefixo ${escapar(c.prefixo)} · ${c.chamadas} envio(s)
          ${c.ultimo_uso_em ? ' · último em ' + dataBr(c.ultimo_uso_em) : ' · nunca usada'}
        </div>
        ${c.revogada_em
          ? `<div class="sub" style="color:var(--erro)">Revogada em ${dataBr(c.revogada_em)}</div>`
          : `<div class="acoes"><button class="perigo mini" data-revogar-chave="${c.id}">Revogar</button></div>`}
      </div>`).join('')
    : '<p class="vazio">Nenhuma chave gerada ainda.</p>';
}

$('#btn-criar-chave').onclick = async () => {
  try {
    const { token } = await api('/api/chaves', { metodo: 'POST', corpo: { nome: $('#nova-chave-nome').value } });
    $('#chave-valor').textContent = token;
    $('#chave-nova').classList.remove('oculto');
    $('#nova-chave-nome').value = '';
    await carregarChaves();
  } catch (err) {
    falhar(err);
  }
};

$('#btn-copiar-chave').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#chave-valor').textContent);
    avisar('Chave copiada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-chaves').addEventListener('click', async (e) => {
  const id = e.target.dataset.revogarChave;
  if (!id) return;
  if (!confirm('Revogar esta chave? O sistema que a usa para de enviar na hora.')) return;
  try {
    await api(`/api/chaves/${id}`, { metodo: 'DELETE' });
    await carregarChaves();
    avisar('Chave revogada.', 'ok');
  } catch (err) {
    falhar(err);
  }
});

async function carregarChaves() {
  const { chaves } = await api('/api/chaves');
  estado.chaves = chaves;
  desenharChaves();
}

function desenharCursos() {
  const categorias = estado.categorias.filter((c) => c.ativa);
  $('#lista-cursos').innerHTML = estado.cursos.length
    ? estado.cursos.map((curso) => {
        const regra = (id) => curso.regras.find((r) => r.categoria_id === id) || {};
        return `<div class="item">
          <div class="nome">${escapar(curso.nome)}${curso.sigla ? ' · ' + escapar(curso.sigla) : ''}</div>
          <div class="sub">${horas(curso.horas_obrigatorias)} obrigatórias · ${curso.alunos} aluno(s)</div>
          <div class="sub" style="margin-top:6px">
            Coordenação: ${curso.coordenadores.length
              ? curso.coordenadores.map((c) => escapar(c.nome)).join(', ')
              : 'ninguém ainda'}
          </div>

          <div class="linha" style="margin-top:14px">
            <div class="campo"><label>Nome</label><input data-curso-nome="${curso.id}" value="${escapar(curso.nome)}"></div>
            <div class="campo"><label>Sigla</label><input data-curso-sigla="${curso.id}" value="${escapar(curso.sigla || '')}"></div>
            <div class="campo"><label>Horas obrigatórias</label>
              <input data-curso-horas="${curso.id}" type="number" min="1" inputmode="numeric" value="${curso.horas_obrigatorias}"></div>
          </div>

          <details style="margin-top:10px">
            <summary style="cursor:pointer;color:var(--acento);font-weight:600">Limites por categoria</summary>
            <table style="margin-top:12px">
              <thead><tr><th>Categoria</th><th class="num">Limite (h)</th><th class="num">Ou % do total</th></tr></thead>
              <tbody>
                ${categorias.map((cat) => `<tr>
                  <td>${escapar(cat.nome)}</td>
                  <td class="num"><input style="max-width:110px" type="number" min="0" step="1" inputmode="numeric"
                        data-regra-limite="${curso.id}:${cat.id}" value="${regra(cat.id).limite_horas ?? ''}" placeholder="—"></td>
                  <td class="num"><input style="max-width:110px" type="number" min="1" max="100" step="1" inputmode="numeric"
                        data-regra-pct="${curso.id}:${cat.id}" value="${regra(cat.id).percentual_max ?? ''}" placeholder="—"></td>
                </tr>`).join('')}
              </tbody>
            </table>
            <p class="ajuda" style="margin-top:8px">Deixe vazio para a categoria não ter teto neste curso.</p>
          </details>

          <div class="acoes" style="margin-top:14px">
            <button class="secundario mini" data-salvar-curso="${curso.id}">Salvar curso e limites</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="vazio">Nenhum curso cadastrado ainda.</p>';

  $('#lista-categorias-admin').innerHTML = estado.categorias.map((cat) => `<div class="item" style="margin-bottom:10px">
      <div class="linha">
        <div class="campo"><label>Nome</label><input data-cat-nome="${cat.id}" value="${escapar(cat.nome)}"></div>
        <div class="campo"><label>Ordem</label><input data-cat-ordem="${cat.id}" type="number" min="1" inputmode="numeric" value="${cat.ordem}"></div>
      </div>
      <div class="acoes">
        <button class="secundario mini" data-salvar-cat="${cat.id}">Salvar</button>
        <button class="perigo mini" data-excluir-cat="${cat.id}">${cat.ativa ? 'Desativar' : 'Reativar'}</button>
      </div>
    </div>`).join('');

  const opcoes = estado.cursos.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join('');
  $('#nova-turma-curso').innerHTML = `<option value="">Sem curso</option>${opcoes}`;
}

$('#btn-criar-curso').onclick = async () => {
  try {
    await api('/api/cursos', {
      metodo: 'POST',
      corpo: {
        nome: $('#novo-curso-nome').value,
        sigla: $('#novo-curso-sigla').value,
        horas_obrigatorias: $('#novo-curso-horas').value,
      },
    });
    $('#novo-curso-nome').value = '';
    $('#novo-curso-sigla').value = '';
    await carregarAdmin();
    avisar('Curso criado.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-cursos').addEventListener('click', async (e) => {
  const id = e.target.dataset.salvarCurso;
  if (!id) return;
  try {
    await api(`/api/cursos/${id}`, {
      metodo: 'PUT',
      corpo: {
        nome: $(`[data-curso-nome="${id}"]`).value,
        sigla: $(`[data-curso-sigla="${id}"]`).value,
        horas_obrigatorias: $(`[data-curso-horas="${id}"]`).value,
      },
    });
    const regras = estado.categorias.filter((c) => c.ativa).map((cat) => ({
      categoria_id: cat.id,
      limite_horas: $(`[data-regra-limite="${id}:${cat.id}"]`).value,
      percentual_max: $(`[data-regra-pct="${id}:${cat.id}"]`).value,
    })).filter((r) => r.limite_horas !== '' || r.percentual_max !== '');

    await api(`/api/cursos/${id}/regras`, { metodo: 'PUT', corpo: { regras } });
    await carregarAdmin();
    avisar('Curso e limites salvos.', 'ok');
  } catch (err) {
    falhar(err);
  }
});

$('#btn-criar-categoria').onclick = async () => {
  try {
    await api('/api/categorias', {
      metodo: 'POST',
      corpo: { nome: $('#nova-categoria-nome').value, ordem: $('#nova-categoria-ordem').value },
    });
    $('#nova-categoria-nome').value = '';
    await carregarAdmin();
    avisar('Categoria adicionada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-categorias-admin').addEventListener('click', async (e) => {
  const { salvarCat, excluirCat } = e.target.dataset;
  try {
    if (salvarCat) {
      await api(`/api/categorias/${salvarCat}`, {
        metodo: 'PUT',
        corpo: {
          nome: $(`[data-cat-nome="${salvarCat}"]`).value,
          ordem: $(`[data-cat-ordem="${salvarCat}"]`).value,
          ativa: true,
        },
      });
      await carregarAdmin();
      avisar('Categoria salva.', 'ok');
    }
    if (excluirCat) {
      const cat = estado.categorias.find((c) => String(c.id) === excluirCat);
      if (cat.ativa) {
        const r = await api(`/api/categorias/${excluirCat}`, { metodo: 'DELETE' });
        avisar(r.desativada
          ? `Categoria desativada (${r.atividades} atividade(s) mantêm o histórico).`
          : 'Categoria removida.', 'ok');
      } else {
        await api(`/api/categorias/${excluirCat}`, {
          metodo: 'PUT', corpo: { nome: cat.nome, ordem: cat.ordem, ativa: true },
        });
        avisar('Categoria reativada.', 'ok');
      }
      await carregarAdmin();
    }
  } catch (err) {
    falhar(err);
  }
});

function desenharUsuarios() {
  const termo = $('#busca-usuarios').value.trim().toLowerCase();
  const lista = estado.usuarios.filter((u) =>
    !termo || `${u.nome} ${u.email}`.toLowerCase().includes(termo));
  const cursos = estado.cursos.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join('');

  $('#lista-usuarios').innerHTML = lista.length
    ? lista.map((u) => `<div class="item">
        <div class="nome">${escapar(u.nome)} ${u.pre_cadastrado ? '<span class="selo esperando">sem senha</span>' : ''}</div>
        <div class="sub">${escapar(u.email)}${u.turma_nome ? ' · ' + escapar(u.turma_nome) : ''}</div>
        <div class="linha" style="margin-top:12px">
          <div class="campo">
            <label>Papel</label>
            <select data-papel="${u.id}">
              ${['aluno', 'professor', 'coordenador', 'admin']
                .map((p) => `<option value="${p}" ${p === u.papel ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="campo">
            <label>Curso</label>
            <select data-curso="${u.id}"><option value="">Sem curso</option>${cursos}</select>
          </div>
          <div class="campo">
            <label>Matrícula</label>
            <input data-matricula="${u.id}" value="${escapar(u.matricula || '')}">
          </div>
        </div>
        <div class="acoes"><button class="secundario mini" data-salvar-usuario="${u.id}">Salvar</button></div>
      </div>`).join('')
    : '<p class="vazio">Ninguém encontrado.</p>';

  for (const u of lista) {
    const select = $(`[data-curso="${u.id}"]`);
    if (select) select.value = u.curso_id ?? '';
  }
}

$('#busca-usuarios').addEventListener('input', desenharUsuarios);

$('#lista-usuarios').addEventListener('click', async (e) => {
  const id = e.target.dataset.salvarUsuario;
  if (!id) return;
  try {
    await api(`/api/usuarios/${id}`, {
      metodo: 'PUT',
      corpo: {
        papel: $(`[data-papel="${id}"]`).value,
        curso_id: $(`[data-curso="${id}"]`).value || null,
        matricula: $(`[data-matricula="${id}"]`).value,
      },
    });
    await carregarAdmin();
    avisar('Pessoa atualizada.', 'ok');
  } catch (err) {
    falhar(err);
  }
});

async function carregarAdmin() {
  const [cursos, categorias, usuarios] = await Promise.all([
    api('/api/cursos'),
    api('/api/categorias'),
    estado.usuario?.papel === 'admin' ? api('/api/usuarios') : Promise.resolve({ usuarios: [] }),
  ]);
  estado.cursos = cursos.cursos;
  estado.categorias = categorias.categorias;
  estado.usuarios = usuarios.usuarios;
  desenharCursos();
  desenharUsuarios();
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

// ---------------------------------------------------------------- aulas e tarefas

// Lê o arquivo escolhido e devolve no formato que a API espera.
function lerParaEnvio(input) {
  const arquivo = input?.files?.[0];
  if (!arquivo) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.onload = () => resolve({
      nome: arquivo.name,
      tipo: arquivo.type || 'application/octet-stream',
      conteudo: String(leitor.result).split(',')[1],
    });
    leitor.readAsDataURL(arquivo);
  });
}

const prazoTexto = (prazo) => (prazo ? `entrega até ${dataBr(prazo)}` : 'sem prazo');

const SELO_ENTREGA = {
  enviada: '<span class="selo esperando">aguardando avaliação</span>',
  devolvida: '<span class="selo esperando">devolvida para correção</span>',
  aceita: '<span class="selo ok">aceita</span>',
};

function blocoMaterial(m, comRemover) {
  const link = m.tipo === 'link'
    ? `<a href="${escapar(m.url)}" target="_blank" rel="noopener">${escapar(m.titulo)}</a>`
    : m.arquivo_id
      ? `<a href="/api/arquivos/${m.arquivo_id}" target="_blank" rel="noopener">${escapar(m.titulo)}</a>`
      : escapar(m.titulo);
  return `<div class="item" style="margin-bottom:8px">
    <div class="nome">${link}</div>
    ${m.descricao ? `<div class="sub">${escapar(m.descricao)}</div>` : ''}
    ${m.arquivo_nome ? `<div class="sub">${escapar(m.arquivo_nome)} · ${Math.ceil((m.arquivo_tamanho || 0) / 1024)} KB</div>` : ''}
    ${comRemover ? `<div class="acoes"><button class="perigo mini" data-remover-material="${m.id}">Remover</button></div>` : ''}
  </div>`;
}

function blocoTarefaAluno(t) {
  const entrega = t.minha_entrega;
  return `<div class="item" style="margin-bottom:10px">
    <div class="cabecalho">
      <span class="titulo">${escapar(t.titulo)}</span>
      ${entrega ? SELO_ENTREGA[entrega.status] : '<span class="selo esperando">a entregar</span>'}
    </div>
    <div class="sub">${prazoTexto(t.prazo)}${t.horas_sugeridas ? ' · vale ' + horas(t.horas_sugeridas) : ''}</div>
    ${t.enunciado ? `<p style="margin:10px 0 0">${escapar(t.enunciado)}</p>` : ''}
    ${entrega?.observacao ? `<div class="observacao"><strong>Professor:</strong> ${escapar(entrega.observacao)}</div>` : ''}
    ${entrega?.status === 'aceita'
      ? `<p class="sub" style="margin-top:10px">Suas ${horas(entrega.horas || 0)} já entraram como horas validadas.</p>`
      : `<div style="margin-top:12px">
           <textarea data-entrega-texto="${t.id}" placeholder="Escreva sua resposta aqui">${escapar(entrega?.texto || '')}</textarea>
           <div class="campo" style="margin-top:10px">
             <label>Anexo <span class="opcional">(PDF, JPG ou PNG)</span></label>
             <input type="file" data-entrega-arquivo="${t.id}" accept=".pdf,.jpg,.jpeg,.png,.txt,.md">
             ${entrega?.arquivo_nome ? `<div class="ajuda">Já enviado: ${escapar(entrega.arquivo_nome)}</div>` : ''}
           </div>
           <button data-enviar-entrega="${t.id}">${entrega ? 'Reenviar entrega' : 'Entregar'}</button>
         </div>`}
  </div>`;
}

function desenharMuralAluno() {
  const mural = estado.mural;
  const temAlgo = mural && (mural.aulas.length || mural.avulsos.materiais.length || mural.avulsos.tarefas.length);
  $('#cartao-mural-aluno').classList.toggle('oculto', !temAlgo);
  if (!temAlgo) return;

  const secao = (titulo, sub, materiais, tarefas, descricao) => `
    <div class="item" style="margin-bottom:14px">
      <div class="nome" style="font-size:17px">${escapar(titulo)}</div>
      ${sub ? `<div class="sub">${escapar(sub)}</div>` : ''}
      ${descricao ? `<p style="margin:10px 0 0">${escapar(descricao)}</p>` : ''}
      ${materiais.length ? `<div style="margin-top:12px">${materiais.map((m) => blocoMaterial(m, false)).join('')}</div>` : ''}
      ${tarefas.length ? `<div style="margin-top:12px">${tarefas.map(blocoTarefaAluno).join('')}</div>` : ''}
    </div>`;

  $('#mural-aluno').innerHTML = [
    ...mural.aulas.map((a) => secao(a.titulo, a.data_aula ? dataBr(a.data_aula) : '', a.materiais, a.tarefas, a.descricao)),
    (mural.avulsos.materiais.length || mural.avulsos.tarefas.length)
      ? secao('Material e tarefas da turma', '', mural.avulsos.materiais, mural.avulsos.tarefas, null)
      : '',
  ].join('');
}

$('#mural-aluno').addEventListener('click', async (e) => {
  const id = e.target.dataset.enviarEntrega;
  if (!id) return;
  e.target.disabled = true;
  try {
    const arquivo = await lerParaEnvio($(`[data-entrega-arquivo="${id}"]`));
    await api(`/api/tarefas/${id}/entrega`, {
      metodo: 'PUT',
      corpo: { texto: $(`[data-entrega-texto="${id}"]`).value, arquivo },
    });
    await carregarMuralAluno();
    avisar('Entrega enviada. O professor vai avaliar.', 'ok');
  } catch (err) {
    falhar(err);
  } finally {
    e.target.disabled = false;
  }
});

async function carregarMuralAluno() {
  if (!estado.usuario?.turma_id) return;
  estado.mural = await api(`/api/turmas/${estado.usuario.turma_id}/mural`);
  desenharMuralAluno();
}

// ---- lado do professor ----

function blocoTarefaProfessor(t) {
  return `<div class="item" style="margin-bottom:8px">
    <div class="cabecalho">
      <span class="titulo">${escapar(t.titulo)}</span>
      ${t.a_avaliar > 0 ? `<span class="selo esperando">${t.a_avaliar} a avaliar</span>` : ''}
      ${t.publicada ? '' : '<span class="selo esperando">rascunho</span>'}
    </div>
    <div class="sub">${prazoTexto(t.prazo)} · ${t.entregas} entrega(s)${t.horas_sugeridas ? ' · ' + horas(t.horas_sugeridas) : ''}</div>
    <div class="acoes" style="margin-top:10px">
      <button class="secundario mini" data-ver-entregas="${t.id}">Ver entregas</button>
      <button class="perigo mini" data-remover-tarefa="${t.id}">Excluir</button>
    </div>
    <div data-entregas-de="${t.id}"></div>
  </div>`;
}

function desenharMuralProfessor() {
  const mural = estado.mural;
  if (!mural) {
    $('#mural-professor').innerHTML = '<div class="cartao"><p class="vazio">Escolha uma turma para ver as aulas.</p></div>';
    return;
  }
  const categorias = estado.categorias.filter((c) => c.ativa)
    .map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join('');

  const bloco = (titulo, sub, aulaId, materiais, tarefas, descricao, publicada) => `
    <div class="cartao">
      <div class="cabecalho">
        <h2 style="flex:1">${escapar(titulo)}</h2>
        ${publicada === 0 ? '<span class="selo esperando">rascunho</span>' : ''}
      </div>
      ${sub ? `<p class="explicacao" style="margin-bottom:8px">${escapar(sub)}</p>` : ''}
      ${descricao ? `<p style="margin:0 0 14px">${escapar(descricao)}</p>` : ''}

      ${materiais.length ? materiais.map((m) => blocoMaterial(m, true)).join('') : '<p class="vazio">Sem material ainda.</p>'}
      ${tarefas.length ? `<div style="margin-top:12px">${tarefas.map(blocoTarefaProfessor).join('')}</div>` : ''}

      <details style="margin-top:14px">
        <summary style="cursor:pointer;color:var(--acento);font-weight:600">Adicionar material</summary>
        <div class="campo" style="margin-top:12px">
          <label>Título</label><input data-mat-titulo="${aulaId}" placeholder="Ex.: Roteiro de observação">
        </div>
        <div class="linha">
          <div class="campo"><label>Arquivo</label>
            <input type="file" data-mat-arquivo="${aulaId}" accept=".pdf,.jpg,.jpeg,.png,.txt,.md"></div>
          <div class="campo"><label>ou link</label>
            <input data-mat-url="${aulaId}" placeholder="https://..."></div>
        </div>
        <button class="secundario mini" data-add-material="${aulaId}">Adicionar</button>
      </details>

      <details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--acento);font-weight:600">Criar tarefa</summary>
        <div class="campo" style="margin-top:12px">
          <label>Título</label><input data-tar-titulo="${aulaId}" placeholder="Ex.: Registro da observação 3">
        </div>
        <div class="campo">
          <label>Enunciado</label>
          <textarea data-tar-enunciado="${aulaId}" style="min-height:100px" placeholder="O que o aluno precisa fazer."></textarea>
        </div>
        <div class="linha">
          <div class="campo"><label>Prazo</label><input type="date" data-tar-prazo="${aulaId}"></div>
          <div class="campo"><label>Vale quantas horas</label>
            <input type="number" min="0" step="0.5" inputmode="decimal" data-tar-horas="${aulaId}" placeholder="4"></div>
          <div class="campo"><label>Categoria</label>
            <select data-tar-categoria="${aulaId}"><option value="">Sem categoria</option>${categorias}</select></div>
        </div>
        <button class="secundario mini" data-add-tarefa="${aulaId}">Criar tarefa</button>
      </details>
    </div>`;

  $('#mural-professor').innerHTML = [
    ...mural.aulas.map((a) => bloco(
      a.titulo, a.data_aula ? dataBr(a.data_aula) : '', a.id, a.materiais, a.tarefas, a.descricao, a.publicada,
    )),
    bloco('Material e tarefas da turma', 'Sem vínculo com uma aula específica', '',
      mural.avulsos.materiais, mural.avulsos.tarefas, null, 1),
  ].join('');
}

async function carregarMuralProfessor() {
  const turmaId = estado.turmaFiltro || estado.turmas[0]?.id;
  if (!turmaId) {
    estado.mural = null;
  } else {
    estado.mural = await api(`/api/turmas/${turmaId}/mural`);
    estado.mural.turma_id = turmaId;
  }
  desenharMuralProfessor();
}

$('#btn-criar-aula').onclick = async () => {
  const turmaId = estado.mural?.turma_id || estado.turmaFiltro || estado.turmas[0]?.id;
  if (!turmaId) return avisar('Crie uma turma antes de publicar aulas.');
  try {
    await api('/api/aulas', {
      metodo: 'POST',
      corpo: {
        turma_id: turmaId,
        titulo: $('#nova-aula-titulo').value,
        data_aula: $('#nova-aula-data').value,
        descricao: $('#nova-aula-descricao').value,
        publicada: $('#nova-aula-publicada').value === '1',
      },
    });
    $('#nova-aula-titulo').value = '';
    $('#nova-aula-descricao').value = '';
    await carregarMuralProfessor();
    avisar('Aula publicada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#mural-professor').addEventListener('click', async (e) => {
  const d = e.target.dataset;
  const turmaId = estado.mural?.turma_id;
  try {
    if (d.addMaterial !== undefined) {
      const chave = d.addMaterial;
      const arquivo = await lerParaEnvio($(`[data-mat-arquivo="${chave}"]`));
      const url = $(`[data-mat-url="${chave}"]`).value.trim();
      if (!arquivo && !url) return avisar('Escolha um arquivo ou informe um link.');
      await api('/api/materiais', {
        metodo: 'POST',
        corpo: {
          turma_id: turmaId,
          aula_id: chave || null,
          tipo: arquivo ? 'arquivo' : 'link',
          titulo: $(`[data-mat-titulo="${chave}"]`).value || arquivo?.nome || url,
          url: url || null,
          arquivo,
        },
      });
      await carregarMuralProfessor();
      avisar('Material adicionado.', 'ok');
    }

    if (d.addTarefa !== undefined) {
      const chave = d.addTarefa;
      await api('/api/tarefas', {
        metodo: 'POST',
        corpo: {
          turma_id: turmaId,
          aula_id: chave || null,
          titulo: $(`[data-tar-titulo="${chave}"]`).value,
          enunciado: $(`[data-tar-enunciado="${chave}"]`).value,
          prazo: $(`[data-tar-prazo="${chave}"]`).value,
          horas_sugeridas: $(`[data-tar-horas="${chave}"]`).value,
          categoria_id: $(`[data-tar-categoria="${chave}"]`).value || null,
        },
      });
      await carregarMuralProfessor();
      avisar('Tarefa criada.', 'ok');
    }

    if (d.removerMaterial) {
      await api(`/api/materiais/${d.removerMaterial}`, { metodo: 'DELETE' });
      await carregarMuralProfessor();
    }

    if (d.removerTarefa) {
      if (!confirm('Excluir a tarefa e as entregas dela?')) return;
      await api(`/api/tarefas/${d.removerTarefa}`, { metodo: 'DELETE' });
      await carregarMuralProfessor();
    }

    if (d.verEntregas) {
      const { entregas, sem_entregar: semEntregar } = await api(`/api/tarefas/${d.verEntregas}/entregas`);
      $(`[data-entregas-de="${d.verEntregas}"]`).innerHTML = `
        <div style="margin-top:12px">
          ${entregas.length ? entregas.map((en) => `
            <div class="item" style="margin-bottom:8px">
              <div class="cabecalho">
                <span class="titulo">${escapar(en.aluno_nome)}</span>
                ${SELO_ENTREGA[en.status]}
              </div>
              ${en.texto ? `<pre style="margin-top:10px">${escapar(en.texto)}</pre>` : ''}
              ${en.arquivo_id ? `<div class="sub" style="margin-top:8px">
                  <a href="/api/arquivos/${en.arquivo_id}" target="_blank" rel="noopener">${escapar(en.arquivo_nome)}</a>
                </div>` : ''}
              ${en.status === 'aceita' ? `<div class="sub">${horas(en.horas || 0)} lançadas como horas validadas</div>` : ''}
              <div class="linha" style="margin-top:10px">
                <div class="campo"><label>Horas a lançar</label>
                  <input type="number" min="0" step="0.5" inputmode="decimal" data-av-horas="${en.id}" value="${en.horas ?? ''}"></div>
                <div class="campo" style="flex:2"><label>Observação</label>
                  <input data-av-obs="${en.id}" value="${escapar(en.observacao || '')}" placeholder="Obrigatória para devolver"></div>
              </div>
              <div class="acoes">
                <button class="mini" data-aceitar="${en.id}">Aceitar</button>
                <button class="secundario mini" data-devolver="${en.id}">Devolver</button>
              </div>
            </div>`).join('') : '<p class="vazio">Ninguém entregou ainda.</p>'}
          ${semEntregar.length
            ? `<p class="sub">Ainda não entregaram: ${semEntregar.map((a) => escapar(a.nome)).join(', ')}</p>`
            : ''}
        </div>`;
    }

    if (d.aceitar || d.devolver) {
      const id = d.aceitar || d.devolver;
      await api(`/api/entregas/${id}/avaliacao`, {
        metodo: 'POST',
        corpo: {
          status: d.aceitar ? 'aceita' : 'devolvida',
          horas: $(`[data-av-horas="${id}"]`).value || undefined,
          observacao: $(`[data-av-obs="${id}"]`).value,
        },
      });
      await carregarMuralProfessor();
      await carregarProfessor();
      avisar(d.aceitar ? 'Entrega aceita e horas lançadas.' : 'Entrega devolvida ao aluno.', 'ok');
    }
  } catch (err) {
    falhar(err);
  }
});

// ---------------------------------------------------------------- carga

async function carregarAtividades() {
  const dados = await api('/api/atividades');
  estado.atividades = dados.atividades;
  estado.resumo = dados.resumo;
  desenharResumo();
  desenharCategorias();
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
  await carregarMuralProfessor();
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
  if (EQUIPE.includes(u.papel)) {
    const cargo = { admin: 'administração', coordenador: 'coordenação', professor: 'professor(a)' }[u.papel];
    $('#identificacao').textContent = [u.nome, cargo, u.instituicao].filter(Boolean).join(' · ');
    $('#painel-professor').classList.remove('oculto');
    $('#painel-aluno').classList.add('oculto');
    $('#cfg-nome').value = u.nome;
    $('#cfg-instituicao').value = u.instituicao || '';
    estado.turmas = dados.turmas || [];
    $('#aba-botao-convites').classList.toggle('oculto', !u.pode_convidar);
    $('#aba-botao-cursos').classList.toggle('oculto', u.papel !== 'admin');
    $('#aba-botao-usuarios').classList.toggle('oculto', u.papel !== 'admin');
    estado.categorias = dados.categorias;
    estado.cursos = dados.cursos || [];
    await carregarProfessor();
    await carregarChaves();
    if (u.papel === 'admin') await carregarAdmin();
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
      .filter((c) => c.ativa)
      .map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`)
      .join('');
    $('#meus-nome').value = u.nome;
    $('#meus-matricula').value = u.matricula || '';
    estado.resumo = dados.resumo;
    limparFormulario();
    abrirFormulario(false);
    await carregarAtividades();
    await carregarMuralAluno();
  }
}

iniciar().catch((err) => {
  mostrarEntrada();
  console.error(err);
});
