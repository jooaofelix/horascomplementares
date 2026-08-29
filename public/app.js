const $ = (sel) => document.querySelector(sel);

// Professor, coordenação e administração compartilham o mesmo painel; o que
// muda é o alcance de cada um, decidido no servidor.
const EQUIPE = ['professor', 'coordenador', 'admin'];

const SELO_STATUS = {
  pendente: ['esperando', 'aguardando análise'],
  em_analise: ['esperando', 'em análise'],
  correcao: ['esperando', 'devolvida para correção'],
  aprovado: ['ok', 'aprovada'],
  reprovado: ['reprovado', 'reprovada'],
};
const NA_FILA = ['pendente', 'em_analise', 'correcao'];
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
  materias: [],
  minhasMaterias: [],
  entregasACorrigir: 0,
  abaAberta: null,
  turmaFiltro: '',
  materiaFiltro: '',
  limiteArquivo: 0,
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

function avisar(mensagem, tipo = 'erro', alvo = null) {
  const emConfig = !$('#tela-config').classList.contains('oculto');
  const el = $(alvo ?? (emConfig ? '#aviso-config' : '#aviso-app'));
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
      // Mostra a sala e as matérias que vêm com ela, para o aluno conferir antes.
      caixa.innerHTML = `Turma <strong>${escapar(turma.nome)}</strong>${
        (turma.materias || []).length
          ? '<br><span class="sub">' + turma.materias
              .map((m) => `${escapar(m.nome)} — ${escapar(m.professor_nome || 'sem professor')}`)
              .join('<br>') + '</span>'
          : turma.professor_nome ? ' · Prof(a). ' + escapar(turma.professor_nome) : ''
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

// ---- configurações (engrenagem) ----

function abrirConfiguracoes(abrir) {
  $('#tela-config').classList.toggle('oculto', !abrir);
  $('#tela-app').classList.toggle('oculto', abrir);
  if (abrir) window.scrollTo({ top: 0 });
}

$('#btn-config').onclick = () => abrirConfiguracoes(true);
$('#btn-voltar').onclick = () => abrirConfiguracoes(false);

$$('#abas-config button').forEach((botao) => {
  botao.onclick = () => {
    $$('#abas-config button').forEach((b) => b.classList.toggle('ativa', b === botao));
    for (const secao of ['meus', 'cursos', 'usuarios', 'convites', 'integracao']) {
      $(`#config-${secao}`).classList.toggle('oculto', secao !== botao.dataset.config);
    }
  };
});

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
  const falta = Math.max(0, r.meta - r.validado);
  $('#n-validado').textContent = horas(r.validado);
  $('#n-aguardando').textContent = horas(r.aguardando ?? 0);
  $('#n-reprovado').textContent = horas(r.reprovado ?? 0);
  $('#n-restante').textContent = horas(falta);
  $('#linha-meta').textContent =
    `${horas(r.validado)} de ${horas(r.meta)} · ${r.registros} atividade(s) lançada(s)`;

  const pct = (v) => Math.min(100, (v / Math.max(r.meta, 1)) * 100);
  const validado = pct(r.validado);
  $('#barra-validado').style.width = `${validado}%`;
  $('#barra-pendente').style.width = `${Math.max(0, pct(r.declarado) - validado)}%`;

  $('#falta-meta').textContent = falta > 0
    ? `Faltam ${horas(falta)} validadas para fechar a meta.`
    : 'Meta de horas validadas atingida.';
}

function desenharCategorias() {
  const linhas = estado.resumo?.categorias ?? [];
  $('#cartao-categorias').classList.toggle('oculto', linhas.length === 0 || estado.contaHoras === false);
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
  const status = a.status || (a.validado ? 'aprovado' : 'pendente');
  const [classe, rotulo] = SELO_STATUS[status] ?? SELO_STATUS.pendente;
  const selo = `<span class="selo ${classe}">${rotulo}${
    status === 'aprovado' && a.validado_por_nome ? ' · ' + escapar(a.validado_por_nome) : ''
  }</span>`;
  const cargaCortada = status === 'aprovado' && a.horas_aprovadas != null && a.horas_aprovadas !== a.horas;

  const periodo = a.data_fim && a.data_fim !== a.data_atividade
    ? `${dataBr(a.data_atividade)} a ${dataBr(a.data_fim)}`
    : dataBr(a.data_atividade);

  const itens = [
    ['Data', periodo],
    ['Tipo', a.categoria],
    cargaCortada ? ['Aprovadas', `${horas(a.horas_aprovadas)} das ${horas(a.horas)} declaradas`] : null,
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
      ${visorArquivo(a.analise_arquivo_id, a.analise_arquivo_nome, a.analise_arquivo_tipo, 'Relatório do aluno')}
      ${visorArquivo(a.arquivo_id, a.arquivo_nome, a.arquivo_tipo, 'Comprovante')}
      ${!a.arquivo_id && a.arquivo_nome
        ? `<p class="sub" style="margin:12px 0 0">Arquivo: ${escapar(a.arquivo_nome)}</p>` : ''}
      ${a.motivo || a.observacao
        ? `<div class="observacao"><strong>${
             status === 'reprovado' ? 'Motivo da reprovação'
             : status === 'correcao' ? 'O professor pediu'
             : a.horas_revisao ? 'O professor havia pedido'
             : 'Professor'}:</strong> ${escapar(a.motivo || a.observacao)}</div>`
        : ''}
      ${analise}
      <details style="margin-top:10px"><summary data-historico="${a.id}">Ver histórico da solicitação</summary>
        <div data-historico-de="${a.id}" class="sub" style="margin-top:10px">carregando…</div>
      </details>
      ${comEdicao && status === 'correcao'
        ? `<div class="bloco" style="margin:16px 0 0">
             <h3>Reenviar para validação</h3>
             <p class="explicacao">
               Depois de devolvida, a atividade não é editada: você corrige, diz quanto tempo isso
               levou e reenvia. Esse tempo entra nas suas horas.
             </p>
             <div class="campo">
               <label>Quantas horas você levou corrigindo</label>
               <input type="number" min="0" step="0.5" inputmode="decimal" data-reenvio-horas="${a.id}" placeholder="Ex.: 1,5">
             </div>
             <div class="campo">
               <label>Sua análise corrigida <span class="opcional">(deixe como está se não mudou)</span></label>
               <textarea data-reenvio-texto="${a.id}" style="min-height:110px">${escapar(a.texto || '')}</textarea>
             </div>
             <div class="campo">
               <label>Trocar o arquivo <span class="opcional">(opcional)</span></label>
               <input type="file" data-reenvio-arquivo="${a.id}"
                      accept=".pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.txt,.md,.csv">
             </div>
             <div class="acoes">
               <button class="mini" data-reenviar="${a.id}">Reenviar para validação</button>
               <button class="perigo mini" data-excluir="${a.id}">Excluir</button>
             </div>
           </div>`
        : comEdicao
          ? `<div class="acoes" style="margin-top:16px">
               <button class="secundario mini" data-editar="${a.id}">Editar</button>
               <button class="perigo mini" data-excluir="${a.id}">Excluir</button>
             </div>`
          : ''}
      ${comValidacao
        ? `<div style="margin-top:16px">
             <div class="linha">
               <div class="campo">
                 <label>Horas a aprovar</label>
                 <input type="number" min="0" step="0.5" inputmode="decimal" data-horas-aprovadas="${a.id}"
                        value="${a.horas_aprovadas ?? a.horas}">
               </div>
               <div class="campo" style="flex:2">
                 <label>Motivo <span class="opcional">(obrigatório para reprovar ou devolver)</span></label>
                 <input data-motivo="${a.id}" value="${escapar(a.motivo || '')}">
               </div>
             </div>
             <div class="acoes">
               <button class="mini" data-analise="${a.id}" data-status="aprovado">Aprovar</button>
               <button class="secundario mini" data-analise="${a.id}" data-status="correcao">Devolver para correção</button>
               <button class="perigo mini" data-analise="${a.id}" data-status="reprovado">Reprovar</button>
             </div>
           </div>`
        : ''}
    </article>`;
}

function filtrar(lista, termo, status) {
  const t = termo.trim().toLowerCase();
  return lista.filter((a) => {
    const dela = a.status || (a.validado ? 'aprovado' : 'pendente');
    if (status === 'fila' && !NA_FILA.includes(dela)) return false;
    if (status && status !== 'fila' && dela !== status) return false;
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

const formulario = { arquivoNome: null, analiseArquivo: null };

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
  formulario.analiseArquivo = null;
  $('#anexo-atual').classList.add('oculto');
  $('#analise-anexada').classList.add('oculto');
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
    // Os dois anexos sobem junto com o resto do formulário.
    corpo.arquivo = await lerParaEnvio($('#ativ-arquivo'));
    corpo.arquivo_analise = await arquivoParaEnvio(formulario.analiseArquivo);
    await api(id ? `/api/atividades/${id}` : '/api/atividades', { metodo: id ? 'PUT' : 'POST', corpo });
    $('#ativ-arquivo').value = '';
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
  const idReenviar = e.target.dataset.reenviar;

  if (idReenviar) {
    const horasCorrecao = $(`[data-reenvio-horas="${idReenviar}"]`).value;
    if (!horasCorrecao) return avisar('Diga quantas horas você levou corrigindo.');
    e.target.disabled = true;
    try {
      await api(`/api/atividades/${idReenviar}/reenviar`, {
        metodo: 'POST',
        corpo: {
          horas_revisao: horasCorrecao,
          texto: $(`[data-reenvio-texto="${idReenviar}"]`).value,
          arquivo_analise: await lerParaEnvio($(`[data-reenvio-arquivo="${idReenviar}"]`)),
        },
      });
      await carregarAtividades();
      avisar('Reenviado. A professora recebeu o aviso e vai validar.', 'ok');
    } catch (err) {
      falhar(err);
    } finally {
      e.target.disabled = false;
    }
    return;
  }

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
    $('#ativ-arquivo').value = '';
    formulario.analiseArquivo = null;
    $('#analise-anexada').classList.toggle('oculto', !a.analise_arquivo_id);
    if (a.analise_arquivo_id) {
      $('#analise-anexada').innerHTML =
        `Relatório já anexado: <a href="/api/arquivos/${a.analise_arquivo_id}" target="_blank" rel="noopener">${
          escapar(a.analise_arquivo_nome || 'abrir')}</a> — anexe outro só se quiser trocar.`;
    }
    // Já tem comprovante anexado: só troca se o aluno escolher outro arquivo.
    $('#anexo-atual').classList.toggle('oculto', !a.arquivo_id);
    if (a.arquivo_id) {
      $('#anexo-atual').innerHTML =
        `Já anexado: <a href="/api/arquivos/${a.arquivo_id}" target="_blank" rel="noopener">${
          escapar(a.arquivo_nome || 'comprovante')}</a> — escolha outro arquivo só se quiser trocar.`;
    }
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

// ---- o arquivo da análise ----

// .txt e .md entram como texto no próprio campo; qualquer outro formato (o
// caso comum: o relatório em PDF) vira anexo da atividade.
const EH_TEXTO = /\.(txt|md|markdown)$/i;

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
  const semExtensao = arquivo.name.replace(/\.[^.]+$/, '');
  if (!$('#ativ-titulo').value.trim()) $('#ativ-titulo').value = semExtensao;

  if (EH_TEXTO.test(arquivo.name) || arquivo.type.startsWith('text/')) {
    if (arquivo.size > 2 * 1024 * 1024) return avisar('Arquivo de texto grande demais (limite de 2 MB).');
    const conteudo = await arquivo.text();
    const atual = $('#ativ-texto').value.trim();
    $('#ativ-texto').value = atual ? `${atual}\n\n${conteudo}` : conteudo;
    formulario.arquivoNome = arquivo.name;
    return atualizarContador();
  }

  if (estado.limiteArquivo && arquivo.size > estado.limiteArquivo) {
    const limite = (estado.limiteArquivo / (1024 * 1024)).toFixed(1).replace('.', ',');
    return avisar(`O arquivo passa do limite de ${limite} MB.`);
  }
  formulario.analiseArquivo = arquivo;
  $('#analise-anexada').classList.remove('oculto');
  $('#analise-anexada').textContent = `Relatório anexado: ${arquivo.name}`;
}

// ---------------------------------------------------------------- professor

// A tela do professor tem dois estados: o menu inicial, com os quatro botões
// grandes, e uma seção aberta, com o "Voltar ao início" em cima. Nada de abas
// pequenas — quem usa isso uma vez por semana precisa ver para onde está indo.
const SECOES = {
  aulas: 'Aulas e tarefas',
  registros: 'Horas complementares',
  turma: 'Meus alunos',
  turmas: 'Turmas e matérias',
};

function mostrarAba(qual) {
  const aba = typeof qual === 'string' ? qual : qual?.dataset.aba;
  estado.abaAberta = aba && SECOES[aba] ? aba : null;

  for (const nome of Object.keys(SECOES)) {
    $(`#aba-${nome}`).classList.toggle('oculto', nome !== estado.abaAberta);
  }
  $('#inicio-professor').classList.toggle('oculto', Boolean(estado.abaAberta));
  $('#topo-secao').classList.toggle('oculto', !estado.abaAberta);
  if (estado.abaAberta) $('#titulo-secao').textContent = SECOES[estado.abaAberta];

  // O seletor de matéria só aparece onde ele muda alguma coisa.
  $('#filtro-turma-cartao').classList.toggle(
    'oculto',
    !['turma', 'registros', 'aulas'].includes(estado.abaAberta) || estado.materias.length < 2,
  );
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('#menu-professor button').forEach((botao) => {
  botao.onclick = () => {
    mostrarAba(botao);
    // Abrir a seção busca o estado atual: um aluno pode ter entrado na turma
    // enquanto a página estava aberta.
    carregarProfessor().catch(falhar);
  };
});

$('#btn-voltar-inicio').onclick = () => {
  mostrarAba(null);
  carregarProfessor().catch(falhar);
};

$('#filtro-turma').addEventListener('change', async (e) => {
  estado.materiaFiltro = e.target.value;
  const materia = estado.materias.find((m) => String(m.id) === String(estado.materiaFiltro));
  // A matéria escolhida também decide de qual turma são os alunos e as horas.
  estado.turmaFiltro = materia ? String(materia.turma_id) : '';
  await carregarProfessor();
});

// As marcas vermelhas do menu: o que está esperando por esta pessoa hoje.
function desenharMenuProfessor() {
  const naFila = estado.atividades.filter((a) => NA_FILA.includes(a.status || 'pendente')).length;
  const comHoras = estado.materias.some((m) => m.conta_horas);

  const marcar = (id, quantos, um, varios) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('oculto', !quantos);
    el.textContent = quantos ? `${quantos} ${quantos > 1 ? varios : um}` : '';
  };
  marcar('#marca-entregas', estado.entregasACorrigir, 'entrega para corrigir', 'entregas para corrigir');
  marcar('#marca-horas', comHoras ? naFila : 0, 'lançamento para ver', 'lançamentos para ver');
  marcar('#marca-turmas', estado.turmas.length ? 0 : 1, 'crie a sua primeira turma', '');

  // "Profa. Helena Duarte" vira "Helena": é assim que ela é chamada.
  const primeiro = (estado.usuario?.nome || '')
    .replace(/^(prof|profa|professor|professora|dr|dra)\.?\s+/i, '')
    .split(' ')[0];
  $('#saudacao-professor').textContent = estado.turmas.length
    ? `Olá, ${primeiro}. O que você quer fazer agora?`
    : 'Bem-vinda! Comece criando a sua turma em "Turmas e matérias".';

  // Sem nenhuma matéria que gere horas, esse botão só confunde.
  $('#menu-professor button[data-aba="registros"]').classList.toggle('oculto', !comHoras);
}

function desenharResumoProfessor() {
  const alunos = estado.alunos;
  const aValidar = alunos.reduce((total, a) => total + a.pendentes, 0);
  const aCorrigir = estado.entregasACorrigir;
  const comHoras = estado.materias.some((m) => m.conta_horas);

  const pecas = [
    ['var(--alunos)', alunos.length, alunos.length === 1 ? 'aluno' : 'alunos'],
    ['var(--aulas)', aCorrigir, aCorrigir === 1 ? 'entrega a corrigir' : 'entregas a corrigir'],
    comHoras ? ['var(--horas)', aValidar, aValidar === 1 ? 'lançamento a validar' : 'lançamentos a validar'] : null,
  ].filter(Boolean);

  $('#resumo-professor').innerHTML = pecas
    .map(([cor, n, r]) => `<div class="peca" style="--cor-peca:${cor}"><div class="n">${n}</div><div class="r">${r}</div></div>`)
    .join('');
  $('#resumo-professor').classList.remove('oculto');
}

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
            ${a.conta_horas
              ? `<span><b>${horas(a.validado)}</b> validadas</span>
                 <span><b>${horas(a.declarado)}</b> lançadas</span>
                 <span>meta ${horas(meta)}</span>
                 ${a.pendentes > 0 ? `<span class="selo esperando">${a.pendentes} a validar</span>` : ''}`
              : '<span class="sub">sala sem matéria que gere horas</span>'}
          </div>
          <details style="margin-top:12px">
            <summary data-anotacoes="${a.id}" style="cursor:pointer;color:var(--alunos);font-weight:600;font-size:15px">
              Anotações sobre o aluno
            </summary>
            <div data-anotacoes-de="${a.id}" class="sub" style="margin-top:10px">carregando…</div>
          </details>
        </div>`;
      }).join('')
    : `<p class="vazio">Nenhum aluno entrou ainda. Abra a aba <strong>Turmas</strong>, toque em
         <strong>Copiar convite</strong> e cole no grupo da turma: o código é o que abre a porta.</p>`;
}

async function mostrarAnotacoes(alunoId, alvo) {
  try {
    const { anotacoes } = await api(`/api/alunos/${alunoId}/anotacoes`);
    alvo.innerHTML = `
      ${anotacoes.length
        ? anotacoes.map((n) => `<div class="anotacao">
            ${escapar(n.texto)}
            <div class="quem">
              ${escapar(n.autor_nome || 'alguém')} · ${dataBr(n.criada_em)}
              ${n.autor_id === estado.usuario.id
                ? `<button class="perigo mini" data-apagar-anotacao="${n.id}" style="margin-left:8px">apagar</button>`
                : ''}
            </div>
          </div>`).join('')
        : '<p class="vazio">Nada anotado ainda. O aluno nunca vê o que fica aqui.</p>'}
      <textarea data-nova-anotacao="${alunoId}" style="min-height:90px;margin-top:10px"
                placeholder="Ex.: faltou nos dois últimos encontros; combinamos reposição em 12/05."></textarea>
      <button class="secundario mini" data-salvar-anotacao="${alunoId}" style="margin-top:8px">Salvar anotação</button>`;
  } catch (err) {
    alvo.textContent = err.message;
  }
}

$('#lista-alunos').addEventListener('click', async (e) => {
  const { anotacoes, salvarAnotacao, apagarAnotacao } = e.target.dataset;
  try {
    if (anotacoes) {
      const alvo = $(`[data-anotacoes-de="${anotacoes}"]`);
      if (alvo) await mostrarAnotacoes(anotacoes, alvo);
    }
    if (salvarAnotacao) {
      const campo = $(`[data-nova-anotacao="${salvarAnotacao}"]`);
      if (!campo.value.trim()) return avisar('Escreva a anotação antes de salvar.');
      await api(`/api/alunos/${salvarAnotacao}/anotacoes`, { metodo: 'POST', corpo: { texto: campo.value } });
      await mostrarAnotacoes(salvarAnotacao, $(`[data-anotacoes-de="${salvarAnotacao}"]`));
      avisar('Anotação salva. Só a equipe vê.', 'ok');
    }
    if (apagarAnotacao) {
      const alunoId = e.target.closest('[data-anotacoes-de]').dataset.anotacoesDe;
      await api(`/api/anotacoes/${apagarAnotacao}`, { metodo: 'DELETE' });
      await mostrarAnotacoes(alunoId, $(`[data-anotacoes-de="${alunoId}"]`));
    }
  } catch (err) {
    falhar(err);
  }
});

function desenharListaProfessor() {
  const lista = filtrar(estado.atividades, $('#busca-prof').value, $('#filtro-status-prof').value);
  $('#lista-prof').innerHTML = lista.length
    ? lista.map((a) => cartaoAtividade(a, { comAluno: true, comValidacao: true })).join('')
    : '<p class="vazio">Nada para mostrar com esses filtros.</p>';


}

async function mostrarHistorico(id, alvo) {
  try {
    const { historico } = await api(`/api/atividades/${id}/historico`);
    alvo.innerHTML = historico.length
      ? historico.map((h) => `<div style="padding:6px 0;border-bottom:1px solid var(--linha, var(--borda))">
          <strong>${dataBr(h.criado_em)} ${String(h.criado_em).slice(11, 16)}</strong> ·
          ${escapar(h.usuario_nome)}${h.papel ? ` (${escapar(h.papel)})` : ''}<br>${escapar(h.descricao)}
        </div>`).join('')
      : 'Sem registros.';
  } catch (err) {
    alvo.textContent = err.message;
  }
}

document.addEventListener('click', (e) => {
  const id = e.target.dataset?.historico;
  if (!id) return;
  const alvo = $(`[data-historico-de="${id}"]`);
  if (alvo) mostrarHistorico(id, alvo);
});

$('#lista-prof').addEventListener('click', async (e) => {
  const id = e.target.dataset.analise;
  if (!id) return;
  const status = e.target.dataset.status;
  try {
    await api(`/api/atividades/${id}/analise`, {
      metodo: 'POST',
      corpo: {
        status,
        horas_aprovadas: $(`[data-horas-aprovadas="${id}"]`)?.value,
        motivo: $(`[data-motivo="${id}"]`)?.value || '',
      },
    });
    await carregarProfessor();
    avisar({
      aprovado: 'Horas aprovadas.',
      correcao: 'Devolvida ao aluno para correção.',
      reprovado: 'Solicitação reprovada.',
    }[status], 'ok');
  } catch (err) {
    falhar(err);
  }
});

$('#busca-prof').addEventListener('input', desenharListaProfessor);
$('#filtro-status-prof').addEventListener('change', desenharListaProfessor);

// ---- turmas ----

function desenharTurmas() {
  $('#form-nova-turma').open = !estado.turmas.length;
  $('#lista-turmas').innerHTML = estado.turmas.length
    ? estado.turmas.map((t) => `<div class="item" data-area="turmas">
        <div class="nome">${escapar(t.nome)}</div>
        <div class="sub">${escapar(t.periodo || 'sem período')} · ${t.alunos} aluno(s)</div>
        <div class="codigo-turma">
          <span class="valor">${escapar(t.codigo || '——')}</span>
          <button class="secundario mini" data-copiar="${escapar(t.codigo || '')}">Copiar convite</button>
        </div>

        <div class="bloco">
          <h3>Matérias desta turma</h3>
          ${(t.materias || []).length
            ? t.materias.map((m) => materiaEditavel(m)).join('')
            : '<p class="vazio">Nenhuma matéria ainda.</p>'}
          <details class="dobra fina">
            <summary><span class="mais">+</span> Adicionar uma matéria minha</summary>
            <div class="campo">
              <label>Nome da matéria</label>
              <input data-nova-materia="${t.id}" maxlength="120" placeholder="Ex.: Psicologia Social">
            </div>
            <label class="opcao-turma" style="margin-bottom:10px">
              <input type="checkbox" data-nova-materia-conta="${t.id}">
              <span>Gera horas complementares <span class="sub">— estágio, extensão, monitoria</span></span>
            </label>
            <button class="secundario mini" data-add-materia="${t.id}">Adicionar matéria</button>
          </details>
        </div>

        ${t.posso_editar ? `<div class="bloco">
          <h3>Dados da turma</h3>
          <div class="linha">
            <div class="campo"><label>Nome</label><input data-turma-nome="${t.id}" value="${escapar(t.nome)}"></div>
            <div class="campo"><label>Período</label><input data-turma-periodo="${t.id}" value="${escapar(t.periodo || '')}"></div>
            <div class="campo"><label>Meta (h)</label><input data-turma-meta="${t.id}" type="number" min="1" inputmode="numeric" value="${t.meta_horas}"></div>
          </div>
          <div class="acoes">
            <button class="secundario mini" data-salvar-turma="${t.id}">Salvar</button>
            <button class="perigo mini" data-excluir-turma="${t.id}">Excluir turma</button>
          </div>
        </div>` : `<p class="sub">Turma de ${escapar(t.professor_nome || 'outro professor')} — você cuida da sua matéria nela.</p>`}
      </div>`).join('')
    : '<p class="vazio">Nenhuma turma ainda. Crie a primeira acima — leva um minuto.</p>';
}

// A matéria do colega aparece na lista, mas só quem dá ela é que edita.
const materiaEditavel = (m) => `<div class="materia${m.posso_editar ? '' : ' de-colega'}">
    <div class="cabecalho">
      <span class="titulo">${escapar(m.nome)}</span>
      ${m.conta_horas ? '<span class="selo ok">gera horas</span>' : ''}
    </div>
    <div class="sub">${escapar(m.professor_nome || 'sem professor')}</div>
    ${m.posso_editar ? `<details class="dobra fina discreta">
      <summary>Editar matéria</summary>
      <div class="campo">
        <label>Nome da matéria</label>
        <input data-materia-nome="${m.id}" value="${escapar(m.nome)}">
      </div>
      <label class="opcao-turma" style="margin-bottom:10px">
        <input type="checkbox" data-materia-conta="${m.id}" ${m.conta_horas ? 'checked' : ''}>
        <span>Gera horas complementares <span class="sub">— estágio, extensão, monitoria</span></span>
      </label>
      <div class="acoes">
        <button class="secundario mini" data-salvar-materia="${m.id}">Salvar matéria</button>
        <button class="perigo mini" data-excluir-materia="${m.id}">Excluir</button>
      </div>
    </details>` : ''}
  </div>`;

$('#btn-criar-turma').onclick = async () => {
  try {
    await api('/api/turmas', {
      metodo: 'POST',
      corpo: {
        nome: $('#nova-turma-nome').value,
        materia: $('#nova-turma-materia').value,
        periodo: $('#nova-turma-periodo').value,
        curso_id: $('#nova-turma-curso').value || null,
        meta_horas: $('#nova-turma-meta').value || undefined,
        conta_horas: $('#nova-turma-conta').checked,
      },
    });
    $('#nova-turma-nome').value = '';
    $('#nova-turma-materia').value = '';
    $('#nova-turma-periodo').value = '';
    await carregarProfessor();
    avisar('Turma criada. Passe o código para os alunos.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

// Entrar na sala de um colega: o código é o mesmo que o aluno usa.
$('#btn-entrar-turma').onclick = async () => {
  try {
    const { turma } = await api('/api/materias', {
      metodo: 'POST',
      corpo: {
        codigo_turma: $('#entrar-codigo').value,
        nome: $('#entrar-materia').value,
        conta_horas: $('#entrar-conta').checked,
      },
    });
    $('#entrar-codigo').value = '';
    $('#entrar-materia').value = '';
    $('#entrar-conta').checked = false;
    await carregarProfessor();
    avisar(`Sua matéria entrou em ${turma.nome}.`, 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#lista-turmas').addEventListener('click', async (e) => {
  const {
    salvarTurma, excluirTurma, copiar, addMateria, salvarMateria, excluirMateria,
  } = e.target.dataset;
  try {
    if (copiar !== undefined) {
      const convite = `Entre na nossa sala: ${location.origin} — código da turma: ${copiar}`;
      await navigator.clipboard.writeText(convite);
      avisar('Convite copiado — cole no grupo da turma.', 'ok');
    }
    if (addMateria) {
      const nome = $(`[data-nova-materia="${addMateria}"]`).value;
      if (!nome.trim()) return avisar('Dê um nome à matéria.');
      await api('/api/materias', {
        metodo: 'POST',
        corpo: {
          turma_id: Number(addMateria),
          nome,
          conta_horas: $(`[data-nova-materia-conta="${addMateria}"]`).checked,
        },
      });
      await carregarProfessor();
      avisar('Matéria criada.', 'ok');
    }
    if (salvarMateria) {
      await api(`/api/materias/${salvarMateria}`, {
        metodo: 'PUT',
        corpo: {
          nome: $(`[data-materia-nome="${salvarMateria}"]`).value,
          conta_horas: $(`[data-materia-conta="${salvarMateria}"]`).checked,
        },
      });
      await carregarProfessor();
      avisar('Matéria atualizada.', 'ok');
    }
    if (excluirMateria) {
      if (!confirm('Excluir esta matéria?')) return;
      await api(`/api/materias/${excluirMateria}`, { metodo: 'DELETE' });
      await carregarProfessor();
      avisar('Matéria excluída.', 'ok');
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
      if (!confirm('Excluir esta turma inteira, com as matérias dela?')) return;
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
      corpo: {
        nome: $('#cfg-nome').value,
        instituicao: $('#cfg-instituicao').value,
        avisar_email: $('#cfg-avisar').checked,
      },
    });
    avisar('Dados salvos.', 'ok');
    await iniciar();
  } catch (err) {
    falhar(err);
  }
};

// ---------------------------------------------------------------- aulas e tarefas

// Lê o arquivo escolhido e devolve no formato que a API espera.
const lerParaEnvio = (input) => arquivoParaEnvio(input?.files?.[0]);

function arquivoParaEnvio(arquivo) {
  if (!arquivo) return Promise.resolve(null);
  if (estado.limiteArquivo && arquivo.size > estado.limiteArquivo) {
    const limite = (estado.limiteArquivo / (1024 * 1024)).toFixed(1).replace('.', ',');
    const tamanho = (arquivo.size / (1024 * 1024)).toFixed(1).replace('.', ',');
    return Promise.reject(new Error(`O arquivo tem ${tamanho} MB e o limite aqui é ${limite} MB.`));
  }
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

const numero = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// A tarefa vale hora complementar (estágio, extensão) ou nota (disciplina).
const valorTarefa = (t) =>
  t.nota_maxima ? `vale nota até ${numero(t.nota_maxima)}`
  : t.horas_sugeridas ? `vale ${horas(t.horas_sugeridas)}`
  : '';

const notaDaEntrega = (e, t = {}) =>
  e?.nota !== null && e?.nota !== undefined
    ? `nota ${numero(e.nota)}${t.nota_maxima ? ` de ${numero(t.nota_maxima)}` : ''}`
    : '';

const SELO_ENTREGA = {
  enviada: '<span class="selo esperando">aguardando avaliação</span>',
  devolvida: '<span class="selo esperando">devolvida para correção</span>',
  aceita: '<span class="selo ok">aceita</span>',
};

// Ver o documento sem sair da tela: PDF e imagem abrem aqui mesmo, o resto
// (Word, planilha) só faz sentido baixado. Baixar fica sempre à mão.
function visorArquivo(id, nome, tipo, rotulo = 'Documento') {
  if (!id) return '';
  const ehPdf = String(tipo || '').includes('pdf') || /\.pdf$/i.test(nome || '');
  const ehImagem = String(tipo || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(nome || '');
  const dentro = ehPdf
    ? `<iframe class="visor" src="/api/arquivos/${id}" title="${escapar(nome || rotulo)}"></iframe>`
    : ehImagem
      ? `<img class="visor" src="/api/arquivos/${id}" alt="${escapar(nome || rotulo)}">`
      : `<p class="sub" style="margin:10px 0 0">Este formato não abre aqui dentro — use “Baixar”.</p>`;

  return `<div class="anexo">
    <div class="cabecalho">
      <span class="titulo">${escapar(rotulo)}</span>
      <span class="sub">${escapar(nome || '')}</span>
    </div>
    <div class="acoes" style="margin-top:8px">
      <a class="botao-link" href="/api/arquivos/${id}?baixar" download>Baixar</a>
      <a class="botao-link" href="/api/arquivos/${id}" target="_blank" rel="noopener">Abrir em outra aba</a>
    </div>
    ${ehPdf || ehImagem
      ? `<details class="dobra fina discreta" style="margin-top:6px">
           <summary>Ver aqui mesmo</summary>${dentro}
         </details>`
      : dentro}
  </div>`;
}

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

function blocoTarefaAluno(t, materiaNome = '') {
  const entrega = t.minha_entrega;
  return `<div class="item" style="margin-bottom:10px">
    <div class="cabecalho">
      <span class="titulo">${escapar(t.titulo)}</span>
      ${entrega ? SELO_ENTREGA[entrega.status] : '<span class="selo esperando">a entregar</span>'}
    </div>
    <div class="sub">
      ${[materiaNome && escapar(materiaNome), prazoTexto(t.prazo), valorTarefa(t)].filter(Boolean).join(' · ')}
    </div>
    ${t.enunciado ? `<p style="margin:10px 0 0">${escapar(t.enunciado)}</p>` : ''}
    ${entrega?.observacao ? `<div class="observacao"><strong>Professor:</strong> ${escapar(entrega.observacao)}</div>` : ''}
    ${entrega?.status === 'aceita'
      ? `<p class="sub" style="margin-top:10px">${
          notaDaEntrega(entrega, t)
            ? 'Corrigida: <strong>' + notaDaEntrega(entrega, t) + '</strong>.'
            : `Suas ${horas(entrega.horas || 0)} já entraram como horas validadas.`}</p>`
      : `<div style="margin-top:12px">
           <textarea data-entrega-texto="${t.id}" placeholder="Escreva sua resposta aqui">${escapar(entrega?.texto || '')}</textarea>
           ${entrega?.status === 'devolvida'
             ? `<div class="campo" style="margin-top:10px">
                  <label>Quanto tempo levou para refazer <span class="opcional">(em horas)</span></label>
                  <input type="number" min="0" step="0.5" inputmode="decimal"
                         data-entrega-revisao="${t.id}" placeholder="Ex.: 1,5">
                  <div class="ajuda">Esse tempo entra na conta das suas horas quando o professor aceitar.</div>
                </div>`
             : ''}
           ${entrega?.horas_revisao
             ? `<p class="sub" style="margin:10px 0 0">Revisão já informada: ${horas(entrega.horas_revisao)}.</p>`
             : ''}
           <div class="campo" style="margin-top:10px">
             <label>Anexo <span class="opcional">(PDF, JPG ou PNG)</span></label>
             <input type="file" data-entrega-arquivo="${t.id}" accept=".pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.txt,.md,.csv">
             ${entrega?.arquivo_nome ? `<div class="ajuda">Já enviado: ${escapar(entrega.arquivo_nome)}</div>` : ''}
           </div>
           <button data-enviar-entrega="${t.id}">${entrega ? 'Reenviar entrega' : 'Entregar'}</button>
         </div>`}
  </div>`;
}

function desenharMuralAluno() {
  const mural = estado.mural;
  const materias = mural?.materias ?? [];
  const temAlgo = materias.some(
    (m) => m.aulas.length || m.avulsos.materiais.length || m.avulsos.tarefas.length,
  );
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

  // O que falta entregar vem primeiro, de todas as matérias juntas, com o nome
  // da matéria em cada tarefa — é a pergunta que o aluno faz ao abrir o app.
  const pendentes = materias.flatMap((m) =>
    [...m.aulas.flatMap((a) => a.tarefas), ...m.avulsos.tarefas]
      .filter((t) => !t.minha_entrega || t.minha_entrega.status === 'devolvida')
      .map((t) => ({ ...t, materia_nome: m.nome })));

  const daMateria = (m) => {
    const corpo = [
      ...m.aulas.map((a) => secao(a.titulo, a.data_aula ? dataBr(a.data_aula) : '', a.materiais, a.tarefas, a.descricao)),
      (m.avulsos.materiais.length || m.avulsos.tarefas.length)
        ? secao('Material e tarefas soltas', '', m.avulsos.materiais, m.avulsos.tarefas, null)
        : '',
    ].join('');
    if (!corpo) return '';
    return `<div class="bloco">
      <span class="etiqueta">${escapar(m.professor_nome || 'sem professor')}</span>
      <h2>${escapar(m.nome)}${m.conta_horas ? ' <span class="selo ok">gera horas</span>' : ''}</h2>
      ${corpo}
    </div>`;
  };

  $('#mural-aluno').innerHTML = [
    pendentes.length
      ? `<div class="bloco"><h2>Para entregar</h2>${pendentes
          .map((t) => blocoTarefaAluno(t, t.materia_nome))
          .join('')}</div>`
      : '',
    ...materias.map(daMateria),
  ].join('');
}

$('#mural-aluno').addEventListener('click', async (e) => {
  const id = e.target.dataset.enviarEntrega;
  if (!id) return;
  // A mesma tarefa aparece em "Para entregar" e dentro da matéria. Ler os
  // campos do cartão em que o aluno clicou — e não do primeiro da página — é o
  // que faz o texto enviado ser o que ele escreveu.
  const cartao = e.target.closest('.item') || document;
  const campo = (nome) => cartao.querySelector(`[data-entrega-${nome}="${id}"]`);
  e.target.disabled = true;
  try {
    const arquivo = await lerParaEnvio(campo('arquivo'));
    await api(`/api/tarefas/${id}/entrega`, {
      metodo: 'PUT',
      corpo: {
        texto: campo('texto').value,
        horas_revisao: campo('revisao')?.value || undefined,
        arquivo,
      },
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
    <div class="sub">${[prazoTexto(t.prazo), `${t.entregas} entrega(s)`, valorTarefa(t)].filter(Boolean).join(' · ')}</div>
    <div class="acoes" style="margin-top:10px">
      <button class="secundario mini" data-ver-entregas="${t.id}">Ver entregas</button>
      <button class="perigo mini" data-remover-tarefa="${t.id}">Excluir</button>
    </div>
    <div data-entregas-de="${t.id}"></div>
  </div>`;
}

function desenharEscolhaTurmas() {
  const caixa = $('#nova-aula-turmas');
  if (!caixa) return;
  const minhas = estado.minhasMaterias;
  const marcada = (m) => String(m.id) === String(estado.materiaFiltro) || minhas.length === 1;
  caixa.innerHTML = minhas.length
    ? minhas.map((m) => `<label class="opcao-turma">
        <input type="checkbox" value="${m.id}" ${marcada(m) ? 'checked' : ''}>
        <span>${escapar(m.nome)} <span class="sub">· ${escapar(m.turma_nome)}</span></span>
      </label>`).join('')
    : '<p class="vazio">Crie uma turma com a sua matéria antes de publicar aulas.</p>';
}

const materiasMarcadas = () =>
  Array.from(document.querySelectorAll('#nova-aula-turmas input:checked')).map((c) => Number(c.value));

function desenharMuralProfessor() {
  const mural = estado.mural;
  // Sem matéria nenhuma, o próximo passo é criar a turma — a tela diz isso em
  // vez de mostrar um mural vazio.
  if (!mural) {
    $('#mural-professor').innerHTML = `<div class="cartao" data-area="turmas">
      <span class="etiqueta">Primeiro passo</span>
      <h2>Crie a sua turma</h2>
      <p class="explicacao">
        Vá na aba <strong>Turmas</strong> e crie a turma com a sua matéria. Você recebe um código de
        6 letras para passar aos alunos — é com ele que eles entram. Depois volte aqui para publicar
        a primeira aula.
      </p>
    </div>`;
    $('#form-nova-aula').open = false;
    return;
  }
  const categorias = estado.categorias.filter((c) => c.ativa)
    .map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join('');
  // Matéria de estágio avalia em horas complementares; disciplina, em nota.
  const comHoras = !!mural.materia?.conta_horas;

  const bloco = (titulo, sub, aulaId, materiais, tarefas, descricao, publicada, turmasDaAula = '') => `
    <div class="cartao">
      <div class="cabecalho">
        <h2 style="flex:1">${escapar(titulo)}</h2>
        ${publicada === 0 ? '<span class="selo esperando">rascunho</span>' : ''}
      </div>
      ${sub ? `<p class="explicacao" style="margin-bottom:8px">${escapar(sub)}</p>` : ''}
      ${turmasDaAula ? `<p class="sub" style="margin:-4px 0 12px">Também em: ${escapar(turmasDaAula)}</p>` : ''}
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
            <input type="file" data-mat-arquivo="${aulaId}" accept=".pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.txt,.md,.csv"></div>
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
          ${comHoras
            ? `<div class="campo"><label>Vale quantas horas</label>
                 <input type="number" min="0" step="0.5" inputmode="decimal" data-tar-horas="${aulaId}" placeholder="4"></div>
               <div class="campo"><label>Categoria da hora</label>
                 <select data-tar-categoria="${aulaId}"><option value="">Sem categoria</option>${categorias}</select></div>`
            : `<div class="campo"><label>Vale nota até</label>
                 <input type="number" min="0" step="0.5" inputmode="decimal" data-tar-nota="${aulaId}" placeholder="10"></div>`}
        </div>
        <button class="secundario mini" data-add-tarefa="${aulaId}">Criar tarefa</button>
      </details>
    </div>`;

  // Matéria ainda sem nada dentro: o formulário já abre, para não deixar o
  // professor procurando por onde começar.
  $('#form-nova-aula').open = !mural.aulas.length;

  $('#mural-professor').innerHTML = [
    `<div class="bloco"><h2>${escapar(mural.materia?.nome || 'Matéria')}</h2>
       <p class="explicacao">${escapar(mural.turma?.nome || '')}${
         mural.materia?.conta_horas ? ' · as tarefas aceitas viram horas complementares' : ''}</p></div>`,
    ...mural.aulas.map((a) => bloco(
      a.titulo, a.data_aula ? dataBr(a.data_aula) : '', a.id, a.materiais, a.tarefas, a.descricao, a.publicada,
      // Só vale dizer onde mais a aula está quando ela vai para mais de uma.
      (a.materias ?? []).length > 1
        ? a.materias.filter((m) => m.id !== mural.materia?.id).map((m) => `${m.nome} — ${m.turma_nome}`).join(' · ')
        : '',
    )),
    bloco('Material e tarefas soltas', 'Sem vínculo com uma aula específica', '',
      mural.avulsos.materiais, mural.avulsos.tarefas, null, 1),
  ].join('');
}

async function carregarMuralProfessor() {
  const materiaId = estado.materiaFiltro || estado.materias[0]?.id;
  if (!materiaId) {
    estado.mural = null;
  } else {
    estado.mural = await api(`/api/materias/${materiaId}/mural`);
    estado.mural.materia_id = Number(materiaId);
  }
  desenharMuralProfessor();
}

$('#btn-criar-aula').onclick = async () => {
  const materias = materiasMarcadas();
  if (!materias.length) return avisar('Marque ao menos uma matéria para receber a aula.');
  try {
    await api('/api/aulas', {
      metodo: 'POST',
      corpo: {
        materia_ids: materias,
        titulo: $('#nova-aula-titulo').value,
        data_aula: $('#nova-aula-data').value,
        descricao: $('#nova-aula-descricao').value,
        publicada: $('#nova-aula-publicada').value === '1',
        arquivo: await lerParaEnvio($('#nova-aula-arquivo')),
      },
    });
    $('#nova-aula-titulo').value = '';
    $('#nova-aula-descricao').value = '';
    $('#nova-aula-arquivo').value = '';
    // O mural mostra uma matéria por vez: cai na primeira que acabou de receber
    // a aula, senão o professor publica e não vê nada mudar.
    estado.materiaFiltro = String(materias[0]);
    const escolhida = estado.materias.find((m) => String(m.id) === estado.materiaFiltro);
    estado.turmaFiltro = escolhida ? String(escolhida.turma_id) : '';
    await carregarProfessor();
    avisar('Aula publicada.', 'ok');
  } catch (err) {
    falhar(err);
  }
};

$('#mural-professor').addEventListener('click', async (e) => {
  const d = e.target.dataset;
  const materiaId = estado.mural?.materia_id;
  try {
    if (d.addMaterial !== undefined) {
      const chave = d.addMaterial;
      const arquivo = await lerParaEnvio($(`[data-mat-arquivo="${chave}"]`));
      const url = $(`[data-mat-url="${chave}"]`).value.trim();
      if (!arquivo && !url) return avisar('Escolha um arquivo ou informe um link.');
      await api('/api/materiais', {
        metodo: 'POST',
        corpo: {
          materia_id: materiaId,
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
          materia_id: materiaId,
          aula_id: chave || null,
          titulo: $(`[data-tar-titulo="${chave}"]`).value,
          enunciado: $(`[data-tar-enunciado="${chave}"]`).value,
          prazo: $(`[data-tar-prazo="${chave}"]`).value,
          horas_sugeridas: $(`[data-tar-horas="${chave}"]`)?.value,
          nota_maxima: $(`[data-tar-nota="${chave}"]`)?.value,
          categoria_id: $(`[data-tar-categoria="${chave}"]`)?.value || null,
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
      const { entregas, sem_entregar: semEntregar, tarefa } = await api(`/api/tarefas/${d.verEntregas}/entregas`);
      $(`[data-entregas-de="${d.verEntregas}"]`).innerHTML = `
        <div style="margin-top:12px">
          ${entregas.length ? entregas.map((en) => `
            <div class="item" style="margin-bottom:8px">
              <div class="cabecalho">
                <span class="titulo">${escapar(en.aluno_nome)}</span>
                ${en.turma_nome ? `<span class="sub">${escapar(en.turma_nome)}</span>` : ''}
                ${SELO_ENTREGA[en.status]}
              </div>
              ${en.texto ? `<pre style="margin-top:10px">${escapar(en.texto)}</pre>` : ''}
              ${visorArquivo(en.arquivo_id, en.arquivo_nome, en.arquivo_tipo, 'Entrega do aluno')}
              ${en.status === 'aceita'
                ? `<div class="sub">${notaDaEntrega(en, tarefa) || `${horas(en.horas || 0)} lançadas como horas validadas`}</div>`
                : ''}
              <div class="linha" style="margin-top:10px">
                ${tarefa.nota_maxima
                  ? `<div class="campo"><label>Nota (até ${numero(tarefa.nota_maxima)})</label>
                       <input type="number" min="0" step="0.5" inputmode="decimal" data-av-nota="${en.id}" value="${en.nota ?? ''}"></div>`
                  : `<div class="campo"><label>Horas a lançar</label>
                       <input type="number" min="0" step="0.5" inputmode="decimal" data-av-horas="${en.id}"
                              value="${en.horas ?? (((tarefa.horas_sugeridas ?? 0) + (en.horas_revisao ?? 0)) || '')}">
                       ${en.horas_revisao
                         ? `<div class="ajuda">${numero(tarefa.horas_sugeridas ?? 0)} h da tarefa + ${
                              numero(en.horas_revisao)} h que o aluno levou refazendo.</div>`
                         : ''}</div>`}
                <div class="campo" style="flex:2"><label>Observação</label>
                  <input data-av-obs="${en.id}" value="${escapar(en.observacao || '')}" placeholder="Obrigatória para devolver"></div>
              </div>
              <div class="acoes">
                <button class="mini" data-aceitar="${en.id}">Aceitar</button>
                <button class="secundario mini" data-devolver="${en.id}">Devolver</button>
              </div>
            </div>`).join('') : '<p class="vazio">Ninguém entregou ainda.</p>'}
          ${semEntregar.length
            ? `<p class="sub">Ainda não entregaram: ${semEntregar.map((a) =>
                escapar(a.nome) + (a.turma_nome ? ` (${escapar(a.turma_nome)})` : '')).join(', ')}</p>`
            : ''}
        </div>`;
    }

    if (d.aceitar || d.devolver) {
      const id = d.aceitar || d.devolver;
      await api(`/api/entregas/${id}/avaliacao`, {
        metodo: 'POST',
        corpo: {
          status: d.aceitar ? 'aceita' : 'devolvida',
          horas: $(`[data-av-horas="${id}"]`)?.value || undefined,
          nota: $(`[data-av-nota="${id}"]`)?.value || undefined,
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
  estado.entregasACorrigir = turma.entregas_a_corrigir || 0;
  estado.turmas = turma.turmas;
  // As matérias que este usuário administra, com a turma junto: é por elas que
  // ele navega. Publicar é mais estrito — só nas que ele mesmo dá.
  estado.materias = estado.turmas.flatMap((t) =>
    (t.materias || [])
      .filter((m) => m.posso_editar)
      .map((m) => ({ ...m, turma_nome: t.nome, periodo: t.periodo })));
  estado.minhasMaterias = estado.materias.filter((m) => m.minha);

  $('#filtro-turma').innerHTML = [
    '<option value="">Todas as matérias</option>',
    ...estado.turmas.map((t) => {
      const minhas = estado.materias.filter((m) => m.turma_id === t.id);
      if (!minhas.length) return '';
      return `<optgroup label="${escapar(t.periodo ? `${t.nome} — ${t.periodo}` : t.nome)}">${
        minhas.map((m) =>
          `<option value="${m.id}" ${String(m.id) === String(estado.materiaFiltro) ? 'selected' : ''}>${escapar(m.nome)}</option>`,
        ).join('')}</optgroup>`;
    }),
  ].join('');
  $('#filtro-turma-cartao').classList.toggle(
    'oculto',
    estado.materias.length < 2 || !['turma', 'registros', 'aulas'].includes(estado.abaAberta),
  );

  desenharAlunos();
  desenharResumoProfessor();
  desenharMenuProfessor();
  desenharListaProfessor();
  desenharTurmas();
  desenharEscolhaTurmas();
  await carregarMuralProfessor();
}

async function iniciar() {
  const dados = await api('/api/eu');
  estado.usuario = dados.usuario;
  estado.categorias = dados.categorias;
  estado.limiteArquivo = dados.limite_arquivo || 0;

  if (!estado.usuario) {
    $('#campo-convite').dataset.obrigatorio = dados.convite_obrigatorio ? '1' : '';
    return mostrarEntrada();
  }

  $('#tela-entrada').classList.add('oculto');
  $('#tela-app').classList.remove('oculto');

  const u = estado.usuario;
  if (EQUIPE.includes(u.papel)) {
    const cargo = { admin: 'administração', coordenador: 'coordenação', professor: 'professor(a)' }[u.papel];
    $('#titulo-app').textContent = u.instituicao || 'Sala de Aula';
    $('#identificacao').textContent = [u.nome, cargo].filter(Boolean).join(' · ');
    $('#identificacao-config').textContent = $('#identificacao').textContent;
    $('#painel-professor').classList.remove('oculto');
    $('#painel-aluno').classList.add('oculto');
    $('#cfg-nome').value = u.nome;
    $('#cfg-instituicao').value = u.instituicao || '';
    $('#cfg-avisar').checked = u.avisar_email !== 0;
    // Dizer com todas as letras se o envio está ligado neste servidor.
    $('#estado-email').innerHTML = dados.email_configurado
      ? `✅ O envio de e-mail está <strong>ligado</strong> neste sistema (as mensagens saem de ${
          escapar(dados.email_de || '')}).`
      : '⚠️ O envio de e-mail ainda <strong>não foi ligado</strong> neste sistema: nenhum aviso sai. '
        + 'Quem publica precisa configurar EMAIL_CHAVE e EMAIL_DE (veja o README).';
    estado.turmas = dados.turmas || [];
    $('#config-botao-convites').classList.toggle('oculto', !u.pode_convidar);
    $('#config-botao-integracao').classList.remove('oculto');
    const limiteMb = (estado.limiteArquivo / (1024 * 1024)).toFixed(1).replace('.', ',');
    const ajuda = $('#ajuda-formatos');
    if (ajuda) ajuda.textContent = `PDF, PPTX, DOCX, planilha, imagem ou texto — até ${limiteMb} MB por arquivo.`;
    $('#config-botao-cursos').classList.toggle('oculto', u.papel !== 'admin');
    $('#config-botao-usuarios').classList.toggle('oculto', u.papel !== 'admin');
    estado.categorias = dados.categorias;
    estado.cursos = dados.cursos || [];
    await carregarProfessor();
    mostrarAba(null);
    await carregarChaves();
    if (u.papel === 'admin') await carregarAdmin();
    if (u.pode_convidar) await carregarConvites();
  } else {
    const materias = dados.materias || [];
    $('#titulo-app').textContent = materias.find((m) => m.instituicao)?.instituicao || 'Sala de Aula';
    $('#identificacao').textContent = [u.nome, u.turma_nome].filter(Boolean).join(' · ');
    $('#identificacao-config').textContent = $('#identificacao').textContent;
    // O aluno tem vários professores: quem gera hora é quem interessa aqui.
    const deHoras = materias.filter((m) => m.conta_horas).map((m) => m.nome);
    $('#explicacao-progresso').textContent = u.turma_nome
      ? `Turma ${u.turma_nome}${deHoras.length ? ' · horas de ' + deHoras.join(', ') : ''}`
      : 'Você ainda não está em uma turma — informe o código em “Seus dados”.';
    $('#painel-aluno').classList.remove('oculto');
    $('#painel-professor').classList.add('oculto');
    $('#ativ-categoria').innerHTML = estado.categorias
      .filter((c) => c.ativa)
      .map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`)
      .join('');
    $('#meus-nome').value = u.nome;
    $('#meus-matricula').value = u.matricula || '';
    // Disciplina comum não gera hora complementar: a seção some para o aluno.
    const comHoras = dados.conta_horas !== false;
    for (const id of ['#cartao-horas-aluno', '#btn-abrir-form', '#cartao-atividades-aluno']) {
      $(id)?.classList.toggle('oculto', !comHoras);
    }
    estado.contaHoras = comHoras;
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
